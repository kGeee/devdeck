import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { createBranch, switchBranch } from "@/lib/git";
import { gitBranches } from "@/lib/git-service";
import { invalidate } from "@/lib/git-cache";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET /api/projects/:name/git/branch -> local + remote branches
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ branches: await gitBranches(name, project.path) });
}

// POST /api/projects/:name/git/branch  { name: string, create?: boolean }
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

  let body: { branch?: unknown; create?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  if (!branch) {
    return NextResponse.json({ error: "branch is required" }, { status: 400 });
  }
  // git would reject these anyway, but a clear message beats a raw git error.
  if (/[\s~^:?*[\\]/.test(branch) || branch.startsWith("-")) {
    return NextResponse.json(
      { error: "Branch name contains characters git does not allow" },
      { status: 400 }
    );
  }

  const r = body.create
    ? await createBranch(project.path, branch)
    : await switchBranch(project.path, branch);

  invalidate(name);

  if (!r.ok) {
    return NextResponse.json(
      { error: r.stderr.trim() || "Branch operation failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, branch });
}
