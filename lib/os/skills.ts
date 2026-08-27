import { promises as fs } from "node:fs";
import path from "node:path";
import { packsRoot } from "./paths";
import type { Skill } from "./types";

interface Frontmatter {
  name?: string;
  description?: string;
}

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const meta: Frontmatter = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key === "name") meta.name = value;
    if (key === "description") meta.description = value;
  }
  return { meta, body };
}

async function walkSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return out;
    throw err;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkSkillFiles(full)));
    } else if (ent.isFile() && ent.name === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

export async function loadSkills(cwd = process.cwd()): Promise<Skill[]> {
  const root = packsRoot(cwd);
  const skillsRoot = path.join(root, "skills");
  const files = await walkSkillFiles(skillsRoot);
  const skills: Skill[] = [];
  for (const full of files.sort()) {
    const raw = await fs.readFile(full, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.name || !meta.description) continue;
    const rel = path.relative(skillsRoot, path.dirname(full));
    skills.push({
      slug: rel.split(path.sep).join("/"),
      name: meta.name,
      description: meta.description,
      body: body.trim(),
      path: path.relative(root, full),
    });
  }
  return skills;
}

/**
 * Match skills whose description fits the task text.
 * Simple token overlap — description is the matcher per skill.md.
 */
export function matchSkills(skills: Skill[], task: string): Skill[] {
  const hay = task.toLowerCase();
  return skills.filter((s) => {
    const desc = s.description.toLowerCase();
    if (hay.includes(desc)) return true;
    const tokens = desc
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3);
    const hits = tokens.filter((t) => hay.includes(t)).length;
    return hits >= Math.min(3, Math.ceil(tokens.length * 0.35));
  });
}

export function injectSkills(skills: Skill[]): string {
  if (skills.length === 0) return "";
  return skills
    .map((s) => `## Skill: ${s.name}\n\n${s.body}`)
    .join("\n\n");
}
