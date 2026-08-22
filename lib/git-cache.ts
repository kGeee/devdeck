/**
 * TTL cache in front of the git/gh subprocess calls.
 *
 * Measured on this machine a single `git status --porcelain=v2` costs ~28ms and
 * a serial sweep of every sibling repo ~500ms. That is cheap enough to do
 * lazily on demand and far too expensive to do on the dashboard's 2s poll, so
 * every read goes through here.
 *
 * Two properties matter beyond the TTL:
 *  - concurrent requests for the same key join one in-flight promise rather
 *    than spawning a second subprocess;
 *  - total concurrent spawns are capped so a rail refresh across ~17 repos
 *    cannot fork 17 processes at once.
 */

interface Entry<T> {
  value: T | null;
  at: number;
  inflight: Promise<T> | null;
}

const store = new Map<string, Entry<unknown>>();

/* ── Concurrency gate ───────────────────────────────────────────────────── */

const MAX_CONCURRENT = 4;
let active = 0;
const queue: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = queue.shift();
    if (next) next();
  }
}

/**
 * Return a cached value if it is younger than `ttl`, otherwise produce it.
 * Concurrent callers for the same key share one execution.
 */
export async function cached<T>(
  key: string,
  ttl: number,
  produce: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;

  if (hit) {
    if (hit.inflight) return hit.inflight;
    if (hit.value !== null && now - hit.at < ttl) return hit.value;
  }

  const entry: Entry<T> = hit ?? { value: null, at: 0, inflight: null };
  const p = withSlot(produce)
    .then((value) => {
      entry.value = value;
      entry.at = Date.now();
      return value;
    })
    .finally(() => {
      entry.inflight = null;
    });

  entry.inflight = p;
  store.set(key, entry as Entry<unknown>);
  return p;
}

/**
 * Drop every cached entry for a project. Called after any write so the next
 * read reflects it immediately rather than serving up to `ttl` of stale state.
 */
export function invalidate(project: string): void {
  for (const key of store.keys()) {
    if (key === project || key.startsWith(`${project}:`)) store.delete(key);
  }
}

export function invalidateAll(): void {
  store.clear();
}

export const TTL = {
  /** Rail rows: many projects, glanceable, tolerant of being a bit stale. */
  summary: 30_000,
  /** The project actually being looked at. */
  detail: 4_000,
  /** GitHub goes over the network and is rate-limited. */
  github: 60_000,
} as const;

/** Cache is process-global and must survive Next.js dev HMR recompiles. */
declare global {
  // eslint-disable-next-line no-var
  var __devdeckGitCache: Map<string, Entry<unknown>> | undefined;
}
if (globalThis.__devdeckGitCache) {
  for (const [k, v] of globalThis.__devdeckGitCache) store.set(k, v);
}
globalThis.__devdeckGitCache = store;
