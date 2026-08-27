---
id: dispatch
kind: protocol
---

# Dispatch

Coordinator is the only lane that starts work. Specialists do not recruit each other.

## Code-only

Operator ask is code with no UI surface.

Coordinator → Planner → (lock) → Executor → Reviewer → Merger.

## UI work

A Design lock is required before Planner.

The lock must name all of:

1. layout
2. type
3. color
4. density
5. states
6. empty and error
7. keyboard

If any item is missing, Coordinator rejects the dispatch and asks for the missing piece. v1 Design lanes are stubs, so the operator (or a pasted spec) supplies the lock. The kernel still enforces the checklist.

Then: Coordinator posts the lock into the shipping room → Planner → Executor → Reviewer → Merger.

## Rules

- No Executor without a locked plan.
- No Planner skipping ledger recall.
- No Merger without a Reviewer (or operator) verdict plus green CI.
- Product rooms (Marketing, Apple, Windows) are out of this shipping room.
- Do not expand into hub UI (PWA, mobile, Memory pane, CLI adapters).

## Status

Coordinator reports where the job sits (`planned` / `executing` / `review` / `blocked`) in the shipping room. Specialists do not recap the whole pipeline on every turn.
