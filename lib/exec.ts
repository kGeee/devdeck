import { execFile } from "node:child_process";

/**
 * The single place where git/gh subprocesses are spawned.
 *
 * Every argument is an array element and `shell` is never enabled — this is the
 * injection boundary. Branch names, commit messages and file paths all come
 * from the client, so they must never be interpolated into a command line.
 */

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

const DEFAULT_TIMEOUT = 15_000;
/** Diffs of large files blow past the 1MB default. */
const MAX_BUFFER = 24 * 1024 * 1024;

export interface RunOptions {
  cwd: string;
  timeout?: number;
  /** Written to stdin — used for commit messages and PR bodies, which must
   *  never travel as argv (they contain newlines and arbitrary text). */
  input?: string;
  env?: NodeJS.ProcessEnv;
}

export function run(
  file: string,
  args: string[],
  opts: RunOptions
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: MAX_BUFFER,
        shell: false,
        env: {
          ...process.env,
          ...opts.env,
          // Never let git try to prompt for credentials — it would hang the
          // request forever with no terminal attached.
          GIT_TERMINAL_PROMPT: "0",
          // Keep read-only polling from fighting the user's editor or a
          // running dev server over the index lock.
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as NodeJS.ErrnoException).code === "number"
            ? ((err as unknown as { code: number }).code ?? null)
            : err
              ? 1
              : 0;
        resolve({
          ok: !err,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code,
        });
      }
    );

    if (opts.input != null) {
      child.stdin?.end(opts.input);
    }
  });
}

/** Run and return trimmed stdout, or null when the command failed. */
export async function runText(
  file: string,
  args: string[],
  opts: RunOptions
): Promise<string | null> {
  const r = await run(file, args, opts);
  return r.ok ? r.stdout.trim() : null;
}
