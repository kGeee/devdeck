"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Ban, FileCode2, Loader2, Terminal } from "lucide-react";
import type { AgentSession, AgentToolCall } from "@/lib/agents/types";
import { agentStream, type AgentStreamState } from "@/lib/agent-stream";
import { Button, EmptyState } from "../ui";
import AgentTree from "./AgentTree";
import {
  ProviderBadge,
  StatusBadge,
  formatCost,
  formatDuration,
} from "./shared";

const EFFECT_TONE: Record<AgentToolCall["effect"], string> = {
  read: "text-[var(--color-blue)]",
  write: "text-[var(--color-accent)]",
  execute: "text-[var(--color-amber)]",
  search: "text-[var(--color-violet)]",
  network: "text-[var(--color-blue)]",
  delegate: "text-[var(--color-violet)]",
  other: "text-[var(--color-muted)]",
};

/** Stable reference: useSyncExternalStore re-invokes this and compares by
 *  identity, so a fresh object each call would loop forever. */
const EMPTY_SNAPSHOT: AgentStreamState = { session: null, raw: [], connected: false };

type FeedItem =
  | { kind: "tool"; at: number; call: AgentToolCall }
  | { kind: "text" | "thinking"; at: number; id: string; text: string };

/**
 * Live view of one run: the agency tree on the left, and the selected node's
 * chronological activity on the right.
 *
 * Session state comes from `agentStream` via useSyncExternalStore rather than
 * component state, so a run emitting hundreds of tool events per second
 * re-renders only this subtree.
 */
export default function SessionView({
  sessionId,
  initial,
  onCancelled,
}: {
  sessionId: string;
  initial?: AgentSession | null;
  onCancelled?: () => void;
}) {
  const [node, setNode] = useState("root");
  const [cancelling, setCancelling] = useState(false);
  const [showThinking, setShowThinking] = useState(false);

  const state = useSyncExternalStore(
    agentStream.subscribe,
    agentStream.getSnapshot,
    // The server render has no stream; render the empty snapshot there.
    () => EMPTY_SNAPSHOT
  );

  useEffect(() => {
    agentStream.connect(sessionId, initial ?? null);
    setNode("root");
    return () => agentStream.disconnect();
    // `initial` is a render-time convenience only; reconnecting when it changes
    // identity would tear down a healthy stream on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const session = state.session;

  const feed = useMemo((): FeedItem[] => {
    if (!session) return [];
    const items: FeedItem[] = [];
    for (const call of session.toolCalls) {
      if (call.nodeId !== node) continue;
      items.push({ kind: "tool", at: call.startedAt, call });
    }
    for (const m of session.messages) {
      if (m.nodeId !== node) continue;
      if (m.kind === "thinking" && !showThinking) continue;
      items.push({ kind: m.kind, at: m.at, id: m.id, text: m.text });
    }
    return items.sort((a, b) => a.at - b.at);
  }, [session, node, showThinking]);

  if (!session) {
    return (
      <EmptyState icon={<Loader2 className="size-6 spin" />} title="Connecting to session…" />
    );
  }

  const live = session.status === "running" || session.status === "starting";

  const cancel = async () => {
    setCancelling(true);
    try {
      await fetch(`/api/agents/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onCancelled?.();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Run header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
        <ProviderBadge provider={session.provider} />
        <StatusBadge status={session.status} />
        <span className="font-mono text-[11px] text-[var(--color-muted-2)]">
          {formatDuration(session.startedAt, session.endedAt)}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-muted-2)]">
          {formatCost(session.usage.costUsd)}
        </span>
        {session.model && (
          <span className="truncate font-mono text-[11px] text-[var(--color-muted-2)]">
            {session.model}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowThinking((v) => !v)}
            title="Show the model's reasoning blocks"
          >
            {showThinking ? "Hide thinking" : "Show thinking"}
          </Button>
          {live && (
            <Button size="sm" variant="danger" onClick={cancel} busy={cancelling}>
              <Ban className="size-3.5" />
              Stop
            </Button>
          )}
        </div>
      </div>

      <p className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-2 text-[12px] text-[var(--color-muted)]">
        {session.prompt}
      </p>

      <div className="flex min-h-0 flex-1">
        {/* Agency tree */}
        <div className="scroll-thin w-64 shrink-0 overflow-y-auto border-r border-[var(--color-border)] py-1.5">
          <AgentTree nodes={session.nodes} selected={node} onSelect={setNode} />
        </div>

        {/* Selected node's activity */}
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {feed.length === 0 ? (
            <EmptyState
              icon={<Terminal className="size-6" />}
              title={live ? "Waiting for the first action…" : "No activity recorded"}
            />
          ) : (
            <ol className="flex flex-col gap-2">
              {feed.map((item) =>
                item.kind === "tool" ? (
                  <li
                    key={item.call.id}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {item.call.status === "running" ? (
                        <Loader2 className="size-3 shrink-0 spin text-[var(--color-accent)]" />
                      ) : (
                        <FileCode2
                          className={`size-3 shrink-0 ${
                            item.call.status === "error"
                              ? "text-[var(--color-red)]"
                              : EFFECT_TONE[item.call.effect]
                          }`}
                        />
                      )}
                      <span className="font-mono text-[11px] font-medium">
                        {item.call.name}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-muted)]"
                        title={item.call.summary}
                      >
                        {item.call.summary}
                      </span>
                    </div>
                    {item.call.result && (
                      <p className="mt-1.5 line-clamp-2 border-l-2 border-[var(--color-border-strong)] pl-2 font-mono text-[10.5px] leading-relaxed text-[var(--color-muted-2)]">
                        {item.call.result}
                      </p>
                    )}
                  </li>
                ) : (
                  <li
                    key={item.id}
                    className={`whitespace-pre-wrap rounded-md px-2.5 py-2 text-[12.5px] leading-relaxed ${
                      item.kind === "thinking"
                        ? "border border-dashed border-[var(--color-border-strong)] text-[var(--color-muted-2)] italic"
                        : "bg-[var(--color-surface)] text-[var(--color-foreground)]"
                    }`}
                  >
                    {item.text}
                  </li>
                )
              )}
            </ol>
          )}

          {(session.result || session.error) && (
            <div
              className={`mt-3 whitespace-pre-wrap rounded-md border px-3 py-2 text-[12.5px] leading-relaxed ${
                session.error
                  ? "border-[var(--color-red)]/30 bg-[var(--color-red)]/8 text-[var(--color-red)]"
                  : "border-[var(--color-accent)]/25 bg-[var(--color-accent)]/8"
              }`}
            >
              {session.error ?? session.result}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
