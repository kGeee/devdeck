# DevDeck packs v1

Original DevDeck voice. These files are the OS prompt + schema surface the kernel loads.

Do not paste foreign product prompts into this tree.

| File | Role |
|---|---|
| `coordinator.md` | Operator-facing dispatcher |
| `lanes/planner.md` | Plan only |
| `lanes/executor.md` | Locked plan → branch + PR |
| `lanes/reviewer.md` | Verdict only |
| `lanes/merger.md` | Merge after verdict + green CI |
| `lanes/stubs.md` | Design Lead / UX / UI (registered, no runtime) |
| `room.md` | Members-only rooms + @routing |
| `skill.md` | SKILL.md schema |
| `routine.md` | Cron / event + intent prompt |
| `dispatch.md` | Design-lock gate, then Planner → Executor |
| `codepath.md` | Branch + PR job, ledger hooks |
| `memory.md` | Profile / log / project shard |
| `concurrency.md` | run-lock, approval-gate, shard-writer |
| `skills/*/SKILL.md` | Seed recipes |
| `routines/_schema.json` | Machine shape for the loader |

Kernel (`lib/os/`) loads `manifest.json`, then the files in `loadOrder`.
