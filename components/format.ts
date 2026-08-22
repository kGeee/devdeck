import type { ProcessStatus } from "@/lib/types";

export function formatUptime(startedAt: number | null, now: number): string {
  if (!startedAt) return "—";
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Coarse "3 minutes ago" formatting for timestamps we only glance at. */
export function relativeTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(at).toLocaleDateString();
}

export const STATUS_META: Record<
  ProcessStatus,
  { label: string; color: string; dot: string }
> = {
  running: { label: "Running", color: "var(--color-accent)", dot: "bg-[var(--color-accent)]" },
  starting: { label: "Starting", color: "var(--color-amber)", dot: "bg-[var(--color-amber)]" },
  crashed: { label: "Crashed", color: "var(--color-red)", dot: "bg-[var(--color-red)]" },
  stopped: { label: "Stopped", color: "var(--color-muted-2)", dot: "bg-[var(--color-muted-2)]" },
};
