import type {
  AgentMessage,
  AgentNode,
  AgentStatus,
  AgentToolCall,
  AgentUsage,
  ToolStatus,
} from "../types";

/**
 * The write surface an adapter is given. The session manager implements it:
 * every call both mutates the stored session and broadcasts a delta to any
 * attached SSE client, so adapters never touch transport or storage.
 */
export interface Sink {
  readonly cwd: string;
  now(): number;
  meta(patch: { providerSessionId?: string | null; model?: string | null }): void;
  /** Insert a node, or merge into the existing one with the same id. */
  node(node: AgentNode): void;
  nodePatch(id: string, patch: Partial<AgentNode>): void;
  toolStart(call: AgentToolCall): void;
  toolEnd(
    id: string,
    patch: { status: ToolStatus; result: string | null; endedAt: number }
  ): void;
  message(message: AgentMessage): void;
  usage(usage: AgentUsage): void;
  finish(patch: { status: AgentStatus; result?: string | null; error?: string | null }): void;
}

/** Stateful per-run parser for one provider's JSONL dialect. */
export interface Adapter {
  /** One line of provider stdout. Already known to be non-empty. */
  line(raw: string): void;
  /** Called once the process exits, so the adapter can settle unfinished work. */
  close(exitCode: number | null): void;
}

export const ROOT = "root";

export function emptyUsage(): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: null,
  };
}

export function rootNode(name: string, at: number): AgentNode {
  return {
    id: ROOT,
    parentId: null,
    name,
    kind: "root",
    status: "running",
    task: null,
    startedAt: at,
    endedAt: null,
    activity: null,
    toolCalls: 0,
    files: [],
  };
}

let seq = 0;
/** Ids for providers that don't supply their own. */
export function syntheticId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}`;
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
