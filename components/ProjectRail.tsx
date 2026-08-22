"use client";

import { useState } from "react";
import { Plus, Loader2, X, Server, GitBranch, Search, Bot, Network, LayoutGrid } from "lucide-react";
import type { GitSummary, ProjectView } from "@/lib/types";
import { STATUS_META } from "./format";

/** Top-level surfaces. "workspace" is the per-project view; the other two are
 *  cross-project and ignore the rail selection. */
export type HubView = "workspace" | "runs" | "graph";

const VIEWS: { id: HubView; label: string; icon: typeof Server }[] = [
  { id: "workspace", label: "Projects", icon: LayoutGrid },
  { id: "runs", label: "Runs", icon: Bot },
  { id: "graph", label: "Graph", icon: Network },
];

/**
 * Persistent project list. Deliberately dumb: it renders the summaries it is
 * given and never fetches, so a burst of log lines cannot re-render it.
 */
export default function ProjectRail({
  projects,
  summaries,
  selected,
  onSelect,
  onAdd,
  adding,
  addError,
  view,
  onViewChange,
  liveAgents,
}: {
  projects: ProjectView[];
  summaries: Record<string, GitSummary>;
  selected: string | null;
  onSelect: (name: string) => void;
  onAdd: (path: string) => Promise<void>;
  adding: boolean;
  addError: string | null;
  view: HubView;
  onViewChange: (view: HubView) => void;
  /** Count of in-flight agent runs, badged on the Runs tab. */
  liveAgents: number;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [filter, setFilter] = useState("");

  const q = filter.trim().toLowerCase();
  const visible = q
    ? projects.filter((p) => p.name.toLowerCase().includes(q))
    : projects;

  const running = projects.filter(
    (p) => p.state.status === "running" || p.state.status === "starting"
  ).length;

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3.5 py-3">
        <div className="grid size-7 place-items-center rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]">
          <Server className="size-3.5 text-[var(--color-accent)]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[13px] font-semibold tracking-tight">DevDeck</h1>
          <p className="font-mono text-[10px] text-[var(--color-muted-2)]">
            {running} running · {projects.length} projects
          </p>
        </div>
      </div>

      {/* Top-level surfaces */}
      <div className="flex gap-0.5 border-b border-[var(--color-border)] px-2 py-1.5">
        {VIEWS.map((v) => {
          const active = view === v.id;
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              onClick={() => onViewChange(v.id)}
              aria-pressed={active}
              className={`ring-focus relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors cursor-pointer ${
                active
                  ? "bg-[var(--color-surface-3)] text-[var(--color-foreground)]"
                  : "text-[var(--color-muted-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-muted)]"
              }`}
            >
              <Icon className="size-3.5" />
              {v.label}
              {v.id === "runs" && liveAgents > 0 && (
                <span className="status-pulse size-1.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {/* Filter */}
      <div className="border-b border-[var(--color-border)] px-2.5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted-2)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            spellCheck={false}
            aria-label="Filter projects"
            className="ring-focus w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-[var(--color-muted-2)]"
          />
        </div>
      </div>

      {/* Project list */}
      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1.5">
        {visible.map((p) => {
          const meta = STATUS_META[p.state.status];
          const git = summaries[p.name];
          const isSelected = selected === p.name;
          const active =
            p.state.status === "running" || p.state.status === "starting";
          return (
            <button
              key={p.name}
              onClick={() => onSelect(p.name)}
              aria-current={isSelected ? "page" : undefined}
              className={`ring-focus group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer ${
                isSelected
                  ? "bg-[var(--color-surface-2)]"
                  : "hover:bg-[var(--color-surface-2)]/60"
              }`}
            >
              {/* Selection marker doubles as the status dot's anchor. */}
              <span
                aria-hidden
                className={`h-7 w-0.5 shrink-0 rounded-full ${
                  isSelected ? "bg-[var(--color-accent)]" : "bg-transparent"
                }`}
              />
              <span
                className={`size-1.5 shrink-0 rounded-full ${meta.dot} ${
                  active ? "status-pulse" : ""
                }`}
                title={meta.label}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[13px] ${
                    isSelected
                      ? "font-medium text-[var(--color-foreground)]"
                      : "text-[var(--color-muted)] group-hover:text-[var(--color-foreground)]"
                  }`}
                >
                  {p.name}
                </span>
                {git?.isRepo && (
                  <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-[var(--color-muted-2)]">
                    <GitBranch className="size-2.5 shrink-0" />
                    <span className="truncate">
                      {git.detached
                        ? "detached"
                        : (git.branch ?? "—")}
                    </span>
                    {git.dirty > 0 && (
                      <span className="text-[var(--color-amber)]">
                        ·{git.dirty}
                      </span>
                    )}
                    {git.ahead ? (
                      <span className="text-[var(--color-blue)]">↑{git.ahead}</span>
                    ) : null}
                    {git.behind ? (
                      <span className="text-[var(--color-violet)]">↓{git.behind}</span>
                    ) : null}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {visible.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-[var(--color-muted-2)]">
            {q ? "No projects match." : "No projects found."}
          </p>
        )}
      </nav>

      {/* Add project */}
      <div className="border-t border-[var(--color-border)] p-2">
        {showAdd ? (
          <form
            className="slide-up"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newPath.trim() || adding) return;
              await onAdd(newPath.trim());
              setNewPath("");
            }}
          >
            <input
              autoFocus
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="~/code/my-app"
              spellCheck={false}
              autoComplete="off"
              aria-label="Project folder path"
              className="ring-focus w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2 py-1.5 font-mono text-xs outline-none placeholder:text-[var(--color-muted-2)]"
            />
            {addError && (
              <p className="mt-1.5 text-[10px] text-[var(--color-red)]">
                {addError}
              </p>
            )}
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="submit"
                disabled={adding || !newPath.trim()}
                className="ring-focus flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent)] px-2 py-1.5 text-xs font-semibold text-[var(--color-accent-fg)] transition-[filter] hover:brightness-110 disabled:opacity-45 cursor-pointer"
              >
                {adding ? <Loader2 className="size-3 spin" /> : null}
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                aria-label="Cancel"
                className="ring-focus grid size-7 place-items-center rounded-md border border-[var(--color-border-strong)] text-[var(--color-muted-2)] hover:text-[var(--color-foreground)] cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="ring-focus flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--color-muted-2)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            <Plus className="size-3.5" />
            Add project
          </button>
        )}
      </div>
    </aside>
  );
}
