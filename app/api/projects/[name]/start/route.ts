import { NextResponse } from "next/server";
import { findProject, devPortArgs } from "@/lib/scan";
import { manager } from "@/lib/process-manager";

export const dynamic = "force-dynamic";

// POST /api/projects/:name/start  { script?: string }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let script = project.devScript;
  try {
    const body = await req.json();
    if (body?.script && typeof body.script === "string") script = body.script;
  } catch {
    /* no body — use default dev script */
  }

  if (!script || !project.scripts[script]) {
    return NextResponse.json(
      { error: "No runnable dev script for this project" },
      { status: 400 }
    );
  }

  const port = project.portOverride;
  const state = manager.start({
    name: project.name,
    cwd: project.path,
    packageManager: project.packageManager,
    script,
    port,
    extraArgs: port != null ? devPortArgs(project.framework, port) : [],
  });

  return NextResponse.json({ state });
}
