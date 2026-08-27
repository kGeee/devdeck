import { randomUUID } from "node:crypto";
import type {
  ApprovalCard,
  ApprovalGate,
  InboundMessage,
  InboundMode,
  RunLock,
  ShardWriter,
} from "./types";

/** Heuristic: steer = correction/stop/extra constraint; else queue. */
export function classifyInbound(text: string): InboundMode {
  const t = text.trim().toLowerCase();
  if (
    /^(stop|cancel|abort|never\s+mind|wait)\b/.test(t) ||
    /\b(instead|actually|correction|don't|do not|without|also make sure|constraint)\b/.test(
      t
    )
  ) {
    return "steer";
  }
  return "queue";
}

export function createRunLock(chatId: string): RunLock {
  return { chatId, status: "idle", inbound: [] };
}

export type TurnStartResult =
  | { started: true; turnId: string; lock: RunLock }
  | {
      started: false;
      lock: RunLock;
      inbound: InboundMessage;
    };

/**
 * One active turn per chat. Inbound while active queues or steers —
 * it does not start a second turn.
 */
export function receiveInbound(
  lock: RunLock,
  text: string,
  opts: { mode?: InboundMode; id?: string; at?: string } = {}
): TurnStartResult {
  const mode = opts.mode ?? classifyInbound(text);
  const inbound: InboundMessage = {
    id: opts.id ?? randomUUID(),
    text,
    arrivedAt: opts.at ?? new Date().toISOString(),
    mode,
  };

  if (lock.status === "active") {
    return {
      started: false,
      lock: { ...lock, inbound: [...lock.inbound, inbound] },
      inbound,
    };
  }

  const turnId = randomUUID();
  return {
    started: true,
    turnId,
    lock: {
      chatId: lock.chatId,
      status: "active",
      activeTurnId: turnId,
      inbound: [],
    },
  };
}

export function endTurn(lock: RunLock): {
  lock: RunLock;
  nextQueued: InboundMessage | null;
  steered: InboundMessage[];
} {
  const steered = lock.inbound.filter((m) => m.mode === "steer");
  const queued = lock.inbound.filter((m) => m.mode === "queue");
  const nextQueued = queued[0] ?? null;
  const remaining = queued.slice(1);
  return {
    lock: {
      chatId: lock.chatId,
      status: "idle",
      inbound: remaining,
    },
    nextQueued,
    steered,
  };
}

export function createApprovalGate(streamId: string): ApprovalGate {
  return { streamId, card: null, streamStatus: "running" };
}

export type ApprovalRequestResult =
  | { ok: true; gate: ApprovalGate; card: ApprovalCard }
  | { ok: false; reason: "card-open"; gate: ApprovalGate };

/** One card per stream; stream pauses until allow/deny. */
export function requestApproval(
  gate: ApprovalGate,
  summary: string,
  opts: { id?: string; at?: string } = {}
): ApprovalRequestResult {
  if (gate.card) {
    return { ok: false, reason: "card-open", gate };
  }
  const card: ApprovalCard = {
    id: opts.id ?? randomUUID(),
    summary,
    createdAt: opts.at ?? new Date().toISOString(),
  };
  return {
    ok: true,
    card,
    gate: { ...gate, card, streamStatus: "paused" },
  };
}

export type ApprovalDecision = "allow" | "deny";

export function resolveApproval(
  gate: ApprovalGate,
  decision: ApprovalDecision
): { gate: ApprovalGate; decision: ApprovalDecision; endedAction: boolean } {
  if (!gate.card) {
    return {
      gate,
      decision,
      endedAction: false,
    };
  }
  if (decision === "allow") {
    return {
      decision,
      endedAction: false,
      gate: { streamId: gate.streamId, card: null, streamStatus: "running" },
    };
  }
  return {
    decision,
    endedAction: true,
    gate: { streamId: gate.streamId, card: null, streamStatus: "running" },
  };
}

export function createShardWriter(
  filePath: string,
  ownerAgentId: string
): ShardWriter {
  return { path: filePath, ownerAgentId };
}

/** Exclusive resource occupancy — not a fourth lock type. */
export interface ExclusiveResource {
  key: string;
  holderId: string | null;
}

export function claimExclusive(
  resource: ExclusiveResource,
  holderId: string
): { ok: true; resource: ExclusiveResource } | { ok: false; holderId: string } {
  if (resource.holderId && resource.holderId !== holderId) {
    return { ok: false, holderId: resource.holderId };
  }
  return { ok: true, resource: { ...resource, holderId } };
}

export function releaseExclusive(
  resource: ExclusiveResource,
  holderId: string
): ExclusiveResource {
  if (resource.holderId !== holderId) return resource;
  return { ...resource, holderId: null };
}
