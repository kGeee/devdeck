import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { packsRoot, routinesDir } from "./paths";
import type { GithubTrigger, Routine, RoutineTrigger } from "./types";

const TERMINAL_EVENTS = new Set(["pr-merged", "pr-closed"]);

export async function loadRoutineSchema(
  cwd = process.cwd()
): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(
    path.join(packsRoot(cwd), "routines", "_schema.json"),
    "utf8"
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

export type RoutineValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

export function validateRoutine(input: unknown): RoutineValidation {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["routine must be an object"] };
  }
  const r = input as Record<string, unknown>;
  if (typeof r.name !== "string" || !r.name) errors.push("name required");
  if (typeof r.prompt !== "string" || !r.prompt) errors.push("prompt required");
  if (typeof r.enabled !== "boolean") errors.push("enabled must be boolean");
  if (r.expiresAt !== undefined && typeof r.expiresAt !== "string") {
    errors.push("expiresAt must be a string");
  }
  if (r.id !== undefined && typeof r.id !== "string") {
    errors.push("id must be a string");
  }
  const triggerErrors = validateTrigger(r.trigger);
  errors.push(...triggerErrors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateTrigger(trigger: unknown): string[] {
  if (!trigger || typeof trigger !== "object") {
    return ["trigger required"];
  }
  const t = trigger as Record<string, unknown>;
  if (t.type === "cron") {
    if (typeof t.schedule !== "string" || !t.schedule) {
      return ["cron trigger requires schedule"];
    }
    return [];
  }
  if (t.type === "github") {
    const errs: string[] = [];
    if (typeof t.repo !== "string" || !t.repo || t.repo.includes("*")) {
      errs.push("github trigger requires concrete repo owner/name");
    }
    if (!Array.isArray(t.events) || t.events.length === 0) {
      errs.push("github trigger requires events[]");
    } else if (!t.events.every((e) => typeof e === "string")) {
      errs.push("github events must be strings");
    }
    if (t.pr !== undefined && typeof t.pr !== "number") {
      errs.push("pr must be an integer");
    }
    return errs;
  }
  return ["trigger.type must be cron or github"];
}

async function ensureRoutinesDir(cwd: string): Promise<string> {
  const dir = routinesDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function routinePath(id: string, cwd: string): string {
  return path.join(routinesDir(cwd), `${id}.json`);
}

export async function saveRoutine(
  input: Omit<Routine, "id"> & { id?: string },
  cwd = process.cwd()
): Promise<Routine> {
  const validation = validateRoutine(input);
  if (!validation.ok) {
    throw new Error(`invalid routine: ${validation.errors.join("; ")}`);
  }
  const routine: Routine = {
    id: input.id ?? randomUUID(),
    name: input.name,
    prompt: input.prompt,
    enabled: input.enabled,
    trigger: input.trigger,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  await ensureRoutinesDir(cwd);
  await fs.writeFile(
    routinePath(routine.id, cwd),
    JSON.stringify(routine, null, 2),
    "utf8"
  );
  return routine;
}

export async function loadRoutine(
  id: string,
  cwd = process.cwd()
): Promise<Routine | null> {
  try {
    const raw = await fs.readFile(routinePath(id, cwd), "utf8");
    return JSON.parse(raw) as Routine;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

export async function listRoutines(cwd = process.cwd()): Promise<Routine[]> {
  await ensureRoutinesDir(cwd);
  const files = await fs.readdir(routinesDir(cwd));
  const out: Routine[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const r = await loadRoutine(f.replace(/\.json$/, ""), cwd);
    if (r) out.push(r);
  }
  return out;
}

export async function deleteRoutine(
  id: string,
  cwd = process.cwd()
): Promise<boolean> {
  try {
    await fs.unlink(routinePath(id, cwd));
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return false;
    throw err;
  }
}

export function hasTerminalGithubEvent(trigger: RoutineTrigger): boolean {
  if (trigger.type !== "github") return false;
  return trigger.events.some((e) => TERMINAL_EVENTS.has(e));
}

/**
 * Apply a wake: self-delete finite watches on terminal github events
 * or when expiresAt has passed.
 */
export async function handleRoutineWake(
  routine: Routine,
  opts: { now?: Date; event?: string } = {},
  cwd = process.cwd()
): Promise<{ deleted: boolean; routine: Routine | null }> {
  const now = opts.now ?? new Date();

  if (routine.expiresAt && new Date(routine.expiresAt).getTime() <= now.getTime()) {
    await deleteRoutine(routine.id, cwd);
    return { deleted: true, routine: null };
  }

  if (
    routine.trigger.type === "github" &&
    opts.event &&
    TERMINAL_EVENTS.has(opts.event) &&
    (routine.trigger as GithubTrigger).events.includes(opts.event)
  ) {
    await deleteRoutine(routine.id, cwd);
    return { deleted: true, routine: null };
  }

  return { deleted: false, routine };
}

/** Sweep expired routines. */
export async function sweepExpiredRoutines(
  now = new Date(),
  cwd = process.cwd()
): Promise<string[]> {
  const deleted: string[] = [];
  for (const r of await listRoutines(cwd)) {
    if (r.expiresAt && new Date(r.expiresAt).getTime() <= now.getTime()) {
      await deleteRoutine(r.id, cwd);
      deleted.push(r.id);
    }
  }
  return deleted;
}
