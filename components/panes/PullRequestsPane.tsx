"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GitPullRequest,
  CheckCircle2,
  XCircle,
  Clock,
  CircleDashed,
  ExternalLink,
  Plus,
  GitMerge,
  CircleAlert,
} from "lucide-react";
import type {
  CheckState,
  GitHubView,
  GitOverview,
  ProjectView,
  PullRequest,
} from "@/lib/types";
import ConfirmDialog from "../ConfirmDialog";
import { Badge, Button, EmptyState, ErrorNote } from "../ui";

const CHECK_ICON: Record<CheckState, React.ReactNode> = {
  success: <CheckCircle2 className="size-3.5 text-[var(--color-accent)]" />,
  failure: <XCircle className="size-3.5 text-[var(--color-red)]" />,
  pending: <Clock className="size-3.5 text-[var(--color-amber)]" />,
  neutral: <CircleDashed className="size-3.5 text-[var(--color-muted-2)]" />,
};

export default function PullRequestsPane({
  project,
  onChanged,
}: {
  project: ProjectView;
  onChanged: () => void;
}) {
  const [gh, setGh] = useState<GitHubView | null>(null);
  const [git, setGit] = useState<GitOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<PullRequest | null>(null);
  const [mergeMethod, setMergeMethod] =
    useState<"squash" | "merge" | "rebase">("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [nonce, setNonce] = useState(0);

  const name = encodeURIComponent(project.name);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, s] = await Promise.all([
        fetch(`/api/projects/${name}/github`, { cache: "no-store" }).then((r) =>
          r.json()
        ),
        fetch(`/api/projects/${name}/git`, { cache: "no-store" }).then((r) =>
          r.json()
        ),
      ]);
      setGh(g);
      setGit(s);
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  const branch = git?.status?.branch ?? null;
  const canOpenPR =
    Boolean(branch) && !git?.status?.detached && !git?.status?.unborn;

  const createPR = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${name}/github/pr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setShowCreate(false);
      setTitle("");
      setBody("");
      setNonce((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open PR");
    } finally {
      setBusy(false);
    }
  };

  const doMerge = async () => {
    if (!mergeTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${name}/github/pr/${mergeTarget.number}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: mergeMethod,
            deleteBranch,
            confirm: String(mergeTarget.number),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setMergeTarget(null);
      setNonce((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !gh) {
    return (
      <div className="p-4">
        <div className="h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]" />
      </div>
    );
  }

  // No remote is a normal state for many local projects, not an error.
  if (gh && !gh.available) {
    return (
      <EmptyState
        icon={<GitPullRequest className="size-6" />}
        title={gh.reason ?? "GitHub is not available for this project"}
        hint="Add a GitHub remote named origin to manage pull requests here."
      />
    );
  }

  const prs = gh?.prs ?? [];

  return (
    <div className="p-4">
      {gh?.isFork && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/8 px-3 py-2 text-xs text-[var(--color-amber)]">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span>
            This is a fork. Branches push to{" "}
            <span className="font-mono">{gh.pushRepo}</span>, but pull requests
            are opened and merged against{" "}
            <span className="font-mono">{gh.baseRepo}</span>.
          </span>
        </p>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Pull requests
          </h3>
          <span className="font-mono text-[11px] text-[var(--color-muted-2)]">
            {prs.length}
          </span>
          {gh?.baseRepo && <Badge tone="blue">{gh.baseRepo}</Badge>}
        </div>
        <Button
          size="sm"
          onClick={() => {
            setShowCreate((v) => !v);
            setTitle(branch ? branch.replace(/[-_/]+/g, " ") : "");
          }}
          disabled={!canOpenPR}
          title={
            !canOpenPR
              ? "Needs a checked-out branch with commits"
              : "Open a PR from the current branch"
          }
        >
          <Plus className="size-3.5" />
          New PR
        </Button>
      </div>

      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {showCreate && (
        <form
          className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 slide-up"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void createPR();
          }}
        >
          <p className="mb-2 font-mono text-[11px] text-[var(--color-muted-2)]">
            {branch} → {gh?.defaultBranch ?? "main"}
          </p>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Pull request title"
            className="ring-focus w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2.5 py-1.5 text-[13px] outline-none placeholder:text-[var(--color-muted-2)]"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Description (optional)"
            className="ring-focus mt-2 w-full resize-none rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--color-muted-2)]"
          />
          <div className="mt-2 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={draft}
                onChange={(e) => setDraft(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Open as draft
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                type="submit"
                busy={busy}
                disabled={!title.trim()}
              >
                Create PR
              </Button>
            </div>
          </div>
        </form>
      )}

      {prs.length === 0 ? (
        <EmptyState
          icon={<GitPullRequest className="size-6" />}
          title="No open pull requests"
          hint={
            canOpenPR
              ? `Open one from ${branch} with the New PR button.`
              : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {prs.map((pr) => (
            <li
              key={pr.number}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5"
            >
              <div className="flex items-start gap-2.5">
                <GitPullRequest
                  className={`mt-0.5 size-4 shrink-0 ${
                    pr.isDraft
                      ? "text-[var(--color-muted-2)]"
                      : "text-[var(--color-accent)]"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--color-muted-2)]">
                      #{pr.number}
                    </span>
                    <span className="text-[13px] font-medium">{pr.title}</span>
                    {pr.isDraft && <Badge>draft</Badge>}
                    {pr.reviewDecision === "APPROVED" && (
                      <Badge tone="accent">approved</Badge>
                    )}
                    {pr.reviewDecision === "CHANGES_REQUESTED" && (
                      <Badge tone="red">changes requested</Badge>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--color-muted-2)]">
                    {pr.headRefName} → {pr.baseRefName} · {pr.author} ·{" "}
                    <span className="text-[var(--color-add)]">+{pr.additions}</span>{" "}
                    <span className="text-[var(--color-del)]">−{pr.deletions}</span>{" "}
                    · {pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}
                  </p>

                  {pr.checks.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {pr.checks.map((c, i) => (
                        <li
                          key={`${c.name}-${i}`}
                          className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]"
                        >
                          {CHECK_ICON[c.state]}
                          {c.url ? (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ring-focus rounded hover:text-[var(--color-foreground)] hover:underline"
                            >
                              {c.name}
                            </a>
                          ) : (
                            c.name
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open PR #${pr.number} on GitHub`}
                    className="ring-focus grid size-8 place-items-center rounded-md border border-[var(--color-border-strong)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-foreground)]"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                  <Button
                    size="sm"
                    onClick={() => setMergeTarget(pr)}
                    disabled={pr.isDraft}
                    title={
                      pr.isDraft ? "Draft PRs cannot be merged" : "Merge this PR"
                    }
                  >
                    <GitMerge className="size-3.5" />
                    Merge
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={mergeTarget !== null}
        title={`Merge PR #${mergeTarget?.number}?`}
        body={
          <>
            <span className="block">
              <strong className="text-[var(--color-foreground)]">
                {mergeTarget?.title}
              </strong>
            </span>
            <span className="mt-1 block">
              This merges into{" "}
              <span className="font-mono text-[var(--color-foreground)]">
                {gh?.baseRepo}
              </span>{" "}
              and publishes to the remote. It cannot be undone from here.
            </span>
            {mergeTarget?.checks.some((c) => c.state === "failure") && (
              <span className="mt-2 block text-[var(--color-red)]">
                Warning: this PR has failing checks.
              </span>
            )}
            <span className="mt-3 flex flex-wrap items-center gap-3">
              <select
                value={mergeMethod}
                onChange={(e) =>
                  setMergeMethod(e.target.value as typeof mergeMethod)
                }
                className="ring-focus rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-foreground)]"
              >
                <option value="squash">Squash and merge</option>
                <option value="merge">Create a merge commit</option>
                <option value="rebase">Rebase and merge</option>
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={deleteBranch}
                  onChange={(e) => setDeleteBranch(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Delete branch
              </label>
            </span>
          </>
        }
        phrase={String(mergeTarget?.number ?? "")}
        confirmLabel="Merge"
        busy={busy}
        error={error}
        onCancel={() => setMergeTarget(null)}
        onConfirm={doMerge}
      />
    </div>
  );
}
