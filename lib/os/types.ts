/**
 * DevDeck OS v1 kernel types.
 * Contracts mirror packs/; persistence lives under .devdeck/os/.
 */

export type CodeJobStatus =
  | "planned"
  | "executing"
  | "review"
  | "merging"
  | "done"
  | "blocked";

export interface CodeJob {
  repo: string;
  branch: string;
  prUrl?: string;
  status: CodeJobStatus;
  planId: string;
  executorId?: string;
}

export interface Plan {
  id: string;
  goal: string;
  constraints: string[];
  steps: string[];
  outOfScope: string[];
  doneWhen: string[];
  ledgerRefs: string[];
  locked: boolean;
}

export type VerdictResult = "approve" | "changes-requested" | "comment";

export interface Verdict {
  prUrl: string;
  result: VerdictResult;
  summary: string;
  planId: string;
}

export interface LaneDef {
  id: string;
  name: string;
  pack: string;
  runtime: boolean;
  does: string[];
  doesNot: string[];
}

export interface PackManifest {
  packVersion: number;
  voice: string;
  repo: string;
  base: string;
  note?: string;
  loadOrder: string[];
  lanes: LaneDef[];
  skillsGlob: string;
  routinesDir: string;
  persist: {
    rooms: string;
    routines: string;
    memory: string;
  };
  ledger: {
    system: string;
    beforePlan: string[];
    afterWork: string[];
  };
  concurrency: string[];
}

export interface LoadedPackFile {
  path: string;
  content: string;
}

export interface LoadedPacks {
  manifest: PackManifest;
  files: LoadedPackFile[];
  lanes: Map<string, LaneDef>;
}

export interface RoomMessage {
  id: string;
  fromId: string;
  text: string;
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  memberIds: string[];
  messages: RoomMessage[];
}

export type MentionTarget =
  | { kind: "everyone" }
  | { kind: "lane"; laneId: string; name: string; runtime: boolean }
  | { kind: "unknown"; raw: string };

export interface Skill {
  slug: string;
  name: string;
  description: string;
  body: string;
  path: string;
}

export type CronTrigger = { type: "cron"; schedule: string };
export type GithubTrigger = {
  type: "github";
  repo: string;
  events: string[];
  pr?: number;
};
export type RoutineTrigger = CronTrigger | GithubTrigger;

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  trigger: RoutineTrigger;
  expiresAt?: string;
}

export type InboundMode = "queue" | "steer";

export interface InboundMessage {
  id: string;
  text: string;
  arrivedAt: string;
  mode: InboundMode;
}

export interface RunLock {
  chatId: string;
  status: "idle" | "active";
  activeTurnId?: string;
  inbound: InboundMessage[];
}

export interface ApprovalCard {
  id: string;
  summary: string;
  createdAt: string;
}

export interface ApprovalGate {
  streamId: string;
  card: ApprovalCard | null;
  streamStatus: "running" | "paused";
}

export interface ShardWriter {
  path: string;
  ownerAgentId: string;
}

export type DesignLockItem =
  | "layout"
  | "type"
  | "color"
  | "density"
  | "states"
  | "empty/error"
  | "keyboard";

export const DESIGN_LOCK_ITEMS: readonly DesignLockItem[] = [
  "layout",
  "type",
  "color",
  "density",
  "states",
  "empty/error",
  "keyboard",
] as const;

export type DesignLock = Record<DesignLockItem, string>;

export interface DispatchRequest {
  kind: "ui" | "code-only";
  designLock?: Partial<DesignLock>;
  plan?: Plan;
  targetLane: "planner" | "executor" | "reviewer" | "merger";
}

export type DispatchResult =
  | { ok: true }
  | { ok: false; reason: string; missing?: DesignLockItem[] };

export interface LedgerEntry {
  id: string;
  text: string;
  at: string;
}

/** Thin typed face for agent-log-db — do not rebuild that system here. */
export interface AgentLogDb {
  recall_relevant(query: string, repo?: string): Promise<LedgerEntry[]>;
  recall_recent(limit?: number): Promise<LedgerEntry[]>;
  log_entry(text: string, meta?: Record<string, unknown>): Promise<LedgerEntry>;
}

export const SHIPPING_ROOM_NAME = "DevDeck";
export const COORDINATOR_LANE_ID = "coordinator";
