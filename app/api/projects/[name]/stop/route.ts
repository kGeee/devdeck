import { NextResponse } from "next/server";
import { manager } from "@/lib/process-manager";

export const dynamic = "force-dynamic";

// POST /api/projects/:name/stop
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const state = await manager.stop(name);
  return NextResponse.json({ state });
}
