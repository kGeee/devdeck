import { manager } from "@/lib/process-manager";

export const dynamic = "force-dynamic";

// GET /api/projects/:name/logs  -> Server-Sent Events stream of log lines.
// Sends the current buffer first, then streams new lines + status changes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Replay existing buffer.
      send("snapshot", { logs: manager.getLogs(name), state: manager.state(name) });

      const unsubscribe = manager.subscribe(
        name,
        (line) => send("log", line),
        (status) => send("status", { status, state: manager.state(name) })
      );

      // Heartbeat keeps the connection from idling out.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      // @ts-expect-error - non-standard but available on the controller's signal
      const signal: AbortSignal | undefined = controller.signal;
      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal?.addEventListener?.("abort", cleanup);
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
