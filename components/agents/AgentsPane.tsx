"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import type {
  AgentProvider,
  AgentSession,
  AgentSessionSummary,
  ProviderInfo,
} from "@/lib/agents/types";
import type { ProjectView } from "@/lib/types";
import { EmptyState } from "../ui";
import AgentComposer, { type Mode } from "./AgentComposer";
import SessionView from "./SessionView";
import { ProviderBadge, StatusBadge, formatCost } from "./shared";
import { relativeTime } from "../format";

/** Runs finish in the background, so the list refreshes even when idle. */
const POLL_MS = 4000;

/**
 * Agent surface for one project: launch runs here, and watch any of them.
 *
 * Runs are listed as a horizontal strip rather than a sidebar so the detail
 * view keeps the width it needs for the agency tree plus the activity feed.
 */
export default function AgentsPane({ project }: { project: ProjectView }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [initial, setInitial] = useState<AgentSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/agents?project=${encodeURIComponent(project.name)}&history=1`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions as AgentSessionSummary[]);
    } catch {
      /* transient; the next poll retries */
    }
  }, [project.name]);

  useEffect(() => {
    let alive = true;
    fetch("/api/agents/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setProviders(d.providers as ProviderInfo[]))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, POLL_MS);
    return () => clearInterval(t);
  }, [loadSessions]);

  const submit = useCallback(
    async (input: { provider: AgentProvider; prompt: string; mode: Mode }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, project: project.name }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        // Seed the stream with the session we just got so the detail view has
        // something to render before the first delta arrives.
        setInitial(data.session as AgentSession);
        setSelected((data.session as AgentSession).id);
        await loadSessions();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start the run");
      } finally {
        setBusy(false);
      }
    },
    [project.name, loadSessions]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentComposer
        project={project.name}
        providers={providers}
        busy={busy}
        error={error}
        onSubmit={submit}
      />

      {sessions.length > 0 && (
        <div className="scroll-thin flex shrink-0 gap-1.5 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-2">
          {sessions.map((s) => {
            const active = s.id === selected;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setInitial(null);
                  setSelected(s.id);
                }}
                title={s.prompt}
                className={`ring-focus w-56 shrink-0 rounded-md border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                  active
                    ? "border-[var(--color-accent)]/45 bg-[var(--color-accent)]/8"
                    : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)]"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <ProviderBadge provider={s.provider} />
                  <StatusBadge status={s.status} />
                </span>
                <span className="mt-1 block truncate text-[11.5px] text-[var(--color-foreground)]">
                  {s.prompt}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-[var(--color-muted-2)]">
                  {relativeTime(s.startedAt)} · {s.toolCalls} calls
                  {s.subagents > 0 && ` · ${s.subagents} sub`}
                  {s.costUsd != null && ` · ${formatCost(s.costUsd)}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <SessionView
          key={selected}
          sessionId={selected}
          initial={initial}
          onCancelled={loadSessions}
        />
      ) : (
        <div className="grid flex-1 place-items-center">
          <EmptyState
            icon={<Bot className="size-7" />}
            title="No run selected"
            hint={
              sessions.length > 0
                ? "Pick a run above, or start a new one."
                : `Prompt an agent to work in ${project.name}. It runs in that folder with the access level you choose.`
            }
          />
        </div>
      )}
    </div>
  );
}
