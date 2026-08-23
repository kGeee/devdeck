import type { DesignFile, DesignGraph } from "./types";

/**
 * Search a project's design graph by intent.
 *
 * The point is to answer "where is the gallery page" without reading a single
 * file: the scan already captured each file's path, exported symbols and
 * leading doc comment, which together describe what a file is for. A result
 * carries its neighbours too, so one query returns an orientation map rather
 * than a filename - that is what makes it possible to skip the broad glob and
 * read only what matters.
 */

/**
 * Conversational filler that carries no location signal. Kept deliberately
 * short: over-trimming is worse than a little noise, because a dropped term
 * like "page" or "api" is exactly the one that finds the file.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "into", "its", "it", "is", "are", "be", "this", "that", "these",
  "i", "ill", "im", "we", "lets", "let", "you", "your", "my",
  "start", "starting", "begin", "look", "looking", "check", "checking", "see",
  "first", "then", "next", "now", "current", "currently", "existing",
  "implementation", "implement", "code", "codebase", "file", "files", "some",
  "how", "what", "where", "which", "does", "do", "make", "sure", "up",
]);

/** Split a token into sub-words: "GalleryPage" and "gallery-page" both split. */
function subWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 1);
}

export function tokenize(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const token of raw) {
    if (STOPWORDS.has(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

export interface SearchHit {
  path: string;
  kind: string;
  lang: string;
  loc: number;
  fanIn: number;
  doc: string | null;
  symbols: string[];
  score: number;
  /** Why this ranked: which signals matched. Keeps results auditable. */
  matched: string[];
  /** In-project files this one imports. */
  imports: string[];
  /** In-project files that import this one. */
  importedBy: string[];
}

interface Scored {
  file: DesignFile;
  score: number;
  matched: Set<string>;
}

/**
 * Weights. Path beats prose on purpose: a file literally named gallery/page.tsx
 * is a stronger answer than one whose comment happens to mention galleries.
 */
const W_BASENAME = 6;
const W_DIR = 4;
const W_SYMBOL = 4;
const W_DOC = 2;
const W_PHRASE = 8;

export function searchDesign(
  graph: DesignGraph,
  query: string,
  limit = 12
): { tokens: string[]; hits: SearchHit[] } {
  const tokens = tokenize(query);
  if (tokens.length === 0) return { tokens, hits: [] };

  // Files that import a given file, for the neighbourhood in each result.
  const importedBy = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = importedBy.get(edge.to);
    if (list) list.push(edge.from);
    else importedBy.set(edge.to, [edge.from]);
  }

  const phrase = tokens.join(" ");
  const scored: Scored[] = [];

  for (const file of graph.files) {
    const baseWords = subWords(file.path.split("/").pop() ?? "");
    const dirWords = subWords(file.dir);
    const symbolWords = new Set(file.symbols.flatMap(subWords));
    const docWords = file.doc ? new Set(subWords(file.doc)) : null;

    let score = 0;
    const matched = new Set<string>();

    for (const token of tokens) {
      if (baseWords.includes(token)) {
        score += W_BASENAME;
        matched.add("name");
      }
      if (dirWords.includes(token)) {
        score += W_DIR;
        matched.add("path");
      }
      if (symbolWords.has(token)) {
        score += W_SYMBOL;
        matched.add("symbol");
      }
      if (docWords?.has(token)) {
        score += W_DOC;
        matched.add("doc");
      }
    }

    if (score === 0) continue;

    // Adjacent query terms appearing together in the path is a strong signal:
    // "gallery page" should beat a file matching only "page".
    const pathWords = [...dirWords, ...baseWords].join(" ");
    if (tokens.length > 1 && pathWords.includes(phrase)) {
      score += W_PHRASE;
      matched.add("phrase");
    }

    // Break ties toward files the project actually depends on, and away from
    // tests, which otherwise crowd out the implementation they cover.
    score += Math.min(4, Math.log2(1 + file.fanIn) * 1.5);
    if (file.kind === "test") score *= 0.5;

    scored.push({ file, score, matched });
  }

  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  return {
    tokens,
    hits: scored.slice(0, limit).map(({ file, score, matched }) => ({
      path: file.path,
      kind: file.kind,
      lang: file.lang,
      loc: file.loc,
      fanIn: file.fanIn,
      doc: file.doc,
      symbols: file.symbols.slice(0, 12),
      score: Math.round(score * 100) / 100,
      matched: [...matched],
      imports: file.imports.slice(0, 12),
      importedBy: (importedBy.get(file.path) ?? []).slice(0, 12),
    })),
  };
}
