"use client";

import { useEffect, useState } from "react";
import { FileDiff, Loader2 } from "lucide-react";
import type { GitFileChange } from "@/lib/types";
import { EmptyState } from "./ui";

/**
 * Unified-diff renderer. Deliberately not a syntax highlighter — it colours
 * additions, deletions and hunk headers only, which is what a review-at-a-
 * glance needs and keeps the render cheap for large diffs.
 */
export default function DiffViewer({
  projectName,
  file,
  staged,
}: {
  projectName: string;
  file: GitFileChange | null;
  staged: boolean;
}) {
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file || file.isDirectory) {
      setDiff("");
      return;
    }
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ path: file.path });
    if (staged) qs.set("staged", "1");
    if (file.untracked) qs.set("untracked", "1");

    fetch(
      `/api/projects/${encodeURIComponent(projectName)}/git/diff?${qs}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .then((d) => {
        if (alive) setDiff(d.diff ?? "");
      })
      .catch(() => alive && setDiff(""))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [projectName, file, staged]);

  if (!file) {
    return (
      <EmptyState
        icon={<FileDiff className="size-6" />}
        title="Select a file to see its diff"
      />
    );
  }

  if (file.isDirectory) {
    return (
      <EmptyState
        icon={<FileDiff className="size-6" />}
        title={`${file.path} is an untracked directory`}
        hint="Git collapses a wholly-untracked directory into a single entry. Stage it to see its files individually."
      />
    );
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="size-5 spin text-[var(--color-muted-2)]" />
      </div>
    );
  }

  if (!diff.trim()) {
    return (
      <EmptyState
        icon={<FileDiff className="size-6" />}
        title="No textual diff"
        hint="The file may be binary, empty, or identical in this view."
      />
    );
  }

  const lines = diff.split("\n");

  return (
    <div className="scroll-thin overflow-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-[1.5]">
        <tbody>
          {lines.map((line, i) => {
            let cls = "text-[var(--color-foreground)]/85";
            if (line.startsWith("@@")) cls = "diff-hunk";
            else if (line.startsWith("+++") || line.startsWith("---"))
              cls = "diff-meta";
            else if (
              line.startsWith("diff ") ||
              line.startsWith("index ") ||
              line.startsWith("new file") ||
              line.startsWith("deleted file") ||
              line.startsWith("similarity ") ||
              line.startsWith("rename ")
            )
              cls = "diff-meta";
            else if (line.startsWith("+")) cls = "diff-add";
            else if (line.startsWith("-")) cls = "diff-del";

            return (
              <tr key={i} className={cls}>
                <td className="w-10 select-none border-r border-[var(--color-border)] px-2 text-right align-top text-[var(--color-muted-2)]/50 tabular-nums">
                  {i + 1}
                </td>
                <td className="whitespace-pre-wrap break-all px-3">
                  {line || " "}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
