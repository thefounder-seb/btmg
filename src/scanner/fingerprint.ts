/**
 * SHA-256 content fingerprinting for incremental scanning.
 * Persists a JSON store at <projectRoot>/.btmg/fingerprints.json.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileFingerprint, FingerprintDiff, FingerprintStore } from "./types.js";

const STORE_FILENAME = "fingerprints.json";
const BTMG_DIR = ".btmg";

/** Compute a SHA-256 fingerprint for a file given its content buffer or string. */
export function computeFingerprint(
  relativePath: string,
  content: Buffer | string
): FileFingerprint {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const hash = createHash("sha256").update(buf).digest("hex");
  return {
    relativePath,
    hash,
    size: buf.byteLength,
    recordedAt: Date.now(),
  };
}

/** Load the fingerprint store from disk. Returns null if no store exists yet. */
export function loadFingerprints(projectRoot: string): FingerprintStore | null {
  const storePath = join(projectRoot, BTMG_DIR, STORE_FILENAME);
  if (!existsSync(storePath)) {
    return null;
  }
  try {
    const raw = readFileSync(storePath, "utf8");
    return JSON.parse(raw) as FingerprintStore;
  } catch {
    // Corrupt store — treat as missing
    return null;
  }
}

/** Persist a fingerprint store to disk. Creates the .btmg directory if needed. */
export function saveFingerprints(projectRoot: string, store: FingerprintStore): void {
  const btmgDir = join(projectRoot, BTMG_DIR);
  if (!existsSync(btmgDir)) {
    mkdirSync(btmgDir, { recursive: true });
  }
  const storePath = join(btmgDir, STORE_FILENAME);
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Compare two stores and return which files changed, were added, or removed.
 * Both maps use relativePath as the key.
 */
export function diffFingerprints(
  previous: FingerprintStore,
  current: FingerprintStore
): FingerprintDiff {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [path, curr] of Object.entries(current)) {
    const prev = previous[path];
    if (!prev) {
      added.push(path);
    } else if (prev.hash !== curr.hash) {
      changed.push(path);
    }
  }

  for (const path of Object.keys(previous)) {
    if (!current[path]) {
      removed.push(path);
    }
  }

  return { changed, added, removed };
}
