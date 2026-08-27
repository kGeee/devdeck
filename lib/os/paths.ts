import path from "node:path";

/** Pack root relative to the repo (cwd when the hub runs). */
export function packsRoot(cwd = process.cwd()): string {
  return path.join(cwd, "packs");
}

export function osRoot(cwd = process.cwd()): string {
  return path.join(cwd, ".devdeck", "os");
}

export function roomsDir(cwd = process.cwd()): string {
  return path.join(osRoot(cwd), "rooms");
}

export function routinesDir(cwd = process.cwd()): string {
  return path.join(osRoot(cwd), "routines");
}

export function memoryDir(cwd = process.cwd()): string {
  return path.join(osRoot(cwd), "memory");
}

export function profilePath(agentId: string, cwd = process.cwd()): string {
  return path.join(memoryDir(cwd), agentId, "profile.md");
}

export function logMonthPath(
  agentId: string,
  ym: string,
  cwd = process.cwd()
): string {
  return path.join(memoryDir(cwd), agentId, "log", `${ym}.md`);
}

export function projectShardPath(
  slug: string,
  agentId: string,
  cwd = process.cwd()
): string {
  return path.join(memoryDir(cwd), "project", slug, `${agentId}.md`);
}
