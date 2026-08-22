"use client";

import { Bot, CornerDownRight } from "lucide-react";
import type { AgentNode } from "@/lib/agents/types";
import { NodeDot } from "./shared";

/**
 * The run's agency tree: the root agent and everything it delegated to.
 *
 * Each row's second line is the node's live activity — the answer to "what is
 * this subagent working on right now". When a node is idle the line falls back
 * to its assigned task, so a row is never blank.
 */
export default function AgentTree({
  nodes,
  selected,
  onSelect,
}: {
  nodes: AgentNode[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  // Roots first, then each root's children — the tree is only ever two deep
  // today, but ordering by parent keeps it correct if that ever changes.
  const roots = nodes.filter((n) => n.parentId === null);
  const ordered: { node: AgentNode; depth: number }[] = [];
  const walk = (node: AgentNode, depth: number) => {
    ordered.push({ node, depth });
    for (const child of nodes.filter((n) => n.parentId === node.id)) walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);

  return (
    <div className="flex flex-col">
      {ordered.map(({ node, depth }) => {
        const active = node.id === selected;
        const line = node.activity ?? node.task;
        return (
          <button
            key={node.id}
            onClick={() => onSelect(node.id)}
            className={`ring-focus group flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors cursor-pointer ${
              active
                ? "border-l-[var(--color-accent)] bg-[var(--color-surface-2)]"
                : "border-l-transparent hover:bg-[var(--color-surface-2)]/60"
            }`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
          >
            <span className="mt-1 flex items-center gap-1.5">
              {depth > 0 && (
                <CornerDownRight className="size-3 shrink-0 text-[var(--color-muted-2)]" />
              )}
              <NodeDot status={node.status} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {depth === 0 && <Bot className="size-3.5 shrink-0 text-[var(--color-muted)]" />}
                <span className="truncate text-[13px] font-medium">{node.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-muted-2)]">
                  {node.toolCalls}
                  {node.files.length > 0 && ` · ${node.files.length}f`}
                </span>
              </span>
              <span
                className={`mt-0.5 block truncate text-[11px] ${
                  node.activity
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-muted-2)]"
                }`}
                title={line ?? undefined}
              >
                {line ?? "idle"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
