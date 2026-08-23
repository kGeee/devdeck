"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Generic force-directed layout.
 *
 * Lifted out of the agent activity graph so the design graph could reuse the
 * simulation rather than carry a second copy of the same physics. Callers map
 * their own domain nodes onto the shape below; nothing here knows what a
 * project, a run or a folder is.
 *
 * A physics library would be the obvious reach, but these graphs are a few
 * hundred nodes at most and an O(n squared) repulsion pass at that size costs
 * well under a frame. The simulation cools on a fixed alpha decay and then
 * stops scheduling frames, so an idle graph burns no CPU.
 */

export interface ForceNode {
  id: string;
  label: string;
  color: string;
  radius: number;
  /** Draw the label unconditionally; otherwise it appears on hover. */
  showLabel?: boolean;
  /** Breathing outline, for something live. */
  pulse?: boolean;
  /** Tooltip text. */
  title?: string;
}

export interface ForceEdge {
  id: string;
  source: string;
  target: string;
  color: string;
  width: number;
  dash?: string;
  opacity?: number;
}

interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export default function ForceGraph({
  nodes,
  edges,
  width = 1200,
  height = 760,
  onSelect,
}: {
  nodes: ForceNode[];
  edges: ForceEdge[];
  width?: number;
  height?: number;
  onSelect?: (id: string) => void;
}) {
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const points = useRef(new Map<string, Point>());
  const frame = useRef<number | null>(null);
  /** Latest data, so a poll producing an identical shape cannot restart the run. */
  const data = useRef({ nodes, edges });
  data.current = { nodes, edges };

  const shape = useMemo(
    () => `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => e.id).join(",")}`,
    [nodes, edges]
  );

  useEffect(() => {
    const pts = points.current;
    const { nodes, edges } = data.current;

    // Seed new nodes on a spiral; keep positions for nodes already placed so
    // the layout does not jump when one node is added.
    const golden = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach((n, i) => {
      if (pts.has(n.id)) return;
      pts.set(n.id, {
        x: width / 2 + Math.cos(i * golden) * (60 + i * 6),
        y: height / 2 + Math.sin(i * golden) * (60 + i * 6),
        vx: 0,
        vy: 0,
      });
    });
    for (const id of [...pts.keys()]) {
      if (!nodes.some((n) => n.id === id)) pts.delete(id);
    }

    let alpha = 1;
    const ideal = Math.max(50, Math.min(120, 900 / Math.sqrt(nodes.length + 1)));

    const step = () => {
      alpha *= 0.985;

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
            dx = (i % 7) - 3 || 1;
            dy = (j % 5) - 2 || 1;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const force = (ideal * ideal) / d2;
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

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

      for (const n of nodes) {
        const p = pts.get(n.id);
        if (!p) continue;
        p.vx += (width / 2 - p.x) * 0.006;
        p.vy += (height / 2 - p.y) * 0.006;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x = Math.max(24, Math.min(width - 24, p.x + p.vx * alpha));
        p.y = Math.max(24, Math.min(height - 24, p.y + p.vy * alpha));
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
  }, [shape, width, height]);

  const pts = points.current;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img">
      <g>
        {edges.map((e) => {
          const a = pts.get(e.source);
          const b = pts.get(e.target);
          if (!a || !b) return null;
          const lit = hover != null && (e.source === hover || e.target === hover);
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.color}
              strokeWidth={lit ? e.width + 1 : e.width}
              strokeDasharray={e.dash}
              opacity={lit ? 0.95 : (e.opacity ?? 0.4)}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((n) => {
          const p = pts.get(n.id);
          if (!p) return null;
          const active = hover === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
              onClick={() => onSelect?.(n.id)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              {n.title && <title>{n.title}</title>}
              <circle
                r={n.radius}
                fill={n.color}
                fillOpacity={active ? 1 : 0.85}
                stroke={n.pulse ? "var(--color-accent)" : "var(--color-background)"}
                strokeWidth={n.pulse ? 2 : 1.5}
                className={n.pulse ? "status-pulse" : undefined}
              />
              {(n.showLabel || active) && (
                <text
                  y={-n.radius - 5}
                  textAnchor="middle"
                  className="pointer-events-none"
                  fill="var(--color-foreground)"
                  fontSize={active ? 12 : 10}
                  fontWeight={n.showLabel ? 600 : 400}
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
