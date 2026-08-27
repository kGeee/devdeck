import type {
  DesignLock,
  DesignLockItem,
  DispatchRequest,
  DispatchResult,
  Plan,
} from "./types";
import { DESIGN_LOCK_ITEMS } from "./types";

export function missingDesignLockItems(
  lock: Partial<DesignLock> | undefined
): DesignLockItem[] {
  if (!lock) return [...DESIGN_LOCK_ITEMS];
  return DESIGN_LOCK_ITEMS.filter((item) => {
    const v = lock[item];
    return typeof v !== "string" || v.trim() === "";
  });
}

export function assertDesignLock(
  lock: Partial<DesignLock> | undefined
): DispatchResult {
  const missing = missingDesignLockItems(lock);
  if (missing.length) {
    return {
      ok: false,
      reason: `Design lock incomplete; missing: ${missing.join(", ")}`,
      missing,
    };
  }
  return { ok: true };
}

export function canStartExecutor(plan: Plan | undefined | null): DispatchResult {
  if (!plan?.id) {
    return { ok: false, reason: "Executor refused: planId missing" };
  }
  if (!plan.locked) {
    return { ok: false, reason: "Executor refused: plan is not locked" };
  }
  return { ok: true };
}

/**
 * Dispatch gate: UI work needs a full Design lock; code-only skips it.
 * Pipeline: Coordinator → Planner → Executor (Reviewer → Merger as later gates).
 * No Executor without a locked plan.
 */
export function gateDispatch(req: DispatchRequest): DispatchResult {
  if (req.kind === "ui") {
    const design = assertDesignLock(req.designLock);
    if (!design.ok) return design;
  }

  if (req.targetLane === "executor") {
    return canStartExecutor(req.plan);
  }

  if (req.targetLane === "planner" || req.targetLane === "reviewer" || req.targetLane === "merger") {
    return { ok: true };
  }

  return { ok: false, reason: `unknown target lane: ${req.targetLane}` };
}

export function canMerge(opts: {
  verdictApproved: boolean;
  operatorApproved: boolean;
  ciGreen: boolean;
}): DispatchResult {
  if (!opts.verdictApproved && !opts.operatorApproved) {
    return { ok: false, reason: "Merger refused: no Reviewer or operator approval" };
  }
  if (!opts.ciGreen) {
    return { ok: false, reason: "Merger refused: CI is not green" };
  }
  return { ok: true };
}
