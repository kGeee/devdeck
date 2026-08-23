import { NextResponse } from "next/server";
import { loadGraph } from "@/lib/design/store";
import { searchDesign } from "@/lib/design/search";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:name/search?q=...&limit=12
 *
 * Resolves an intent to files without reading any of them, using the cached
 * design graph. Returns each hit with its doc comment, exported symbols and
 * import neighbours so a caller can decide what to open.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (!q.trim()) {
    return NextResponse.json({ error: "A query is required" }, { status: 400 });
  }

  const graph = await loadGraph(name);
  if (!graph) {
    return NextResponse.json(
      { error: "No design graph yet — build it first" },
      { status: 409 }
    );
  }

  const limitRaw = Number(url.searchParams.get("limit") ?? "12");
  const limit = Number.isFinite(limitRaw) ? Math.min(40, Math.max(1, limitRaw)) : 12;

  const { tokens, hits } = searchDesign(graph, q, limit);
  return NextResponse.json({ query: q, tokens, builtAt: graph.builtAt, hits });
}
