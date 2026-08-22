"use client";

import type { LogLine } from "./process-manager";

/**
 * Log buffer held outside React state.
 *
 * A dev server can emit hundreds of lines a second. If those lines lived in
 * WorkspaceShell state, every one would re-render the rail, header, tabs and
 * the active pane. Instead the buffer lives here and components subscribe via
 * useSyncExternalStore, so only the log body re-renders.
 *
 * Writes are also batched to one flush per animation frame, and the buffer is
 * a bounded array trimmed in place rather than the O(n) copy-per-line the
 * previous implementation used.
 */

const MAX_LINES = 2000;

export interface LogStreamState {
  lines: LogLine[];
  connected: boolean;
}

type Listener = () => void;

class LogStream {
  private lines: LogLine[] = [];
  private listeners = new Set<Listener>();
  private source: EventSource | null = null;
  private pending: LogLine[] = [];
  private frame: number | null = null;
  private connected = false;
  /** Replaced on every flush so useSyncExternalStore sees a new reference. */
  private snapshot: LogStreamState = { lines: [], connected: false };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LogStreamState => this.snapshot;

  private commit(): void {
    this.snapshot = { lines: this.lines, connected: this.connected };
    for (const l of this.listeners) l();
  }

  private scheduleFlush(): void {
    if (this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.pending.length === 0) return;
      // One concat per frame, then trim in place.
      this.lines = this.lines.concat(this.pending);
      this.pending = [];
      if (this.lines.length > MAX_LINES) {
        this.lines = this.lines.slice(this.lines.length - MAX_LINES);
      }
      this.commit();
    });
  }

  /** Point the stream at a URL, or disconnect entirely when given null. */
  connect(url: string | null): void {
    this.source?.close();
    this.source = null;
    this.lines = [];
    this.pending = [];
    this.connected = false;
    this.commit();

    if (!url) return;

    const es = new EventSource(url);
    this.source = es;

    es.addEventListener("snapshot", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { logs: LogLine[] };
      this.lines = data.logs ?? [];
      this.connected = true;
      this.commit();
    });
    es.addEventListener("log", (e) => {
      this.pending.push(JSON.parse((e as MessageEvent).data) as LogLine);
      this.scheduleFlush();
    });
    es.onerror = () => {
      // EventSource reconnects on its own; just reflect the gap in the UI.
      this.connected = false;
      this.commit();
    };
    es.onopen = () => {
      this.connected = true;
      this.commit();
    };
  }

  disconnect(): void {
    this.connect(null);
  }
}

/** One stream for the dev-server dock, one for the task console. */
export const devLogStream = new LogStream();
export const taskLogStream = new LogStream();
