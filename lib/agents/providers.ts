import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@/lib/exec";
import type { AgentProvider, ProviderInfo } from "./types";

/**
 * How much freedom an agent run gets. One vocabulary across three CLIs that
 * each spell it differently.
 *
 * "plan" is genuinely read-only; "edit" lets the agent write inside the project
 * but not run unrestricted commands; "full" disables the guardrails entirely.
 */
export type AgentMode = "plan" | "edit" | "full";

export const MODE_LABELS: Record<AgentMode, string> = {
  plan: "Plan only",
  edit: "Edit files",
  full: "Full access",
};

export interface SpawnSpec {
  file: string;
  args: string[];
}

/**
 * Every CLI here reads stdin when it is a pipe. Under `next dev` the child's
 * stdin is inherited unless we say otherwise, and Codex will sit forever on
 * "Reading additional input from stdin…". The spawner passes stdio[0]="ignore";
 * this note exists so nobody "fixes" that later.
 */
export function buildSpawn(
  provider: AgentProvider,
  opts: { prompt: string; cwd: string; mode: AgentMode; resume?: string | null }
): SpawnSpec {
  switch (provider) {
    case "claude": {
      const permission =
        opts.mode === "plan"
          ? "plan"
          : opts.mode === "edit"
            ? "acceptEdits"
            : "bypassPermissions";
      const args = [
        "-p",
        opts.prompt,
        "--output-format",
        "stream-json",
        // stream-json refuses to emit the tool/subagent events without it.
        "--verbose",
        // Emits subagent text with parent_tool_use_id set — the only way to
        // attribute activity to a specific subagent rather than the root.
        "--forward-subagent-text",
        "--permission-mode",
        permission,
      ];
      if (opts.resume) args.push("--resume", opts.resume);
      return { file: "claude", args };
    }

    case "codex": {
      const sandbox =
        opts.mode === "plan"
          ? "read-only"
          : opts.mode === "edit"
            ? "workspace-write"
            : "danger-full-access";
      const args = ["exec", "--json", "--sandbox", sandbox, "-C", opts.cwd];
      // Refuses to start in a non-git directory without this, which is a poor
      // failure for a scratch folder the user deliberately added.
      args.push("--skip-git-repo-check");
      if (opts.mode === "full") args.push("--dangerously-bypass-approvals-and-sandbox");
      if (opts.resume) args.push("resume", opts.resume);
      args.push(opts.prompt);
      return { file: "codex", args };
    }

    case "gemini": {
      const approval =
        opts.mode === "plan" ? "default" : opts.mode === "edit" ? "auto_edit" : "yolo";
      const args = ["-o", "stream-json", "--approval-mode", approval];
      if (opts.resume) args.push("--resume", opts.resume);
      // Positional prompt; -p is deprecated in 0.23.
      args.push(opts.prompt);
      return { file: "gemini", args };
    }
  }
}

const LABELS: Record<AgentProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function versionOf(bin: string): Promise<string | null> {
  const r = await run(bin, ["--version"], { cwd: os.homedir(), timeout: 8000 });
  if (!r.ok) return null;
  // "2.1.235 (Claude Code)" / "codex-cli 0.135.0" / "0.23.0"
  const m = r.stdout.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : r.stdout.trim().split("\n")[0] || null;
}

/**
 * Credential preflight.
 *
 * Deliberately conservative: it only reports `ready: false` for conditions we
 * can prove locally from config files or the environment. An exhausted billing
 * account is invisible from here and surfaces as a runtime error event instead.
 */
async function readiness(
  provider: AgentProvider
): Promise<{ ready: boolean; reason: string | null }> {
  const home = os.homedir();

  if (provider === "claude") {
    if (process.env.ANTHROPIC_API_KEY) return { ready: true, reason: null };
    // The CLI stores OAuth credentials in the macOS keychain rather than a
    // file, so absence of ~/.claude.json is not proof of anything.
    return { ready: true, reason: null };
  }

  if (provider === "codex") {
    if (process.env.OPENAI_API_KEY) return { ready: true, reason: null };
    if (await exists(path.join(home, ".codex", "auth.json"))) {
      return { ready: true, reason: null };
    }
    return { ready: false, reason: "Not signed in — run `codex login`." };
  }

  // gemini
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return { ready: true, reason: null };
  }
  const oauth = await exists(path.join(home, ".gemini", "google_accounts.json"));
  if (oauth && !process.env.GOOGLE_CLOUD_PROJECT && !process.env.GOOGLE_CLOUD_PROJECT_ID) {
    // Observed failure on this machine: the CLI authenticates, then exits 41
    // because a Workspace account needs an explicit project.
    return {
      ready: false,
      reason:
        "Signed in with a Workspace account — set GOOGLE_CLOUD_PROJECT (or GEMINI_API_KEY) before running.",
    };
  }
  if (!oauth) return { ready: false, reason: "Not signed in — run `gemini` once to authenticate." };
  return { ready: true, reason: null };
}

/** Cached because the UI polls this and each miss costs three subprocesses. */
let cache: { at: number; data: ProviderInfo[] } | null = null;
const TTL_MS = 30_000;

export async function getProviders(force = false): Promise<ProviderInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const ids: AgentProvider[] = ["claude", "codex", "gemini"];
  const data = await Promise.all(
    ids.map(async (id): Promise<ProviderInfo> => {
      const version = await versionOf(id);
      if (version == null) {
        return {
          id,
          label: LABELS[id],
          installed: false,
          version: null,
          ready: false,
          reason: `\`${id}\` is not on PATH.`,
        };
      }
      const { ready, reason } = await readiness(id);
      return { id, label: LABELS[id], installed: true, version, ready, reason };
    })
  );

  cache = { at: Date.now(), data };
  return data;
}
