import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActionInput, ActionInputType, ProjectAction } from "./types";

/**
 * Project-declared actions.
 *
 * Read from `devdeck.json` at the project root, falling back to a "devdeck"
 * key in package.json. Two sources rather than one because a monorepo often has
 * no root package.json at all (budgetr is exactly this - its scripts live in
 * web/package.json), so keying off package.json alone would leave those
 * projects with nowhere to declare anything.
 *
 * Trust boundary: the command comes from a file inside the user's own project,
 * the same trust level as the package.json scripts DevDeck already runs. What
 * is NOT trusted is the input values typed in the browser. Those are validated
 * against the declared type here and then passed as separate argv elements to a
 * spawn with `shell: false`, so a value can never become a second command.
 */

const MAX_ACTIONS = 24;
const MAX_INPUTS = 8;
const MAX_ARGS = 32;
/** Long enough for a branch name or a message, short enough to stay sane. */
const MAX_VALUE = 500;

const INPUT_TYPES: ActionInputType[] = ["string", "select", "boolean", "branch"];

/**
 * Control characters have no business in argv: they would corrupt the log
 * output and can hide what a command actually is. Checked by code point rather
 * than a regex so the source file itself stays free of them.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function parseInput(raw: unknown): ActionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const name = str(o.name);
  // The name becomes a "{placeholder}", so keep it to a safe identifier.
  if (!name || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return null;

  const type = (str(o.type) ?? "string") as ActionInputType;
  if (!INPUT_TYPES.includes(type)) return null;

  const options = Array.isArray(o.options)
    ? o.options.filter((v): v is string => typeof v === "string").slice(0, 50)
    : [];
  if (type === "select" && options.length === 0) return null;

  let pattern = str(o.pattern);
  if (pattern) {
    // A malformed regex here would otherwise throw at validation time,
    // mid-request, on every run of the action.
    try {
      new RegExp(pattern);
    } catch {
      pattern = null;
    }
  }

  return {
    name,
    label: str(o.label) ?? name,
    type,
    required: o.required !== false,
    placeholder: str(o.placeholder),
    pattern,
    options,
    defaultValue: str(o.default) ?? str(o.defaultValue),
    flag: str(o.flag),
  };
}

function parseAction(raw: unknown): ProjectAction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const id = str(o.id);
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) return null;

  const command = str(o.command);
  if (!command || hasControlChars(command)) return null;

  const args = Array.isArray(o.args)
    ? o.args
        .filter((v): v is string => typeof v === "string" && !hasControlChars(v))
        .slice(0, MAX_ARGS)
    : [];

  const inputs: ActionInput[] = [];
  if (Array.isArray(o.inputs)) {
    for (const entry of o.inputs.slice(0, MAX_INPUTS)) {
      const parsed = parseInput(entry);
      if (parsed && !inputs.some((i) => i.name === parsed.name)) inputs.push(parsed);
    }
  }

  return {
    id,
    label: str(o.label) ?? id,
    description: str(o.description),
    command,
    args,
    inputs,
    confirm: str(o.confirm),
    danger: o.danger === true,
    cwd: str(o.cwd),
  };
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Load and validate a project's declared actions. Never throws. */
export async function loadActions(projectPath: string): Promise<ProjectAction[]> {
  let source: unknown = null;

  const manifest = await readJson(path.join(projectPath, "devdeck.json"));
  if (manifest && Array.isArray(manifest.actions)) {
    source = manifest.actions;
  } else {
    const pkg = await readJson(path.join(projectPath, "package.json"));
    const devdeck = pkg?.devdeck as Record<string, unknown> | undefined;
    if (devdeck && Array.isArray(devdeck.actions)) source = devdeck.actions;
  }

  if (!Array.isArray(source)) return [];

  const actions: ProjectAction[] = [];
  for (const raw of source.slice(0, MAX_ACTIONS)) {
    const parsed = parseAction(raw);
    if (parsed && !actions.some((a) => a.id === parsed.id)) actions.push(parsed);
  }
  return actions;
}

export interface ResolvedCommand {
  file: string;
  args: string[];
  cwd: string;
}

/**
 * Validate submitted values against an action's declared inputs and build the
 * argv. Returns a user-facing message instead of throwing on bad input.
 */
export function resolveAction(
  action: ProjectAction,
  projectPath: string,
  values: Record<string, unknown>
): { ok: true; resolved: ResolvedCommand } | { ok: false; error: string } {
  const resolved = new Map<string, string>();

  for (const input of action.inputs) {
    const raw = values[input.name];

    if (input.type === "boolean") {
      resolved.set(input.name, raw === true || raw === "true" ? "true" : "false");
      continue;
    }

    let value = typeof raw === "string" ? raw.trim() : "";
    if (!value && input.defaultValue) value = input.defaultValue;

    if (!value) {
      if (input.required) return { ok: false, error: `"${input.label}" is required` };
      resolved.set(input.name, "");
      continue;
    }

    if (value.length > MAX_VALUE) {
      return { ok: false, error: `"${input.label}" is too long` };
    }
    if (hasControlChars(value)) {
      return { ok: false, error: `"${input.label}" contains invalid characters` };
    }
    if (input.type === "select" && !input.options.includes(value)) {
      return { ok: false, error: `"${value}" is not a valid choice for ${input.label}` };
    }
    if (input.pattern) {
      // Anchored, so a pattern like \d+\.\d+\.\d+ cannot match a substring of
      // something longer.
      if (!new RegExp(`^(?:${input.pattern})$`).test(value)) {
        return { ok: false, error: `"${input.label}" is not in the expected format` };
      }
    }

    resolved.set(input.name, value);
  }

  const byName = new Map(action.inputs.map((i) => [i.name, i]));
  const args: string[] = [];

  for (const template of action.args) {
    // A boolean placeholder contributes its flag or disappears entirely - it
    // must never land in argv as an empty string.
    const solo = template.match(/^\{([a-zA-Z][a-zA-Z0-9_]*)\}$/);
    if (solo) {
      const input = byName.get(solo[1]);
      if (input?.type === "boolean") {
        if (resolved.get(input.name) === "true" && input.flag) args.push(input.flag);
        continue;
      }
      if (input) {
        const value = resolved.get(input.name) ?? "";
        if (value) args.push(value);
        continue;
      }
      // Unknown placeholder: pass through literally rather than guessing.
      args.push(template);
      continue;
    }

    // Interpolation inside a larger element still yields ONE argv element, so
    // there is no shell to re-split it.
    args.push(
      template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, key: string) =>
        resolved.has(key) ? (resolved.get(key) as string) : whole
      )
    );
  }

  // Working directory must stay inside the project.
  const cwd = action.cwd ? path.resolve(projectPath, action.cwd) : projectPath;
  if (cwd !== projectPath && !cwd.startsWith(projectPath + path.sep)) {
    return { ok: false, error: "Action cwd escapes the project directory" };
  }

  // A command containing a separator is a path inside the project; a bare name
  // is a PATH binary (npm, bash, git).
  let file = action.command;
  if (file.includes("/")) {
    const abs = path.resolve(projectPath, file);
    if (abs !== projectPath && !abs.startsWith(projectPath + path.sep)) {
      return { ok: false, error: "Action command escapes the project directory" };
    }
    file = abs;
  }

  return { ok: true, resolved: { file, args, cwd } };
}
