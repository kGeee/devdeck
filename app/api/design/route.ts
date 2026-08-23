import { NextResponse } from "next/server";
import { scanProjects } from "@/lib/scan";
import { buildDesignGraph } from "@/lib/design/scan";
import { listGraphs, saveGraph } from "@/lib/design/store";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";
/** Indexing every project is slow by nature; give it room. */
export const maxDuration = 300;

// GET /api/design -> which projects already have a cached graph.
export async function GET() {
  return NextResponse.json({ graphs: await listGraphs() });
}

/**
 * POST /api/design  { force?: boolean } -> build graphs for every project.
 *
 * The one-time pass that gives every project a design graph. Projects that
 * already have one are skipped unless `force` is set, so re-running after
 * adding a project is cheap.
 */
export async function POST(req: Request) {
  const blocked = assertLocalRequest(req);
  if (blocked) return blocked;

  let force = false;
  try {
    force = (await req.json())?.force === true;
  } catch {
    /* body is optional */
  }

  const projects = await scanProjects();
  const existing = new Set((await listGraphs()).map((g) => g.project));

  const built: { project: string; files: number; ms: number }[] = [];
  const skipped: string[] = [];
  const failed: { project: string; error: string }[] = [];

  // Sequential on purpose: these are disk-bound walks, and running a dozen at
  // once would starve the dev server this is running inside.
  for (const project of projects) {
    if (!force && existing.has(project.name)) {
      skipped.push(project.name);
      continue;
    }
    try {
      const graph = await buildDesignGraph(project.name, project.path);
      await saveGraph(graph);
      built.push({
        project: project.name,
        files: graph.stats.fileCount,
        ms: graph.durationMs,
      });
    } catch (err) {
      failed.push({
        project: project.name,
        error: err instanceof Error ? err.message : "scan failed",
      });
    }
  }

  return NextResponse.json({ built, skipped, failed });
}
