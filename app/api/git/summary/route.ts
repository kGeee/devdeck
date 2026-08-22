import { NextResponse } from "next/server";
import { gitSummaries } from "@/lib/git-service";

export const dynamic = "force-dynamic";

// GET /api/git/summary -> one lightweight git row per project, for the rail.
// Cached for 30s behind a concurrency gate; a full sweep costs ~500ms.
export async function GET() {
  return NextResponse.json({ summaries: await gitSummaries() });
}
