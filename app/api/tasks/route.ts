import { NextResponse } from "next/server";
import { manager } from "@/lib/process-manager";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET /api/tasks?project=name -> task runs, newest first.
export async function GET(req: Request) {
  const project = new URL(req.url).searchParams.get("project") ?? undefined;
  return NextResponse.json({ tasks: manager.tasks(project) });
}

// DELETE /api/tasks?key=... -> cancel a running task.
export async function DELETE(req: Request) {
  const blocked = assertLocalRequest(req);
  if (blocked) return blocked;

  const key = new URL(req.url).searchParams.get("key");
  if (!key || !manager.taskView(key)) {
    return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  }
  await manager.stop(key);
  return NextResponse.json({ ok: true });
}
