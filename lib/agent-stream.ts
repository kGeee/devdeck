"use client";

import type { AgentDelta, AgentSession } from "@/lib/agents/types";

/**
 * Client-side mirror of one agent session.
 *
 * Same reasoning as `log-store.ts`: a busy run emits deltas far faster than
 * React should re-render, so the session lives outside component state and is
 * published to subscribers on an animation frame. Components read it through
 * useSyncExternalStore, so only the subtree that reads it re-renders.
 */

export interface AgentStreamState {
  session: AgentSession | null;
  raw: { line: string; at: number }[];
  connected: boolean;
}

const MAX_RAW = 1000;

type Listener = () => void;

class AgentStream {
  private listeners = new Set<Listener>();
  private source: EventSource | null = null;
  private session: AgentSession | null = null;
  private raw: { line: string; at: number }[] = [];
  private connected = false;
  private frame: number | null = null;
  private dirty = false;
  private snapshot: AgentStreamState = { session: null, raw: [], connected: false };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AgentStreamState => this.snapshot;

  /** Publish at most once per frame; deltas arrive in bursts. */
  private schedule(): void {
    this.dirty = true;
    if (this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.snapshot = {
        session: this.session ? { ...this.session } : null,
        raw: this.raw,
        connected: this.connected,
      };
      for (const l of this.listeners) l();
    });
  }

  private apply(delta: AgentDelta): void {
    if (delta.type === "session") {
      this.session = delta.session;
      this.schedule();
      return;
    }

    const s = this.session;
    if (!s) return;

    switch (delta.type) {
      case "status":
        s.status = delta.status;
        s.endedAt = delta.endedAt;
        s.exitCode = delta.exitCode;
        break;
      case "meta":
        s.providerSessionId = delta.providerSessionId;
        s.model = delta.model;
        break;
      case "node": {
        const i = s.nodes.findIndex((n) => n.id === delta.node.id);
        if (i === -1) s.nodes = [...s.nodes, delta.node];
        else {
          const next = s.nodes.slice();
          next[i] = delta.node;
          s.nodes = next;
        }
        break;
      }
      case "tool": {
        const i = s.toolCalls.findIndex((c) => c.id === delta.call.id);
        if (i === -1) s.toolCalls = [...s.toolCalls, delta.call];
        else {
          const next = s.toolCalls.slice();
          next[i] = delta.call;
          s.toolCalls = next;
        }
        break;
      }
      case "message":
        s.messages = [...s.messages, delta.message];
        break;
      case "usage":
        s.usage = delta.usage;
        break;
      case "result":
        s.result = delta.result;
        s.error = delta.error;
        break;
      case "raw":
        this.raw = this.raw.concat({ line: delta.line, at: delta.at });
        if (this.raw.length > MAX_RAW) this.raw = this.raw.slice(-MAX_RAW);
        break;
    }
    this.schedule();
  }

  /** Point at a session id, or disconnect entirely with null. */
  connect(id: string | null, initial?: AgentSession | null): void {
    this.source?.close();
    this.source = null;
    this.session = initial ?? null;
    this.raw = [];
    this.connected = false;
    this.schedule();

    if (!id) return;

    const es = new EventSource(`/api/agents/${encodeURIComponent(id)}/stream`);
    this.source = es;
    es.onmessage = (e) => {
      try {
        this.apply(JSON.parse(e.data) as AgentDelta);
      } catch {
        /* ignore a malformed frame */
      }
    };
    es.onopen = () => {
      this.connected = true;
      this.schedule();
    };
    es.onerror = () => {
      this.connected = false;
      this.schedule();
      // A finished run's stream closes; don't let EventSource reconnect-loop.
      if (this.session?.endedAt) {
        es.close();
        this.source = null;
      }
    };
  }

  disconnect(): void {
    this.connect(null);
  }
}

/** One stream: the workspace shows a single focused session at a time. */
export const agentStream = new AgentStream();
