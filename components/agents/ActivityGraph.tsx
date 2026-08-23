"use client";

import { useMemo } from "react";
import type { GraphEdge, GraphEdgeKind, GraphNode } from "@/lib/agents/graph";
import ForceGraph, { type ForceEdge, type ForceNode } from "../ForceGraph";

/**
 * Agent activity across projects, drawn with the shared force layout.
 *
 * This file is only the mapping from activity semantics onto the generic graph
 * shape; the simulation lives in ForceGraph so the design graph can reuse it.
 */

const EDGE_STYLE: Record<GraphEdgeKind, { stroke: string; dash?: string; width: number }> = {
  "ran-in": { stroke: "var(--color-border-strong)", width: 1 },
  delegated: { stroke: "var(--color-violet)", width: 1.5 },
  read: { stroke: "var(--color-blue)", width: 1, dash: "3 3" },
  write: { stroke: "var(--color-accent)", width: 1.5 },
  execute: { stroke: "var(--color-amber)", width: 1 },
  network: { stroke: "var(--color-blue)", width: 1 },
  // The headline relationship: one project's run reaching into another.
  "cross-project": { stroke: "var(--color-red)", width: 2 },
};

const NODE_STYLE: Record<GraphNode["kind"], { fill: string; r: number }> = {
  project: { fill: "var(--color-accent)", r: 13 },
  session: { fill: "var(--color-violet)", r: 8 },
  subagent: { fill: "var(--color-blue)", r: 6 },
  file: { fill: "var(--color-muted-2)", r: 4 },
  host: { fill: "var(--color-amber)", r: 5 },
};

export default function ActivityGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const mappedNodes = useMemo(
    (): ForceNode[] =>
      nodes.map((n) => {
        const style = NODE_STYLE[n.kind];
        return {
          id: n.id,
          label: n.label,
          color: style.fill,
          radius: style.r + Math.min(6, Math.log2(Math.max(1, n.weight)) * 1.5),
          // Projects and subagents are the structure; everything else would
          // just crowd the canvas with labels.
          showLabel: n.kind === "project" || n.kind === "subagent",
          pulse: n.status === "running",
          title: n.label,
        };
      }),
    [nodes]
  );

  const mappedEdges = useMemo(
    (): ForceEdge[] =>
      edges.map((e) => {
        const style = EDGE_STYLE[e.kind];
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          color: style.stroke,
          width: style.width,
          dash: style.dash,
          opacity: e.kind === "cross-project" ? 0.85 : 0.4,
        };
      }),
    [edges]
  );

  return <ForceGraph nodes={mappedNodes} edges={mappedEdges} />;
}
