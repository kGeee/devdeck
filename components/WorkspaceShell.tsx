"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers } from "lucide-react";
import type { GitSummary, ProjectView } from "@/lib/types";
import ProjectRail, { type HubView } from "./ProjectRail";
import WorkspaceHeader from "./WorkspaceHeader";
import LogDock from "./LogDock";
import OverviewPane from "./panes/OverviewPane";
import ChangesPane from "./panes/ChangesPane";
import BranchesPane from "./panes/BranchesPane";
import PullRequestsPane from "./panes/PullRequestsPane";
import ScriptsPane from "./panes/ScriptsPane";
import AgentsPane from "./agents/AgentsPane";
import AllRunsPane from "./agents/AllRunsPane";
import GraphPane from "./agents/GraphPane";
import { EmptyState } from "./ui";

const PROCESS_POLL_MS = 2000;
/** Git state is subprocess-backed; the server caches it for 30s anyway. */
const GIT_POLL_MS = 20000;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "changes", label: "Changes" },
  { id: "branches", label: "Branches" },
  { id: "prs", label: "Pull Requests" },
  { id: "scripts", label: "Scripts" },
  { id: "agents", label: "Agents" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function WorkspaceShell() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [summaries, setSummaries] = useState<Record<string, GitSummary>>({});
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [view, setView] = useState<HubView>("workspace");
  /** In-flight agent runs, for the Runs tab indicator. */
  const [liveAgents, setLiveAgents] = useState(0);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockHeight, setDockHeight] = useState(220);
  /** Bumped to tell the active pane its project's git state changed. */
  const [gitNonce, setGitNonce] = useState(0);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  /* ── Data loading ─────────────────────────────────────────────────────── */

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects);
      // Default to the first project once, on initial load.
      if (!selectedRef.current && data.projects.length > 0) {
        setSelected(data.projects[0].name);
      }
    } catch {
      /* transient; the next poll retries */
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadSummaries = useCallback(async () => {
    try {
      const res = await fetch("/api/git/summary", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, GitSummary> = {};
      for (const s of data.summaries as GitSummary[]) map[s.name] = s;
      setSummaries(map);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    loadProjects();
    const t = setInterval(loadProjects, PROCESS_POLL_MS);
    return () => clearInterval(t);
  }, [loadProjects]);

  useEffect(() => {
    loadSummaries();
    const t = setInterval(loadSummaries, GIT_POLL_MS);
    return () => clearInterval(t);
  }, [loadSummaries]);

  /* Live agent count for the rail indicator. Cheap: in-memory on the server. */
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setLiveAgents(
          (data.sessions as { status: string }[]).filter(
            (s) => s.status === "running" || s.status === "starting"
          ).length
        );
      } catch {
        /* transient */
      }
    };
    load();
    const t = setInterval(load, PROCESS_POLL_MS);
    return () => clearInterval(t);
  }, []);

  /** Called by panes after a write so the rail and sibling panes catch up. */
  const refreshGit = useCallback(() => {
    setGitNonce((n) => n + 1);
    void loadSummaries();
  }, [loadSummaries]);

  /* ── Selection persists in the URL hash so a reload keeps your place ──── */

  useEffect(() => {
    const fromHash = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      const [name, t] = raw.split("/");
      if (name) setSelected(decodeURIComponent(name));
      if (t && TABS.some((x) => x.id === t)) setTab(t as TabId);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const next = `#${encodeURIComponent(selected)}/${tab}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [selected, tab]);

  /* ── Actions ──────────────────────────────────────────────────────────── */

  const act = useCallback(
    async (name: string, action: "start" | "stop") => {
      setBusy((b) => ({ ...b, [name]: true }));
      setProjects((ps) =>
        ps.map((p) =>
          p.name === name && action === "start"
            ? { ...p, state: { ...p.state, status: "starting" } }
            : p
        )
      );
      try {
        await fetch(`/api/projects/${encodeURIComponent(name)}/${action}`, {
          method: "POST",
        });
      } catch {
        /* surfaced via polling */
      } finally {
        await loadProjects();
        setBusy((b) => ({ ...b, [name]: false }));
      }
      if (action === "start") setDockOpen(true);
    },
    [loadProjects]
  );

  const open = useCallback(async (name: string, target: "editor" | "finder") => {
    await fetch(`/api/projects/${encodeURIComponent(name)}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
  }, []);

  const addProject = useCallback(
    async (path: string) => {
      setAdding(true);
      setAddError(null);
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        await loadProjects();
        await loadSummaries();
        if (data?.project?.name) setSelected(data.project.name);
      } catch (e) {
        setAddError(e instanceof Error ? e.message : "Failed to add project");
      } finally {
        setAdding(false);
      }
    },
    [loadProjects, loadSummaries]
  );

  const removeProject = useCallback(
    async (name: string) => {
      if (
        !window.confirm(
          `Remove "${name}" from DevDeck? Your files stay untouched.`
        )
      ) {
        return;
      }
      await fetch(`/api/projects/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      setSelected(null);
      await loadProjects();
    },
    [loadProjects]
  );

  const setPort = useCallback(
    async (name: string, port: number | null) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      // Reflect immediately; it takes effect on the next start.
      setProjects((ps) =>
        ps.map((p) => (p.name === name ? { ...p, portOverride: port } : p))
      );
    },
    []
  );

  const project = useMemo(
    () => projects.find((p) => p.name === selected) ?? null,
    [projects, selected]
  );

  /* ── Render ───────────────────────────────────────────────────────────── */

  return (
    <div className="flex h-dvh overflow-hidden">
      <ProjectRail
        projects={projects}
        summaries={summaries}
        selected={selected}
        onSelect={setSelected}
        onAdd={addProject}
        adding={adding}
        addError={addError}
        view={view}
        onViewChange={setView}
        liveAgents={liveAgents}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {view === "graph" ? (
          <GraphPane />
        ) : view === "runs" ? (
          <AllRunsPane />
        ) : project ? (
          <>
            <WorkspaceHeader
              project={project}
              busy={!!busy[project.name]}
              dockOpen={dockOpen}
              onStart={() => act(project.name, "start")}
              onStop={() => act(project.name, "stop")}
              onOpen={(t) => open(project.name, t)}
              onRemove={() => removeProject(project.name)}
              onToggleDock={() => setDockOpen((v) => !v)}
              onSetPort={(port) => setPort(project.name, port)}
            />

            <nav
              role="tablist"
              className="flex shrink-0 items-center gap-0.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3"
            >
              {TABS.map((t) => {
                const active = tab === t.id;
                const badge =
                  t.id === "changes"
                    ? (summaries[project.name]?.dirty ?? 0)
                    : 0;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.id)}
                    className={`ring-focus relative flex items-center gap-1.5 px-3 py-2 text-[13px] transition-colors cursor-pointer ${
                      active
                        ? "text-[var(--color-foreground)]"
                        : "text-[var(--color-muted-2)] hover:text-[var(--color-muted)]"
                    }`}
                  >
                    {t.label}
                    {badge > 0 && (
                      <span className="rounded bg-[var(--color-amber)]/15 px-1 font-mono text-[10px] text-[var(--color-amber)]">
                        {badge}
                      </span>
                    )}
                    <span
                      aria-hidden
                      className={`absolute inset-x-2 -bottom-px h-px ${
                        active ? "bg-[var(--color-accent)]" : "bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </nav>

            {/* Panes are keyed by project so switching resets their state.
                The agents pane owns its own scroll regions (tree and feed
                scroll independently), so it opts out of the shared overflow. */}
            <main
              className={
                tab === "agents"
                  ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                  : "scroll-thin min-h-0 flex-1 overflow-y-auto"
              }
            >
              {tab === "overview" && (
                <OverviewPane
                  key={`${project.name}-overview`}
                  project={project}
                  nonce={gitNonce}
                  onGoToTab={setTab}
                />
              )}
              {tab === "changes" && (
                <ChangesPane
                  key={`${project.name}-changes`}
                  project={project}
                  nonce={gitNonce}
                  onChanged={refreshGit}
                />
              )}
              {tab === "branches" && (
                <BranchesPane
                  key={`${project.name}-branches`}
                  project={project}
                  nonce={gitNonce}
                  onChanged={refreshGit}
                />
              )}
              {tab === "prs" && (
                <PullRequestsPane
                  key={`${project.name}-prs`}
                  project={project}
                  onChanged={refreshGit}
                />
              )}
              {tab === "scripts" && (
                <ScriptsPane key={`${project.name}-scripts`} project={project} />
              )}
              {tab === "agents" && (
                <AgentsPane key={`${project.name}-agents`} project={project} />
              )}
            </main>
          </>
        ) : (
          <div className="grid flex-1 place-items-center">
            <EmptyState
              icon={<Layers className="size-7" />}
              title={loaded ? "Select a project" : "Loading projects…"}
              hint={
                loaded
                  ? "Pick one from the left, or add a folder that isn't in the scanned root."
                  : undefined
              }
            />
          </div>
        )}

        {/* Mounted once, outside the tab switch, so it survives tab changes.
            Scoped to the workspace view — the dock tails one project's dev
            server, which is meaningless while a cross-project view is open. */}
        {view === "workspace" && (
        <LogDock
          projectName={project?.name ?? null}
          open={dockOpen}
          height={dockHeight}
          onToggle={() => setDockOpen((v) => !v)}
          onResize={setDockHeight}
        />
        )}
      </div>
    </div>
  );
}
