import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AgentDelta,
  AgentMessage,
  AgentNode,
  AgentSession,
  AgentSessionSummary,
  AgentStatus,
  AgentToolCall,
  AgentUsage,
  AgentProvider,
  ToolStatus,
} from "./types";
import { createAdapter, type Adapter, type Sink } from "./adapters";
import { buildSpawn, type AgentMode } from "./providers";
import { emptyUsage } from "./adapters/base";
import { truncate } from "./tools";

/** Raw provider lines kept per run, for the debug view. Bounded. */
const MAX_RAW = 1500;
/** Assistant messages kept per run. Bounded — a long run is mostly prose. */
const MAX_MESSAGES = 600;
/** Finished runs held in memory. Older ones stay on disk. */
const MAX_SESSIONS = 60;

interface Live {
  session: AgentSession;
  child: ChildProcess | null;
  adapter: Adapter;
  emitter: EventEmitter;
  raw: { line: string; at: number }[];
  stdoutBuf: string;
  stderrBuf: string;
  /** Collected stderr, used to explain a failure the JSONL never reported. */
  stderrText: string;
  cancelled: boolean;
}

function storeDir(): string {
  return path.join(process.cwd(), ".devdeck", "agents");
}

export interface StartOptions {
  provider: AgentProvider;
  project: string;
  cwd: string;
  prompt: string;
  mode: AgentMode;
  resume?: string | null;
}

class AgentSessionManager {
  private live = new Map<string, Live>();

  /* ── Lifecycle ────────────────────────────────────────────────────────── */

  start(opts: StartOptions): AgentSession {
    const id = randomUUID();
    const at = Date.now();

    const session: AgentSession = {
      id,
      provider: opts.provider,
      project: opts.project,
      cwd: opts.cwd,
      prompt: opts.prompt,
      status: "starting",
      providerSessionId: null,
      model: null,
      startedAt: at,
      endedAt: null,
      exitCode: null,
      result: null,
      error: null,
      usage: emptyUsage(),
      nodes: [],
      toolCalls: [],
      messages: [],
    };

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);

    const entry: Live = {
      session,
      child: null,
      adapter: null as unknown as Adapter,
      emitter,
      raw: [],
      stdoutBuf: "",
      stderrBuf: "",
      stderrText: "",
      cancelled: false,
    };
    this.live.set(id, entry);
    entry.adapter = createAdapter(opts.provider, this.sinkFor(entry));

    const { file, args } = buildSpawn(opts.provider, {
      prompt: opts.prompt,
      cwd: opts.cwd,
      mode: opts.mode,
      resume: opts.resume ?? null,
    });

    const child = spawn(file, args, {
      cwd: opts.cwd,
      // Own process group, so cancelling kills the agent's children too.
      detached: true,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        // Every one of these CLIs reads a piped stdin and will otherwise block
        // forever waiting for input that is never coming.
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    entry.child = child;
    this.patchStatus(entry, "running");

    child.stdout?.on("data", (d: Buffer) => this.onStdout(entry, d.toString()));
    child.stderr?.on("data", (d: Buffer) => this.onStderr(entry, d.toString()));

    child.on("error", (err) => {
      entry.session.error = `Failed to start ${file}: ${err.message}`;
      this.settle(entry, "failed", null);
    });

    child.on("exit", (code) => {
      // Flush whatever is left in the line buffers before settling.
      if (entry.stdoutBuf.trim()) this.feed(entry, entry.stdoutBuf);
      entry.stdoutBuf = "";
      entry.child = null;
      entry.adapter.close(code);
      this.settle(entry, entry.cancelled ? "cancelled" : null, code);
    });

    return session;
  }

  async cancel(id: string): Promise<boolean> {
    const entry = this.live.get(id);
    if (!entry?.child?.pid) return false;
    entry.cancelled = true;
    const pid = entry.child.pid;

    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          entry.child?.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        kill("SIGKILL");
        resolve();
      }, 4000);
      entry.child?.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return true;
  }

  /* ── Stream plumbing ──────────────────────────────────────────────────── */

  private onStdout(entry: Live, chunk: string): void {
    entry.stdoutBuf += chunk;
    // JSONL: split on newlines and keep the trailing partial line buffered.
    const lines = entry.stdoutBuf.split("\n");
    entry.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) this.feed(entry, line);
    }
  }

  private feed(entry: Live, line: string): void {
    const at = Date.now();
    entry.raw.push({ line, at });
    if (entry.raw.length > MAX_RAW) entry.raw.splice(0, entry.raw.length - MAX_RAW);
    this.emit(entry, { type: "raw", line, at });
    try {
      entry.adapter.line(line);
    } catch {
      // A malformed event must never take the run down with it.
    }
  }

  private onStderr(entry: Live, chunk: string): void {
    entry.stderrText = truncate(entry.stderrText + chunk, 4000);
    entry.stderrBuf += chunk;
    const lines = entry.stderrBuf.split("\n");
    entry.stderrBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const at = Date.now();
      entry.raw.push({ line: `stderr: ${line}`, at });
      this.emit(entry, { type: "raw", line: `stderr: ${line}`, at });
    }
  }

  private emit(entry: Live, delta: AgentDelta): void {
    entry.emitter.emit("delta", delta);
  }

  /* ── Sink: adapters write through this ────────────────────────────────── */

  private sinkFor(entry: Live): Sink {
    const s = entry.session;
    return {
      cwd: s.cwd,
      now: () => Date.now(),

      meta: (patch) => {
        if (patch.providerSessionId !== undefined) s.providerSessionId = patch.providerSessionId;
        if (patch.model !== undefined) s.model = patch.model;
        this.emit(entry, {
          type: "meta",
          providerSessionId: s.providerSessionId,
          model: s.model,
        });
      },

      node: (node: AgentNode) => {
        const i = s.nodes.findIndex((n) => n.id === node.id);
        if (i === -1) s.nodes.push(node);
        else s.nodes[i] = { ...s.nodes[i], ...node };
        this.emit(entry, { type: "node", node: s.nodes[i === -1 ? s.nodes.length - 1 : i] });
      },

      nodePatch: (id, patch) => {
        const i = s.nodes.findIndex((n) => n.id === id);
        if (i === -1) return;
        s.nodes[i] = { ...s.nodes[i], ...patch };
        this.emit(entry, { type: "node", node: s.nodes[i] });
      },

      toolStart: (call: AgentToolCall) => {
        s.toolCalls.push(call);
        const i = s.nodes.findIndex((n) => n.id === call.nodeId);
        if (i !== -1) {
          const node = s.nodes[i];
          const files =
            call.path && !node.files.includes(call.path) && call.effect !== "execute"
              ? [...node.files, call.path]
              : node.files;
          s.nodes[i] = { ...node, toolCalls: node.toolCalls + 1, files };
          this.emit(entry, { type: "node", node: s.nodes[i] });
        }
        this.emit(entry, { type: "tool", call });
      },

      toolEnd: (id, patch: { status: ToolStatus; result: string | null; endedAt: number }) => {
        const i = s.toolCalls.findIndex((c) => c.id === id);
        if (i === -1) return;
        s.toolCalls[i] = { ...s.toolCalls[i], ...patch };
        this.emit(entry, { type: "tool", call: s.toolCalls[i] });
      },

      message: (message: AgentMessage) => {
        s.messages.push(message);
        if (s.messages.length > MAX_MESSAGES) {
          s.messages.splice(0, s.messages.length - MAX_MESSAGES);
        }
        this.emit(entry, { type: "message", message });
      },

      usage: (usage: AgentUsage) => {
        s.usage = usage;
        this.emit(entry, { type: "usage", usage });
      },

      finish: ({ status, result, error }) => {
        if (result !== undefined) s.result = result;
        if (error !== undefined) s.error = error;
        this.emit(entry, { type: "result", result: s.result, error: s.error });
        // The exit handler settles the run; recording the verdict here means a
        // provider that reports failure still exits 0 is reported correctly.
        s.status = status;
      },
    };
  }

  /* ── Settling ─────────────────────────────────────────────────────────── */

  private patchStatus(entry: Live, status: AgentStatus): void {
    entry.session.status = status;
    this.emit(entry, {
      type: "status",
      status,
      endedAt: entry.session.endedAt,
      exitCode: entry.session.exitCode,
    });
  }

  private settle(entry: Live, forced: AgentStatus | null, code: number | null): void {
    const s = entry.session;
    if (s.endedAt) return;

    s.endedAt = Date.now();
    s.exitCode = code;

    if (forced) s.status = forced;
    else if (s.status === "starting" || s.status === "running") {
      s.status = code === 0 ? "succeeded" : "failed";
    }

    if (s.status === "failed" && !s.error) {
      // Prefer the CLI's own stderr — it is where auth and billing failures
      // are reported, and it is far more useful than "exited with code 1".
      s.error = entry.stderrText.trim() || `Exited with code ${code}`;
    }

    // Any node still marked running is stale now.
    for (let i = 0; i < s.nodes.length; i++) {
      if (s.nodes[i].status === "running") {
        s.nodes[i] = {
          ...s.nodes[i],
          status: s.status === "succeeded" ? "done" : "failed",
          endedAt: s.endedAt,
          activity: null,
        };
      }
    }

    this.emit(entry, {
      type: "status",
      status: s.status,
      endedAt: s.endedAt,
      exitCode: s.exitCode,
    });
    void this.persist(s);
    this.trim();
  }

  private trim(): void {
    const finished = [...this.live.values()]
      .filter((e) => e.session.endedAt != null)
      .sort((a, b) => (a.session.endedAt ?? 0) - (b.session.endedAt ?? 0));
    while (finished.length > MAX_SESSIONS) {
      const drop = finished.shift();
      if (drop) this.live.delete(drop.session.id);
    }
  }

  /* ── Persistence ──────────────────────────────────────────────────────── */

  private async persist(session: AgentSession): Promise<void> {
    try {
      const dir = storeDir();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${session.id}.json`),
        JSON.stringify(session),
        "utf8"
      );
    } catch {
      // History is a convenience; failing to write it must not break the run.
    }
  }

  /** Sessions on disk, newest first. Used for history beyond the memory cap. */
  async archived(limit = 100): Promise<AgentSessionSummary[]> {
    let files: string[];
    try {
      files = await fs.readdir(storeDir());
    } catch {
      return [];
    }
    const out: AgentSessionSummary[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(storeDir(), f), "utf8");
        out.push(summarise(JSON.parse(raw) as AgentSession));
      } catch {
        /* skip unreadable */
      }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  async load(id: string): Promise<AgentSession | null> {
    const inMemory = this.live.get(id);
    if (inMemory) return inMemory.session;
    try {
      const raw = await fs.readFile(path.join(storeDir(), `${id}.json`), "utf8");
      return JSON.parse(raw) as AgentSession;
    } catch {
      return null;
    }
  }

  /* ── Reads ────────────────────────────────────────────────────────────── */

  get(id: string): AgentSession | null {
    return this.live.get(id)?.session ?? null;
  }

  rawLog(id: string): { line: string; at: number }[] {
    return this.live.get(id)?.raw ?? [];
  }

  list(project?: string): AgentSessionSummary[] {
    return [...this.live.values()]
      .map((e) => e.session)
      .filter((s) => !project || s.project === project)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(summarise);
  }

  /** Every session currently in memory, for the cross-project graph. */
  all(): AgentSession[] {
    return [...this.live.values()].map((e) => e.session);
  }

  subscribe(id: string, onDelta: (delta: AgentDelta) => void): (() => void) | null {
    const entry = this.live.get(id);
    if (!entry) return null;
    entry.emitter.on("delta", onDelta);
    return () => entry.emitter.off("delta", onDelta);
  }
}

function summarise(s: AgentSession): AgentSessionSummary {
  const root = s.nodes.find((n) => n.kind === "root");
  return {
    id: s.id,
    provider: s.provider,
    project: s.project,
    prompt: s.prompt,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    subagents: s.nodes.filter((n) => n.kind === "subagent").length,
    toolCalls: s.toolCalls.length,
    costUsd: s.usage.costUsd,
    activity: root?.activity ?? null,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __devdeckAgents: AgentSessionManager | undefined;
}

export const agents: AgentSessionManager =
  globalThis.__devdeckAgents ?? (globalThis.__devdeckAgents = new AgentSessionManager());
