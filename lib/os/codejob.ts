import type {
  AgentLogDb,
  CodeJob,
  CodeJobStatus,
  Plan,
} from "./types";
import { canStartExecutor } from "./dispatch";
import { createStubLedger } from "./ledger";

export function createPlan(partial: Omit<Plan, "locked"> & { locked?: boolean }): Plan {
  return {
    ...partial,
    locked: partial.locked ?? false,
  };
}

export function lockPlan(plan: Plan): Plan {
  return { ...plan, locked: true };
}

export type CodeJobStartResult =
  | { ok: true; job: CodeJob }
  | { ok: false; reason: string };

/**
 * CodeJob is a record + gates. No Cursor Cloud Agent HTTP client in v1.
 * Wire to lib/git + lib/github at call sites when actually pushing.
 */
export function createCodeJob(opts: {
  repo: string;
  branch: string;
  plan: Plan;
  executorId?: string;
}): CodeJobStartResult {
  const gate = canStartExecutor(opts.plan);
  if (!gate.ok) return gate;

  const job: CodeJob = {
    repo: opts.repo,
    branch: opts.branch,
    status: "planned",
    planId: opts.plan.id,
    ...(opts.executorId ? { executorId: opts.executorId } : {}),
  };
  return { ok: true, job };
}

export function transitionCodeJob(
  job: CodeJob,
  status: CodeJobStatus,
  extra: Partial<Pick<CodeJob, "prUrl" | "executorId">> = {}
): CodeJob {
  return { ...job, status, ...extra };
}

export async function preparePlanWithLedger(
  ledger: AgentLogDb,
  opts: { ask: string; repo?: string }
): Promise<{ relevant: Awaited<ReturnType<AgentLogDb["recall_relevant"]>>; recent: Awaited<ReturnType<AgentLogDb["recall_recent"]>> }> {
  const relevant = await ledger.recall_relevant(opts.ask, opts.repo);
  const recent = await ledger.recall_recent(5);
  return { relevant, recent };
}

export async function logJobStep(
  ledger: AgentLogDb,
  text: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await ledger.log_entry(text, meta);
}

export { createStubLedger };
