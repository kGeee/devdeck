"use client";

import type { AgentProvider, AgentStatus, NodeStatus } from "@/lib/agents/types";
import { Badge } from "../ui";

/**
 * Provider identity. Green is reserved for "running" everywhere else in the
 * app, so no provider claims it — otherwise a stopped Claude run would still
 * read as active.
 */
export const PROVIDER_TONE: Record<AgentProvider, "violet" | "blue" | "amber"> = {
  claude: "violet",
  codex: "blue",
  gemini: "amber",
};

export const PROVIDER_LABEL: Record<AgentProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

export const STATUS_TONE: Record<AgentStatus, "accent" | "muted" | "red" | "amber"> = {
  starting: "amber",
  running: "accent",
  succeeded: "accent",
  failed: "red",
  cancelled: "muted",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  starting: "Starting",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function ProviderBadge({ provider }: { provider: AgentProvider }) {
  return <Badge tone={PROVIDER_TONE[provider]}>{PROVIDER_LABEL[provider]}</Badge>;
}

export function StatusBadge({ status }: { status: AgentStatus }) {
  const live = status === "running" || status === "starting";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide ${
        status === "failed"
          ? "border-[var(--color-red)]/30 bg-[var(--color-red)]/10 text-[var(--color-red)]"
          : status === "cancelled"
            ? "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-muted)]"
            : status === "succeeded"
              ? "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
              : "border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
      }`}
    >
      {live && (
        <span className="status-pulse size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

const NODE_DOT: Record<NodeStatus, string> = {
  running: "bg-[var(--color-accent)] status-pulse",
  done: "bg-[var(--color-muted-2)]",
  failed: "bg-[var(--color-red)]",
};

export function NodeDot({ status }: { status: NodeStatus }) {
  return <span className={`size-1.5 shrink-0 rounded-full ${NODE_DOT[status]}`} aria-hidden />;
}

/** "$0.0421" — agent runs are cheap enough that two decimals hides the cost. */
export function formatCost(usd: number | null): string {
  if (usd == null) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatDuration(startedAt: number, endedAt: number | null): string {
  const ms = (endedAt ?? Date.now()) - startedAt;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
