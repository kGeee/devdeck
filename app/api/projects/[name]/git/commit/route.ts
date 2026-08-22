import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { commit, getStatus } from "@/lib/git";
import { invalidate } from "@/lib/git-cache";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// POST /api/projects/:name/git/commit  { message: string, amend?: boolean }
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

  let body: { message?: unknown; amend?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "A commit message is required" },
      { status: 400 }
    );
  }

  // Refuse rather than let git produce a confusing error.
  const status = await getStatus(project.path);
  if (status?.files.some((f) => f.state === "conflicted")) {
    return NextResponse.json(
      { error: "Resolve the merge conflicts before committing" },
      { status: 409 }
    );
  }
  if (!body.amend && !status?.files.some((f) => f.staged)) {
    return NextResponse.json(
      { error: "Nothing staged to commit" },
      { status: 409 }
    );
  }

  const r = await commit(project.path, message, { amend: Boolean(body.amend) });
  invalidate(name);

  if (!r.ok) {
    return NextResponse.json(
      { error: r.stderr.trim() || r.stdout.trim() || "Commit failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, output: r.stdout.trim() });
}
