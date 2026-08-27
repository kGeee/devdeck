import { promises as fs } from "node:fs";
import path from "node:path";
import type { LaneDef, LoadedPackFile, LoadedPacks, PackManifest } from "./types";
import { packsRoot } from "./paths";

export function buildLaneRegistry(lanes: LaneDef[]): Map<string, LaneDef> {
  const map = new Map<string, LaneDef>();
  for (const lane of lanes) {
    map.set(lane.id, lane);
    map.set(lane.name.toLowerCase(), lane);
  }
  return map;
}

export function getLaneByName(
  registry: Map<string, LaneDef>,
  name: string
): LaneDef | undefined {
  const direct = registry.get(name.toLowerCase());
  if (direct) return direct;
  for (const lane of new Set(registry.values())) {
    if (lane.name.toLowerCase() === name.toLowerCase()) return lane;
    if (lane.id.toLowerCase() === name.toLowerCase()) return lane;
  }
  return undefined;
}

export function runtimeLanes(registry: Map<string, LaneDef>): LaneDef[] {
  const seen = new Set<string>();
  const out: LaneDef[] = [];
  for (const lane of registry.values()) {
    if (seen.has(lane.id)) continue;
    seen.add(lane.id);
    if (lane.runtime) out.push(lane);
  }
  return out;
}

export async function loadPacks(cwd = process.cwd()): Promise<LoadedPacks> {
  const root = packsRoot(cwd);
  const raw = await fs.readFile(path.join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as PackManifest;

  const files: LoadedPackFile[] = [];
  for (const rel of manifest.loadOrder) {
    const full = path.join(root, rel);
    const content = await fs.readFile(full, "utf8");
    files.push({ path: rel, content });
  }

  const lanes = buildLaneRegistry(manifest.lanes);
  return { manifest, files, lanes };
}
