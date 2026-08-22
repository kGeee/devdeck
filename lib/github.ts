import { run } from "./exec";
import { getRepoInfo } from "./git";
import type {
  CheckState,
  GitHubView,
  PRCheck,
  PullRequest,
  RunSlugs,
} from "./types";

/**
 * GitHub access via the `gh` CLI.
 *
 * The critical rule here: **never let `gh` infer the base repo.** Verified on
 * pixelpane-src, whose origin is kGeee/pixelpane but where a bare `gh repo
 * view` returns snehith01001110/pixelpane — gh resolved the base repo to the
 * `upstream` remote. A bare `gh pr merge` there would act on someone else's
 * repository. Every invocation therefore passes an explicit `--repo`.
 */

const PR_FIELDS = [
  "number",
  "title",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
  "url",
  "author",
  "createdAt",
  "updatedAt",
  "additions",
  "deletions",
  "changedFiles",
  "reviewDecision",
  "statusCheckRollup",
].join(",");

/** Extract "owner/repo" from an https or ssh remote URL. */
export function slugFromRemote(url: string): string | null {
  const m =
    url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/) ?? null;
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

/**
 * Resolve the two slugs a fork needs kept apart:
 *  - pushRepo: from `origin` — where branches and PR heads live.
 *  - baseRepo: where PRs are listed/opened/merged. Same as pushRepo normally;
 *    on a fork configured with an `upstream` remote it is that instead.
 */
export async function resolveSlugs(dir: string): Promise<RunSlugs> {
  const info = await getRepoInfo(dir);
  if (!info.isRepo) {
    return { pushRepo: null, baseRepo: null, isFork: false };
  }
  const origin = info.remotes.origin;
  if (!origin) {
    return { pushRepo: null, baseRepo: null, isFork: false };
  }
  const pushRepo = slugFromRemote(origin);
  const upstream = info.remotes.upstream
    ? slugFromRemote(info.remotes.upstream)
    : null;

  // Only treat it as a fork when upstream genuinely points somewhere else.
  const isFork = Boolean(upstream && upstream !== pushRepo);
  return {
    pushRepo,
    baseRepo: isFork ? upstream : pushRepo,
    isFork,
  };
}

/**
 * `gh` exit codes are inconsistent here — with no remote, `pr list` and
 * `repo view` exit 1 while `pr status` exits 0, all printing "no git remotes
 * found". So we never rely on them: we check for an origin remote ourselves
 * first, and defensively reject stdout that is not JSON.
 */
function parseJson<T>(stdout: string): T | null {
  const s = stdout.trim();
  if (!s.startsWith("[") && !s.startsWith("{")) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

interface RawCheckRun {
  __typename: "CheckRun";
  name: string;
  status: string;
  conclusion: string;
  detailsUrl: string | null;
  workflowName: string;
}

interface RawStatusContext {
  __typename: "StatusContext";
  context: string;
  state: string;
  targetUrl: string | null;
}

type RawCheck = RawCheckRun | RawStatusContext | { __typename?: string };

/**
 * `statusCheckRollup` is a heterogeneous array discriminated by __typename:
 * CheckRun carries name/status/conclusion/detailsUrl, StatusContext carries
 * context/state/targetUrl and has no conclusion at all. Normalise both.
 */
function normaliseChecks(rollup: unknown): PRCheck[] {
  if (!Array.isArray(rollup)) return [];
  const out: PRCheck[] = [];
  for (const raw of rollup as RawCheck[]) {
    if (raw?.__typename === "CheckRun") {
      const c = raw as RawCheckRun;
      out.push({
        name: c.workflowName ? `${c.workflowName} / ${c.name}` : c.name,
        state:
          c.status !== "COMPLETED"
            ? "pending"
            : mapConclusion(c.conclusion),
        url: c.detailsUrl ?? null,
      });
    } else if (raw?.__typename === "StatusContext") {
      const c = raw as RawStatusContext;
      out.push({
        name: c.context,
        state: mapConclusion(c.state),
        url: c.targetUrl ?? null,
      });
    }
  }
  return out;
}

function mapConclusion(v: string): CheckState {
  switch ((v ?? "").toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
    case "TIMED_OUT":
    case "CANCELLED":
    case "STARTUP_FAILURE":
      return "failure";
    case "PENDING":
    case "EXPECTED":
    case "QUEUED":
    case "IN_PROGRESS":
      return "pending";
    default:
      return "neutral";
  }
}

interface RawPR {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  url: string;
  author?: { login?: string };
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision?: string;
  statusCheckRollup?: unknown;
}

function normalisePR(raw: RawPR): PullRequest {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    isDraft: raw.isDraft,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    url: raw.url,
    author: raw.author?.login ?? "unknown",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
    // gh returns "" (not null) when no review is required.
    reviewDecision: raw.reviewDecision ? raw.reviewDecision : null,
    checks: normaliseChecks(raw.statusCheckRollup),
  };
}

/** Full GitHub view for a project, or an explicit unavailable state. */
export async function getGitHubView(dir: string): Promise<GitHubView> {
  const unavailable = (reason: string): GitHubView => ({
    available: false,
    reason,
    pushRepo: null,
    baseRepo: null,
    isFork: false,
    defaultBranch: null,
    isPrivate: false,
    prs: [],
  });

  const slugs = await resolveSlugs(dir);
  if (!slugs.baseRepo) return unavailable("No GitHub remote configured");

  const [repoRes, prRes] = await Promise.all([
    run(
      "gh",
      // `gh repo view` takes the repo POSITIONALLY — it rejects --repo, unlike
      // `gh pr list`/`pr create`/`pr merge`. Either way it is explicit, which
      // is the point: gh must never infer the base repo itself.
      [
        "repo",
        "view",
        slugs.baseRepo,
        "--json",
        "defaultBranchRef,isPrivate,nameWithOwner",
      ],
      { cwd: dir, timeout: 20_000 }
    ),
    run(
      "gh",
      ["pr", "list", "--repo", slugs.baseRepo, "--json", PR_FIELDS, "--limit", "30"],
      { cwd: dir, timeout: 25_000 }
    ),
  ]);

  const repo = parseJson<{
    defaultBranchRef: { name: string } | null;
    isPrivate: boolean;
  }>(repoRes.stdout);

  if (!repo) {
    return unavailable(
      repoRes.stderr.trim() || "Could not reach GitHub for this repository"
    );
  }

  const prs = parseJson<RawPR[]>(prRes.stdout) ?? [];

  return {
    available: true,
    reason: null,
    pushRepo: slugs.pushRepo,
    baseRepo: slugs.baseRepo,
    isFork: slugs.isFork,
    // defaultBranchRef is null on an entirely empty repo.
    defaultBranch: repo.defaultBranchRef?.name ?? null,
    isPrivate: repo.isPrivate,
    prs: prs.map(normalisePR),
  };
}

export async function createPR(
  dir: string,
  opts: {
    title: string;
    body: string;
    base: string;
    head: string;
    draft?: boolean;
  }
): Promise<{ ok: boolean; url: string | null; error: string | null }> {
  const slugs = await resolveSlugs(dir);
  if (!slugs.baseRepo) {
    return { ok: false, url: null, error: "No GitHub remote configured" };
  }

  const args = [
    "pr",
    "create",
    "--repo",
    slugs.baseRepo,
    "--title",
    opts.title,
    "--base",
    opts.base,
    "--head",
    // On a fork the head must be qualified with the owner of the push repo,
    // otherwise GitHub looks for the branch in the base repo and 404s.
    slugs.isFork && slugs.pushRepo
      ? `${slugs.pushRepo.split("/")[0]}:${opts.head}`
      : opts.head,
    "--body-file",
    "-",
  ];
  if (opts.draft) args.push("--draft");

  const r = await run("gh", args, {
    cwd: dir,
    input: opts.body,
    timeout: 40_000,
  });
  if (!r.ok) {
    return { ok: false, url: null, error: r.stderr.trim() || "Failed to create PR" };
  }
  const url = r.stdout.trim().split("\n").find((l) => l.startsWith("http")) ?? null;
  return { ok: true, url, error: null };
}

export async function mergePR(
  dir: string,
  number: number,
  opts: { method: "squash" | "merge" | "rebase"; deleteBranch?: boolean }
): Promise<{ ok: boolean; error: string | null }> {
  const slugs = await resolveSlugs(dir);
  if (!slugs.baseRepo) {
    return { ok: false, error: "No GitHub remote configured" };
  }
  const args = [
    "pr",
    "merge",
    String(number),
    "--repo",
    slugs.baseRepo,
    `--${opts.method}`,
  ];
  if (opts.deleteBranch) args.push("--delete-branch");

  const r = await run("gh", args, { cwd: dir, timeout: 60_000 });
  return {
    ok: r.ok,
    error: r.ok ? null : r.stderr.trim() || "Failed to merge",
  };
}
