import { NextResponse } from "next/server";
import { agents } from "@/lib/agents/session-manager";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET /api/agents/:id -> the full session (falls back to the on-disk archive).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await agents.load(id);
  if (!session) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
  }
  return NextResponse.json({ session, raw: agents.rawLog(id) });
}

// DELETE /api/agents/:id -> cancel a running session.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = assertLocalRequest(req);
  if (blocked) return blocked;

  const { id } = await params;
  const cancelled = await agents.cancel(id);
  if (!cancelled) {
    return NextResponse.json(
      { error: "Session is not running" },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
