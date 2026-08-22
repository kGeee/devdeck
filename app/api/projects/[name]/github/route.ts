import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { githubView } from "@/lib/git-service";

export const dynamic = "force-dynamic";

// GET /api/projects/:name/github -> repo slugs + open PRs, or an explicit
// unavailable state when the project has no GitHub remote (not an error).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(await githubView(name, project.path));
}
