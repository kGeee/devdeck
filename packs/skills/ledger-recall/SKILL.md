---
name: Ledger recall
description: Use this before writing a plan or starting a CodeJob — pull agent-log-db context first.
---

# Ledger recall

1. Call `recall_relevant` with the ask and the repo slug.
2. If the last few turns still matter, call `recall_recent`.
3. Cite the entry ids you actually used in the plan (`ledgerRefs`).
4. Do not rebuild the ledger. Do not skip this because the chat "seems fresh."
5. After the step lands (plan, PR, verdict, merge), `log_entry` once. Do not double-log the same fact.
