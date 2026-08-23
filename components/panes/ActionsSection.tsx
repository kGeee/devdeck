"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Play, Square, Zap } from "lucide-react";
import type { GitBranch, ProjectAction, ProjectView, TaskView } from "@/lib/types";
import { Badge, Button, ErrorNote } from "../ui";
import ConfirmDialog from "../ConfirmDialog";

/**
 * Project-declared actions: parameterised commands a project exposes to
 * DevDeck through `devdeck.json` (or a "devdeck" key in package.json).
 *
 * This sits above the npm scripts list because it covers what scripts cannot —
 * a command that needs arguments. `npm run x` has nowhere to put a branch name
 * or a version number, so anything needing them was previously terminal-only.
 */
export default function ActionsSection({
  project,
  tasks,
  onRan,
  activeKey,
  onSelectTask,
  onCancel,
}: {
  project: ProjectView;
  tasks: TaskView[];
  onRan: (taskKey: string) => void;
  activeKey: string | null;
  onSelectTask: (key: string) => void;
  onCancel: (key: string) => void;
}) {
  const [actions, setActions] = useState<ProjectAction[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<ProjectAction | null>(null);

  const name = encodeURIComponent(project.name);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${name}/actions`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setActions((d.actions ?? []) as ProjectAction[]))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [name]);

  const needsBranches = useMemo(
    () => actions.some((a) => a.inputs.some((i) => i.type === "branch")),
    [actions]
  );

  // Only pay for the branch list when an action actually asks for one.
  useEffect(() => {
    if (!needsBranches) return;
    let alive = true;
    fetch(`/api/projects/${name}/git/branch`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list = (d.branches ?? []) as GitBranch[];
        setBranches([...new Set(list.filter((b) => !b.remote).map((b) => b.name))]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [name, needsBranches]);

  const valuesFor = useCallback(
    (action: ProjectAction): Record<string, string> => {
      const current = values[action.id] ?? {};
      const merged: Record<string, string> = {};
      for (const input of action.inputs) {
        merged[input.name] =
          current[input.name] ??
          input.defaultValue ??
          (input.type === "boolean" ? "false" : "");
      }
      return merged;
    },
    [values]
  );

  const setValue = (actionId: string, key: string, value: string) => {
    setValues((v) => ({ ...v, [actionId]: { ...(v[actionId] ?? {}), [key]: value } }));
  };

  const execute = useCallback(
    async (action: ProjectAction) => {
      setBusy(action.id);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${name}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: action.id, values: valuesFor(action) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        onRan(data.taskKey as string);
        setPending(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to run action");
      } finally {
        setBusy(null);
      }
    },
    [name, valuesFor, onRan]
  );

  /** Danger actions and anything with a confirm message stop for approval. */
  const trigger = (action: ProjectAction) => {
    if (action.danger || action.confirm) setPending(action);
    else void execute(action);
  };

  if (actions.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <Zap className="size-3.5 text-[var(--color-violet)]" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          Actions
          <span className="ml-1.5 font-mono text-[10px] text-[var(--color-muted-2)]">
            {actions.length}
          </span>
        </h3>
      </div>

      {error && (
        <div className="p-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <ul className="divide-y divide-[var(--color-border)]">
        {actions.map((action) => {
          const task = tasks.find(
            (t) => t.kind === "action" && t.label === action.label
          );
          const running = task?.status === "running";
          const expanded = openId === action.id;
          const hasInputs = action.inputs.length > 0;
          const current = valuesFor(action);

          return (
            <li key={action.id} className={expanded ? "bg-[var(--color-surface-2)]/40" : ""}>
              <div className="flex items-center gap-2.5 px-4 py-2.5">
                <button
                  onClick={() => (task ? onSelectTask(task.key) : undefined)}
                  disabled={!task}
                  className="ring-focus min-w-0 flex-1 text-left disabled:cursor-default"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{action.label}</span>
                    {action.danger && <Badge tone="red">danger</Badge>}
                    {task && activeKey === task.key && <Badge tone="accent">output</Badge>}
                  </span>
                  {action.description && (
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--color-muted-2)]">
                      {action.description}
                    </span>
                  )}
                </button>

                {running ? (
                  <Button size="sm" variant="danger" onClick={() => task && onCancel(task.key)}>
                    <Square className="size-3 fill-current" />
                    Stop
                  </Button>
                ) : hasInputs ? (
                  <Button
                    size="sm"
                    onClick={() => setOpenId(expanded ? null : action.id)}
                    title="Set inputs before running"
                  >
                    <ChevronDown
                      className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                    Configure
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={action.danger ? "danger" : "default"}
                    onClick={() => trigger(action)}
                    busy={busy === action.id}
                  >
                    <Play className="size-3 fill-current" />
                    Run
                  </Button>
                )}
              </div>

              {expanded && hasInputs && (
                <div className="flex flex-col gap-2.5 border-t border-[var(--color-border)] px-4 py-3">
                  {action.inputs.map((input) => {
                    const options =
                      input.type === "branch" ? branches : input.options;
                    return (
                      <label key={input.name} className="flex flex-col gap-1">
                        <span className="text-[11px] text-[var(--color-muted)]">
                          {input.label}
                          {!input.required && (
                            <span className="text-[var(--color-muted-2)]"> (optional)</span>
                          )}
                        </span>

                        {input.type === "boolean" ? (
                          <button
                            type="button"
                            onClick={() =>
                              setValue(
                                action.id,
                                input.name,
                                current[input.name] === "true" ? "false" : "true"
                              )
                            }
                            className={`ring-focus w-fit rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                              current[input.name] === "true"
                                ? "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-foreground)]"
                                : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-muted-2)]"
                            }`}
                          >
                            {current[input.name] === "true" ? "on" : "off"}
                            {input.flag && (
                              <span className="ml-1.5 font-mono text-[10px] opacity-70">
                                {input.flag}
                              </span>
                            )}
                          </button>
                        ) : options.length > 0 ? (
                          <select
                            value={current[input.name]}
                            onChange={(e) => setValue(action.id, input.name, e.target.value)}
                            className="ring-focus rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2 py-1.5 font-mono text-xs outline-none"
                          >
                            <option value="">
                              {input.placeholder ?? "Select…"}
                            </option>
                            {options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={current[input.name]}
                            onChange={(e) => setValue(action.id, input.name, e.target.value)}
                            placeholder={input.placeholder ?? ""}
                            spellCheck={false}
                            className="ring-focus rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2 py-1.5 font-mono text-xs outline-none placeholder:text-[var(--color-muted-2)]"
                          />
                        )}
                      </label>
                    );
                  })}

                  <CommandPreview action={action} values={current} />

                  <div className="flex items-center gap-2 pt-0.5">
                    <Button
                      size="sm"
                      variant={action.danger ? "danger" : "primary"}
                      onClick={() => trigger(action)}
                      busy={busy === action.id}
                    >
                      <Play className="size-3 fill-current" />
                      Run
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pending != null}
        title={`Run "${pending?.label ?? ""}"?`}
        body={
          <span>
            {pending?.confirm ??
              "This action is marked as destructive."}
            {pending && (
              <span className="mt-2 block font-mono text-[11px] text-[var(--color-muted-2)]">
                {previewOf(pending, valuesFor(pending))}
              </span>
            )}
          </span>
        }
        phrase={pending?.id ?? ""}
        confirmLabel="Run action"
        busy={busy === pending?.id}
        onConfirm={() => pending && void execute(pending)}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

/**
 * Client-side mirror of the server's argv building, for display only. The
 * server resolves and validates independently — this exists so a release that
 * pushes a tag shows exactly what it will run before it runs.
 */
function previewOf(action: ProjectAction, values: Record<string, string>): string {
  const byName = new Map(action.inputs.map((i) => [i.name, i]));
  const parts: string[] = [];

  for (const template of action.args) {
    const solo = template.match(/^\{([a-zA-Z][a-zA-Z0-9_]*)\}$/);
    if (solo) {
      const input = byName.get(solo[1]);
      if (input?.type === "boolean") {
        if (values[input.name] === "true" && input.flag) parts.push(input.flag);
        continue;
      }
      if (input) {
        const value = values[input.name] ?? "";
        if (value) parts.push(value);
        else parts.push(`<${input.label}>`);
        continue;
      }
    }
    parts.push(
      template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, key: string) =>
        values[key] ? values[key] : whole
      )
    );
  }

  return [action.command, ...parts].join(" ");
}

function CommandPreview({
  action,
  values,
}: {
  action: ProjectAction;
  values: Record<string, string>;
}) {
  return (
    <p className="truncate rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 font-mono text-[11px] text-[var(--color-muted)]">
      {previewOf(action, values)}
    </p>
  );
}
