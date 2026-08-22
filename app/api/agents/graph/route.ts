import { NextResponse } from "next/server";
import { agents } from "@/lib/agents/session-manager";
import { buildGraph } from "@/lib/agents/graph";
import { scanProjects } from "@/lib/scan";

export const dynamic = "force-dynamic";

// GET /api/agents/graph -> the cross-project activity graph.
export async function GET() {
  const projects = await scanProjects();
  const graph = buildGraph(
    agents.all(),
    projects.map((p) => ({ name: p.name, path: p.path }))
  );
  return NextResponse.json({ graph });
}
