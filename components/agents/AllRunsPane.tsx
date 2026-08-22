"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import type { AgentSessionSummary } from "@/lib/agents/types";
import { EmptyState, PaneHeader } from "../ui";
import SessionView from "./SessionView";
import { ProviderBadge, StatusBadge, formatCost } from "./shared";
import { relativeTime } from "../format";

const POLL_MS = 3000;

/**
 * Every run, across every project — the hub-level answer to "what are my
 * agents doing right now". Live runs sort to the top, because a finished run
 * from an hour ago is never the thing you opened this view to find.
 */
export default function AllRunsPane() {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents?history=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = data.sessions as AgentSessionSummary[];
      list.sort((a, b) => {
        const liveA = a.status === "running" || a.status === "starting" ? 1 : 0;
        const liveB = b.status === "running" || b.status === "starting" ? 1 : 0;
        if (liveA !== liveB) return liveB - liveA;
        return b.startedAt - a.startedAt;
      });
      setSessions(list);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const liveCount = sessions.filter(
    (s) => s.status === "running" || s.status === "starting"
  ).length;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)]">
        <PaneHeader title="All runs" count={sessions.length}>
          {liveCount > 0 && (
            <span className="font-mono text-[11px] text-[var(--color-accent)]">
              {liveCount} live
            </span>
          )}
        </PaneHeader>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <EmptyState
              icon={<Bot className="size-6" />}
              title="No runs yet"
              hint="Open a project's Agents tab to start one."
            />
          ) : (
            sessions.map((s) => {
              const active = s.id === selected;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  title={s.prompt}
                  className={`ring-focus block w-full border-l-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                    active
                      ? "border-l-[var(--color-accent)] bg-[var(--color-surface-2)]"
                      : "border-l-transparent hover:bg-[var(--color-surface-2)]/60"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <ProviderBadge provider={s.provider} />
                    <StatusBadge status={s.status} />
                  </span>
                  <span className="mt-1 block truncate text-[12px]">{s.prompt}</span>
                  {s.activity && (
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--color-accent)]">
                      {s.activity}
                    </span>
                  )}
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--color-muted-2)]">
                    {s.project} · {relativeTime(s.startedAt)} · {s.toolCalls} calls
                    {s.subagents > 0 && ` · ${s.subagents} sub`}
                    {s.costUsd != null && ` · ${formatCost(s.costUsd)}`}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {selected ? (
        <SessionView key={selected} sessionId={selected} onCancelled={load} />
      ) : (
        <div className="grid flex-1 place-items-center">
          <EmptyState
            icon={<Bot className="size-7" />}
            title="Select a run"
            hint="Pick one on the left to watch its agents work."
          />
        </div>
      )}
    </div>
  );
}
