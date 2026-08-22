import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { discard, getStatus } from "@/lib/git";
import { invalidate } from "@/lib/git-cache";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/:name/git/discard  { paths: string[], confirm: string }
 *
 * Destructive and unrecoverable — there is no reflog for an uncommitted change.
 * `confirm` must equal the project name, matching the typed confirmation in the
 * UI, so a stray or replayed request cannot wipe the working tree.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const blocked = assertLocalRequest(req);
  if (blocked) return blocked;

  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { paths?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (body.confirm !== name) {
    return NextResponse.json(
      { error: "Confirmation did not match the project name" },
      { status: 400 }
    );
  }

  const paths = Array.isArray(body.paths)
    ? body.paths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  if (paths.length === 0) {
    return NextResponse.json({ error: "paths is required" }, { status: 400 });
  }

  // Untracked files have nothing to restore from and must be removed instead,
  // so split them by their actual state rather than trusting the client.
  const status = await getStatus(project.path);
  const untrackedSet = new Set(
    (status?.files ?? []).filter((f) => f.untracked).map((f) => f.path)
  );
  const tracked = paths.filter((p) => !untrackedSet.has(p));
  const untracked = paths.filter((p) => untrackedSet.has(p));

  const r = await discard(project.path, tracked, untracked);
  invalidate(name);

  if (!r.ok) {
    return NextResponse.json(
      { error: r.stderr.trim() || "Discard failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, discarded: paths.length });
}
