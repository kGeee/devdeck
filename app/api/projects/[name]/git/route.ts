import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { gitOverview } from "@/lib/git-service";

export const dynamic = "force-dynamic";

// GET /api/projects/:name/git -> branch state, changed files, history.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  // Resolving through findProject is what keeps a crafted name from reaching
  // an arbitrary directory — the path always comes from the scan, never the URL.
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(await gitOverview(name, project.path));
}
