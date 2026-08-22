import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { findProject } from "@/lib/scan";

export const dynamic = "force-dynamic";

// POST /api/projects/:name/open  { target?: "editor" | "finder" }
// Opens the project folder in the user's editor or the OS file browser.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const project = await findProject(name);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let target: "editor" | "finder" = "editor";
  try {
    const body = await req.json();
    if (body?.target === "finder") target = "finder";
  } catch {
    /* default */
  }

  try {
    if (target === "editor") {
      // Try VS Code first; fall back to the OS opener.
      const code = spawn("code", [project.path], { stdio: "ignore", detached: true });
      code.on("error", () => {
        spawn(opener(), [project.path], { stdio: "ignore", detached: true }).unref();
      });
      code.unref();
    } else {
      spawn(opener(), [project.path], { stdio: "ignore", detached: true }).unref();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to open" },
      { status: 500 }
    );
  }
}

function opener(): string {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "explorer";
  return "xdg-open";
}
