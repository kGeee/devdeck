"use client";

import { useEffect, useState } from "react";
import { CornerDownLeft, ShieldAlert, TriangleAlert } from "lucide-react";
import type { AgentProvider, ProviderInfo } from "@/lib/agents/types";
import { Button, ErrorNote } from "../ui";
import { PROVIDER_LABEL } from "./shared";

const MODES = [
  { id: "plan", label: "Plan only", hint: "Reads and reasons. Cannot change files." },
  { id: "edit", label: "Edit files", hint: "May write inside this project." },
  { id: "full", label: "Full access", hint: "No guardrails. Runs any command." },
] as const;

export type Mode = (typeof MODES)[number]["id"];

/**
 * Prompt box for launching a run against the selected project.
 *
 * Providers that failed preflight are rendered disabled with the reason
 * attached, rather than hidden — "why is Gemini missing" is a worse question
 * to leave the user with than "Gemini needs GOOGLE_CLOUD_PROJECT set".
 */
export default function AgentComposer({
  project,
  providers,
  busy,
  error,
  onSubmit,
}: {
  project: string;
  providers: ProviderInfo[];
  busy: boolean;
  error: string | null;
  onSubmit: (input: { provider: AgentProvider; prompt: string; mode: Mode }) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>("plan");
  const [provider, setProvider] = useState<AgentProvider>("claude");

  // Land on a provider that can actually run, so the default isn't a dead end.
  useEffect(() => {
    const current = providers.find((p) => p.id === provider);
    if (current && !current.ready) {
      const usable = providers.find((p) => p.ready);
      if (usable) setProvider(usable.id);
    }
  }, [providers, provider]);

  const active = providers.find((p) => p.id === provider);
  const canSend = prompt.trim().length > 0 && !busy && (active?.ready ?? false);

  const send = () => {
    if (!canSend) return;
    onSubmit({ provider, prompt: prompt.trim(), mode });
    setPrompt("");
  };

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5 pb-2.5">
        {providers.map((p) => {
          const selected = p.id === provider;
          return (
            <button
              key={p.id}
              onClick={() => p.ready && setProvider(p.id)}
              disabled={!p.ready}
              title={p.reason ?? `${p.label} ${p.version ?? ""}`.trim()}
              className={`ring-focus inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed ${
                selected
                  ? "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-foreground)]"
                  : p.ready
                    ? "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted-2)] opacity-60"
              }`}
            >
              {PROVIDER_LABEL[p.id]}
              {!p.ready && <TriangleAlert className="size-3 text-[var(--color-amber)]" />}
            </button>
          );
        })}

        <span className="mx-1 h-4 w-px bg-[var(--color-border-strong)]" aria-hidden />

        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            title={m.hint}
            className={`ring-focus rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
              mode === m.id
                ? m.id === "full"
                  ? "border-[var(--color-red)]/50 bg-[var(--color-red)]/10 text-[var(--color-red)]"
                  : "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-foreground)]"
                : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            send();
          }
        }}
        rows={3}
        spellCheck={false}
        placeholder={`Ask ${PROVIDER_LABEL[provider]} to do something in ${project}…`}
        className="ring-focus scroll-thin w-full resize-y rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-[var(--color-muted-2)]"
      />

      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted-2)]">
          {mode === "full" ? (
            <>
              <ShieldAlert className="size-3.5 text-[var(--color-red)]" />
              <span className="text-[var(--color-red)]">
                Full access — the agent can run any command on your machine.
              </span>
            </>
          ) : (
            <span>{MODES.find((m) => m.id === mode)?.hint}</span>
          )}
        </p>
        <Button variant="primary" size="sm" onClick={send} disabled={!canSend} busy={busy}>
          Run
          <CornerDownLeft className="size-3.5 opacity-70" />
        </Button>
      </div>

      {active && !active.ready && active.reason && (
        <p className="pt-2 text-[11px] text-[var(--color-amber)]">{active.reason}</p>
      )}
      {error && (
        <div className="pt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </div>
  );
}
