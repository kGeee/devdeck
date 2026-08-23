import { promises as fs } from "node:fs";
import path from "node:path";
import type { DesignGraph } from "./types";

/**
 * On-disk cache of built design graphs.
 *
 * Scanning a project is far too slow to do per request — budgetr means walking
 * and reading a thousand files — so graphs are built once, stored, and served
 * from disk until explicitly rebuilt.
 */

function storeDir(): string {
  return path.join(process.cwd(), ".devdeck", "design");
}

/** Project names are directory basenames; keep them safe as filenames. */
function fileFor(project: string): string {
  const safe = project.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(storeDir(), `${safe}.json`);
}

export async function saveGraph(graph: DesignGraph): Promise<void> {
  await fs.mkdir(storeDir(), { recursive: true });
  await fs.writeFile(fileFor(graph.project), JSON.stringify(graph), "utf8");
}

export async function loadGraph(project: string): Promise<DesignGraph | null> {
  try {
    return JSON.parse(await fs.readFile(fileFor(project), "utf8")) as DesignGraph;
  } catch {
    return null;
  }
}

export interface GraphMeta {
  project: string;
  builtAt: number;
  fileCount: number;
  loc: number;
}

/** Which projects already have a cached graph, for the bulk-index view. */
export async function listGraphs(): Promise<GraphMeta[]> {
  let names: string[];
  try {
    names = await fs.readdir(storeDir());
  } catch {
    return [];
  }
  const out: GraphMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(storeDir(), name), "utf8");
      const g = JSON.parse(raw) as DesignGraph;
      out.push({
        project: g.project,
        builtAt: g.builtAt,
        fileCount: g.stats.fileCount,
        loc: g.stats.loc,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => a.project.localeCompare(b.project));
}
