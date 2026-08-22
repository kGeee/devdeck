import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { manager } from "@/lib/process-manager";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET /api/projects/:name/scripts -> the project's scripts and any task runs.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({
    scripts: project.scripts,
    devScript: project.devScript,
    tasks: manager.tasks(name),
  });
}

// POST /api/projects/:name/scripts  { script: string }
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

  let body: { script?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const script = typeof body.script === "string" ? body.script : "";
  // Only scripts declared in package.json can be run — the name is looked up,
  // never passed through from the request.
  if (!script || !(script in project.scripts)) {
    return NextResponse.json(
      { error: "Unknown script for this project" },
      { status: 400 }
    );
  }

  // The dev script belongs to the server lifecycle. Running it here would
  // spawn a second server on the same port under a different key.
  if (script === project.devScript) {
    return NextResponse.json(
      {
        error: `"${script}" is this project's dev server — start it from the header instead`,
      },
      { status: 409 }
    );
  }

  const pm = project.packageManager ?? "npm";
  const key = `${project.path} script ${script}`;
  const result = manager.runTask({
    key,
    project: name,
    label: script,
    kind: "script",
    cwd: project.path,
    file: pm,
    args: ["run", script],
  });

  if (!result.started) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true, taskKey: key });
}
