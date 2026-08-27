import { promises as fs } from "node:fs";
import path from "node:path";
import {
  logMonthPath,
  memoryDir,
  profilePath,
  projectShardPath,
} from "./paths";
import type { ShardWriter } from "./types";

export type MemoryLayer = "profile" | "log" | "project";

export type ShardWriteResult =
  | { ok: true; path: string }
  | { ok: false; reason: "refused"; expectedOwner: string; callerId: string };

function writerFor(filePath: string, ownerAgentId: string): ShardWriter {
  return { path: filePath, ownerAgentId };
}

export function assertShardOwner(
  writer: ShardWriter,
  callerId: string
): ShardWriteResult | null {
  if (callerId !== writer.ownerAgentId) {
    return {
      ok: false,
      reason: "refused",
      expectedOwner: writer.ownerAgentId,
      callerId,
    };
  }
  return null;
}

async function writeOwned(
  filePath: string,
  ownerAgentId: string,
  callerId: string,
  content: string,
  mode: "set" | "append"
): Promise<ShardWriteResult> {
  const refusal = assertShardOwner(writerFor(filePath, ownerAgentId), callerId);
  if (refusal) return refusal;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (mode === "append") {
    await fs.appendFile(filePath, content, "utf8");
  } else {
    await fs.writeFile(filePath, content, "utf8");
  }
  return { ok: true, path: filePath };
}

export async function writeProfile(
  agentId: string,
  callerId: string,
  content: string,
  cwd = process.cwd()
): Promise<ShardWriteResult> {
  return writeOwned(profilePath(agentId, cwd), agentId, callerId, content, "set");
}

export async function appendLog(
  agentId: string,
  callerId: string,
  line: string,
  opts: { at?: Date; cwd?: string } = {}
): Promise<ShardWriteResult> {
  const at = opts.at ?? new Date();
  const cwd = opts.cwd ?? process.cwd();
  const ym = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  const file = logMonthPath(agentId, ym, cwd);
  const text = line.endsWith("\n") ? line : `${line}\n`;
  return writeOwned(file, agentId, callerId, text, "append");
}

export async function writeProjectShard(
  slug: string,
  agentId: string,
  callerId: string,
  content: string,
  cwd = process.cwd()
): Promise<ShardWriteResult> {
  return writeOwned(
    projectShardPath(slug, agentId, cwd),
    agentId,
    callerId,
    content,
    "set"
  );
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

export interface MemoryBundle {
  profile: string | null;
  log: string | null;
  project: string | null;
  /** Precedence: project > log > profile */
  resolved: string;
}

export async function loadMemory(
  agentId: string,
  opts: { projectSlug?: string; at?: Date; cwd?: string } = {}
): Promise<MemoryBundle> {
  const cwd = opts.cwd ?? process.cwd();
  const at = opts.at ?? new Date();
  const ym = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  const profile = await readIfExists(profilePath(agentId, cwd));
  const log = await readIfExists(logMonthPath(agentId, ym, cwd));
  const project = opts.projectSlug
    ? await readIfExists(projectShardPath(opts.projectSlug, agentId, cwd))
    : null;

  // Precedence for conflicting facts: project > log > profile.
  return { profile, log, project, resolved: composePrecedence(project, log, profile) };
}

function composePrecedence(
  project: string | null,
  log: string | null,
  profile: string | null
): string {
  const parts: string[] = [];
  if (project) parts.push(`# project\n${project.trim()}`);
  if (log) parts.push(`# log\n${log.trim()}`);
  if (profile) parts.push(`# profile\n${profile.trim()}`);
  return parts.join("\n\n");
}

export function memoryRoot(cwd = process.cwd()): string {
  return memoryDir(cwd);
}
