import type { AgentToolCall, ToolStatus } from "../types";
import { activityFor, effectOf, hostOf, pathOf, summarise, truncate } from "../tools";
import { ROOT, syntheticId, type Adapter, type Sink } from "./base";
import { createClaudeAdapter } from "./claude";

/**
 * Gemini CLI `-o stream-json` adapter.
 *
 * Gemini's stream-json is modelled on Claude Code's, so assistant/user/result
 * events are handed straight to the Claude adapter rather than reimplemented.
 * What differs is tool reporting: Gemini emits discrete `tool_call` and
 * `tool_call_update` events instead of content blocks, so those are handled here.
 *
 * Unverified end to end: the Gemini account on this machine is a Workspace
 * account that exits before producing a turn until GOOGLE_CLOUD_PROJECT is set.
 * Both event families are therefore tolerated, and anything unrecognised is
 * ignored rather than throwing.
 */
export function createGeminiAdapter(sink: Sink): Adapter {
  const inner = createClaudeAdapter(sink, "Gemini");
  const open = new Set<string>();

  function statusOf(value: unknown): ToolStatus {
    const s = String(value ?? "").toLowerCase();
    if (s.includes("error") || s.includes("fail") || s.includes("cancel")) return "error";
    if (s.includes("success") || s.includes("complete") || s.includes("done")) return "ok";
    return "running";
  }

  function onToolCall(ev: Record<string, unknown>): void {
    const id = (ev.id as string) ?? (ev.call_id as string) ?? syntheticId("call");
    const name = (ev.name as string) ?? (ev.tool as string) ?? "tool";
    const input = ev.args ?? ev.input ?? ev.parameters;
    const effect = effectOf(name);

    const call: AgentToolCall = {
      id,
      nodeId: ROOT,
      name,
      effect,
      summary: summarise(name, input, sink.cwd),
      startedAt: sink.now(),
      endedAt: null,
      status: "running",
      result: null,
      path: effect === "read" || effect === "write" ? pathOf(input, sink.cwd) : null,
      host: effect === "network" ? hostOf(input) : null,
    };
    open.add(id);
    sink.toolStart(call);
    sink.nodePatch(ROOT, { activity: activityFor(call.name, call.summary) });
  }

  function onToolUpdate(ev: Record<string, unknown>): void {
    const id = (ev.id as string) ?? (ev.call_id as string);
    if (!id || !open.has(id)) return;
    const status = statusOf(ev.status ?? ev.state);
    if (status === "running") return;

    const output = ev.result ?? ev.output ?? ev.response ?? ev.error;
    sink.toolEnd(id, {
      status,
      result: output == null ? null : truncate(typeof output === "string" ? output : JSON.stringify(output)),
      endedAt: sink.now(),
    });
    open.delete(id);
    sink.nodePatch(ROOT, { activity: null });
  }

  return {
    line(raw: string): void {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (String(ev.type ?? "")) {
        case "tool_call":
          return onToolCall(ev);
        case "tool_call_update":
          return onToolUpdate(ev);
        case "session":
          sink.meta({
            providerSessionId: (ev.session_id as string) ?? (ev.id as string) ?? null,
            model: (ev.model as string) ?? null,
          });
          return;
        case "error": {
          const message =
            (ev.message as string) ??
            ((ev.error as Record<string, unknown>)?.message as string) ??
            "Gemini error";
          sink.finish({ status: "failed", error: message });
          return;
        }
        default:
          // assistant / user / result / system — Claude-shaped.
          return inner.line(raw);
      }
    },

    close(exitCode: number | null): void {
      for (const id of open) {
        sink.toolEnd(id, { status: "error", result: "Run ended", endedAt: sink.now() });
      }
      open.clear();
      inner.close(exitCode);
    },
  };
}
