import { NextResponse } from "next/server";
import { getProviders } from "@/lib/agents/providers";

export const dynamic = "force-dynamic";

// GET /api/agents/providers -> install + credential status for each CLI.
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  return NextResponse.json({ providers: await getProviders(force) });
}
