import { NextResponse } from "next/server";

/**
 * Cross-site request guard for mutating routes.
 *
 * These routes can commit, push and merge PRs using the user's ambient git and
 * `gh` credentials. Without a guard, ANY page open in the browser could issue a
 * cross-origin POST to localhost:4321 and drive them — the typed confirmation
 * dialogs defend against the user, not against a malicious page.
 *
 * Two independent checks, either of which is sufficient to reject:
 *  - `Sec-Fetch-Site` must not be cross-site (sent by all current browsers and
 *    not forgeable by page JavaScript).
 *  - `Origin`, when present, must be a loopback address.
 *
 * Paired with binding the dev server to 127.0.0.1 so nothing off-machine can
 * reach it at all.
 */

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/** Returns an error response when the request must be refused, else null. */
export function assertLocalRequest(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  // "same-origin" and "none" (direct navigation) are fine; a missing header
  // means a non-browser client such as curl, which we allow.
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json(
      { error: "Cross-site requests are not allowed" },
      { status: 403 }
    );
  }

  const origin = req.headers.get("origin");
  if (origin) {
    const host = hostOf(origin);
    if (!host || !ALLOWED_HOSTS.has(host)) {
      return NextResponse.json(
        { error: "Requests must originate from localhost" },
        { status: 403 }
      );
    }
  }

  return null;
}
