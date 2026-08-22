"use client";

import { useEffect, useState } from "react";
import {
  Play,
  Square,
  ExternalLink,
  Code2,
  FolderOpen,
  Loader2,
  Trash2,
  Terminal,
  Check,
  X,
} from "lucide-react";
import type { ProjectView } from "@/lib/types";
import { STATUS_META, formatUptime } from "./format";
import { Badge, IconButton } from "./ui";

export default function WorkspaceHeader({
  project,
  busy,
  dockOpen,
  onStart,
  onStop,
  onOpen,
  onRemove,
  onToggleDock,
  onSetPort,
}: {
  project: ProjectView;
  busy: boolean;
  dockOpen: boolean;
  onStart: () => void;
  onStop: () => void;
  onOpen: (target: "editor" | "finder") => void;
  onRemove: () => void;
  onToggleDock: () => void;
  onSetPort: (port: number | null) => Promise<void>;
}) {
  const { state } = project;
  const meta = STATUS_META[state.status];
  const isActive = state.status === "running" || state.status === "starting";
  const port = state.detectedPort ?? project.portOverride ?? project.declaredPort;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.status]);

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`size-2 shrink-0 rounded-full ${meta.dot} ${
            isActive ? "status-pulse" : ""
          }`}
        />
        <h2 className="truncate text-sm font-semibold tracking-tight">
          {project.name}
        </h2>
        <span className="shrink-0 text-xs" style={{ color: meta.color }}>
          {meta.label}
        </span>
        {state.status === "running" && (
          <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-muted-2)] sm:inline">
            {formatUptime(state.startedAt, now)}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {project.framework && <Badge tone="blue">{project.framework}</Badge>}
        {project.packageManager && <Badge>{project.packageManager}</Badge>}
        <PortControl
          effectivePort={port}
          override={project.portOverride}
          detected={state.detectedPort}
          isActive={isActive}
          onSetPort={onSetPort}
        />
        {project.manual && <Badge>manual</Badge>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {project.runnable ? (
          isActive ? (
            <button
              onClick={onStop}
              disabled={busy}
              className="ring-focus inline-flex items-center gap-1.5 rounded-md border border-[var(--color-red)]/35 bg-[var(--color-red)]/10 px-2.5 py-1.5 text-xs font-semibold text-[var(--color-red)] transition-colors hover:bg-[var(--color-red)]/20 disabled:opacity-45 cursor-pointer"
            >
              {busy ? (
                <Loader2 className="size-3.5 spin" />
              ) : (
                <Square className="size-3.5 fill-current" />
              )}
              Stop
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={busy}
              className="ring-focus inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-accent-fg)] transition-[filter] hover:brightness-110 disabled:opacity-45 cursor-pointer"
            >
              {busy ? (
                <Loader2 className="size-3.5 spin" />
              ) : (
                <Play className="size-3.5 fill-current" />
              )}
              Start dev
            </button>
          )
        ) : (
          <span className="rounded-md border border-dashed border-[var(--color-border-strong)] px-2.5 py-1.5 text-[11px] text-[var(--color-muted-2)]">
            No dev script
          </span>
        )}

        <IconButton label="Toggle logs" onClick={onToggleDock} active={dockOpen}>
          <Terminal className="size-4" />
        </IconButton>

        {port && state.status === "running" ? (
          <a
            href={`http://localhost:${port}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open localhost:${port}`}
            title={`Open localhost:${port}`}
            className="ring-focus grid size-8 place-items-center rounded-md border border-[var(--color-border-strong)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-foreground)]"
          >
            <ExternalLink className="size-4" />
          </a>
        ) : null}

        <IconButton label="Open in editor" onClick={() => onOpen("editor")}>
          <Code2 className="size-4" />
        </IconButton>
        <IconButton label="Reveal in Finder" onClick={() => onOpen("finder")}>
          <FolderOpen className="size-4" />
        </IconButton>
        {project.manual && (
          <IconButton label="Remove project" tone="danger" onClick={onRemove}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>
    </header>
  );
}

/**
 * Dev port. Shows the detected port while running, otherwise the configured
 * one; click to pin the project to a fixed port, which takes effect on the
 * next start.
 */
function PortControl({
  effectivePort,
  override,
  detected,
  isActive,
  onSetPort,
}: {
  effectivePort: number | null;
  override: number | null;
  detected: number | null;
  isActive: boolean;
  onSetPort: (port: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    const trimmed = value.trim();
    let next: number | null;
    if (trimmed === "") {
      next = null;
    } else if (/^\d+$/.test(trimmed)) {
      next = Number(trimmed);
      if (next < 1 || next > 65535) {
        setError("1–65535");
        return;
      }
    } else {
      setError("Numbers only");
      return;
    }
    if (next === override) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSetPort(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus
          inputMode="numeric"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="auto"
          aria-label="Dev port"
          className="ring-focus w-16 rounded border border-[var(--color-border-strong)] bg-[var(--color-background)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums outline-none"
        />
        <button
          onClick={() => void commit()}
          disabled={saving}
          aria-label="Save port"
          className="ring-focus grid size-5 place-items-center rounded text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 cursor-pointer"
        >
          {saving ? <Loader2 className="size-3 spin" /> : <Check className="size-3" />}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          aria-label="Cancel"
          className="ring-focus grid size-5 place-items-center rounded text-[var(--color-muted-2)] hover:bg-[var(--color-surface-2)] cursor-pointer"
        >
          <X className="size-3" />
        </button>
        {error && (
          <span className="text-[10px] text-[var(--color-red)]">{error}</span>
        )}
      </span>
    );
  }

  return (
    <button
      onClick={() => {
        setValue(override != null ? String(override) : "");
        setError(null);
        setEditing(true);
      }}
      title={
        override != null
          ? `Pinned to port ${override}${isActive ? " (applies on next start)" : ""} — click to change`
          : "Click to pin a fixed dev port"
      }
      className="ring-focus rounded cursor-pointer"
    >
      <Badge tone={detected ? "accent" : override != null ? "blue" : "muted"}>
        :{effectivePort ?? "—"}
      </Badge>
    </button>
  );
}
