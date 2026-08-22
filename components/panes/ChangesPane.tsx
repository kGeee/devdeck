"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCheck,
  FileDiff,
  Folder,
  Minus,
  RotateCcw,
  Undo2,
  UploadCloud,
  DownloadCloud,
  RefreshCw,
} from "lucide-react";
import type { GitFileChange, GitOverview, ProjectView } from "@/lib/types";
import DiffViewer from "../DiffViewer";
import ConfirmDialog from "../ConfirmDialog";
import { Badge, Button, EmptyState, ErrorNote, IconButton } from "../ui";

const STATE_MARK: Record<string, { ch: string; tone: string; label: string }> = {
  modified: { ch: "M", tone: "text-[var(--color-amber)]", label: "Modified" },
  added: { ch: "A", tone: "text-[var(--color-accent)]", label: "Added" },
  deleted: { ch: "D", tone: "text-[var(--color-red)]", label: "Deleted" },
  renamed: { ch: "R", tone: "text-[var(--color-blue)]", label: "Renamed" },
  copied: { ch: "C", tone: "text-[var(--color-blue)]", label: "Copied" },
  typechange: { ch: "T", tone: "text-[var(--color-violet)]", label: "Type changed" },
  untracked: { ch: "?", tone: "text-[var(--color-muted-2)]", label: "Untracked" },
  conflicted: { ch: "!", tone: "text-[var(--color-red)]", label: "Conflicted" },
};

export default function ChangesPane({
  project,
  nonce,
  onChanged,
}: {
  project: ProjectView;
  nonce: number;
  onChanged: () => void;
}) {
  const [git, setGit] = useState<GitOverview | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewStaged, setViewStaged] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string[] | null>(null);
  const [localNonce, setLocalNonce] = useState(0);

  const name = encodeURIComponent(project.name);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${name}/git`, { cache: "no-store" });
      setGit(await r.json());
    } catch {
      /* transient */
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load, nonce, localNonce]);

  const bump = useCallback(() => {
    setLocalNonce((n) => n + 1);
    onChanged();
  }, [onChanged]);

  const files = git?.status?.files ?? [];
  const staged = useMemo(() => files.filter((f) => f.staged), [files]);
  const unstaged = useMemo(() => files.filter((f) => !f.staged), [files]);

  const selected = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath]
  );

  const post = useCallback(
    async (path: string, body: unknown): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${name}/git/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        bump();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [name, bump]
  );

  const setStaged = (paths: string[], value: boolean) =>
    post("stage", { paths, staged: value });

  const doCommit = async () => {
    if (!message.trim()) return;
    if (await post("commit", { message })) setMessage("");
  };

  const sync = (action: "fetch" | "pull" | "push") =>
    post("sync", { action });

  if (git && !git.isRepo) {
    return (
      <EmptyState
        icon={<FileDiff className="size-6" />}
        title="Not a git repository"
        hint="Changes, branches and pull requests need a git repo."
      />
    );
  }

  const status = git?.status;
  const canCommit = staged.length > 0 && message.trim().length > 0;
  const conflicted = files.some((f) => f.state === "conflicted");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sync bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <span className="font-mono text-[11px] text-[var(--color-muted-2)]">
          {status?.detached
            ? "detached HEAD"
            : (status?.branch ?? "—")}
          {status?.upstream ? ` → ${status.upstream}` : " · no upstream"}
        </span>
        {status?.ahead != null && (
          <span className="font-mono text-[11px] tabular-nums">
            <span className="text-[var(--color-blue)]">↑{status.ahead}</span>{" "}
            <span className="text-[var(--color-violet)]">↓{status.behind}</span>
          </span>
        )}
        {git && !git.fetchedAt && (
          <Badge tone="amber" title="Ahead/behind is derived from the last fetch">
            never fetched
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={() => sync("fetch")} busy={busy}>
            <RefreshCw className="size-3.5" />
            Fetch
          </Button>
          <Button size="sm" onClick={() => sync("pull")} busy={busy}>
            <DownloadCloud className="size-3.5" />
            Pull
          </Button>
          <Button
            size="sm"
            onClick={() => sync("push")}
            busy={busy}
            disabled={status?.detached || status?.unborn}
            title={
              status?.detached
                ? "Cannot push from a detached HEAD"
                : status?.unborn
                  ? "No commits to push yet"
                  : undefined
            }
          >
            <UploadCloud className="size-3.5" />
            Push
          </Button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-4 pt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(260px,340px)_1fr]">
        {/* File list */}
        <div className="scroll-thin flex min-h-0 flex-col overflow-y-auto border-r border-[var(--color-border)]">
          {files.length === 0 ? (
            <EmptyState
              icon={<CheckCheck className="size-6" />}
              title="Working tree clean"
            />
          ) : (
            <>
              <FileGroup
                title="Staged"
                count={staged.length}
                files={staged}
                selectedPath={selectedPath}
                onSelect={(f) => {
                  setSelectedPath(f.path);
                  setViewStaged(true);
                }}
                action={{
                  icon: <Minus className="size-3.5" />,
                  label: "Unstage all",
                  onClick: () =>
                    setStaged(staged.map((f) => f.path), false),
                }}
                rowAction={(f) => ({
                  icon: <Minus className="size-3.5" />,
                  label: `Unstage ${f.path}`,
                  onClick: () => setStaged([f.path], false),
                })}
                busy={busy}
              />
              <FileGroup
                title="Changes"
                count={unstaged.length}
                files={unstaged}
                selectedPath={selectedPath}
                onSelect={(f) => {
                  setSelectedPath(f.path);
                  setViewStaged(false);
                }}
                action={{
                  icon: <Check className="size-3.5" />,
                  label: "Stage all",
                  onClick: () =>
                    setStaged(unstaged.map((f) => f.path), true),
                  secondary: {
                    icon: <RotateCcw className="size-3.5" />,
                    label: "Discard all",
                    onClick: () =>
                      setConfirmDiscard(unstaged.map((f) => f.path)),
                  },
                }}
                rowAction={(f) => ({
                  icon: <Check className="size-3.5" />,
                  label: `Stage ${f.path}`,
                  onClick: () => setStaged([f.path], true),
                  secondary: {
                    icon: <Undo2 className="size-3.5" />,
                    label: `Discard ${f.path}`,
                    onClick: () => setConfirmDiscard([f.path]),
                  },
                })}
                busy={busy}
              />
            </>
          )}
        </div>

        {/* Diff + commit */}
        <div className="flex min-h-0 flex-col">
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            <DiffViewer
              projectName={project.name}
              file={selected}
              staged={viewStaged}
            />
          </div>

          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            {conflicted && (
              <p className="mb-2 text-xs text-[var(--color-red)]">
                Resolve the conflicted files before committing.
              </p>
            )}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void doCommit();
                }
              }}
              rows={2}
              placeholder={
                staged.length
                  ? `Commit message for ${staged.length} staged file${staged.length === 1 ? "" : "s"}…`
                  : "Stage something to commit…"
              }
              className="ring-focus w-full resize-none rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--color-muted-2)]"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-[var(--color-muted-2)]">
                {staged.length} staged · {unstaged.length} unstaged
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={doCommit}
                disabled={!canCommit || conflicted}
                busy={busy}
                title="⌘↵ to commit"
              >
                Commit
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard !== null}
        title="Discard changes?"
        body={
          <>
            This permanently discards local edits to{" "}
            <strong className="text-[var(--color-foreground)]">
              {confirmDiscard?.length ?? 0}
            </strong>{" "}
            path{confirmDiscard?.length === 1 ? "" : "s"} in{" "}
            <span className="font-mono">{project.name}</span>. Uncommitted work
            cannot be recovered — there is no reflog for it.
          </>
        }
        phrase={project.name}
        confirmLabel="Discard"
        busy={busy}
        onCancel={() => setConfirmDiscard(null)}
        onConfirm={async () => {
          const paths = confirmDiscard ?? [];
          const ok = await post("discard", { paths, confirm: project.name });
          if (ok) {
            setConfirmDiscard(null);
            setSelectedPath(null);
          }
        }}
      />
    </div>
  );
}

interface GroupAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  secondary?: { icon: React.ReactNode; label: string; onClick: () => void };
}

function FileGroup({
  title,
  count,
  files,
  selectedPath,
  onSelect,
  action,
  rowAction,
  busy,
}: {
  title: string;
  count: number;
  files: GitFileChange[];
  selectedPath: string | null;
  onSelect: (f: GitFileChange) => void;
  action: GroupAction;
  rowAction: (f: GitFileChange) => GroupAction;
  busy: boolean;
}) {
  if (count === 0) return null;
  return (
    <section>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          {title}
          <span className="font-mono text-[10px] text-[var(--color-muted-2)]">
            {count}
          </span>
        </span>
        <span className="flex items-center gap-1">
          {action.secondary && (
            <IconButton
              label={action.secondary.label}
              onClick={action.secondary.onClick}
              disabled={busy}
              tone="danger"
            >
              {action.secondary.icon}
            </IconButton>
          )}
          <IconButton label={action.label} onClick={action.onClick} disabled={busy}>
            {action.icon}
          </IconButton>
        </span>
      </div>

      <ul>
        {files.map((f) => {
          const mark = STATE_MARK[f.state] ?? STATE_MARK.modified;
          const isSel = selectedPath === f.path;
          const row = rowAction(f);
          return (
            <li key={f.path}>
              <div
                className={`group flex items-center gap-2 px-3 py-1.5 transition-colors ${
                  isSel
                    ? "bg-[var(--color-surface-2)]"
                    : "hover:bg-[var(--color-surface-2)]/60"
                }`}
              >
                <button
                  onClick={() => onSelect(f)}
                  className="ring-focus flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                >
                  <span
                    className={`shrink-0 font-mono text-[11px] font-semibold ${mark.tone}`}
                    title={mark.label}
                  >
                    {mark.ch}
                  </span>
                  {f.isDirectory && (
                    <Folder className="size-3 shrink-0 text-[var(--color-muted-2)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {f.origPath && (
                      <span className="text-[var(--color-muted-2)]">
                        {f.origPath} →{" "}
                      </span>
                    )}
                    {f.path}
                  </span>
                  {f.staged && f.unstaged && (
                    <Badge tone="amber" title="Partially staged">
                      partial
                    </Badge>
                  )}
                </button>
                <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {row.secondary && (
                    <IconButton
                      label={row.secondary.label}
                      onClick={row.secondary.onClick}
                      disabled={busy}
                      tone="danger"
                    >
                      {row.secondary.icon}
                    </IconButton>
                  )}
                  <IconButton
                    label={row.label}
                    onClick={row.onClick}
                    disabled={busy}
                  >
                    {row.icon}
                  </IconButton>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
