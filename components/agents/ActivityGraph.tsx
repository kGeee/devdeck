"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphEdgeKind, GraphNode } from "@/lib/agents/graph";

/**
 * Force-directed layout, hand-rolled.
 *
 * A real physics library would be the obvious reach, but this graph is a few
 * hundred nodes at most and DevDeck currently ships four runtime dependencies.
 * An O(n²) repulsion pass at this size costs well under a frame, so the layout
 * is not worth a new dependency.
 *
 * The simulation cools on a fixed alpha decay and then stops scheduling
 * frames, so an idle graph burns no CPU.
 */

interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

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

const W = 1200;
const H = 760;

export default function ActivityGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<GraphNode | null>(null);
  const points = useRef(new Map<string, Point>());
  const frame = useRef<number | null>(null);
  /** Latest data, so the simulation can read it without being restarted by a
   *  poll that produced structurally identical arrays. */
  const data = useRef({ nodes, edges });
  data.current = { nodes, edges };

  // Stable key so the simulation restarts only when the graph really changes.
  const shape = useMemo(
    () => `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => e.id).join(",")}`,
    [nodes, edges]
  );

  useEffect(() => {
    const pts = points.current;
    const { nodes, edges } = data.current;
    // Seed new nodes on a circle; keep positions for nodes we already placed so
    // the layout doesn't jump every time a run adds a file.
    const golden = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach((n, i) => {
      if (pts.has(n.id)) return;
      const radius = n.kind === "project" ? 90 : 260;
      pts.set(n.id, {
        x: W / 2 + Math.cos(i * golden) * radius,
        y: H / 2 + Math.sin(i * golden) * radius,
        vx: 0,
        vy: 0,
      });
    });
    for (const id of [...pts.keys()]) {
      if (!nodes.some((n) => n.id === id)) pts.delete(id);
    }

    let alpha = 1;
    const ideal = 90;

    const step = () => {
      alpha *= 0.985;

      // Repulsion (every pair).
      for (let i = 0; i < nodes.length; i++) {
        const a = pts.get(nodes[i].id);
        if (!a) continue;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = pts.get(nodes[j].id);
          if (!b) continue;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            // Perfectly coincident nodes produce NaN; nudge them apart.
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            d2 = 1;
          }
          const force = (ideal * ideal) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Springs along edges.
      for (const e of edges) {
        const a = pts.get(e.source);
        const b = pts.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const force = (d * d) / (ideal * 14);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // Gravity toward the centre, plus damping and integration.
      for (const n of nodes) {
        const p = pts.get(n.id);
        if (!p) continue;
        p.vx += (W / 2 - p.x) * 0.006;
        p.vy += (H / 2 - p.y) * 0.006;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x = Math.max(24, Math.min(W - 24, p.x + p.vx * alpha));
        p.y = Math.max(24, Math.min(H - 24, p.y + p.vy * alpha));
      }

      setTick((t) => t + 1);
      // Below this the movement is sub-pixel; stop burning frames.
      if (alpha > 0.02) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
    // Structure only: see `data` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  const pts = points.current;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      role="img"
      aria-label="Agent activity across projects"
    >
      <g>
        {edges.map((e) => {
          const a = pts.get(e.source);
          const b = pts.get(e.target);
          if (!a || !b) return null;
          const style = EDGE_STYLE[e.kind];
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={style.stroke}
              strokeWidth={style.width}
              strokeDasharray={style.dash}
              opacity={e.kind === "cross-project" ? 0.85 : 0.4}
            />
          );
        })}
      </g>

      <g>
        {nodes.map((n) => {
          const p = pts.get(n.id);
          if (!p) return null;
          const style = NODE_STYLE[n.kind];
          const r = style.r + Math.min(6, Math.log2(Math.max(1, n.weight)) * 1.5);
          const live = n.status === "running";
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
              style={{ cursor: "pointer" }}
            >
              <circle
                r={r}
                fill={style.fill}
                fillOpacity={n.kind === "file" ? 0.5 : 0.85}
                stroke={live ? "var(--color-accent)" : "var(--color-background)"}
                strokeWidth={live ? 2 : 1.5}
                className={live ? "status-pulse" : undefined}
              />
              {(n.kind === "project" || n.kind === "subagent" || hover?.id === n.id) && (
                <text
                  y={-r - 5}
                  textAnchor="middle"
                  className="pointer-events-none"
                  fill="var(--color-foreground)"
                  fontSize={n.kind === "project" ? 12 : 10}
                  fontWeight={n.kind === "project" ? 600 : 400}
                >
                  {n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
