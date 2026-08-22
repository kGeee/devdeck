"use client";

import { useCallback, useEffect, useState } from "react";
import { Network, RefreshCw } from "lucide-react";
import type { ActivityGraph as GraphData } from "@/lib/agents/graph";
import { EmptyState, IconButton, PaneHeader } from "../ui";
import ActivityGraph from "./ActivityGraph";

const POLL_MS = 5000;

const LEGEND: { label: string; color: string; dash?: boolean }[] = [
  { label: "Project", color: "var(--color-accent)" },
  { label: "Run", color: "var(--color-violet)" },
  { label: "Subagent", color: "var(--color-blue)" },
  { label: "File", color: "var(--color-muted-2)" },
  { label: "External host", color: "var(--color-amber)" },
  { label: "Cross-project link", color: "var(--color-red)" },
];

/**
 * Cross-project activity graph.
 *
 * Built only from tool calls that actually name a path, so exploratory runs
 * that work through shell commands contribute runs and subagents but few file
 * nodes — that is honest rather than a gap: we cannot know which files
 * `grep -rn …` touched without parsing its output.
 */
export default function GraphPane() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/graph", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setGraph(data.graph as GraphData);
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const empty = !graph || graph.nodes.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="Activity graph" count={graph?.nodes.length}>
        {graph && (
          <span className="font-mono text-[11px] text-[var(--color-muted-2)]">
            {graph.stats.sessions} runs · {graph.stats.files} files
            {graph.stats.crossProjectLinks > 0 && (
              <span className="text-[var(--color-red)]">
                {" "}
                · {graph.stats.crossProjectLinks} cross-project
              </span>
            )}
            {graph.stats.truncatedFiles > 0 && ` · ${graph.stats.truncatedFiles} files hidden`}
          </span>
        )}
        <IconButton label="Refresh graph" onClick={load} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "spin" : ""}`} />
        </IconButton>
      </PaneHeader>

      {empty ? (
        <div className="grid flex-1 place-items-center">
          <EmptyState
            icon={<Network className="size-7" />}
            title="No agent activity yet"
            hint="Run an agent from a project's Agents tab. Every file it reads or writes lands here, and a run that reaches into another project shows up as a red link."
          />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ActivityGraph nodes={graph.nodes} edges={graph.edges} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
            {LEGEND.map((l) => (
              <span
                key={l.label}
                className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: l.color }}
                  aria-hidden
                />
                {l.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
