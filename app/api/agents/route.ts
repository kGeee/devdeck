import { NextResponse } from "next/server";
import { agents } from "@/lib/agents/session-manager";
import { PROVIDERS, type AgentProvider } from "@/lib/agents/types";
import { getProviders, type AgentMode } from "@/lib/agents/providers";
import { findProject } from "@/lib/scan";
import { assertLocalRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

const MODES: AgentMode[] = ["plan", "edit", "full"];
/** Long enough for real instructions, short enough to stay a sane argv. */
const MAX_PROMPT = 20_000;

// GET /api/agents?project=name&history=1 -> session summaries, newest first.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project") ?? undefined;
  const live = agents.list(project);

  if (url.searchParams.get("history") !== "1") {
    return NextResponse.json({ sessions: live });
  }

  // Merge on-disk history, letting the in-memory copy win for ids in both.
  const seen = new Set(live.map((s) => s.id));
  const archived = (await agents.archived()).filter(
    (s) => !seen.has(s.id) && (!project || s.project === project)
  );
  return NextResponse.json({
    sessions: [...live, ...archived].sort((a, b) => b.startedAt - a.startedAt),
  });
}

// POST /api/agents  { provider, project, prompt, mode } -> start a run.
export async function POST(req: Request) {
  const blocked = assertLocalRequest(req);
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const provider = body.provider as AgentProvider;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "A prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `Prompt is too long (max ${MAX_PROMPT} characters)` },
      { status: 400 }
    );
  }

  const mode = (body.mode as AgentMode) ?? "plan";
  if (!MODES.includes(mode)) {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }

  const projectName = typeof body.project === "string" ? body.project : "";
  const project = await findProject(projectName);
  if (!project) {
    return NextResponse.json({ error: "Unknown project" }, { status: 404 });
  }

  // Refuse up front when we already know the CLI cannot run — otherwise the
  // user watches a session sit at "running" until it dies on an auth error.
  const info = (await getProviders()).find((p) => p.id === provider);
  if (!info?.installed) {
    return NextResponse.json(
      { error: info?.reason ?? `${provider} is not installed` },
      { status: 409 }
    );
  }
  if (!info.ready) {
    return NextResponse.json({ error: info.reason ?? "Provider is not ready" }, { status: 409 });
  }

  const session = agents.start({
    provider,
    project: project.name,
    cwd: project.path,
    prompt,
    mode,
    resume: typeof body.resume === "string" ? body.resume : null,
  });

  return NextResponse.json({ session });
}
