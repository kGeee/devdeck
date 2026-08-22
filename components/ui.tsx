"use client";

import { Loader2 } from "lucide-react";

/** Shared primitives so the panes stay consistent without repeating classes. */

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  busy,
  type = "button",
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const variants: Record<string, string> = {
    default:
      "border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)]",
    primary:
      "bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-semibold hover:brightness-110",
    danger:
      "border border-[var(--color-red)]/35 bg-[var(--color-red)]/10 text-[var(--color-red)] hover:bg-[var(--color-red)]/20",
    ghost:
      "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-foreground)]",
  };
  const sizes: Record<string, string> = {
    sm: "px-2 py-1 text-xs gap-1.5",
    md: "px-3 py-1.5 text-sm gap-2",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`ring-focus inline-flex items-center justify-center rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {busy && <Loader2 className="size-3.5 spin" />}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  label,
  active,
  disabled,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`ring-focus grid size-8 shrink-0 place-items-center rounded-md border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
          : tone === "danger"
            ? "border-[var(--color-border-strong)] text-[var(--color-muted)] hover:bg-[var(--color-red)]/10 hover:text-[var(--color-red)]"
            : "border-[var(--color-border-strong)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "muted",
  title,
}: {
  children: React.ReactNode;
  tone?: "muted" | "accent" | "blue" | "violet" | "amber" | "red";
  title?: string;
}) {
  const tones: Record<string, string> = {
    muted:
      "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
    accent:
      "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
    blue: "border-[var(--color-blue)]/30 bg-[var(--color-blue)]/10 text-[var(--color-blue)]",
    violet:
      "border-[var(--color-violet)]/30 bg-[var(--color-violet)]/10 text-[var(--color-violet)]",
    amber:
      "border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10 text-[var(--color-amber)]",
    red: "border-[var(--color-red)]/30 bg-[var(--color-red)]/10 text-[var(--color-red)]",
  };
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="mb-3 text-[var(--color-muted-2)]">{icon}</div>
      <p className="text-sm text-[var(--color-muted)]">{title}</p>
      {hint && (
        <p className="mt-1.5 max-w-md text-xs text-[var(--color-muted-2)]">{hint}</p>
      )}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-md border border-[var(--color-red)]/30 bg-[var(--color-red)]/8 px-3 py-2 text-xs text-[var(--color-red)]">
      {children}
    </p>
  );
}

export function PaneHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          {title}
        </h3>
        {count != null && (
          <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted-2)]">
            {count}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}
