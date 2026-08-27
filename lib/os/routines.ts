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

type JsonSchema = Record<string, unknown>;

/**
 * Minimal applicator for packs/routines/_schema.json (draft-ish subset:
 * type, required, properties, oneOf, const, items, description ignored).
 */
function applySchema(
  schema: JsonSchema,
  value: unknown,
  pathLabel = ""
): string[] {
  const errors: string[] = [];
  const label = pathLabel || "routine";

  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [`${label} must be an object`];
    }
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required)
      ? (schema.required as string[])
      : [];
    for (const key of required) {
      if (obj[key] === undefined) errors.push(`${label}.${key} required`);
    }
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const [key, propSchema] of Object.entries(properties)) {
      if (obj[key] === undefined) continue;
      errors.push(...applySchema(propSchema, obj[key], `${label}.${key}`));
    }
    return errors;
  }

  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as JsonSchema[];
    const branchErrors = branches.map((branch) => applySchema(branch, value, label));
    if (branchErrors.some((e) => e.length === 0)) return [];
    return [
      `${label} must match oneOf (${branches.length} variants failed)`,
      ...branchErrors.flatMap((e, i) => e.map((msg) => `  [${i}] ${msg}`)),
    ];
  }

  if ("const" in schema) {
    if (value !== schema.const) {
      errors.push(`${label} must be ${JSON.stringify(schema.const)}`);
    }
    return errors;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${label} must be a string`);
    return errors;
  }

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${label} must be a boolean`);
    return errors;
  }

  if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push(`${label} must be an integer`);
    }
    return errors;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${label} must be an array`);
      return errors;
    }
    const items = schema.items as JsonSchema | undefined;
    if (items) {
      value.forEach((item, i) => {
        errors.push(...applySchema(items, item, `${label}[${i}]`));
      });
    }
    return errors;
  }

  return errors;
}

/** DevDeck rules JSON Schema does not express well. */
function applyDevDeckExtras(input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const trigger = input.trigger;
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) {
    return errors;
  }
  const t = trigger as Record<string, unknown>;
  if (t.type === "github") {
    if (typeof t.repo === "string" && t.repo.includes("*")) {
      errors.push("github trigger requires concrete repo owner/name (no wildcard)");
    }
    if (Array.isArray(t.events)) {
      if (t.events.length === 0) {
        errors.push("github trigger events must be non-empty");
      } else if (!t.events.every((e) => typeof e === "string" && e.length > 0)) {
        errors.push("github events must be non-empty strings");
      }
    }
  }
  if (t.type === "cron" && typeof t.schedule === "string" && t.schedule.trim() === "") {
    errors.push("cron schedule must be non-empty");
  }
  return errors;
}

/**
 * Validate against packs/routines/_schema.json plus DevDeck extras.
 * Pass the schema from `loadRoutineSchema` so the loader is not dead coverage.
 */
export function validateRoutine(
  input: unknown,
  schema: Record<string, unknown>
): RoutineValidation {
  const schemaErrors = applySchema(schema, input);
  const extraErrors =
    input && typeof input === "object" && !Array.isArray(input)
      ? applyDevDeckExtras(input as Record<string, unknown>)
      : [];
  const errors = [...schemaErrors, ...extraErrors];
  return errors.length ? { ok: false, errors } : { ok: true };
}

export async function validateRoutineFromPacks(
  input: unknown,
  cwd = process.cwd()
): Promise<RoutineValidation> {
  const schema = await loadRoutineSchema(cwd);
  return validateRoutine(input, schema);
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
  const schema = await loadRoutineSchema(cwd);
  const validation = validateRoutine(input, schema);
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
