import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Persistent store for project paths the user adds by hand (projects that live
 * outside the scanned root). Kept as a small JSON file so the list survives
 * restarts. Override the location with DEVDECK_CONFIG.
 */
function storePath(): string {
  if (process.env.DEVDECK_CONFIG) return path.resolve(process.env.DEVDECK_CONFIG);
  return path.join(process.cwd(), ".devdeck", "projects.json");
}

/** Expand a leading "~" and resolve to an absolute path. */
export function resolveInput(input: string): string {
  const trimmed = input.trim();
  const expanded =
    trimmed === "~" || trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(1))
      : trimmed;
  return path.resolve(expanded);
}

/**
 * On-disk shape. `paths` are manually-added project folders; `ports` maps a
 * project name to the dev-server port the user wants it run on.
 */
interface Store {
  paths: string[];
  ports: Record<string, number>;
}

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(storePath(), "utf8");
    const data = JSON.parse(raw);
    const paths = Array.isArray(data?.paths)
      ? data.paths.filter((p: unknown): p is string => typeof p === "string")
      : [];
    const ports: Record<string, number> = {};
    if (data?.ports && typeof data.ports === "object") {
      for (const [name, port] of Object.entries(data.ports)) {
        if (typeof port === "number" && Number.isInteger(port)) ports[name] = port;
      }
    }
    return { paths, ports };
  } catch {
    return { paths: [], ports: {} };
  }
}

async function writeStore(store: Store): Promise<void> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export async function getManualPaths(): Promise<string[]> {
  return (await readStore()).paths;
}

/**
 * Validate and persist a new manual project path. Returns the resolved absolute
 * path. Throws with a user-facing message if the path is missing or not a
 * directory.
 */
export async function addManualPath(input: string): Promise<string> {
  if (!input || !input.trim()) throw new Error("Path is required");
  const resolved = resolveInput(input);

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);

  const store = await readStore();
  if (!store.paths.includes(resolved)) {
    store.paths.push(resolved);
    await writeStore(store);
  }
  return resolved;
}

/**
 * Remove a manual project, identified by its absolute path or directory name.
 * Returns true if an entry was removed.
 */
export async function removeManualPath(target: string): Promise<boolean> {
  const store = await readStore();
  const next = store.paths.filter(
    (p) => p !== target && path.basename(p) !== target
  );
  if (next.length === store.paths.length) return false;
  store.paths = next;
  await writeStore(store);
  return true;
}

/** Map of project name -> user-chosen dev port. */
export async function getPortOverrides(): Promise<Record<string, number>> {
  return (await readStore()).ports;
}

/**
 * Set (or clear, when port is null) the dev port for a project. Throws if the
 * port is out of range. Returns the saved value, or null when cleared.
 */
export async function setPortOverride(
  name: string,
  port: number | null
): Promise<number | null> {
  if (port !== null) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be an integer between 1 and 65535");
    }
  }
  const store = await readStore();
  if (port === null) {
    delete store.ports[name];
  } else {
    store.ports[name] = port;
  }
  await writeStore(store);
  return port;
}
