import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DesignEdge,
  DesignFile,
  DesignFolder,
  DesignFolderEdge,
  DesignGraph,
  DesignPackage,
  FileKind,
  SourceLang,
} from "./types";

/**
 * Builds a project's structural graph by walking its directory and reading
 * import statements.
 *
 * Regex-based rather than AST-based on purpose: a full parse of budgetr's 1100+
 * TypeScript files would need a real toolchain dependency and take orders of
 * magnitude longer to produce the same node-and-edge picture. Import statements
 * are regular enough in practice that the tradeoff is worth it. The known cost
 * is that a `from "..."` inside a comment or string counts as an edge; that is
 * acceptable noise for an architectural overview.
 */

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  "vendor",
  "Pods",
  ".venv",
  "venv",
  "__pycache__",
  ".devdeck",
  ".expo",
  "DerivedData",
]);

/** Extensions we read for imports. */
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
/** Extensions that become nodes but are never parsed. */
const OTHER_EXT = new Set([
  ".swift",
  ".py",
  ".css",
  ".scss",
  ".json",
  ".md",
  ".sql",
  ".sh",
  ".toml",
  ".yml",
  ".yaml",
]);

/** Hard ceiling so a stray huge directory cannot hang the scan. */
const MAX_FILES = 6000;
/** Files above this are counted but not read for imports. */
const MAX_PARSE_BYTES = 512 * 1024;

function langOf(ext: string): SourceLang {
  if (ext === ".ts" || ext === ".tsx") return "ts";
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".swift") return "swift";
  if (ext === ".py") return "python";
  return "other";
}

/**
 * Role of a file from its path. Ordered most-specific first: a test inside
 * components/ is a test, not a component.
 */
function kindOf(rel: string): FileKind {
  const p = rel.toLowerCase();
  const base = path.basename(p);

  if (/\.(test|spec)\.[a-z]+$/.test(base) || p.includes("__tests__/")) return "test";
  if (/\.d\.ts$/.test(base) || base === "types.ts" || p.includes("/types/")) return "type";
  if (/\.(css|scss|sass|less)$/.test(base)) return "style";
  if (
    /^(next|vite|tailwind|postcss|eslint|drizzle|vitest|jest|babel|rollup|tsup|astro|nuxt|svelte|metro|expo)\./.test(base) ||
    base === "tsconfig.json" ||
    base === "package.json" ||
    /\.(toml|yml|yaml)$/.test(base)
  ) {
    return "config";
  }
  if (p.includes("/api/") && /^route\.[a-z]+$/.test(base)) return "api";
  if (/^(page|layout|template|loading|error|not-found|route)\.[a-z]+$/.test(base)) return "route";
  if (p.startsWith("app/") || p.includes("/app/") || p.startsWith("pages/")) return "route";
  if (p.startsWith("components/") || p.includes("/components/")) return "component";
  if (/^use[A-Z]/.test(path.basename(rel)) || p.includes("/hooks/")) return "hook";
  if (p.startsWith("scripts/") || p.includes("/scripts/")) return "script";
  if (p.startsWith("lib/") || p.includes("/lib/") || p.startsWith("src/")) return "lib";
  if (/\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/.test(base)) return "asset";
  return "other";
}

/**
 * Exported symbol names, in source order.
 *
 * Deliberately shallow: this feeds search and orientation, not a compiler.
 * Missing an unusual export shape costs a search hit, not correctness.
 */
function extractSymbols(source: string): string[] {
  const names: string[] = [];
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (!names.includes(m[1])) names.push(m[1]);
    }
  }
  return names.slice(0, 60);
}

/**
 * The file's leading doc comment, flattened to a sentence or two.
 *
 * Only a block comment in the first few lines counts: a comment further down
 * describes a function, not the file, and would mislead search.
 */
function extractDoc(source: string): string | null {
  const head = source.slice(0, 4000);
  const match = head.match(/\/\*\*?([\s\S]*?)\*\//);
  if (!match) {
    // Fall back to a run of leading line comments.
    const lines: string[] = [];
    for (const line of head.split("\n").slice(0, 12)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) lines.push(trimmed.replace(/^\/+\s?/, ""));
      else if (lines.length > 0) break;
      else if (trimmed.length > 0) break;
    }
    const joined = lines.join(" ").trim();
    return joined.length > 12 ? joined.slice(0, 400) : null;
  }
  // Only trust it when it sits at the top of the file.
  if (head.slice(0, match.index ?? 0).replace(/["'a-zA-Z0-9]/g, "").length !== (match.index ?? 0)) {
    if ((match.index ?? 0) > 400) return null;
  }
  const text = match[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("@"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 12 ? text.slice(0, 400) : null;
}

/** Import specifiers in a source file. Cheap, tolerant, order-preserving. */
function extractSpecifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /^\s*import\s+["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) found.push(m[1]);
  }
  return found;
}

/**
 * Path aliases declared by one tsconfig/jsconfig, scoped to its directory.
 *
 * A monorepo has no single answer here: budgetr declares "@/*" separately in
 * web/, mobile/ and each package, and has no root tsconfig at all. Reading only
 * the project root would leave every "@/..." import unresolved and silently
 * counted as an external package, which is exactly what it did before.
 */
interface AliasScope {
  /** Directory of the config, relative to the project root; "" at the root. */
  dir: string;
  /** Prefix (without the trailing star) mapped to target prefixes. */
  map: Map<string, string[]>;
  baseUrl: string;
}

/**
 * Strip comments from JSONC without touching string contents.
 *
 * A regex cannot do this correctly here: the alias pattern every Next.js
 * project declares is "@/*", and a naive block-comment stripper reads that
 * embedded slash-star as a comment opener and swallows the rest of the file.
 * That failure is silent - the parse throws, aliases come back empty, and every
 * "@/..." import is quietly misfiled as an external package.
 */
function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        // Escape: copy the next character verbatim so an escaped quote does
        // not look like the end of the string.
        if (next !== undefined) {
          out += next;
          i++;
        }
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function parseTsconfig(raw: string): { paths: Record<string, string[]>; baseUrl: string } | null {
  // tsconfig routinely carries comments and trailing commas.
  const stripped = stripJsonComments(raw).replace(/,(\s*[}\]])/g, "$1");
  try {
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
    };
    const opts = parsed.compilerOptions ?? {};
    return {
      paths: opts.paths ?? {},
      baseUrl: typeof opts.baseUrl === "string" ? opts.baseUrl : "",
    };
  } catch {
    return null;
  }
}

/** Collect every tsconfig/jsconfig in the tree, nearest-first at lookup time. */
async function readAliasScopes(root: string, walked: Walked[]): Promise<AliasScope[]> {
  const scopes: AliasScope[] = [];

  for (const entry of walked) {
    const base = path.basename(entry.rel);
    if (base !== "tsconfig.json" && base !== "jsconfig.json") continue;

    let raw: string;
    try {
      raw = await fs.readFile(path.join(root, entry.rel), "utf8");
    } catch {
      continue;
    }
    const parsed = parseTsconfig(raw);
    if (!parsed) continue;

    const map = new Map<string, string[]>();
    for (const [pattern, targets] of Object.entries(parsed.paths)) {
      if (!Array.isArray(targets)) continue;
      map.set(
        pattern.replace(/\*$/, ""),
        targets.map((t) => String(t).replace(/\*$/, ""))
      );
    }
    if (map.size === 0) continue;

    const dir = path.dirname(entry.rel);
    scopes.push({ dir: dir === "." ? "" : dir, map, baseUrl: parsed.baseUrl });
  }

  // Deepest first, so a file under web/ sees web/tsconfig.json before the root.
  return scopes.sort((a, b) => b.dir.split("/").length - a.dir.split("/").length);
}

interface Walked {
  rel: string;
  abs: string;
  bytes: number;
}

async function walk(root: string): Promise<{ files: Walked[]; truncated: boolean }> {
  const files: Walked[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return { files, truncated: true };
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXT.has(ext) && !OTHER_EXT.has(ext)) continue;

      let bytes = 0;
      try {
        bytes = (await fs.stat(abs)).size;
      } catch {
        continue;
      }
      files.push({ rel: path.relative(root, abs), abs, bytes });
    }
  }
  return { files, truncated: false };
}

/**
 * Resolve a specifier to a project-relative file, or null when it is external.
 * Extension and index candidates are tested against the walked file set rather
 * than the filesystem, so resolution costs no syscalls.
 */
function resolveSpecifier(
  spec: string,
  fromRel: string,
  known: Set<string>,
  scopes: AliasScope[]
): string | null {
  if (!spec.startsWith(".")) {
    // Try the nearest enclosing config first, then widen outwards.
    for (const scope of scopes) {
      if (scope.dir !== "" && !fromRel.startsWith(scope.dir + "/")) continue;
      for (const [prefix, targets] of scope.map) {
        if (!prefix || !spec.startsWith(prefix)) continue;
        const rest = spec.slice(prefix.length);
        for (const t of targets) {
          const candidate = path.normalize(path.join(scope.dir, scope.baseUrl, t, rest));
          const hit = matchCandidate(candidate, known);
          if (hit) return hit;
        }
      }
    }
    return null; // bare package
  }

  const target = path.normalize(path.join(path.dirname(fromRel), spec));
  if (target.startsWith("..")) return null; // outside the project
  return matchCandidate(target, known);
}

const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function matchCandidate(base: string, known: Set<string>): string | null {
  const normalized = base.replace(/^\.\//, "");
  if (known.has(normalized)) return normalized;
  for (const ext of RESOLVE_EXT) {
    if (known.has(normalized + ext)) return normalized + ext;
  }
  for (const ext of RESOLVE_EXT) {
    const idx = path.join(normalized, "index" + ext);
    if (known.has(idx)) return idx;
  }
  return null;
}

/** Package name from a bare specifier: "@scope/pkg/sub" becomes "@scope/pkg". */
function packageOf(spec: string): string {
  const parts = spec.split("/");
  if (spec.startsWith("@") && parts.length >= 2) return parts[0] + "/" + parts[1];
  return parts[0];
}

/** Count strongly-connected groups larger than one node: import cycles. */
function countCycles(files: DesignFile[]): number {
  const index = new Map<string, number>();
  files.forEach((f, i) => index.set(f.path, i));
  const adjacency = files.map((f) =>
    f.imports.map((t) => index.get(t)).filter((n): n is number => n != null)
  );

  const idx = new Array<number>(files.length).fill(-1);
  const low = new Array<number>(files.length).fill(0);
  const onStack = new Array<boolean>(files.length).fill(false);
  const stack: number[] = [];
  let counter = 0;
  let cycles = 0;

  // Iterative Tarjan: the recursive form blows the call stack on large projects.
  for (let start = 0; start < files.length; start++) {
    if (idx[start] !== -1) continue;
    const work: { node: number; edge: number }[] = [{ node: start, edge: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame.node;

      if (frame.edge === 0) {
        idx[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = true;
      }

      let recursed = false;
      while (frame.edge < adjacency[v].length) {
        const w = adjacency[v][frame.edge++];
        if (idx[w] === -1) {
          work.push({ node: w, edge: 0 });
          recursed = true;
          break;
        }
        if (onStack[w]) low[v] = Math.min(low[v], idx[w]);
      }
      if (recursed) continue;

      if (low[v] === idx[v]) {
        let size = 0;
        for (;;) {
          const w = stack.pop() as number;
          onStack[w] = false;
          size++;
          if (w === v) break;
        }
        if (size > 1) cycles++;
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low[parent] = Math.min(low[parent], low[v]);
      }
    }
  }
  return cycles;
}

export async function buildDesignGraph(
  project: string,
  root: string
): Promise<DesignGraph> {
  const started = Date.now();
  const { files: walked, truncated } = await walk(root);
  const scopes = await readAliasScopes(root, walked);
  const known = new Set(walked.map((w) => w.rel));

  const files: DesignFile[] = [];
  const edges: DesignEdge[] = [];
  const packageUse = new Map<string, number>();

  for (const entry of walked) {
    const ext = path.extname(entry.rel).toLowerCase();
    const parseable = CODE_EXT.has(ext) && entry.bytes <= MAX_PARSE_BYTES;

    let source = "";
    if (parseable) {
      try {
        source = await fs.readFile(entry.abs, "utf8");
      } catch {
        source = "";
      }
    }

    const imports: string[] = [];
    const externals = new Set<string>();
    if (source) {
      for (const spec of extractSpecifiers(source)) {
        const resolved = resolveSpecifier(spec, entry.rel, known, scopes);
        if (resolved && resolved !== entry.rel) {
          if (!imports.includes(resolved)) imports.push(resolved);
        } else if (!resolved && !spec.startsWith(".")) {
          externals.add(packageOf(spec));
        }
      }
    }

    for (const pkg of externals) {
      packageUse.set(pkg, (packageUse.get(pkg) ?? 0) + 1);
    }
    for (const target of imports) edges.push({ from: entry.rel, to: target });

    const dir = path.dirname(entry.rel);
    files.push({
      path: entry.rel,
      dir: dir === "." ? "" : dir,
      kind: kindOf(entry.rel),
      lang: langOf(ext),
      loc: source ? source.split("\n").length : 0,
      bytes: entry.bytes,
      imports,
      externals: [...externals],
      symbols: source ? extractSymbols(source) : [],
      doc: source ? extractDoc(source) : null,
      fanIn: 0,
    });
  }

  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const edge of edges) {
    const target = byPath.get(edge.to);
    if (target) target.fanIn++;
  }

  const orphans = files.filter(
    (f) => f.fanIn === 0 && f.imports.length === 0 && f.lang !== "other"
  ).length;

  const packages: DesignPackage[] = [...packageUse.entries()]
    .map(([name, used]) => ({ name, used }))
    .sort((a, b) => b.used - a.used);

  return {
    project,
    builtAt: Date.now(),
    durationMs: Date.now() - started,
    root,
    files,
    edges,
    packages,
    stats: {
      fileCount: files.length,
      loc: files.reduce((sum, f) => sum + f.loc, 0),
      edgeCount: edges.length,
      orphans,
      cycles: countCycles(files),
      truncated,
    },
  };
}

/** Separator for aggregated edge keys. Paths never contain it. */
const EDGE_KEY = "::";

/**
 * Roll files up to directories at a given depth.
 *
 * This is the default view: budgetr has over a thousand files, so a file-level
 * picture is neither readable nor cheap to lay out. Folders are the level at
 * which a project's design is actually legible.
 */
export function rollUp(
  graph: DesignGraph,
  depth: number
): { folders: DesignFolder[]; edges: DesignFolderEdge[] } {
  const keyFor = (rel: string): string => {
    const dir = path.dirname(rel);
    if (dir === ".") return "(root)";
    return dir.split("/").slice(0, Math.max(1, depth)).join("/");
  };

  const folders = new Map<
    string,
    { files: number; loc: number; kinds: Map<FileKind, number> }
  >();
  for (const file of graph.files) {
    const key = keyFor(file.path);
    let bucket = folders.get(key);
    if (!bucket) {
      bucket = { files: 0, loc: 0, kinds: new Map() };
      folders.set(key, bucket);
    }
    bucket.files++;
    bucket.loc += file.loc;
    bucket.kinds.set(file.kind, (bucket.kinds.get(file.kind) ?? 0) + 1);
  }

  const edgeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    const from = keyFor(edge.from);
    const to = keyFor(edge.to);
    // Internal cohesion is not a relationship between folders.
    if (from === to) continue;
    const id = from + EDGE_KEY + to;
    edgeCounts.set(id, (edgeCounts.get(id) ?? 0) + 1);
  }

  return {
    folders: [...folders.entries()]
      .map(([p, b]) => ({
        path: p,
        files: b.files,
        loc: b.loc,
        kind:
          ([...b.kinds.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ??
            "other") as FileKind,
      }))
      .sort((a, b) => b.loc - a.loc),
    edges: [...edgeCounts.entries()].map(([id, count]) => {
      const [from, to] = id.split(EDGE_KEY);
      return { from, to, count };
    }),
  };
}
