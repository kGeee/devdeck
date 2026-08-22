import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { getStatus } from "@/lib/git";
import { createPR } from "@/lib/github";
import { githubView } from "@/lib/git-service";
import { invalidate } from "@/lib/git-cache";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// POST /api/projects/:name/github/pr  { title, body?, base?, draft? }
// Opens a PR from the current branch.
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

  let body: { title?: unknown; body?: unknown; base?: unknown; draft?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "A title is required" }, { status: 400 });
  }

  const status = await getStatus(project.path);
  if (!status || status.detached || status.unborn || !status.branch) {
    return NextResponse.json(
      { error: "A PR needs a checked-out branch with commits" },
      { status: 409 }
    );
  }

  const view = await githubView(name, project.path);
  if (!view.available) {
    return NextResponse.json(
      { error: view.reason ?? "GitHub is not available for this project" },
      { status: 409 }
    );
  }

  const base =
    typeof body.base === "string" && body.base.trim()
      ? body.base.trim()
      : (view.defaultBranch ?? "main");

  if (base === status.branch && !view.isFork) {
    return NextResponse.json(
      { error: `Cannot open a PR from ${base} into itself` },
      { status: 409 }
    );
  }

  const result = await createPR(project.path, {
    title,
    body: typeof body.body === "string" ? body.body : "",
    base,
    head: status.branch,
    draft: Boolean(body.draft),
  });

  invalidate(name);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, url: result.url });
}
