import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { removeManualPath, setPortOverride } from "@/lib/manual";
import { manager } from "@/lib/process-manager";

export const dynamic = "force-dynamic";

// PATCH /api/projects/:name  { port: number | null }
// Set (or clear, with null) the dev port the project is started on. Takes
// effect on the next start.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let port: unknown;
  try {
    const body = await req.json();
    port = body?.port;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  // Accept a number, null, or "" (treated as clear).
  let value: number | null;
  if (port === null || port === "") {
    value = null;
  } else if (typeof port === "number") {
    value = port;
  } else if (typeof port === "string" && /^\d+$/.test(port.trim())) {
    value = Number(port.trim());
  } else {
    return NextResponse.json({ error: "Port must be a number or null" }, { status: 400 });
  }

  try {
    await setPortOverride(name, value);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to set port" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, port: value });
}

// DELETE /api/projects/:name -> remove a manually-added project.
// Scanned projects can't be removed (they come from the filesystem).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.manual) {
    return NextResponse.json(
      { error: "Only manually-added projects can be removed" },
      { status: 400 }
    );
  }

  // Stop it first so we don't orphan a running dev server.
  await manager.stop(name);

  const removed = await removeManualPath(project.path);
  if (!removed) {
    return NextResponse.json({ error: "Project was not in the manual list" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
