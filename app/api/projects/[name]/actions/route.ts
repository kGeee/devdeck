import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { loadActions, resolveAction } from "@/lib/actions";
import { manager } from "@/lib/process-manager";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET /api/projects/:name/actions -> declared actions plus their task runs.
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
    actions: await loadActions(project.path),
    tasks: manager.tasks(name).filter((t) => t.kind === "action"),
  });
}

// POST /api/projects/:name/actions  { id: string, values: Record<string,string> }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const blocked = assertLocalRequest(req);
  if (blocked) return blocked;

  const { name } = await params;
  // Resolving through findProject is what keeps a crafted name from reaching an
  // arbitrary directory — the path always comes from the scan, never the URL.
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { id?: unknown; values?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  // The action is looked up by id in the project's own manifest; the command is
  // never taken from the request.
  const action = (await loadActions(project.path)).find((a) => a.id === id);
  if (!action) {
    return NextResponse.json(
      { error: "Unknown action for this project" },
      { status: 400 }
    );
  }

  const values =
    body.values && typeof body.values === "object"
      ? (body.values as Record<string, unknown>)
      : {};

  const outcome = resolveAction(action, project.path, values);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }

  const key = `${project.path} action ${action.id}`;
  const result = manager.runTask({
    key,
    project: name,
    label: action.label,
    kind: "action",
    cwd: outcome.resolved.cwd,
    file: outcome.resolved.file,
    args: outcome.resolved.args,
  });

  if (!result.started) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true, taskKey: key });
}
