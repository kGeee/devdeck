import { randomUUID } from "node:crypto";
import type { AgentLogDb, LedgerEntry } from "./types";

/**
 * Thin typed stub for agent-log-db.
 * Do not rebuild or replace the real ledger — swap this for a live client later.
 */
export function createStubLedger(
  seed: LedgerEntry[] = []
): AgentLogDb & { entries: LedgerEntry[] } {
  const entries = [...seed];
  return {
    entries,
    async recall_relevant(query: string): Promise<LedgerEntry[]> {
      const q = query.toLowerCase();
      return entries.filter((e) => e.text.toLowerCase().includes(q)).slice(-20);
    },
    async recall_recent(limit = 10): Promise<LedgerEntry[]> {
      return entries.slice(-limit);
    },
    async log_entry(
      text: string,
      _meta?: Record<string, unknown>
    ): Promise<LedgerEntry> {
      const entry: LedgerEntry = {
        id: randomUUID(),
        text,
        at: new Date().toISOString(),
      };
      entries.push(entry);
      return entry;
    },
  };
}
