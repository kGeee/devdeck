import { promises as fs } from "node:fs";
import path from "node:path";
import { run, runText, type RunResult } from "./exec";
import type {
  GitBranch,
  GitCommit,
  GitFileChange,
  GitFileState,
  GitRepoInfo,
  GitStatus,
} from "./types";

/* ── Repo identity ──────────────────────────────────────────────────────── */

/**
 * Basic repo facts. `gitDir` is relative (".git") for an ordinary repo but an
 * absolute path for a linked worktree, which is how we detect worktrees.
 */
export async function getRepoInfo(dir: string): Promise<GitRepoInfo> {
  const gitDir = await runText("git", ["rev-parse", "--git-dir"], { cwd: dir });
  if (gitDir == null) {
    return {
      isRepo: false,
      root: null,
      gitDir: null,
      commonDir: null,
      isWorktree: false,
      remotes: {},
    };
  }

  const [root, commonDir, remoteOut] = await Promise.all([
    runText("git", ["rev-parse", "--show-toplevel"], { cwd: dir }),
    runText("git", ["rev-parse", "--git-common-dir"], { cwd: dir }),
    runText("git", ["remote", "-v"], { cwd: dir }),
  ]);

  // A linked worktree's gitdir is an absolute path under <main>/.git/worktrees.
  const isWorktree = path.isAbsolute(gitDir) && gitDir.includes("worktrees");

  const remotes: Record<string, string> = {};
  for (const line of (remoteOut ?? "").split("\n")) {
    // "origin\thttps://github.com/o/r.git (fetch)"
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (m) remotes[m[1]] = m[2];
  }

  return {
    isRepo: true,
    root: root ?? dir,
    gitDir: resolveGitPath(dir, gitDir),
    commonDir: commonDir ? resolveGitPath(dir, commonDir) : null,
    isWorktree,
    remotes,
  };
}

function resolveGitPath(dir: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(dir, p);
}

/**
 * Age of the last fetch, in epoch ms, or null when the repo has never been
 * fetched. Several repos here have no FETCH_HEAD at all, which means their
 * ahead/behind counts are meaningless rather than zero.
 *
 * For a linked worktree FETCH_HEAD lives in the common dir, not the worktree's
 * own gitdir, so we check the worktree first and then fall back.
 */
export async function getFetchedAt(info: GitRepoInfo): Promise<number | null> {
  for (const base of [info.gitDir, info.commonDir]) {
    if (!base) continue;
    try {
      const st = await fs.stat(path.join(base, "FETCH_HEAD"));
      return st.mtimeMs;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/* ── Porcelain v2 parsing ───────────────────────────────────────────────── */

/**
 * Take the path field off a record after skipping `n` space-delimited fields.
 * Paths may contain spaces, so the remainder after the nth space is the path —
 * splitting the whole record on " " would corrupt them.
 */
function pathAfter(rec: string, n: number): string {
  let i = -1;
  for (let k = 0; k < n; k++) {
    i = rec.indexOf(" ", i + 1);
    if (i === -1) return "";
  }
  return rec.slice(i + 1);
}

function fileState(x: string, y: string, untracked: boolean): GitFileState {
  if (untracked) return "untracked";
  if (x === "U" || y === "U") return "conflicted";
  const c = x !== "." ? x : y;
  switch (c) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechange";
    default:
      return "modified";
  }
}

/**
 * `git status --porcelain=v2 --branch --renames -z`, parsed.
 *
 * Layout notes that make this fiddly:
 *  - The `# branch.*` headers are LF-terminated while entry records are
 *    NUL-terminated, so splitting on NUL leaves all headers glued to the first
 *    entry inside element 0.
 *  - A type-2 (rename/copy) record is followed by its original path as a
 *    SEPARATE NUL-terminated field, so the cursor advances by two.
 *  - On an unborn branch there is no `branch.upstream` or `branch.ab` at all,
 *    so ahead/behind must be null rather than 0.
 */
export function parsePorcelainV2(raw: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    detached: false,
    unborn: false,
    head: null,
    upstream: null,
    ahead: null,
    behind: null,
    files: [],
  };

  if (raw.length === 0) return status;

  const records = raw.split("\0");

  // Verified against git 2.x: with -z each `# branch.*` header is its own
  // NUL-terminated record, so headers are interleaved as ordinary records
  // rather than newline-joined onto the first entry.
  const applyHeader = (h: string): void => {
    if (h.startsWith("# branch.oid ")) {
      const oid = h.slice("# branch.oid ".length);
      status.unborn = oid === "(initial)";
      status.head = status.unborn ? null : oid;
    } else if (h.startsWith("# branch.head ")) {
      const b = h.slice("# branch.head ".length);
      if (b === "(detached)") {
        status.detached = true;
      } else {
        status.branch = b;
      }
    } else if (h.startsWith("# branch.upstream ")) {
      status.upstream = h.slice("# branch.upstream ".length);
    } else if (h.startsWith("# branch.ab ")) {
      const m = h.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        status.ahead = Number(m[1]);
        status.behind = Number(m[2]);
      }
    }
  };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    const kind = rec[0];

    if (kind === "#") {
      // Tolerate either layout: one header per record (what git actually
      // emits with -z), or several newline-joined into one.
      for (const line of rec.split("\n")) {
        if (line.startsWith("# ")) applyHeader(line);
      }
      continue;
    }

    if (kind === "1" || kind === "2") {
      const xy = rec.slice(2, 4);
      const x = xy[0];
      const y = xy[1];
      // "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"          -> 8 fields
      // "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>" -> 9 fields
      const filePath = pathAfter(rec, kind === "1" ? 8 : 9);
      let origPath: string | null = null;
      if (kind === "2") {
        // With -z the original path is the very next NUL-terminated field.
        origPath = records[++i] ?? null;
      }
      status.files.push({
        path: filePath,
        origPath,
        staged: x !== ".",
        unstaged: y !== ".",
        untracked: false,
        isDirectory: false,
        state: fileState(x, y, false),
      });
    } else if (kind === "u") {
      // "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>" -> 10 fields
      status.files.push({
        path: pathAfter(rec, 10),
        origPath: null,
        staged: false,
        unstaged: true,
        untracked: false,
        isDirectory: false,
        state: "conflicted",
      });
    } else if (kind === "?") {
      const p = rec.slice(2);
      status.files.push({
        path: p,
        origPath: null,
        staged: false,
        unstaged: true,
        untracked: true,
        // Git collapses an entirely-untracked directory into one entry with a
        // trailing slash; it is not a single file and must not be counted as one.
        isDirectory: p.endsWith("/"),
        state: "untracked",
      });
    }
    // "!" (ignored) is never requested, so it is not handled here.
  }

  status.files.sort((a, b) => a.path.localeCompare(b.path));
  return status;
}

export async function getStatus(dir: string): Promise<GitStatus | null> {
  const r = await run(
    "git",
    ["status", "--porcelain=v2", "--branch", "--renames", "-z"],
    { cwd: dir }
  );
  if (!r.ok) return null;
  return parsePorcelainV2(r.stdout);
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

const LOG_FORMAT = ["%H", "%h", "%s", "%an", "%aI", "%ar"].join("%x00");

export async function getLog(dir: string, limit = 30): Promise<GitCommit[]> {
  // Deliberately NOT -z: that would make the commit separator NUL as well,
  // rendering it indistinguishable from the %x00 field separator. Subjects
  // (%s) are single-line by definition, so newline is a safe record separator.
  const r = await run(
    "git",
    ["log", `--format=${LOG_FORMAT}`, "-n", String(limit)],
    { cwd: dir }
  );
  // An unborn branch has no commits and `git log` fails — that is expected.
  if (!r.ok) return [];

  const out: GitCommit[] = [];
  for (const entry of r.stdout.split("\n")) {
    if (!entry.trim()) continue;
    const f = entry.split("\0");
    if (f.length < 6) continue;
    out.push({
      hash: f[0],
      short: f[1],
      subject: f[2],
      author: f[3],
      date: f[4],
      relative: f[5],
    });
  }
  return out;
}

export async function getBranches(dir: string): Promise<GitBranch[]> {
  const fmt = ["%(refname)", "%(objectname:short)", "%(upstream:short)", "%(HEAD)", "%(committerdate:iso8601)", "%(contents:subject)"].join("%00");
  const r = await run(
    "git",
    ["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes"],
    { cwd: dir }
  );
  if (!r.ok) return [];

  const out: GitBranch[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [refname, sha, upstream, head, date, subject] = line.split("\0");
    if (refname === "refs/remotes/origin/HEAD") continue; // symbolic, not a branch
    const remote = refname.startsWith("refs/remotes/");
    out.push({
      name: refname.replace(/^refs\/(heads|remotes)\//, ""),
      sha,
      upstream: upstream || null,
      current: head === "*",
      remote,
      date: date || null,
      subject: subject || "",
    });
  }
  return out.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.remote !== b.remote) return a.remote ? 1 : -1;
    return (b.date ?? "").localeCompare(a.date ?? "");
  });
}

/**
 * Unified diff for one path. Untracked files have no index entry, so they are
 * diffed against /dev/null instead — `--no-index` exits 1 on difference, which
 * is success for our purposes.
 */
export async function getDiff(
  dir: string,
  filePath: string,
  opts: { staged?: boolean; untracked?: boolean } = {}
): Promise<string> {
  if (opts.untracked) {
    const r = await run(
      "git",
      ["diff", "--no-color", "--no-index", "--", "/dev/null", filePath],
      { cwd: dir }
    );
    return r.stdout;
  }
  const args = ["diff", "--no-color"];
  if (opts.staged) args.push("--cached");
  args.push("--", filePath);
  const r = await run("git", args, { cwd: dir });
  return r.stdout;
}

export async function getStashCount(dir: string): Promise<number> {
  const r = await run("git", ["stash", "list"], { cwd: dir });
  if (!r.ok) return 0;
  return r.stdout.split("\n").filter((l) => l.trim()).length;
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

/** Paths always go after `--` so a filename can never be read as a flag. */
export function stage(dir: string, paths: string[]): Promise<RunResult> {
  return run("git", ["add", "--", ...paths], { cwd: dir });
}

export function unstage(dir: string, paths: string[]): Promise<RunResult> {
  return run("git", ["restore", "--staged", "--", ...paths], { cwd: dir });
}

/**
 * Discard working-tree changes. Untracked paths cannot be "restored" — they
 * have to be removed — so the caller splits them and we handle both.
 */
export async function discard(
  dir: string,
  tracked: string[],
  untracked: string[]
): Promise<RunResult> {
  if (tracked.length) {
    const r = await run("git", ["restore", "--worktree", "--", ...tracked], {
      cwd: dir,
    });
    if (!r.ok) return r;
  }
  if (untracked.length) {
    return run("git", ["clean", "-fd", "--", ...untracked], { cwd: dir });
  }
  return { ok: true, stdout: "", stderr: "", code: 0 };
}

/** The message goes over stdin via `-F -`, never as an argv element. */
export function commit(
  dir: string,
  message: string,
  opts: { amend?: boolean } = {}
): Promise<RunResult> {
  const args = ["commit", "-F", "-"];
  if (opts.amend) args.push("--amend");
  return run("git", args, { cwd: dir, input: message });
}

export function createBranch(dir: string, name: string): Promise<RunResult> {
  return run("git", ["switch", "-c", name], { cwd: dir });
}

export function switchBranch(dir: string, name: string): Promise<RunResult> {
  return run("git", ["switch", name], { cwd: dir });
}

export function fetch(dir: string): Promise<RunResult> {
  return run("git", ["fetch", "--all", "--prune"], { cwd: dir, timeout: 60_000 });
}

export function pull(dir: string): Promise<RunResult> {
  return run("git", ["pull", "--ff-only"], { cwd: dir, timeout: 60_000 });
}

/**
 * Push. When the branch has no upstream yet, `--set-upstream origin <branch>`
 * is required — a bare `git push` would fail.
 */
export function push(
  dir: string,
  opts: { branch?: string | null; setUpstream?: boolean } = {}
): Promise<RunResult> {
  const args = ["push"];
  if (opts.setUpstream && opts.branch) {
    args.push("--set-upstream", "origin", opts.branch);
  }
  return run("git", args, { cwd: dir, timeout: 120_000 });
}
