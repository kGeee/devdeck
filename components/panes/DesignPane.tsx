"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, RefreshCw, Search } from "lucide-react";
import type { DesignFolder, DesignFolderEdge, DesignFile, FileKind } from "@/lib/design/types";
import type { ProjectView } from "@/lib/types";
import ForceGraph, { type ForceEdge, type ForceNode } from "../ForceGraph";
import { Badge, Button, EmptyState, ErrorNote } from "../ui";
import { relativeTime } from "../format";

/** Colour by role, so the shape of a codebase is readable at a glance. */
const KIND_COLOR: Record<FileKind, string> = {
  route: "var(--color-violet)",
  api: "var(--color-blue)",
  component: "var(--color-accent)",
  lib: "var(--color-amber)",
  hook: "var(--color-blue)",
  type: "var(--color-muted-2)",
  test: "var(--color-muted-2)",
  config: "var(--color-muted)",
  script: "var(--color-amber)",
  style: "var(--color-violet)",
  asset: "var(--color-muted-2)",
  other: "var(--color-muted-2)",
};

/** File view is capped: a thousand circles is neither readable nor fast. */
const MAX_FILE_NODES = 160;

interface DesignPayload {
  builtAt: number;
  durationMs: number;
  stats: {
    fileCount: number;
    loc: number;
    edgeCount: number;
    orphans: number;
    cycles: number;
    truncated: boolean;
  };
  folders: DesignFolder[];
  folderEdges: DesignFolderEdge[];
  files: DesignFile[];
  fileEdges: { from: string; to: string }[];
}

interface SearchHit {
  path: string;
  kind: FileKind;
  loc: number;
  fanIn: number;
  doc: string | null;
  symbols: string[];
  score: number;
  matched: string[];
  imports: string[];
  importedBy: string[];
}

/**
 * A project's structural graph: what modules exist and what imports what.
 *
 * The default is the folder rollup rather than the file graph, because a
 * project of any size has far too many files for a file-level picture to say
 * anything. Search is the other half: it answers "where is X" straight from the
 * index, without opening a file.
 */
export default function DesignPane({ project }: { project: ProjectView }) {
  const [data, setData] = useState<DesignPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepth] = useState(2);
  const [view, setView] = useState<"folders" | "files">("folders");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const name = encodeURIComponent(project.name);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${name}/design?depth=${depth}`, {
        cache: "no-store",
      });
      // 204 means the graph has never been built for this project.
      if (res.status === 204) {
        setData(null);
        return;
      }
      if (!res.ok) return;
      setData((await res.json()) as DesignPayload);
    } catch {
      /* transient */
    } finally {
      setLoaded(true);
    }
  }, [name, depth]);

  useEffect(() => {
    void load();
  }, [load]);

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${name}/design`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build the graph");
    } finally {
      setBuilding(false);
    }
  };

  const runSearch = async (q: string) => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/projects/${name}/search?q=${encodeURIComponent(q)}&limit=10`,
        { cache: "no-store" }
      );
      const body = await res.json().catch(() => ({}));
      setHits(res.ok ? (body.hits as SearchHit[]) : []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const { nodes, edges } = useMemo((): { nodes: ForceNode[]; edges: ForceEdge[] } => {
    if (!data) return { nodes: [], edges: [] };

    if (view === "folders") {
      const maxLoc = Math.max(1, ...data.folders.map((f) => f.loc));
      return {
        nodes: data.folders.map((f) => ({
          id: f.path,
          label: f.path,
          color: KIND_COLOR[f.kind],
          radius: 8 + Math.sqrt(f.loc / maxLoc) * 20,
          showLabel: true,
          title: `${f.path} — ${f.files} files, ${f.loc.toLocaleString()} lines`,
        })),
        edges: data.folderEdges.map((e) => ({
          id: `${e.from}>${e.to}`,
          source: e.from,
          target: e.to,
          color: "var(--color-border-strong)",
          width: Math.min(4, 0.6 + Math.log2(1 + e.count)),
          opacity: 0.5,
        })),
      };
    }

    // Files: keep the most connected, which is where the structure lives.
    const ranked = [...data.files]
      .sort((a, b) => b.fanIn - a.fanIn || b.loc - a.loc)
      .slice(0, MAX_FILE_NODES);
    const keep = new Set(ranked.map((f) => f.path));
    const highlighted = new Set(hits?.map((h) => h.path) ?? []);

    return {
      nodes: ranked.map((f) => ({
        id: f.path,
        label: f.path.split("/").pop() ?? f.path,
        color: KIND_COLOR[f.kind],
        radius: 4 + Math.min(10, Math.log2(1 + f.fanIn) * 2.5),
        showLabel: f.fanIn >= 4 || highlighted.has(f.path),
        pulse: highlighted.has(f.path),
        title: `${f.path} — ${f.loc} lines, imported by ${f.fanIn}`,
      })),
      edges: data.fileEdges
        .filter((e) => keep.has(e.from) && keep.has(e.to))
        .map((e) => ({
          id: `${e.from}>${e.to}`,
          source: e.from,
          target: e.to,
          color: "var(--color-border-strong)",
          width: 1,
          opacity: 0.35,
        })),
    };
  }, [data, view, hits]);

  if (loaded && !data) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <EmptyState
          icon={<Network className="size-7" />}
          title="No design graph for this project yet"
          hint={
            <>
              Build one to map its modules and imports, and to search it by
              intent without opening files.
              <span className="mt-3 block">
                <Button variant="primary" size="sm" onClick={build} busy={building}>
                  Build design graph
                </Button>
              </span>
              {error && <span className="mt-3 block">{error}</span>}
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted-2)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch(query);
              if (e.key === "Escape") {
                setQuery("");
                setHits(null);
              }
            }}
            placeholder="Describe what you're looking for — e.g. the gallery page implementation"
            spellCheck={false}
            className="ring-focus w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-[var(--color-muted-2)]"
          />
        </div>
        <Button size="sm" onClick={() => void runSearch(query)} busy={searching}>
          Search
        </Button>

        <span className="mx-1 h-4 w-px bg-[var(--color-border-strong)]" aria-hidden />

        {(["folders", "files"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`ring-focus rounded-md border px-2.5 py-1 text-xs capitalize transition-colors cursor-pointer ${
              view === v
                ? "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-foreground)]"
                : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-muted)]"
            }`}
          >
            {v}
          </button>
        ))}

        {view === "folders" && (
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            aria-label="Folder depth"
            className="ring-focus rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none"
          >
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>
                depth {d}
              </option>
            ))}
          </select>
        )}

        <Button size="sm" onClick={build} busy={building} title="Rescan the project">
          <RefreshCw className={`size-3.5 ${building ? "spin" : ""}`} />
          Rebuild
        </Button>
      </div>

      {error && (
        <div className="px-4 pt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Search results, when there are any */}
        {hits && (
          <div className="scroll-thin w-80 shrink-0 overflow-y-auto border-r border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] px-3 py-2">
              <p className="text-[11px] text-[var(--color-muted)]">
                {hits.length} result{hits.length === 1 ? "" : "s"}
              </p>
            </div>
            {hits.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-[var(--color-muted-2)]">
                Nothing matched. Try naming a feature, a route or a symbol.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {hits.map((h) => (
                  <li key={h.path} className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: KIND_COLOR[h.kind] }}
                        aria-hidden
                      />
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px]"
                        title={h.path}
                      >
                        {h.path}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-muted-2)]">
                        {h.score}
                      </span>
                    </div>
                    {h.doc && (
                      <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
                        {h.doc}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {h.symbols.slice(0, 4).map((s) => (
                        <span
                          key={s}
                          className="rounded bg-[var(--color-surface-2)] px-1 font-mono text-[9.5px] text-[var(--color-muted-2)]"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-[var(--color-muted-2)]">
                      {h.loc} loc · imported by {h.fanIn} · imports {h.imports.length}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="relative min-w-0 flex-1 overflow-hidden">
          {nodes.length === 0 ? (
            <EmptyState icon={<Network className="size-6" />} title="Nothing to draw" />
          ) : (
            <ForceGraph nodes={nodes} edges={edges} />
          )}
          {/* A monorepo collapses to a handful of disconnected blobs at depth 1,
              because every import is internal to one package at that level.
              Say so, rather than showing what looks like a broken graph. */}
          {nodes.length > 1 && edges.length === 0 && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] text-[var(--color-muted-2)]">
              No imports cross a folder boundary at this depth — try a deeper one.
            </p>
          )}
        </div>
      </div>

      {/* Stats footer */}
      {data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 font-mono text-[11px] text-[var(--color-muted-2)]">
          <span>{data.stats.fileCount} files</span>
          <span>{data.stats.loc.toLocaleString()} lines</span>
          <span>{data.stats.edgeCount} imports</span>
          <span>{data.stats.orphans} unconnected</span>
          {data.stats.cycles > 0 && (
            <Badge tone="amber">{data.stats.cycles} import cycles</Badge>
          )}
          {data.stats.truncated && <Badge tone="red">file cap hit</Badge>}
          <span className="ml-auto">
            built {relativeTime(data.builtAt)} in {data.durationMs}ms
          </span>
        </div>
      )}
    </div>
  );
}
