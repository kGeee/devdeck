import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageManager, ProjectInfo } from "./types";
import { getManualPaths, getPortOverrides } from "./manual";

/**
 * Root directory we scan for projects. Defaults to the parent of this
 * dashboard's own directory (the dashboard lives in one of the project
 * folders). Override with DEVDECK_ROOT.
 */
export function getScanRoot(): string {
  if (process.env.DEVDECK_ROOT) return path.resolve(process.env.DEVDECK_ROOT);
  return path.resolve(process.cwd(), "..");
}

/** Directory name of the dashboard itself, so we can exclude it from the list. */
function selfName(): string {
  return path.basename(process.cwd());
}

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  ".turbo",
]);

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(dir: string): Promise<PackageManager | null> {
  if (await exists(path.join(dir, "bun.lockb"))) return "bun";
  if (await exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(dir, "yarn.lock"))) return "yarn";
  if (await exists(path.join(dir, "package-lock.json"))) return "npm";
  return null;
}

/** Pull a port out of a dev script like "next dev -p 4000" or "vite --port 5000". */
function parsePort(command: string): number | null {
  const m = command.match(/(?:-p|--port)[=\s]+(\d{2,5})/);
  if (m) return Number(m[1]);
  const env = command.match(/PORT[=\s]+(\d{2,5})/);
  if (env) return Number(env[1]);
  return null;
}

function guessFramework(
  command: string,
  deps: Record<string, string>
): string | null {
  if (/\bnext\b/.test(command) || deps.next) return "next";
  if (/\bvite\b/.test(command) || deps.vite) return "vite";
  if (/\bastro\b/.test(command) || deps.astro) return "astro";
  if (/\bremix\b/.test(command)) return "remix";
  if (/\bnuxt\b/.test(command) || deps.nuxt) return "nuxt";
  if (/\bnest\b/.test(command)) return "nest";
  if (/\b(tsx|ts-node|nodemon|node)\b/.test(command)) return "node";
  return null;
}

async function readProject(
  dir: string,
  name: string,
  manual: boolean
): Promise<ProjectInfo> {
  const pkgPath = path.join(dir, "package.json");
  const base: ProjectInfo = {
    name,
    path: dir,
    packageManager: null,
    scripts: {},
    devScript: null,
    declaredPort: null,
    framework: null,
    runnable: false,
    manual,
    portOverride: null,
  };

  if (!(await exists(pkgPath))) return base;

  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  } catch {
    return base;
  }

  const scripts = pkg.scripts ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  // Prefer "dev", then "start", then "serve".
  const devScript =
    ["dev", "start", "serve"].find((s) => scripts[s]) ?? null;
  const devCommand = devScript ? scripts[devScript] : "";

  const framework = guessFramework(devCommand, deps);
  const declaredPort = parsePort(devCommand);

  return {
    ...base,
    packageManager: await detectPackageManager(dir),
    scripts,
    devScript,
    declaredPort,
    framework,
    runnable: Boolean(devScript),
  };
}

/** Scan the root for immediate sub-directories that look like projects. */
export async function scanProjects(): Promise<ProjectInfo[]> {
  const root = getScanRoot();
  const self = selfName();
  const selfPath = process.cwd();

  let entries: string[] = [];
  try {
    const dirents = await fs.readdir(root, { withFileTypes: true });
    entries = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !IGNORE.has(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }

  const scanned = await Promise.all(
    entries.map((name) => readProject(path.join(root, name), name, false))
  );

  // Projects the user added by hand (may live anywhere on disk).
  const manualPaths = await getManualPaths();
  const manual = await Promise.all(
    manualPaths.map((p) => readProject(p, path.basename(p), true))
  );

  const portOverrides = await getPortOverrides();

  // Merge, excluding the dashboard itself and de-duplicating by both resolved
  // path and name (name is the stable id used in URLs and React keys). Scanned
  // projects are processed first, so they win any name/path collision.
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();
  const merged: ProjectInfo[] = [];
  for (const p of [...scanned, ...manual]) {
    const key = path.resolve(p.path);
    if (key === path.resolve(selfPath) || p.name === self) continue;
    if (seenPaths.has(key) || seenNames.has(p.name)) continue;
    seenPaths.add(key);
    seenNames.add(p.name);
    merged.push({ ...p, portOverride: portOverrides[p.name] ?? null });
  }

  return merged.sort((a, b) => {
    // Runnable projects first, then alphabetical.
    if (a.runnable !== b.runnable) return a.runnable ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function findProject(name: string): Promise<ProjectInfo | null> {
  const all = await scanProjects();
  return all.find((p) => p.name === name) ?? null;
}

/**
 * CLI args to forward to a dev script (after `--`) to force it onto a given
 * port. The flag name depends on the framework; for frameworks/binaries that
 * read the PORT env var instead of a flag we return no args and rely on env.
 */
export function devPortArgs(framework: string | null, port: number): string[] {
  switch (framework) {
    case "next":
      return ["-p", String(port)];
    case "vite":
    case "astro":
    case "nuxt":
    case "remix":
      return ["--port", String(port)];
    default:
      // node / nest / unknown: rely on the PORT env var.
      return [];
  }
}
