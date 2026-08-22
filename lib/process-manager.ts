import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  PackageManager,
  ProcessState,
  ProcessStatus,
  TaskKind,
  TaskStatus,
  TaskView,
} from "./types";

const MAX_LOG_LINES = 500;

interface LogLine {
  id: number;
  time: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

interface ManagedProcess {
  /** Opaque key. Never parsed back into its parts — a project directory name
   *  may itself contain whatever separator we'd pick, so `project` and `label`
   *  are stored explicitly instead. */
  name: string;
  project: string;
  /** npm script name, or the git operation ("push"/"pull"/"fetch"). */
  label: string;
  kind: TaskKind;
  child: ChildProcess | null;
  status: ProcessStatus;
  startedAt: number | null;
  endedAt: number | null;
  detectedPort: number | null;
  exitCode: number | null;
  logs: LogLine[];
  logSeq: number;
  /** Set when the user asked to stop, so an exit isn't reported as a crash. */
  stopping: boolean;
  readyTimer: NodeJS.Timeout | null;
  emitter: EventEmitter;
}

/**
 * The manager is a singleton kept on globalThis so it survives Next.js dev
 * HMR recompiles (which otherwise reset module-level state).
 */
class ProcessManager {
  private procs = new Map<string, ManagedProcess>();

  private get(name: string): ManagedProcess {
    let p = this.procs.get(name);
    if (!p) {
      p = {
        name,
        project: name,
        label: "dev",
        kind: "server",
        child: null,
        status: "stopped",
        startedAt: null,
        endedAt: null,
        detectedPort: null,
        exitCode: null,
        logs: [],
        logSeq: 0,
        stopping: false,
        readyTimer: null,
        emitter: new EventEmitter(),
      };
      p.emitter.setMaxListeners(50);
      this.procs.set(name, p);
    }
    return p;
  }

  private pushLog(
    p: ManagedProcess,
    stream: LogLine["stream"],
    chunk: string
  ): void {
    const lines = chunk.replace(/\r/g, "").split("\n");
    for (const raw of lines) {
      if (raw.length === 0) continue;
      const line: LogLine = {
        id: p.logSeq++,
        time: Date.now(),
        stream,
        text: raw,
      };
      p.logs.push(line);

      // Detect the listening port from common dev-server output.
      if (p.detectedPort == null) {
        const m =
          raw.match(/localhost:(\d{2,5})/) ??
          raw.match(/127\.0\.0\.1:(\d{2,5})/) ??
          raw.match(/:\/\/[^\s:]+:(\d{4,5})/);
        if (m) p.detectedPort = Number(m[1]);
      }

      // Common "server is up" signals -> flip to running early.
      if (
        p.status === "starting" &&
        /(ready in|compiled|listening|local:|ready on|started server|running at)/i.test(
          raw
        )
      ) {
        this.setStatus(p, "running");
      }

      p.emitter.emit("log", line);
    }
    if (p.logs.length > MAX_LOG_LINES) {
      p.logs.splice(0, p.logs.length - MAX_LOG_LINES);
    }
  }

  private setStatus(p: ManagedProcess, status: ProcessStatus): void {
    if (p.status === status) return;
    p.status = status;
    p.emitter.emit("status", status);
  }

  start(opts: {
    name: string;
    cwd: string;
    packageManager: PackageManager | null;
    script: string;
    /** Force the dev server onto this port (sets PORT env + forwards a flag). */
    port?: number | null;
    /** Extra args forwarded to the script after "--" (e.g. ["-p", "3000"]). */
    extraArgs?: string[];
  }): ProcessState {
    const p = this.get(opts.name);
    if (p.status === "running" || p.status === "starting") {
      return this.state(opts.name);
    }

    const pm = opts.packageManager ?? "npm";
    // pnpm/npm/yarn/bun all support "<pm> run <script>".
    const args = ["run", opts.script];
    // Forward port (and any other) args to the underlying script. npm/yarn/bun
    // consume a "--" separator and pass the rest to the script; pnpm instead
    // forwards args placed directly after the script and passes a literal "--"
    // through (which breaks the flag), so it must NOT get the separator.
    const forwarded = opts.extraArgs ?? [];
    if (forwarded.length > 0) {
      if (pm === "pnpm") args.push(...forwarded);
      else args.push("--", ...forwarded);
    }

    p.logs = [];
    // Note: logSeq is intentionally NOT reset here. It stays monotonic across
    // restarts so log-line ids remain unique for any client whose log stream is
    // still connected (resetting to 0 produced duplicate React keys).
    p.detectedPort = null;
    p.exitCode = null;
    p.stopping = false;
    p.startedAt = Date.now();
    this.setStatus(p, "starting");
    this.pushLog(p, "system", `$ ${pm} ${args.join(" ")}  (in ${opts.cwd})`);

    const child = spawn(pm, args, {
      cwd: opts.cwd,
      // New process group so we can kill the whole tree (dev servers fork).
      detached: true,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        // Keep child output unbuffered-ish.
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
        // Most node dev servers honor PORT; the forwarded flag covers the rest.
        ...(opts.port != null ? { PORT: String(opts.port) } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    p.child = child;

    child.stdout?.on("data", (d: Buffer) => this.pushLog(p, "stdout", d.toString()));
    child.stderr?.on("data", (d: Buffer) => this.pushLog(p, "stderr", d.toString()));

    child.on("error", (err) => {
      this.pushLog(p, "system", `Failed to start: ${err.message}`);
      this.setStatus(p, "crashed");
      p.child = null;
    });

    child.on("exit", (code, signal) => {
      if (p.readyTimer) {
        clearTimeout(p.readyTimer);
        p.readyTimer = null;
      }
      p.exitCode = code;
      p.child = null;
      p.endedAt = Date.now();

      // start() only ever runs dev servers; one-shot runs go through runTask(),
      // which installs its own exit handler with task semantics (exit 0 =
      // succeeded rather than merely stopped).
      if (p.stopping || signal === "SIGTERM" || code === 0 || code == null) {
        this.pushLog(p, "system", `Process stopped${signal ? ` (${signal})` : ""}.`);
        this.setStatus(p, "stopped");
      } else {
        this.pushLog(p, "system", `Process crashed (exit code ${code}).`);
        this.setStatus(p, "crashed");
      }
      p.startedAt = null;
    });

    // Fallback: if it's still alive after a short grace period and we never
    // saw a "ready" signal, treat it as running.
    p.readyTimer = setTimeout(() => {
      if (p.status === "starting" && p.child) this.setStatus(p, "running");
    }, 4000);

    return this.state(opts.name);
  }

  async stop(name: string): Promise<ProcessState> {
    const p = this.get(name);
    const child = p.child;
    if (!child || child.pid == null) {
      this.setStatus(p, "stopped");
      return this.state(name);
    }

    p.stopping = true;
    this.pushLog(p, "system", "Stopping…");
    const pid = child.pid;

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        // Negative pid kills the whole process group (detached spawn).
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    killGroup("SIGTERM");

    // Escalate to SIGKILL if it doesn't exit promptly.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killGroup("SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    return this.state(name);
  }

  state(name: string): ProcessState {
    const p = this.get(name);
    return {
      status: p.status,
      pid: p.child?.pid ?? null,
      startedAt: p.startedAt,
      detectedPort: p.detectedPort,
      exitCode: p.exitCode,
      logCount: p.logs.length,
    };
  }

  /**
   * Snapshot of dev-server states only. One-shot tasks share this map but must
   * not leak into the dashboard payload, which is keyed by project name.
   */
  allStates(): Record<string, ProcessState> {
    const out: Record<string, ProcessState> = {};
    for (const [key, p] of this.procs) {
      if (p.kind === "server") out[key] = this.state(key);
    }
    return out;
  }

  /* ── One-shot tasks (npm scripts and git operations) ─────────────────── */

  private taskStatus(p: ManagedProcess): TaskStatus {
    if (p.child) return "running";
    return p.exitCode === 0 ? "succeeded" : "failed";
  }

  private toTaskView(p: ManagedProcess): TaskView {
    return {
      key: p.name,
      project: p.project,
      label: p.label,
      kind: p.kind,
      status: this.taskStatus(p),
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      exitCode: p.exitCode,
    };
  }

  /** Every non-server run, optionally filtered to one project. */
  tasks(project?: string): TaskView[] {
    const out: TaskView[] = [];
    for (const p of this.procs.values()) {
      if (p.kind === "server") continue;
      if (project && p.project !== project) continue;
      out.push(this.toTaskView(p));
    }
    return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  taskView(key: string): TaskView | null {
    const p = this.procs.get(key);
    if (!p || p.kind === "server") return null;
    return this.toTaskView(p);
  }

  /**
   * Run a one-shot command (an npm script or a git operation) with its output
   * streamed through the same log/SSE plumbing as a dev server.
   *
   * Re-running a task that is still in flight is refused; re-running a finished
   * one resets its buffer.
   */
  runTask(opts: {
    key: string;
    project: string;
    label: string;
    kind: Exclude<TaskKind, "server">;
    cwd: string;
    file: string;
    args: string[];
  }): { started: boolean; reason?: string } {
    const p = this.get(opts.key);
    if (p.child) {
      return { started: false, reason: `"${opts.label}" is already running` };
    }

    p.project = opts.project;
    p.label = opts.label;
    p.kind = opts.kind;
    p.logs = [];
    p.exitCode = null;
    p.endedAt = null;
    p.stopping = false;
    p.startedAt = Date.now();
    this.setStatus(p, "starting");
    this.pushLog(p, "system", `$ ${opts.file} ${opts.args.join(" ")}`);

    const child = spawn(opts.file, opts.args, {
      cwd: opts.cwd,
      detached: true,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        // No terminal is attached, so a credential prompt would hang forever.
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    p.child = child;
    this.setStatus(p, "running");

    child.stdout?.on("data", (d: Buffer) => this.pushLog(p, "stdout", d.toString()));
    child.stderr?.on("data", (d: Buffer) => this.pushLog(p, "stderr", d.toString()));
    child.on("error", (err) => {
      this.pushLog(p, "system", `Failed to start: ${err.message}`);
      p.exitCode = -1;
      p.endedAt = Date.now();
      p.child = null;
      this.setStatus(p, "crashed");
    });

    child.on("exit", (code, signal) => {
      p.exitCode = code;
      p.endedAt = Date.now();
      p.child = null;
      const ms = p.startedAt ? Date.now() - p.startedAt : 0;
      if (code === 0) {
        this.pushLog(p, "system", `Finished successfully in ${(ms / 1000).toFixed(1)}s.`);
        this.setStatus(p, "stopped");
      } else {
        this.pushLog(
          p,
          "system",
          `Failed (${signal ? `signal ${signal}` : `exit code ${code}`}).`
        );
        this.setStatus(p, "crashed");
      }
    });

    return { started: true };
  }

  getLogs(name: string): LogLine[] {
    return this.get(name).logs;
  }

  /** Subscribe to live log + status events. Returns an unsubscribe fn. */
  subscribe(
    name: string,
    onLog: (line: LogLine) => void,
    onStatus: (status: ProcessStatus) => void
  ): () => void {
    const p = this.get(name);
    p.emitter.on("log", onLog);
    p.emitter.on("status", onStatus);
    return () => {
      p.emitter.off("log", onLog);
      p.emitter.off("status", onStatus);
    };
  }

  /**
   * Stop every dev server (used on shutdown). One-shot tasks are left alone —
   * they are short-lived and killing a push mid-flight is worse than letting
   * it finish.
   */
  stopAll(): void {
    for (const [key, p] of this.procs) {
      if (p.kind === "server") void this.stop(key);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __devdeckManager: ProcessManager | undefined;
}

export const manager: ProcessManager =
  globalThis.__devdeckManager ?? (globalThis.__devdeckManager = new ProcessManager());

export type { LogLine };
