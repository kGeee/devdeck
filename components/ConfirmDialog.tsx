"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui";

/**
 * Typed confirmation for irreversible actions.
 *
 * The user must type `phrase` exactly — matching what the corresponding API
 * route independently re-checks, so a mis-click cannot discard a working tree
 * or merge a PR.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  phrase,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  phrase: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const matches = value === phrase;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl slide-up"
      >
        <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-amber)]" />
          <div>
            <h2 id="confirm-title" className="text-sm font-semibold">
              {title}
            </h2>
            <div className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">
              {body}
            </div>
          </div>
        </div>

        <form
          className="px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !busy) onConfirm();
          }}
        >
          <label
            htmlFor="confirm-input"
            className="text-xs text-[var(--color-muted-2)]"
          >
            Type{" "}
            <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[var(--color-foreground)]">
              {phrase}
            </code>{" "}
            to confirm
          </label>
          <input
            id="confirm-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="ring-focus mt-2 w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2.5 py-1.5 font-mono text-sm outline-none"
          />

          {error && (
            <p className="mt-2 text-xs text-[var(--color-red)]">{error}</p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={!matches}
              busy={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
