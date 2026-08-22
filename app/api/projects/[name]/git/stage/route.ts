import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { stage, unstage } from "@/lib/git";
import { invalidate } from "@/lib/git-cache";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// POST /api/projects/:name/git/stage  { paths: string[], staged: boolean }
// staged:true stages the paths, staged:false unstages them.
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

  let body: { paths?: unknown; staged?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const paths = Array.isArray(body.paths)
    ? body.paths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  if (paths.length === 0) {
    return NextResponse.json({ error: "paths is required" }, { status: 400 });
  }

  const r = body.staged
    ? await stage(project.path, paths)
    : await unstage(project.path, paths);

  invalidate(name);

  if (!r.ok) {
    return NextResponse.json(
      { error: r.stderr.trim() || "Git command failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
