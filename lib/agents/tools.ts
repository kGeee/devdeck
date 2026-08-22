import path from "node:path";
import type { ToolEffect } from "./types";

/** Longest single-line preview we keep for a tool result. */
const PREVIEW = 400;

export function truncate(text: string, max = PREVIEW): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** First line only, for activity lines that must fit on one row. */
export function firstLine(text: string, max = 120): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return truncate(line, max);
}

/**
 * Effect of a tool call, by name. Names are matched case-insensitively and
 * cover Claude's tool set plus the Codex/Gemini equivalents, so the graph can
 * colour a write differently from a read regardless of which CLI produced it.
 */
export function effectOf(name: string): ToolEffect {
  const n = name.toLowerCase();
  if (n === "task" || n === "agent") return "delegate";
  if (n === "read" || n === "notebookread" || n === "read_file") return "read";
  if (
    n === "write" ||
    n === "edit" ||
    n === "multiedit" ||
    n === "notebookedit" ||
    n === "file_change" ||
    n === "write_file" ||
    n === "replace"
  ) {
    return "write";
  }
  if (n === "bash" || n === "command_execution" || n === "run_shell_command") return "execute";
  if (n === "grep" || n === "glob" || n === "search_file_content" || n === "list_directory") {
    return "search";
  }
  if (n === "webfetch" || n === "websearch" || n === "web_search" || n === "web_fetch") {
    return "network";
  }
  return "other";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Pull the file path out of a tool input, whatever the provider calls it. */
export function pathOf(input: unknown, cwd: string): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const raw =
    str(o.file_path) ??
    str(o.path) ??
    str(o.notebook_path) ??
    str(o.absolute_path) ??
    str(o.filePath);
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

/** Pull a hostname out of a network tool input. */
export function hostOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const url = str(o.url);
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * One-line, display-ready description of a tool call.
 *
 * Paths are shown relative to the project so the tree stays readable; the
 * absolute path is kept separately on the call for the graph.
 */
export function summarise(name: string, input: unknown, cwd: string): string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rel = (p: string) => {
    const r = path.relative(cwd, p);
    return !r || r.startsWith("..") ? p : r;
  };

  const n = name.toLowerCase();
  const file = pathOf(input, cwd);

  if (n === "bash" || n === "run_shell_command") {
    const cmd = str(o.command) ?? str(o.cmd) ?? "";
    return cmd ? firstLine(cmd) : "shell command";
  }
  if (n === "task" || n === "agent") {
    return str(o.description) ?? firstLine(str(o.prompt) ?? "subagent");
  }
  if (n === "grep" || n === "search_file_content") {
    const pat = str(o.pattern) ?? "";
    const where = str(o.path);
    return where ? `/${pat}/ in ${rel(path.resolve(cwd, where))}` : `/${pat}/`;
  }
  if (n === "glob") return str(o.pattern) ?? "glob";
  if (n === "websearch" || n === "web_search") return str(o.query) ?? "web search";
  if (n === "webfetch" || n === "web_fetch") return str(o.url) ?? "fetch";
  if (n === "todowrite") {
    const todos = Array.isArray(o.todos) ? o.todos.length : 0;
    return `${todos} todo${todos === 1 ? "" : "s"}`;
  }
  if (file) return rel(file);

  const first = Object.values(o).find((v) => typeof v === "string") as string | undefined;
  return first ? truncate(first, 90) : name;
}

/**
 * Present-tense activity line shown against a node while a call is in flight.
 * Reads as a status ("Reading lib/scan.ts"), not as a log entry.
 */
export function activityFor(name: string, summary: string): string {
  const n = name.toLowerCase();
  if (n === "read" || n === "read_file") return `Reading ${summary}`;
  if (n === "write" || n === "write_file") return `Writing ${summary}`;
  if (n === "edit" || n === "multiedit" || n === "replace") return `Editing ${summary}`;
  if (n === "bash" || n === "run_shell_command" || n === "command_execution") {
    return `Running ${summary}`;
  }
  if (n === "grep" || n === "glob" || n === "search_file_content") {
    return `Searching ${summary}`;
  }
  if (n === "task" || n === "agent") return `Delegating: ${summary}`;
  if (n === "websearch" || n === "web_search") return `Searching the web: ${summary}`;
  if (n === "webfetch" || n === "web_fetch") return `Fetching ${summary}`;
  if (n === "todowrite") return `Planning (${summary})`;
  return `${name}: ${summary}`;
}
