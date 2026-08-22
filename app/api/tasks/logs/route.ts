import { manager } from "@/lib/process-manager";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/logs?key=... -> SSE stream for a one-shot task run.
 *
 * Mirrors the dev-server log stream. Task keys are only ever minted
 * server-side, so an unknown key is rejected rather than implicitly creating a
 * tracked process.
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key || !manager.taskView(key)) {
    return new Response("Unknown task", { status: 404 });
  }

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

      send("snapshot", {
        logs: manager.getLogs(key),
        task: manager.taskView(key),
      });

      const unsubscribe = manager.subscribe(
        key,
        (line) => send("log", line),
        () => send("task", manager.taskView(key))
      );

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
