"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronDown, ArrowDownToLine, Terminal, Circle } from "lucide-react";
import { devLogStream } from "@/lib/log-store";
import { IconButton } from "./ui";

const MIN_H = 120;
const MAX_H = 640;

/**
 * Bottom log dock.
 *
 * Mounted once by the shell and collapsed via CSS height rather than being
 * conditionally rendered — unmounting it would drop the SSE connection and the
 * buffered output every time the user hid it or changed tabs.
 *
 * Lines come from an external store, so a chatty dev server re-renders only
 * this component's body, not the rail or the active pane.
 */
export default function LogDock({
  projectName,
  open,
  height,
  onToggle,
  onResize,
}: {
  projectName: string | null;
  open: boolean;
  height: number;
  onToggle: () => void;
  onResize: (h: number) => void;
}) {
  const { lines, connected } = useSyncExternalStore(
    devLogStream.subscribe,
    devLogStream.getSnapshot,
    // Server snapshot — no logs exist during SSR.
    () => ({ lines: [], connected: false })
  );

  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;

  // Point the shared stream at whichever project is selected.
  useEffect(() => {
    devLogStream.connect(
      projectName
        ? `/api/projects/${encodeURIComponent(projectName)}/logs`
        : null
    );
    return () => devLogStream.disconnect();
  }, [projectName]);

  useEffect(() => {
    if (!autoScrollRef.current || !open) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  /* Drag-to-resize the dock. */
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      const move = (ev: PointerEvent) => {
        const next = Math.min(
          MAX_H,
          Math.max(MIN_H, startH + (startY - ev.clientY))
        );
        onResize(next);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [height, onResize]
  );

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Resize handle — only meaningful while expanded. */}
      {open && (
        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize log panel"
          className="h-1 w-full cursor-ns-resize bg-transparent transition-colors hover:bg-[var(--color-accent)]/30"
        />
      )}

      <div className="flex items-center justify-between gap-3 px-3.5 py-1.5">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="ring-focus flex min-w-0 items-center gap-2 rounded text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <ChevronDown
            className={`size-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <Terminal className="size-3.5 shrink-0" />
          <span className="font-medium">Logs</span>
          {projectName && (
            <span className="truncate font-mono text-[11px] text-[var(--color-muted-2)]">
              {projectName}
            </span>
          )}
          <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted-2)]">
            {lines.length}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-muted-2)]"
            title={connected ? "Streaming" : "Disconnected"}
          >
            <Circle
              className={`size-1.5 ${
                connected
                  ? "fill-[var(--color-accent)] text-[var(--color-accent)]"
                  : "fill-[var(--color-muted-2)] text-[var(--color-muted-2)]"
              }`}
            />
            {connected ? "live" : "off"}
          </span>
          <IconButton
            label="Toggle auto-scroll"
            active={autoScroll}
            onClick={() => setAutoScroll((v) => !v)}
          >
            <ArrowDownToLine className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {/* Collapse by height, never by unmounting. */}
      <div
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (atBottom !== autoScroll) setAutoScroll(atBottom);
        }}
        style={{ height: open ? height : 0 }}
        aria-hidden={!open}
        className="scroll-thin overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-background)] font-mono text-[12px] leading-[1.55] transition-[height] duration-150"
      >
        <div className="px-3.5 py-2">
          {lines.length === 0 ? (
            <p className="text-[var(--color-muted-2)]">
              {projectName
                ? "No output yet. Start the dev server to see logs stream here."
                : "Select a project."}
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.id} className="flex gap-3 whitespace-pre-wrap break-words">
                <span className="shrink-0 select-none tabular-nums text-[var(--color-muted-2)]/50">
                  {new Date(l.time).toLocaleTimeString([], { hour12: false })}
                </span>
                <span
                  className={
                    l.stream === "stderr"
                      ? "text-[var(--color-red)]"
                      : l.stream === "system"
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-foreground)]/90"
                  }
                >
                  {l.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
