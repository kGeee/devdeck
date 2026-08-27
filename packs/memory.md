---
id: memory
kind: contract
---

# Memory

Three layers. Most-specific wins: project shard > dated log > profile.

## Profile

Always on. Short facts that should sit in Coordinator context every turn: who the operator is, standing defaults, hard constraints.

Path: `.devdeck/os/memory/<agentId>/profile.md`

Keep it small. One fact per line. No dump of the day's work.

## Dated log

History. Append-only notes under `.devdeck/os/memory/<agentId>/log/YYYY-MM.md`.

Use it to remember what happened, not to reload a novel every turn. Coordinator may skim the current month; specialists read on demand.

## Project shard

Facts about a named project, useful to every member of that project.

Path: `.devdeck/os/memory/project/<slug>/` with one file per contributing agent (`<agentId>.md`). Same shard-writer rule: an agent writes only its own file.

## Precedence

If profile, log, and project disagree, the project shard wins for project work, then log, then profile. A Coordinator instruction in the live turn still beats all three.

## Ledger vs memory

agent-log-db is the **code ledger**, not this tree.

- Before a plan: `recall_relevant`, then `recall_recent` if you still need the last turns.
- After work: `log_entry`.
- Do not rebuild, migrate, or replace agent-log-db in v1.
- Do not write code-ledger facts only to profile.md and skip `log_entry`.

## Writes

Every write goes through shard-writer. Two agents never share a file. No "append to their shard for them."
