import { NextResponse } from "next/server";
import { findProject } from "@/lib/scan";
import { mergePR } from "@/lib/github";
import { githubView } from "@/lib/git-service";
import { invalidate } from "@/lib/git-cache";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/:name/github/pr/:number/merge
 *   { method: "squash"|"merge"|"rebase", deleteBranch?: boolean, confirm: string }
 *
 * The most consequential action in the app — it publishes to a shared remote
 * and cannot be undone from here. `confirm` must equal the PR number, matching
 * the typed confirmation in the UI.
 *
 * mergePR resolves the base repo explicitly from the git remotes; it never lets
 * `gh` infer it, which on a fork would target the upstream owner's repository.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string; number: string }> }
) {
  const blocked = assertLocalRequest(req);
  if (blocked) return blocked;

  const { name, number } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const prNumber = Number(number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json({ error: "Invalid PR number" }, { status: 400 });
  }

  let body: { method?: unknown; deleteBranch?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (String(body.confirm) !== String(prNumber)) {
    return NextResponse.json(
      { error: "Confirmation did not match the PR number" },
      { status: 400 }
    );
  }

  const method = body.method;
  if (method !== "squash" && method !== "merge" && method !== "rebase") {
    return NextResponse.json(
      { error: "method must be squash, merge or rebase" },
      { status: 400 }
    );
  }

  const view = await githubView(name, project.path);
  if (!view.available) {
    return NextResponse.json(
      { error: view.reason ?? "GitHub is not available for this project" },
      { status: 409 }
    );
  }

  const result = await mergePR(project.path, prNumber, {
    method,
    deleteBranch: Boolean(body.deleteBranch),
  });

  invalidate(name);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, mergedInto: view.baseRepo });
}
