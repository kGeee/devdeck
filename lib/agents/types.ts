/**
 * Normalised agent model.
 *
 * Claude, Codex and Gemini each stream a different JSONL dialect. Everything
 * above `lib/agents/adapters/` speaks only the types in this file, so adding a
 * fourth CLI means writing one adapter and touching nothing else.
 */

export type AgentProvider = "claude" | "codex" | "gemini";

export const PROVIDERS: AgentProvider[] = ["claude", "codex", "gemini"];

/**
 * Deliberately not reusing ProcessStatus. An agent run is a conversation with
 * a terminal verdict, not a server that is up or down, and "crashed" is the
 * wrong word for a run the model ended by refusing.
 */
export type AgentStatus =
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type NodeStatus = "running" | "done" | "failed";

/**
 * A unit of agency in a run: the root agent, or a subagent it delegated to.
 *
 * Claude gives us real subagents (Task tool calls, with follow-up events
 * carrying `parent_tool_use_id`). Codex and Gemini have no subagent concept
 * today, so their runs are a single root node — the tree still renders, it is
 * just one level deep.
 */
export interface AgentNode {
  /** "root", or the provider's tool-call id for the delegation that spawned it. */
  id: string;
  parentId: string | null;
  /** Subagent type ("Explore", "code-reviewer") or the provider name for root. */
  name: string;
  kind: "root" | "subagent";
  status: NodeStatus;
  /** The prompt handed to a subagent. Null for the root node. */
  task: string | null;
  startedAt: number;
  endedAt: number | null;
  /**
   * One line describing what this node is doing right now ("Reading scan.ts").
   * This is the field the live subagent view reads — it is what the user meant
   * by "see what each subagent is working on".
   */
  activity: string | null;
  toolCalls: number;
  /** Distinct absolute paths this node read or wrote, in first-touch order. */
  files: string[];
}

export type ToolStatus = "running" | "ok" | "error";

/**
 * How a tool call relates to the world outside the run. Drives edge colouring
 * in the graph, where a read and a write must not look the same.
 */
export type ToolEffect =
  | "read"
  | "write"
  | "execute"
  | "search"
  | "network"
  | "delegate"
  | "other";

export interface AgentToolCall {
  /** Provider tool-call id, or a synthesised one when the provider omits it. */
  id: string;
  /** The AgentNode that issued this call. */
  nodeId: string;
  /** Provider-native tool name: "Read", "Bash", "command_execution", … */
  name: string;
  effect: ToolEffect;
  /** One-line, display-ready description of the input. */
  summary: string;
  startedAt: number;
  endedAt: number | null;
  status: ToolStatus;
  /** Truncated stdout/result preview, or the error text when status is error. */
  result: string | null;
  /** Absolute path touched, when the call was file-scoped. Feeds the graph. */
  path: string | null;
  /** Host contacted, for network calls. Also feeds the graph. */
  host: string | null;
}

/** A chunk of assistant prose or reasoning, attributed to the node that said it. */
export interface AgentMessage {
  id: string;
  nodeId: string;
  kind: "text" | "thinking";
  text: string;
  at: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** USD, when the provider reports it. Codex and Gemini currently do not. */
  costUsd: number | null;
}

export interface AgentSession {
  id: string;
  provider: AgentProvider;
  /** Project name (the stable id used everywhere else in DevDeck). */
  project: string;
  /** Absolute working directory the agent was launched in. */
  cwd: string;
  prompt: string;
  status: AgentStatus;
  /** Provider-native session id, once the provider announces one. Enables resume. */
  providerSessionId: string | null;
  model: string | null;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  /** Terminal summary text from the provider, or the failure reason. */
  result: string | null;
  error: string | null;
  usage: AgentUsage;
  nodes: AgentNode[];
  toolCalls: AgentToolCall[];
  messages: AgentMessage[];
}

/** Row shape for session lists — the full session is large and mostly unread. */
export interface AgentSessionSummary {
  id: string;
  provider: AgentProvider;
  project: string;
  prompt: string;
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  /** Count of nodes with kind "subagent". */
  subagents: number;
  toolCalls: number;
  costUsd: number | null;
  /** Root node's current activity line, for an at-a-glance "what's it doing". */
  activity: string | null;
}

/* ── Streamed deltas ──────────────────────────────────────────────────────
   The SSE channel sends these rather than whole sessions: a run with a few
   hundred tool calls would otherwise re-send the entire tree per event.
   ───────────────────────────────────────────────────────────────────────── */

export type AgentDelta =
  | { type: "session"; session: AgentSession }
  | { type: "status"; status: AgentStatus; endedAt: number | null; exitCode: number | null }
  | { type: "node"; node: AgentNode }
  | { type: "tool"; call: AgentToolCall }
  | { type: "message"; message: AgentMessage }
  | { type: "usage"; usage: AgentUsage }
  | { type: "meta"; providerSessionId: string | null; model: string | null }
  | { type: "result"; result: string | null; error: string | null }
  /** Raw provider line, for the debug/raw log view. */
  | { type: "raw"; line: string; at: number };

/* ── Provider availability ────────────────────────────────────────────────── */

export interface ProviderInfo {
  id: AgentProvider;
  label: string;
  /** The CLI binary is on PATH. */
  installed: boolean;
  version: string | null;
  /**
   * False when the CLI is installed but cannot actually complete a run —
   * missing credentials, an unset project var, an exhausted billing account.
   * Surfaced in the UI up front, because the alternative is a run that hangs
   * or dies several seconds in with an opaque message.
   */
  ready: boolean;
  /** User-facing explanation when `ready` is false. */
  reason: string | null;
}
