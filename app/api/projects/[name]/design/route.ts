import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { buildDesignGraph, rollUp } from "@/lib/design/scan";
import { loadGraph, saveGraph } from "@/lib/design/store";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:name/design?depth=2
 *
 * Serves the cached graph. Returns 204 rather than building on demand — a
 * build can take seconds, and a page load must not silently trigger one.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const graph = await loadGraph(name);
  if (!graph) return new NextResponse(null, { status: 204 });

  const depth = Number(new URL(req.url).searchParams.get("depth") ?? "2");
  const rolled = rollUp(graph, Number.isFinite(depth) ? Math.min(4, Math.max(1, depth)) : 2);

  return NextResponse.json({
    project: graph.project,
    builtAt: graph.builtAt,
    durationMs: graph.durationMs,
    stats: graph.stats,
    packages: graph.packages.slice(0, 40),
    folders: rolled.folders,
    folderEdges: rolled.edges,
    files: graph.files,
    fileEdges: graph.edges,
  });
}

// POST /api/projects/:name/design -> (re)build and cache the graph.
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

  const graph = await buildDesignGraph(project.name, project.path);
  await saveGraph(graph);
  return NextResponse.json({ ok: true, stats: graph.stats, durationMs: graph.durationMs });
}
