import type { AgentToolCall, ToolStatus } from "../types";
import { activityFor, effectOf, firstLine, summarise, truncate } from "../tools";
import { emptyUsage, num, ROOT, rootNode, syntheticId, type Adapter, type Sink } from "./base";

/**
 * Codex `exec --json` adapter.
 *
 * Envelope verified against codex-cli 0.135.0 (thread.started / turn.started /
 * turn.failed / error). The item payloads below are matched defensively —
 * every field is read through a fallback chain — because the account this was
 * built against had no credits, so a successful turn could not be captured.
 * An unrecognised item still lands as a generic tool call rather than vanishing.
 *
 * Codex has no subagent concept, so its runs are a single root node.
 */
export function createCodexAdapter(sink: Sink): Adapter {
  const open = new Map<string, string>(); // item id -> tool call id
  let settled = false;

  sink.node(rootNode("Codex", sink.now()));

  function itemType(item: Record<string, unknown>): string {
    return (
      (item.item_type as string) ??
      (item.type as string) ??
      (item.kind as string) ??
      "item"
    );
  }

  function textOf(item: Record<string, unknown>): string {
    for (const key of ["text", "message", "content", "summary"]) {
      const v = item[key];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  }

  /** Map a Codex item onto the tool vocabulary the rest of the app speaks. */
  function toCall(item: Record<string, unknown>, id: string): AgentToolCall | null {
    const type = itemType(item);

    if (type === "agent_message" || type === "reasoning") return null; // prose, not a call

    let name = type;
    let summary: string;

    if (type === "command_execution") {
      name = "Bash";
      summary = firstLine((item.command as string) ?? (item.cmd as string) ?? "shell command");
    } else if (type === "file_change") {
      name = "Edit";
      const changes = item.changes;
      const first =
        Array.isArray(changes) && changes.length > 0
          ? ((changes[0] as Record<string, unknown>)?.path as string)
          : ((item.path as string) ?? null);
      const count = Array.isArray(changes) ? changes.length : 1;
      summary = first ? (count > 1 ? `${first} +${count - 1} more` : first) : "file change";
    } else if (type === "web_search") {
      name = "WebSearch";
      summary = (item.query as string) ?? "web search";
    } else if (type === "mcp_tool_call") {
      name = `${(item.server as string) ?? "mcp"}:${(item.tool as string) ?? "call"}`;
      summary = summarise(name, item.arguments ?? item.input, sink.cwd);
    } else if (type === "todo_list") {
      name = "TodoWrite";
      const items = item.items ?? item.todos;
      summary = `${Array.isArray(items) ? items.length : 0} todos`;
    } else {
      summary = summarise(name, item, sink.cwd);
    }

    const effect = effectOf(name);
    return {
      id,
      nodeId: ROOT,
      name,
      effect,
      summary,
      startedAt: sink.now(),
      endedAt: null,
      status: "running",
      result: null,
      path:
        type === "file_change"
          ? ((Array.isArray(item.changes) && item.changes.length > 0
              ? ((item.changes[0] as Record<string, unknown>)?.path as string)
              : (item.path as string)) ?? null)
          : null,
      host: null,
    };
  }

  function statusOf(item: Record<string, unknown>): ToolStatus {
    const s = String(item.status ?? "").toLowerCase();
    if (s === "failed" || s === "error") return "error";
    const exit = item.exit_code;
    if (typeof exit === "number" && exit !== 0) return "error";
    return "ok";
  }

  function onItem(ev: Record<string, unknown>, phase: "started" | "updated" | "completed"): void {
    const item = (ev.item ?? ev) as Record<string, unknown>;
    const key = (item.id as string) ?? (ev.item_id as string) ?? syntheticId("item");
    const type = itemType(item);

    if (type === "agent_message" || type === "reasoning") {
      if (phase !== "completed") return;
      const text = textOf(item);
      if (!text.trim()) return;
      sink.message({
        id: syntheticId("msg"),
        nodeId: ROOT,
        kind: type === "reasoning" ? "thinking" : "text",
        text,
        at: sink.now(),
      });
      return;
    }

    if (phase === "started") {
      if (open.has(key)) return;
      const call = toCall(item, key);
      if (!call) return;
      open.set(key, call.id);
      sink.toolStart(call);
      sink.nodePatch(ROOT, { activity: activityFor(call.name, call.summary) });
      return;
    }

    if (phase === "completed") {
      // A completed item we never saw start still deserves a row.
      if (!open.has(key)) {
        const call = toCall(item, key);
        if (!call) return;
        open.set(key, call.id);
        sink.toolStart(call);
      }
      const output =
        (item.aggregated_output as string) ??
        (item.output as string) ??
        (item.result as string) ??
        "";
      sink.toolEnd(key, {
        status: statusOf(item),
        result: output ? truncate(output) : null,
        endedAt: sink.now(),
      });
      open.delete(key);
      sink.nodePatch(ROOT, { activity: null });
    }
  }

  return {
    line(raw: string): void {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      // Some builds nest the payload under `msg`.
      const inner = (ev.msg ?? ev) as Record<string, unknown>;
      const type = String(inner.type ?? ev.type ?? "");

      switch (type) {
        case "thread.started":
          sink.meta({
            providerSessionId:
              ((inner.thread_id ?? ev.thread_id) as string) ?? null,
            model: ((inner.model ?? ev.model) as string) ?? null,
          });
          return;
        case "turn.started":
          return;
        case "item.started":
          return onItem(inner, "started");
        case "item.updated":
          return onItem(inner, "updated");
        case "item.completed":
          return onItem(inner, "completed");
        case "turn.completed": {
          settled = true;
          const u = (inner.usage ?? {}) as Record<string, unknown>;
          sink.usage({
            ...emptyUsage(),
            inputTokens: num(u.input_tokens),
            outputTokens: num(u.output_tokens),
            cacheReadTokens: num(u.cached_input_tokens ?? u.cache_read_input_tokens),
          });
          sink.finish({ status: "succeeded" });
          return;
        }
        case "turn.failed": {
          settled = true;
          const err = (inner.error ?? {}) as Record<string, unknown>;
          sink.finish({
            status: "failed",
            error: (err.message as string) ?? "Codex turn failed",
          });
          return;
        }
        case "error": {
          // Retries are reported as `error` without ending the turn, so this
          // records the message but must not settle the run.
          const msg = (inner.message as string) ?? "Codex error";
          sink.message({
            id: syntheticId("msg"),
            nodeId: ROOT,
            kind: "text",
            text: msg,
            at: sink.now(),
          });
          return;
        }
        default:
          return;
      }
    },

    close(exitCode: number | null): void {
      for (const [key] of open) {
        sink.toolEnd(key, { status: "error", result: "Run ended", endedAt: sink.now() });
      }
      open.clear();
      if (!settled) {
        sink.finish({
          status: exitCode === 0 ? "succeeded" : "failed",
          error: exitCode === 0 ? null : `codex exited with code ${exitCode}`,
        });
      }
    },
  };
}
