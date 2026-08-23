/**
 * Structural ("design") graph of a project: what modules exist and what
 * imports what. Distinct from the agent activity graph, which records what
 * agents did. This one describes the codebase itself.
 */

/** Coarse role of a file, inferred from its path. Drives colour in the graph. */
export type FileKind =
  | "route"
  | "api"
  | "component"
  | "lib"
  | "hook"
  | "style"
  | "test"
  | "config"
  | "script"
  | "type"
  | "asset"
  | "other";

export type SourceLang = "ts" | "js" | "swift" | "python" | "other";

export interface DesignFile {
  /** Path relative to the project root. The stable id for a file node. */
  path: string;
  /** Parent directory relative to the project root; "" at the root. */
  dir: string;
  kind: FileKind;
  lang: SourceLang;
  loc: number;
  bytes: number;
  /** Resolved in-project imports, as relative paths. */
  imports: string[];
  /** Bare package specifiers this file imports. */
  externals: string[];
  /** Exported symbol names, in source order. */
  symbols: string[];
  /**
   * The file's leading doc comment, if it has one. This is the single best
   * signal for what a file is for, and it is why search can answer "the gallery
   * page" without reading the file.
   */
  doc: string | null;
  /** How many in-project files import this one. */
  fanIn: number;
}

export interface DesignEdge {
  from: string;
  to: string;
}

/** A directory rolled up to a chosen depth, with its aggregate weight. */
export interface DesignFolder {
  /** Relative directory path at the rollup depth; "" is the project root. */
  path: string;
  files: number;
  loc: number;
  /** Dominant file kind inside, for colour. */
  kind: FileKind;
}

export interface DesignFolderEdge {
  from: string;
  to: string;
  /** Number of underlying file-to-file imports this edge aggregates. */
  count: number;
}

export interface DesignPackage {
  name: string;
  /** Number of project files importing it. */
  used: number;
}

export interface DesignGraph {
  project: string;
  /** Epoch ms the scan completed. */
  builtAt: number;
  /** Milliseconds the scan took, so the UI can justify caching it. */
  durationMs: number;
  root: string;
  files: DesignFile[];
  edges: DesignEdge[];
  packages: DesignPackage[];
  stats: {
    fileCount: number;
    loc: number;
    edgeCount: number;
    /** Files no in-project file imports, and which import nothing in-project. */
    orphans: number;
    /** Import cycles detected between files. */
    cycles: number;
    /** True when the walk stopped at the file cap. */
    truncated: boolean;
  };
}
