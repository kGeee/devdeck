import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { getDiff } from "@/lib/git";

export const dynamic = "force-dynamic";

// GET /api/projects/:name/git/diff?path=&staged=&untracked=
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const diff = await getDiff(project.path, filePath, {
    staged: url.searchParams.get("staged") === "1",
    untracked: url.searchParams.get("untracked") === "1",
  });

  return NextResponse.json({ diff });
}
