---
id: codepath
kind: protocol
---

# Code path

Product work ships as a git branch plus a GitHub PR. Never clone as a product step. Local CLI spawn in the hub stays for ad-hoc runs; the OS code path does not replace those adapters.

## Job

```
CodeJob {
  repo: string          // owner/name
  branch: string
  prUrl?: string
  status: "planned" | "executing" | "review" | "merging" | "done" | "blocked"
  planId: string
  executorId?: string
}
```

Use existing `lib/git.ts` and `lib/github.ts`. Do not add a cloud-agent HTTP client in v1.

## Sequence

1. Planner writes a locked plan (ledger recall first). Status → `planned`.
2. Executor may start only with that plan. New branch from `main`, implement, open PR. Status → `executing` then `review`.
3. Reviewer leaves a verdict on the PR. Does not merge.
4. Merger merges only if Reviewer **or** the operator approved **and** CI is green. Status → `done`.
5. `log_entry` after the plan, after the PR, after the merge.

Refuse Executor start when `planId` is missing or the plan is not locked. Refuse Merger when verdict is missing or CI is red.

## Scope

Executor implements the plan. No extra features, no drive-by refactors, no merge.

Planner does not open a branch.

## Ledger

agent-log-db stays. `recall_relevant` / `recall_recent` before plan. `log_entry` after each job step. Do not invent a second ledger.
