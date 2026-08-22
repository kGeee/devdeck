import type { AgentNode, AgentToolCall, ToolStatus } from "../types";
import { activityFor, effectOf, firstLine, hostOf, pathOf, summarise, truncate } from "../tools";
import { emptyUsage, num, ROOT, rootNode, type Adapter, type Sink } from "./base";

/**
 * Claude Code `--output-format stream-json` adapter.
 *
 * Event shapes verified against claude 2.1.235:
 *   {type:"system", subtype:"init", session_id, model, tools, …}
 *   {type:"assistant", message:{content:[{type:"text"|"thinking"|"tool_use",…}]},
 *    parent_tool_use_id}
 *   {type:"user", message:{content:[{type:"tool_result", tool_use_id, content}]},
 *    parent_tool_use_id}
 *   {type:"result", subtype:"success"|…, total_cost_usd, usage, result, is_error}
 *
 * `parent_tool_use_id` is the whole reason subagent attribution works: with
 * --forward-subagent-text, everything a subagent says or does carries the id of
 * the Task call that spawned it, which we use directly as that node's id.
 */
export function createClaudeAdapter(sink: Sink, rootLabel = "Claude"): Adapter {
  /** tool_use id -> the call, so a later tool_result can be matched to it. */
  const open = new Map<string, { name: string; nodeId: string }>();
  /** tool_use ids that spawned a subagent, so we can close the node too. */
  const delegations = new Set<string>();
  let settled = false;

  sink.node(rootNode(rootLabel, sink.now()));

  function record(nodeId: string, call: AgentToolCall): void {
    sink.toolStart(call);
    sink.nodePatch(nodeId, { activity: activityFor(call.name, call.summary) });
  }

  function handleAssistant(ev: Record<string, unknown>): void {
    const nodeId = (ev.parent_tool_use_id as string | null) ?? ROOT;
    const message = ev.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;

    for (const raw of content) {
      const block = raw as Record<string, unknown>;
      const kind = block.type;

      if (kind === "text" || kind === "thinking") {
        const text = ((kind === "text" ? block.text : block.thinking) as string) ?? "";
        if (!text.trim()) continue;
        sink.message({
          id: `${nodeId}:${sink.now()}:${kind}`,
          nodeId,
          kind: kind === "text" ? "text" : "thinking",
          text,
          at: sink.now(),
        });
        continue;
      }

      if (kind !== "tool_use") continue;

      const id = (block.id as string) ?? `tool_${sink.now()}`;
      const name = (block.name as string) ?? "tool";
      const input = block.input;
      const summary = summarise(name, input, sink.cwd);
      const effect = effectOf(name);

      open.set(id, { name, nodeId });
      record(nodeId, {
        id,
        nodeId,
        name,
        effect,
        summary,
        startedAt: sink.now(),
        endedAt: null,
        status: "running",
        result: null,
        path: effect === "read" || effect === "write" ? pathOf(input, sink.cwd) : null,
        host: effect === "network" ? hostOf(input) : null,
      });

      // A Task call is a delegation: the tool id becomes the subagent's node id,
      // which is exactly what later events reference via parent_tool_use_id.
      if (effect === "delegate") {
        const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
        const node: AgentNode = {
          id,
          parentId: nodeId,
          name: (o.subagent_type as string) ?? "subagent",
          kind: "subagent",
          status: "running",
          task:
            (o.description as string) ??
            (firstLine((o.prompt as string) ?? "", 200) || null),
          startedAt: sink.now(),
          endedAt: null,
          activity: null,
          toolCalls: 0,
          files: [],
        };
        delegations.add(id);
        sink.node(node);
      }
    }
  }

  function handleUser(ev: Record<string, unknown>): void {
    const message = ev.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;

    for (const raw of content) {
      const block = raw as Record<string, unknown>;
      if (block.type !== "tool_result") continue;

      const id = block.tool_use_id as string;
      if (!id) continue;
      const meta = open.get(id);
      open.delete(id);

      const isError = block.is_error === true;
      const status: ToolStatus = isError ? "error" : "ok";
      const body = block.content;
      const text =
        typeof body === "string"
          ? body
          : Array.isArray(body)
            ? body
                .map((b) => {
                  const o = b as Record<string, unknown>;
                  return typeof o?.text === "string" ? o.text : "";
                })
                .join(" ")
            : "";

      sink.toolEnd(id, { status, result: truncate(text), endedAt: sink.now() });

      if (delegations.has(id)) {
        delegations.delete(id);
        sink.nodePatch(id, {
          status: isError ? "failed" : "done",
          endedAt: sink.now(),
          activity: null,
        });
      } else if (meta) {
        sink.nodePatch(meta.nodeId, { activity: null });
      }
    }
  }

  function handleResult(ev: Record<string, unknown>): void {
    settled = true;
    const u = (ev.usage ?? {}) as Record<string, unknown>;
    sink.usage({
      ...emptyUsage(),
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens),
      cacheCreationTokens: num(u.cache_creation_input_tokens),
      costUsd: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : null,
    });

    const failed = ev.is_error === true || ev.subtype !== "success";
    const text = typeof ev.result === "string" ? ev.result : null;
    sink.finish({
      status: failed ? "failed" : "succeeded",
      result: text,
      error: failed ? (text ?? `Run ended: ${String(ev.subtype ?? "error")}`) : null,
    });
  }

  return {
    line(raw: string): void {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return; // Non-JSON noise on stdout; the raw log still has it.
      }

      switch (ev.type) {
        case "system":
          if (ev.subtype === "init") {
            sink.meta({
              providerSessionId: (ev.session_id as string) ?? null,
              model: (ev.model as string) ?? null,
            });
          }
          // hook_started / hook_response are local hook chatter, not agent work.
          return;
        case "assistant":
          return handleAssistant(ev);
        case "user":
          return handleUser(ev);
        case "result":
          return handleResult(ev);
        default:
          return;
      }
    },

    close(exitCode: number | null): void {
      // Mark any subagent still open as failed — the process is gone, so it is
      // not going to report back, and leaving it spinning in the UI would lie.
      for (const id of delegations) {
        sink.nodePatch(id, { status: "failed", endedAt: sink.now(), activity: null });
      }
      delegations.clear();
      for (const [id] of open) {
        sink.toolEnd(id, { status: "error", result: "Run ended", endedAt: sink.now() });
      }
      open.clear();
      if (!settled) {
        sink.finish({
          status: exitCode === 0 ? "succeeded" : "failed",
          error: exitCode === 0 ? null : `claude exited with code ${exitCode}`,
        });
      }
    },
  };
}
