import { NextResponse } from "next/server";
import { scanProjects } from "@/lib/scan";
import { addManualPath } from "@/lib/manual";
import { manager } from "@/lib/process-manager";
import type { ProjectView } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/projects -> list of projects merged with live process state.
export async function GET() {
  const projects = await scanProjects();
  const views: ProjectView[] = projects.map((p) => ({
    ...p,
    state: manager.state(p.name),
  }));
  return NextResponse.json({ projects: views, scannedAt: Date.now() });
}

// POST /api/projects  { path: string } -> register a project folder by hand.
export async function POST(req: Request) {
  let input: unknown;
  try {
    const body = await req.json();
    input = body?.path;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a path" }, { status: 400 });
  }

  if (typeof input !== "string" || !input.trim()) {
    return NextResponse.json({ error: "Path is required" }, { status: 400 });
  }

  let resolved: string;
  try {
    resolved = await addManualPath(input);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add path" },
      { status: 400 }
    );
  }

  // Surface the freshly added project so the client can confirm/select it.
  const projects = await scanProjects();
  const added = projects.find((p) => p.path === resolved);
  if (!added) {
    return NextResponse.json(
      {
        error:
          "Path was saved but a project there collides with an existing name or the dashboard itself",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ project: { ...added, state: manager.state(added.name) } });
}
