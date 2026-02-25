/**
 * File discovery with glob and language detection.
 * Supports incremental scanning via fingerprint diffing.
 */

import { readFileSync, statSync } from "node:fs";
import { extname, relative } from "node:path";
import { glob } from "glob";
import type { ScanConfig, SupportedLanguage } from "../schema/types.js";
import type { DiscoveredFile, FingerprintStore } from "./types.js";
import { computeFingerprint, diffFingerprints } from "./fingerprint.js";

// ── Language detection ──

const EXT_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  // Generic / config
  ".json": "generic",
  ".env": "generic",
  ".toml": "generic",
  ".yaml": "generic",
  ".yml": "generic",
  ".dockerfile": "generic",
};

const BASENAME_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  Dockerfile: "generic",
  ".env": "generic",
  "go.mod": "go",
  "go.sum": "go",
  "package.json": "generic",
  "tsconfig.json": "generic",
  "pyproject.toml": "generic",
  "requirements.txt": "generic",
};

export function detectLanguage(filePath: string): SupportedLanguage {
  const base = filePath.split("/").pop() ?? filePath;

  // Exact basename match first (handles Dockerfile, .env, etc.)
  if (BASENAME_TO_LANGUAGE[base]) {
    return BASENAME_TO_LANGUAGE[base];
  }

  const ext = extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? "generic";
}

// ── Default exclude patterns ──

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/vendor/**",
  "**/.btmg/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/out/**",
];

// ── Public API ──

export interface DiscoverResult {
  /** All discovered files (full scan or filtered to changed/added when incremental) */
  files: DiscoveredFile[];
  /** Relative paths of files that changed vs the previous fingerprint store */
  changed: string[];
  /** Relative paths of files that were removed since the previous store */
  removed: string[];
  /** Current fingerprint store (computed during discovery, ready to save) */
  currentFingerprints: FingerprintStore;
}

/**
 * Discover files under projectRoot according to ScanConfig.
 * When previousFingerprints is supplied only changed/added files are returned in `files`,
 * but the full currentFingerprints store is always computed so it can be saved.
 */
export async function discoverFiles(
  projectRoot: string,
  config: ScanConfig,
  previousFingerprints?: FingerprintStore | null
): Promise<DiscoverResult> {
  const includes = config.include?.length
    ? config.include
    : ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go", "**/*.json", "**/*.env", "**/Dockerfile", "**/go.mod"];

  const excludes = [...DEFAULT_EXCLUDES, ...(config.exclude ?? [])];

  // Collect all matching paths
  const rawPaths = await glob(includes, {
    cwd: projectRoot,
    absolute: true,
    ignore: excludes,
    nodir: true,
    dot: true,
  });

  // Build full current fingerprint store
  const currentFingerprints: FingerprintStore = {};
  const allDiscovered: DiscoveredFile[] = [];

  for (const absolutePath of rawPaths) {
    const relativePath = relative(projectRoot, absolutePath);

    let content: Buffer;
    let size: number;
    let mtime: number;

    try {
      const st = statSync(absolutePath);
      size = st.size;
      mtime = st.mtimeMs;
      content = readFileSync(absolutePath);
    } catch {
      // File disappeared between glob and stat — skip
      continue;
    }

    const fp = computeFingerprint(relativePath, content);
    currentFingerprints[relativePath] = fp;

    const language = detectLanguage(relativePath);

    // Filter by requested languages when specified
    if (config.languages?.length && !config.languages.includes(language)) {
      continue;
    }

    allDiscovered.push({
      absolutePath,
      relativePath,
      language,
      size,
      mtime,
    });
  }

  // Compute diff against previous store
  let changed: string[] = [];
  let removed: string[] = [];
  let filesToReturn: DiscoveredFile[];

  if (previousFingerprints) {
    const diff = diffFingerprints(previousFingerprints, currentFingerprints);
    changed = diff.changed;
    removed = diff.removed;

    const changedSet = new Set([...diff.changed, ...diff.added]);
    filesToReturn = allDiscovered.filter((f) => changedSet.has(f.relativePath));
  } else {
    // Full scan — return everything
    filesToReturn = allDiscovered;
    changed = [];
    removed = [];
  }

  return {
    files: filesToReturn,
    changed,
    removed,
    currentFingerprints,
  };
}
