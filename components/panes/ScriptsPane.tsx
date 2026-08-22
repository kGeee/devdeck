"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Play,
  Square,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import type { ProjectView, TaskView } from "@/lib/types";
import { taskLogStream } from "@/lib/log-store";
import { Badge, Button, EmptyState, ErrorNote } from "../ui";

const POLL_MS = 1500;

export default function ScriptsPane({ project }: { project: ProjectView }) {
  const [scripts, setScripts] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const name = encodeURIComponent(project.name);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${name}/scripts`, {
        cache: "no-store",
      });
      const d = await r.json();
      setScripts(d.scripts ?? {});
      setTasks(d.tasks ?? []);
    } catch {
      /* transient */
    }
  }, [name]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Stream the selected run's output.
  useEffect(() => {
    taskLogStream.connect(
      activeKey ? `/api/tasks/logs?key=${encodeURIComponent(activeKey)}` : null
    );
    return () => taskLogStream.disconnect();
  }, [activeKey]);

  const { lines } = useSyncExternalStore(
    taskLogStream.subscribe,
    taskLogStream.getSnapshot,
    () => ({ lines: [], connected: false })
  );

  const run = async (script: string) => {
    setBusy(script);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${name}/scripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setActiveKey(data.taskKey);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run script");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (key: string) => {
    await fetch(`/api/tasks?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    await load();
  };

  const entries = Object.entries(scripts);
  const taskFor = (script: string) => tasks.find((t) => t.label === script);

  return (
    <div className="grid min-h-0 gap-4 p-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Scripts
            <span className="ml-1.5 font-mono text-[10px] text-[var(--color-muted-2)]">
              {entries.length}
            </span>
          </h3>
        </div>

        {error && (
          <div className="p-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        {entries.length === 0 ? (
          <EmptyState
            icon={<Terminal className="size-6" />}
            title="No scripts in package.json"
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {entries.map(([script, command]) => {
              const isDev = script === project.devScript;
              const task = taskFor(script);
              const running = task?.status === "running";
              return (
                <li
                  key={script}
                  className={`flex items-center gap-2.5 px-4 py-2.5 transition-colors ${
                    activeKey && task?.key === activeKey
                      ? "bg-[var(--color-surface-2)]"
                      : ""
                  }`}
                >
                  <button
                    onClick={() => task && setActiveKey(task.key)}
                    disabled={!task}
                    className="ring-focus min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-mono text-[13px]">
                        {script}
                      </span>
                      {isDev && <Badge tone="accent">dev server</Badge>}
                      {task && <TaskBadge status={task.status} />}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--color-muted-2)]">
                      {command}
                    </span>
                  </button>

                  {isDev ? (
                    // The dev script belongs to the header's start/stop control;
                    // running it here would spawn a second server on the port.
                    <span className="shrink-0 text-[10px] text-[var(--color-muted-2)]">
                      use header
                    </span>
                  ) : running ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => task && cancel(task.key)}
                    >
                      <Square className="size-3 fill-current" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => run(script)}
                      busy={busy === script}
                    >
                      <Play className="size-3 fill-current" />
                      Run
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex min-h-0 flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Output
          </h3>
          {activeKey && (
            <span className="truncate font-mono text-[11px] text-[var(--color-muted-2)]">
              {tasks.find((t) => t.key === activeKey)?.label}
            </span>
          )}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-[var(--color-background)] px-3.5 py-2 font-mono text-[12px] leading-[1.55]">
          {lines.length === 0 ? (
            <p className="text-[var(--color-muted-2)]">
              Run a script to see its output here.
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
      </section>
    </div>
  );
}

function TaskBadge({ status }: { status: TaskView["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-amber)]">
        <Loader2 className="size-3 spin" />
        running
      </span>
    );
  }
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-accent)]">
        <CheckCircle2 className="size-3" />
        passed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-red)]">
      <XCircle className="size-3" />
      failed
    </span>
  );
}
