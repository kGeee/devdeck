import path from "node:path";
import type { AgentProvider, AgentSession } from "./types";

/**
 * Cross-project activity graph.
 *
 * Built from recorded tool calls rather than from anything the models say, so
 * it shows what the agents actually touched. The interesting structure it
 * surfaces is a *cross-project* edge: a run launched in project A that reads or
 * writes a file living under project B. That is a real coupling — a shared
 * library, a copied config, a monorepo boundary being crossed — and it is
 * invisible in any single project's view.
 */

export type GraphNodeKind = "project" | "session" | "subagent" | "file" | "host";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Owning project, used for clustering and colour. Null for external hosts. */
  project: string | null;
  provider: AgentProvider | null;
  status: string | null;
  /** Touch count — drives node size. */
  weight: number;
}

export type GraphEdgeKind =
  | "ran-in"
  | "delegated"
  | "read"
  | "write"
  | "execute"
  | "network"
  | "cross-project";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  count: number;
}

export interface ActivityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    sessions: number;
    files: number;
    crossProjectLinks: number;
    /** File nodes dropped by the top-N cap, so the UI can say so honestly. */
    truncatedFiles: number;
  };
}

export interface ProjectRef {
  name: string;
  path: string;
}

/** Longest-prefix match of a file path to a known project. */
function owningProject(file: string, projects: ProjectRef[]): ProjectRef | null {
  let best: ProjectRef | null = null;
  for (const p of projects) {
    const root = p.path.endsWith(path.sep) ? p.path : p.path + path.sep;
    if (file === p.path || file.startsWith(root)) {
      if (!best || p.path.length > best.path.length) best = p;
    }
  }
  return best;
}

/** Keep the graph legible: only the most-touched files get their own node. */
const MAX_FILE_NODES = 120;

export function buildGraph(
  sessions: AgentSession[],
  projects: ProjectRef[]
): ActivityGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (node: GraphNode) => {
    const existing = nodes.get(node.id);
    if (existing) {
      existing.weight += node.weight;
      // A live status wins over a stale one.
      if (node.status) existing.status = node.status;
      return existing;
    }
    nodes.set(node.id, node);
    return node;
  };

  const addEdge = (source: string, target: string, kind: GraphEdgeKind) => {
    const id = `${source}->${target}:${kind}`;
    const existing = edges.get(id);
    if (existing) {
      existing.count += 1;
      return;
    }
    edges.set(id, { id, source, target, kind, count: 1 });
  };

  // Count file touches first so the top-N cap is applied on real weight rather
  // than on whichever files happened to appear first.
  const fileTouches = new Map<string, number>();
  for (const s of sessions) {
    for (const call of s.toolCalls) {
      if (!call.path) continue;
      if (call.effect !== "read" && call.effect !== "write") continue;
      fileTouches.set(call.path, (fileTouches.get(call.path) ?? 0) + 1);
    }
  }
  const ranked = [...fileTouches.entries()].sort((a, b) => b[1] - a[1]);
  const keptFiles = new Set(ranked.slice(0, MAX_FILE_NODES).map(([p]) => p));
  const truncatedFiles = Math.max(0, ranked.length - keptFiles.size);

  let crossProjectLinks = 0;

  for (const s of sessions) {
    const projectId = `project:${s.project}`;
    addNode({
      id: projectId,
      kind: "project",
      label: s.project,
      project: s.project,
      provider: null,
      status: null,
      weight: 1,
    });

    const sessionId = `session:${s.id}`;
    addNode({
      id: sessionId,
      kind: "session",
      label: s.prompt.slice(0, 60),
      project: s.project,
      provider: s.provider,
      status: s.status,
      weight: 1,
    });
    addEdge(sessionId, projectId, "ran-in");

    for (const node of s.nodes) {
      if (node.kind !== "subagent") continue;
      const subId = `subagent:${s.id}:${node.id}`;
      addNode({
        id: subId,
        kind: "subagent",
        label: node.name,
        project: s.project,
        provider: s.provider,
        status: node.status,
        weight: Math.max(1, node.toolCalls),
      });
      addEdge(sessionId, subId, "delegated");
    }

    for (const call of s.toolCalls) {
      // The issuing actor: a subagent when the call came from one, else the run.
      const actorId =
        call.nodeId === "root" ? sessionId : `subagent:${s.id}:${call.nodeId}`;
      const actor = nodes.get(actorId) ? actorId : sessionId;

      if (call.host) {
        const hostId = `host:${call.host}`;
        addNode({
          id: hostId,
          kind: "host",
          label: call.host,
          project: null,
          provider: null,
          status: null,
          weight: 1,
        });
        addEdge(actor, hostId, "network");
        continue;
      }

      if (!call.path) continue;
      if (call.effect !== "read" && call.effect !== "write") continue;
      if (!keptFiles.has(call.path)) continue;

      const owner = owningProject(call.path, projects);
      const fileId = `file:${call.path}`;
      addNode({
        id: fileId,
        kind: "file",
        label: owner ? path.relative(owner.path, call.path) || path.basename(call.path) : call.path,
        project: owner?.name ?? null,
        provider: null,
        status: null,
        weight: fileTouches.get(call.path) ?? 1,
      });
      addEdge(actor, fileId, call.effect === "write" ? "write" : "read");

      // The payoff: this run reached into a project other than its own.
      if (owner && owner.name !== s.project) {
        const otherId = `project:${owner.name}`;
        addNode({
          id: otherId,
          kind: "project",
          label: owner.name,
          project: owner.name,
          provider: null,
          status: null,
          weight: 1,
        });
        const edgeId = `${projectId}->${otherId}:cross-project`;
        if (!edges.has(edgeId)) crossProjectLinks += 1;
        addEdge(projectId, otherId, "cross-project");
        addEdge(fileId, otherId, "ran-in");
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    stats: {
      sessions: sessions.length,
      files: keptFiles.size,
      crossProjectLinks,
      truncatedFiles,
    },
  };
}
