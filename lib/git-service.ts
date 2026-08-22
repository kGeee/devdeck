import { cached, TTL } from "./git-cache";
import {
  getBranches,
  getFetchedAt,
  getLog,
  getRepoInfo,
  getStashCount,
  getStatus,
} from "./git";
import { getGitHubView } from "./github";
import { scanProjects } from "./scan";
import type {
  GitBranch,
  GitHubView,
  GitOverview,
  GitSummary,
} from "./types";

/**
 * Cached read layer sitting between the API routes and the raw git/gh calls.
 * Nothing here fetches from the network implicitly — `# branch.ab` is only as
 * fresh as the last explicit fetch, which is surfaced via `fetchedAt`.
 */

export async function gitOverview(
  name: string,
  dir: string
): Promise<GitOverview> {
  return cached(`${name}:overview`, TTL.detail, async () => {
    const info = await getRepoInfo(dir);
    if (!info.isRepo) {
      return {
        isRepo: false,
        isWorktree: false,
        status: null,
        stashes: 0,
        fetchedAt: null,
        commits: [],
      } satisfies GitOverview;
    }
    const [status, stashes, fetchedAt, commits] = await Promise.all([
      getStatus(dir),
      getStashCount(dir),
      getFetchedAt(info),
      getLog(dir, 20),
    ]);
    return {
      isRepo: true,
      isWorktree: info.isWorktree,
      status,
      stashes,
      fetchedAt,
      commits,
    } satisfies GitOverview;
  });
}

export async function gitBranches(
  name: string,
  dir: string
): Promise<GitBranch[]> {
  return cached(`${name}:branches`, TTL.detail, () => getBranches(dir));
}

export async function githubView(
  name: string,
  dir: string
): Promise<GitHubView> {
  return cached(`${name}:github`, TTL.github, () => getGitHubView(dir));
}

/**
 * One lightweight row per project for the rail. A full sweep costs ~500ms, so
 * it runs behind the 30s summary TTL and the cache's concurrency gate rather
 * than on the dashboard's fast poll.
 */
export async function gitSummaries(): Promise<GitSummary[]> {
  const projects = await scanProjects();
  return Promise.all(
    projects.map((p) =>
      cached(`${p.name}:summary`, TTL.summary, async () => {
        const info = await getRepoInfo(p.path);
        if (!info.isRepo) {
          return {
            name: p.name,
            isRepo: false,
            branch: null,
            detached: false,
            unborn: false,
            dirty: 0,
            ahead: null,
            behind: null,
          } satisfies GitSummary;
        }
        const status = await getStatus(p.path);
        return {
          name: p.name,
          isRepo: true,
          branch: status?.branch ?? null,
          detached: status?.detached ?? false,
          unborn: status?.unborn ?? false,
          dirty: status?.files.length ?? 0,
          ahead: status?.ahead ?? null,
          behind: status?.behind ?? null,
        } satisfies GitSummary;
      })
    )
  );
}
