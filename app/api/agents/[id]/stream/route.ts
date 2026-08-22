import { agents } from "@/lib/agents/session-manager";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/:id/stream -> SSE of normalised deltas.
 *
 * Opens with a `session` delta carrying the full current state, so a client
 * that attaches mid-run is immediately consistent and every later event is a
 * pure incremental patch.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = agents.get(id);
  if (!session) return new Response("Unknown session", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({ type: "session", session });

      const unsubscribe = agents.subscribe(id, send);

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15000);

      // @ts-expect-error - non-standard but present on the controller
      const signal: AbortSignal | undefined = controller.signal;
      signal?.addEventListener?.("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
