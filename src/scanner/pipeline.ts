/**
 * Scan pipeline orchestrator.
 * Wires: resolve target → discover → parse → map → ingest → save fingerprints.
 */

import type { BTMG } from "../index.js";
import type { ScanResult } from "./types.js";
import type { ScanPipelineOptions } from "./types.js";
import { resolveTarget } from "./github.js";
import { discoverFiles } from "./discover.js";
import { parseFiles } from "./parse.js";
import { mapArtifacts } from "./map.js";
import { ingestEntities } from "./ingest.js";
import { loadFingerprints, saveFingerprints } from "./fingerprint.js";

/**
 * Run a full codebase scan and ingest the results into the BTMG graph.
 *
 * The pipeline steps are:
 * 1. Resolve target (local path or GitHub URL → local checkout)
 * 2. Load previous fingerprints for incremental scanning
 * 3. Discover files (only changed/added when incremental)
 * 4. Parse discovered files into RawArtifacts
 * 5. Map artifacts to MappedEntity records via ScanMapping rules
 * 6. Ingest entities and relationships into Neo4j
 * 7. Save updated fingerprint store to .btmg/fingerprints.json
 * 8. Cleanup tmp directory (if GitHub clone)
 */
export async function runScan(
  btmg: BTMG,
  options: ScanPipelineOptions
): Promise<ScanResult> {
  const {
    target,
    actor = "btmg-scanner",
    dryRun = false,
    languages,
    githubToken,
  } = options;

  // Read scan config from the BTMG instance's config
  const scanConfig = btmg._config.scan;

  if (!scanConfig) {
    throw new Error(
      "No scan config found. Add a `scan` section to your btmg config file."
    );
  }

  const result: ScanResult = {
    filesDiscovered: 0,
    filesParsed: 0,
    artifactsExtracted: 0,
    entitiesUpserted: 0,
    entitiesSkipped: 0,
    relationsCreated: 0,
    errors: [],
    dryRun,
  };

  // ── Step 1: Resolve target ──
  const resolved = resolveTarget(target, {
    depth: scanConfig.github?.depth,
    branch: scanConfig.github?.branch,
    token: githubToken,
  });
  const { projectRoot, cleanup } = resolved;

  try {
    // ── Step 2: Load previous fingerprints ──
    const previousFingerprints = loadFingerprints(projectRoot);

    // ── Step 3: Discover files ──
    const effectiveLanguages = languages ?? scanConfig.languages;
    const discoverResult = await discoverFiles(
      projectRoot,
      {
        ...scanConfig,
        // Merge language override
        languages: effectiveLanguages,
      },
      previousFingerprints
    );

    result.filesDiscovered = Object.keys(discoverResult.currentFingerprints).length;
    result.filesParsed = discoverResult.files.length;

    if (discoverResult.files.length === 0 && discoverResult.removed.length === 0) {
      // Nothing changed — save fingerprints and exit early
      if (!dryRun) {
        saveFingerprints(projectRoot, discoverResult.currentFingerprints);
      }
      return result;
    }

    // ── Step 4: Parse files ──
    const artifacts = parseFiles(discoverResult.files, {
      languages: effectiveLanguages,
    });

    result.artifactsExtracted = artifacts.length;

    if (artifacts.length === 0) {
      if (!dryRun) {
        saveFingerprints(projectRoot, discoverResult.currentFingerprints);
      }
      return result;
    }

    // ── Step 5: Map artifacts ──
    const { entities, unmapped } = mapArtifacts(
      artifacts,
      scanConfig.mappings,
      btmg.registry,
      projectRoot
    );

    // Track unmapped artifacts as skipped (informational)
    result.entitiesSkipped += unmapped.length;

    // ── Step 6: Ingest ──
    const ingestResult = await ingestEntities(btmg, entities, {
      actor,
      dryRun,
      projectRoot,
    });

    result.entitiesUpserted = ingestResult.entitiesUpserted;
    result.entitiesSkipped += ingestResult.entitiesSkipped;
    result.relationsCreated = ingestResult.relationsCreated;
    result.errors.push(...ingestResult.errors);

    // ── Step 7: Save fingerprints ──
    if (!dryRun) {
      saveFingerprints(projectRoot, discoverResult.currentFingerprints);
    }
  } finally {
    // ── Step 8: Cleanup tmp dir (GitHub clones only) ──
    cleanup?.();
  }

  return result;
}
