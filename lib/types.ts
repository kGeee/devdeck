export type ProcessStatus =
  | "stopped"
  | "starting"
  | "running"
  | "crashed";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/** Static info discovered by scanning the filesystem. */
export interface ProjectInfo {
  /** Directory name — used as the stable id. */
  name: string;
  /** Absolute path to the project directory. */
  path: string;
  /** Detected package manager, or null if none could be determined. */
  packageManager: PackageManager | null;
  /** Available npm scripts (name -> command). */
  scripts: Record<string, string>;
  /** The script we'll run for "dev" (usually "dev"), or null if none exists. */
  devScript: string | null;
  /** Port declared in the dev script, if we could parse one. */
  declaredPort: number | null;
  /** User-set port to force the dev server onto, if any. Overrides declaredPort. */
  portOverride: number | null;
  /** Framework guess for the badge ("next", "vite", "node", etc.). */
  framework: string | null;
  /** True when the project has a package.json with a runnable dev script. */
  runnable: boolean;
  /** True when the user added this path by hand (vs. discovered by scanning). */
  manual: boolean;
}

/** Live runtime state tracked by the process manager. */
export interface ProcessState {
  status: ProcessStatus;
  pid: number | null;
  /** Epoch ms when the current run started. */
  startedAt: number | null;
  /** Port the server is actually listening on (parsed from logs). */
  detectedPort: number | null;
  /** Exit code of the last run, if it has ended. */
  exitCode: number | null;
  /** Number of buffered log lines. */
  logCount: number;
}

/** Combined payload returned to the client. */
export interface ProjectView extends ProjectInfo {
  state: ProcessState;
}

/* ── Tasks (one-shot script and git runs) ───────────────────────────────── */

/**
 * Deliberately separate from ProcessStatus. `components/format.ts` declares
 * STATUS_META as Record<ProcessStatus, …>, so widening ProcessStatus with
 * terminal task states would break that map — and a one-shot run exiting 0 is
 * "succeeded", which is not a meaningful state for a dev server anyway.
 */
export type TaskStatus = "running" | "succeeded" | "failed";

export type TaskKind = "server" | "script" | "git";

export interface TaskView {
  key: string;
  project: string;
  /** npm script name, or the git operation ("push", "pull", "fetch"). */
  label: string;
  kind: TaskKind;
  status: TaskStatus;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
}

/* ── Git ────────────────────────────────────────────────────────────────── */

export interface GitRepoInfo {
  isRepo: boolean;
  root: string | null;
  gitDir: string | null;
  commonDir: string | null;
  /** True for a linked worktree (its gitdir is an absolute worktrees/ path). */
  isWorktree: boolean;
  /** Remote name -> fetch URL. */
  remotes: Record<string, string>;
}

export type GitFileState =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "untracked"
  | "conflicted";

export interface GitFileChange {
  path: string;
  /** Source path of a rename/copy. */
  origPath: string | null;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  /** An entirely-untracked directory, which git collapses into one entry. */
  isDirectory: boolean;
  state: GitFileState;
}

export interface GitStatus {
  /** Null when detached. Still set (to the would-be branch) when unborn. */
  branch: string | null;
  detached: boolean;
  /** No commits yet — porcelain reports oid "(initial)". */
  unborn: boolean;
  head: string | null;
  upstream: string | null;
  /** Null when there is no upstream — meaningfully different from 0. */
  ahead: number | null;
  behind: number | null;
  files: GitFileChange[];
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  relative: string;
}

export interface GitBranch {
  name: string;
  sha: string;
  upstream: string | null;
  current: boolean;
  remote: boolean;
  date: string | null;
  subject: string;
}

/** Everything the git panes need for one project. */
export interface GitOverview {
  isRepo: boolean;
  isWorktree: boolean;
  status: GitStatus | null;
  stashes: number;
  /** Epoch ms of last fetch, or null when the repo has never been fetched —
   *  in which case ahead/behind are stale and must not be presented as live. */
  fetchedAt: number | null;
  commits: GitCommit[];
}

/** Lightweight per-project row for the rail. */
export interface GitSummary {
  name: string;
  isRepo: boolean;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  dirty: number;
  ahead: number | null;
  behind: number | null;
}

/* ── GitHub ─────────────────────────────────────────────────────────────── */

export type CheckState = "success" | "failure" | "pending" | "neutral";

export interface PRCheck {
  name: string;
  state: CheckState;
  url: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** "" from gh normalised to null. */
  reviewDecision: string | null;
  checks: PRCheck[];
}

/**
 * A fork needs two slugs kept apart, because `gh` will otherwise infer the base
 * repo from the `upstream` remote and act on someone else's repository.
 */
export interface RunSlugs {
  /** From `origin` — where branches and PR heads live. */
  pushRepo: string | null;
  /** Where PRs are listed, opened and merged. */
  baseRepo: string | null;
  isFork: boolean;
}

export interface GitHubView {
  /** False when the project has no origin remote — not an error state. */
  available: boolean;
  reason: string | null;
  /** Where branches are pushed (from origin). */
  pushRepo: string | null;
  /** Where PRs are opened and merged. Differs from pushRepo on a fork. */
  baseRepo: string | null;
  isFork: boolean;
  defaultBranch: string | null;
  isPrivate: boolean;
  prs: PullRequest[];
}
