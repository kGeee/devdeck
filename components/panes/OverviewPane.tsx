"use client";

import { useEffect, useState } from "react";
import {
  GitBranch,
  GitCommit as GitCommitIcon,
  FolderGit2,
  CircleAlert,
  Clock,
} from "lucide-react";
import type { GitOverview, GitHubView, ProjectView } from "@/lib/types";
import { Badge, EmptyState } from "../ui";
import { relativeTime } from "../format";

export default function OverviewPane({
  project,
  nonce,
  onGoToTab,
}: {
  project: ProjectView;
  nonce: number;
  onGoToTab: (t: "changes" | "prs" | "branches") => void;
}) {
  const [git, setGit] = useState<GitOverview | null>(null);
  const [gh, setGh] = useState<GitHubView | null>(null);

  useEffect(() => {
    let alive = true;
    const name = encodeURIComponent(project.name);
    fetch(`/api/projects/${name}/git`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setGit(d))
      .catch(() => {});
    fetch(`/api/projects/${name}/github`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setGh(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project.name, nonce]);

  const status = git?.status;
  const dirty = status?.files.length ?? 0;
  const openPRs = gh?.prs.filter((p) => p.state === "OPEN").length ?? 0;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      {/* Repository */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Repository
          </h3>
        </div>
        <div className="p-4">
          {git && !git.isRepo ? (
            <p className="text-sm text-[var(--color-muted-2)]">
              Not a git repository.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <Field label="Branch">
                <span className="flex items-center gap-1.5 font-mono text-[13px]">
                  <GitBranch className="size-3.5 text-[var(--color-muted-2)]" />
                  {status?.detached ? (
                    <Badge tone="amber">detached HEAD</Badge>
                  ) : (
                    (status?.branch ?? "—")
                  )}
                  {status?.unborn && <Badge tone="violet">no commits</Badge>}
                </span>
              </Field>
              <Field label="Upstream">
                <span className="font-mono text-[13px] text-[var(--color-muted)]">
                  {status?.upstream ?? "—"}
                </span>
              </Field>
              <Field label="Ahead / behind">
                {status?.ahead == null ? (
                  <span className="text-[13px] text-[var(--color-muted-2)]">
                    no upstream
                  </span>
                ) : (
                  <span className="font-mono text-[13px] tabular-nums">
                    <span className="text-[var(--color-blue)]">
                      ↑{status.ahead}
                    </span>{" "}
                    <span className="text-[var(--color-violet)]">
                      ↓{status.behind}
                    </span>
                  </span>
                )}
              </Field>
              <Field label="Last fetch">
                <span className="flex items-center gap-1.5 text-[13px]">
                  <Clock className="size-3.5 text-[var(--color-muted-2)]" />
                  {git?.fetchedAt ? (
                    relativeTime(git.fetchedAt)
                  ) : (
                    // Ahead/behind is derived from the last fetch, so with no
                    // FETCH_HEAD at all those numbers mean nothing.
                    <span className="text-[var(--color-amber)]">never</span>
                  )}
                </span>
              </Field>
              {git?.isWorktree && (
                <Field label="Worktree">
                  <Badge tone="violet">linked worktree</Badge>
                </Field>
              )}
              {git && git.stashes > 0 && (
                <Field label="Stashes">
                  <span className="font-mono text-[13px]">{git.stashes}</span>
                </Field>
              )}
            </dl>
          )}
        </div>
      </section>

      {/* At a glance */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            At a glance
          </h3>
        </div>
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
          <Stat
            label="Changes"
            value={dirty}
            tone={dirty > 0 ? "amber" : "muted"}
            onClick={() => onGoToTab("changes")}
          />
          <Stat
            label="Open PRs"
            value={gh?.available ? openPRs : "—"}
            tone={openPRs > 0 ? "blue" : "muted"}
            onClick={() => onGoToTab("prs")}
          />
          <Stat
            label="Scripts"
            value={Object.keys(project.scripts).length}
            tone="muted"
          />
        </div>
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <p className="truncate font-mono text-[11px] text-[var(--color-muted-2)]">
            {project.path}
          </p>
          {gh?.available && gh.isFork && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--color-amber)]">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                Fork — pushes go to{" "}
                <span className="font-mono">{gh.pushRepo}</span>, PRs open
                against <span className="font-mono">{gh.baseRepo}</span>.
              </span>
            </p>
          )}
        </div>
      </section>

      {/* Recent commits */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] lg:col-span-2">
        <div className="border-b border-[var(--color-border)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Recent commits
          </h3>
        </div>
        {git && git.commits.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 className="size-6" />}
            title={
              status?.unborn
                ? "No commits yet on this branch"
                : "No commit history"
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {(git?.commits ?? []).slice(0, 8).map((c) => (
              <li key={c.hash} className="flex items-center gap-3 px-4 py-2.5">
                <GitCommitIcon className="size-3.5 shrink-0 text-[var(--color-muted-2)]" />
                <span className="font-mono text-[11px] text-[var(--color-violet)]">
                  {c.short}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {c.subject}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--color-muted-2)]">
                  {c.author}
                </span>
                <span className="hidden shrink-0 text-[11px] text-[var(--color-muted-2)] sm:inline">
                  {c.relative}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-2)]">
        {label}
      </dt>
      <dd className="mt-1 truncate">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number | string;
  tone: "muted" | "amber" | "blue";
  onClick?: () => void;
}) {
  const colors = {
    muted: "text-[var(--color-foreground)]",
    amber: "text-[var(--color-amber)]",
    blue: "text-[var(--color-blue)]",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`px-4 py-3.5 text-left ${
        onClick
          ? "ring-focus cursor-pointer transition-colors hover:bg-[var(--color-surface-2)]"
          : ""
      }`}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-2)]">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-xl font-semibold tabular-nums ${colors[tone]}`}
      >
        {value}
      </div>
    </Tag>
  );
}
