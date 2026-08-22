"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, Plus, Check, GitCommit as GitCommitIcon } from "lucide-react";
import type { GitBranch as Branch, GitOverview, ProjectView } from "@/lib/types";
import { Badge, Button, EmptyState, ErrorNote } from "../ui";

export default function BranchesPane({
  project,
  nonce,
  onChanged,
}: {
  project: ProjectView;
  nonce: number;
  onChanged: () => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [git, setGit] = useState<GitOverview | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localNonce, setLocalNonce] = useState(0);

  const name = encodeURIComponent(project.name);

  const load = useCallback(async () => {
    try {
      const [b, g] = await Promise.all([
        fetch(`/api/projects/${name}/git/branch`, { cache: "no-store" }).then((r) =>
          r.json()
        ),
        fetch(`/api/projects/${name}/git`, { cache: "no-store" }).then((r) =>
          r.json()
        ),
      ]);
      setBranches(b.branches ?? []);
      setGit(g);
    } catch {
      /* transient */
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load, nonce, localNonce]);

  const act = async (branch: string, create: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${name}/git/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, create }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setNewName("");
      setCreating(false);
      setLocalNonce((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Branch operation failed");
    } finally {
      setBusy(false);
    }
  };

  if (git && !git.isRepo) {
    return (
      <EmptyState
        icon={<GitBranch className="size-6" />}
        title="Not a git repository"
      />
    );
  }

  const dirty = (git?.status?.files.length ?? 0) > 0;
  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Local branches
            <span className="ml-1.5 font-mono text-[10px] text-[var(--color-muted-2)]">
              {local.length}
            </span>
          </h3>
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="size-3.5" />
            New
          </Button>
        </div>

        {creating && (
          <form
            className="border-b border-[var(--color-border)] p-3 slide-up"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) void act(newName.trim(), true);
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="feature/my-branch"
              spellCheck={false}
              className="ring-focus w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2.5 py-1.5 font-mono text-[13px] outline-none placeholder:text-[var(--color-muted-2)]"
            />
            <p className="mt-1.5 text-[11px] text-[var(--color-muted-2)]">
              Creates the branch from the current HEAD and switches to it.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                type="submit"
                busy={busy}
                disabled={!newName.trim()}
              >
                Create &amp; switch
              </Button>
            </div>
          </form>
        )}

        {error && (
          <div className="p-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        {dirty && (
          <p className="border-b border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-amber)]">
            Working tree has uncommitted changes — a switch may be refused by git.
          </p>
        )}

        <ul className="divide-y divide-[var(--color-border)]">
          {local.map((b) => (
            <li
              key={b.name}
              className="group flex items-center gap-2.5 px-4 py-2.5"
            >
              {b.current ? (
                <Check className="size-3.5 shrink-0 text-[var(--color-accent)]" />
              ) : (
                <GitBranch className="size-3.5 shrink-0 text-[var(--color-muted-2)]" />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate font-mono text-[13px] ${
                    b.current ? "text-[var(--color-accent)]" : ""
                  }`}
                >
                  {b.name}
                </span>
                <span className="block truncate text-[11px] text-[var(--color-muted-2)]">
                  {b.subject || "—"}
                </span>
              </span>
              {b.upstream && <Badge>{b.upstream}</Badge>}
              {!b.current && (
                <Button
                  size="sm"
                  onClick={() => act(b.name, false)}
                  busy={busy}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  Switch
                </Button>
              )}
            </li>
          ))}
          {local.length === 0 && (
            <li>
              <EmptyState
                icon={<GitBranch className="size-6" />}
                title={
                  git?.status?.unborn
                    ? "No branches yet — make a first commit"
                    : "No local branches"
                }
              />
            </li>
          )}
        </ul>
      </section>

      <div className="flex flex-col gap-4">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Remote branches
              <span className="ml-1.5 font-mono text-[10px] text-[var(--color-muted-2)]">
                {remote.length}
              </span>
            </h3>
          </div>
          <ul className="scroll-thin max-h-64 divide-y divide-[var(--color-border)] overflow-y-auto">
            {remote.slice(0, 60).map((b) => (
              <li key={b.name} className="px-4 py-2">
                <span className="block truncate font-mono text-[12px] text-[var(--color-muted)]">
                  {b.name}
                </span>
              </li>
            ))}
            {remote.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-[var(--color-muted-2)]">
                No remote-tracking branches.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              History
            </h3>
          </div>
          <ul className="scroll-thin max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto">
            {(git?.commits ?? []).map((c) => (
              <li key={c.hash} className="flex items-center gap-2.5 px-4 py-2">
                <GitCommitIcon className="size-3 shrink-0 text-[var(--color-muted-2)]" />
                <span className="font-mono text-[11px] text-[var(--color-violet)]">
                  {c.short}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px]">
                  {c.subject}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--color-muted-2)]">
                  {c.relative}
                </span>
              </li>
            ))}
            {(git?.commits.length ?? 0) === 0 && (
              <li className="px-4 py-6 text-center text-xs text-[var(--color-muted-2)]">
                No commits yet.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
