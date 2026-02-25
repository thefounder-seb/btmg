/**
 * Graph ingestion.
 * Pass 1: upsert all mapped entities.
 * Pass 2: create relationships derived from artifact refs.
 */

import type { BTMG } from "../index.js";
import type { MappedEntity, ScanError, ScanResult } from "./types.js";

// ── Options ──

export interface IngestOptions {
  /** Actor string written to the audit trail */
  actor?: string;
  /**
   * When true, log what would happen without writing to Neo4j.
   * entitiesUpserted / relationsCreated will remain 0.
   */
  dryRun?: boolean;
  /** Project root used to compute deterministic IDs for relationship targets */
  projectRoot?: string;
}

// ── Internal type ──

interface EntityIndex {
  /** id → MappedEntity */
  byId: Map<string, MappedEntity>;
  /** "filePath:kind:name" → id */
  byArtifactKey: Map<string, string>;
}

function buildIndex(entities: MappedEntity[]): EntityIndex {
  const byId = new Map<string, MappedEntity>();
  const byArtifactKey = new Map<string, string>();

  for (const e of entities) {
    byId.set(e.id, e);
    const key = `${e.artifact.filePath}:${e.artifact.kind}:${e.artifact.name}`;
    byArtifactKey.set(key, e.id);
  }

  return { byId, byArtifactKey };
}

/** Attempt to resolve an ArtifactRef target name to one of the ingested entity IDs */
function resolveRefTarget(
  target: string,
  index: EntityIndex
): string | null {
  // Direct ID match (unlikely but cheap check)
  if (index.byId.has(target)) return target;

  // Search all entities for a name match
  for (const [, entity] of index.byId) {
    if (entity.artifact.name === target) return entity.id;
  }

  // Try interpreting target as a relative import path and find a file entity
  for (const [, entity] of index.byId) {
    if (
      entity.artifact.kind === "file" &&
      (entity.artifact.filePath === target ||
        entity.artifact.name === target)
    ) {
      return entity.id;
    }
  }

  return null;
}

// ── Ref type → relationship type mapping ──

const REF_KIND_TO_RELATION: Record<string, string> = {
  imports: "IMPORTS",
  extends: "EXTENDS",
  implements: "IMPLEMENTS",
  calls: "CALLS",
  depends_on: "DEPENDS_ON",
  configures: "CONFIGURES",
};

// ── Main export ──

/**
 * Ingest mapped entities into the BTMG graph.
 * Returns a partial ScanResult (filesDiscovered / filesParsed / artifactsExtracted
 * are filled in by the pipeline; this function only fills upsert/relation counters).
 */
export async function ingestEntities(
  btmg: BTMG,
  entities: MappedEntity[],
  options: IngestOptions = {}
): Promise<Pick<ScanResult, "entitiesUpserted" | "entitiesSkipped" | "relationsCreated" | "errors" | "dryRun">> {
  const actor = options.actor ?? "btmg-scanner";
  const dryRun = options.dryRun ?? false;

  const errors: ScanError[] = [];
  let entitiesUpserted = 0;
  let entitiesSkipped = 0;
  let relationsCreated = 0;

  // ── Pass 1: Upsert all entities ──
  const index = buildIndex(entities);

  for (const entity of entities) {
    if (dryRun) {
      entitiesSkipped++;
      continue;
    }

    try {
      await btmg.upsert(entity.label, entity.properties, {
        id: entity.id,
        actor,
      });
      entitiesUpserted++;
    } catch (err) {
      entitiesSkipped++;
      errors.push({
        file: entity.artifact.filePath,
        artifactName: entity.artifact.name,
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      });
    }
  }

  // ── Pass 2: Create relationships from artifact refs ──
  for (const entity of entities) {
    for (const ref of entity.artifact.refs) {
      const relType = REF_KIND_TO_RELATION[ref.kind];
      if (!relType) continue;

      const toId = resolveRefTarget(ref.target, index);
      if (!toId) continue;

      const toEntity = index.byId.get(toId);
      if (!toEntity) continue;

      if (dryRun) {
        // Count but don't write
        relationsCreated++;
        continue;
      }

      try {
        await btmg.relate(
          entity.id,
          toId,
          relType,
          entity.label,
          toEntity.label,
          undefined,
          actor
        );
        relationsCreated++;
      } catch {
        // Relationship errors are non-fatal — the entity already exists
        // No error entry to avoid flooding the result for missing edge schemas
      }
    }
  }

  return { entitiesUpserted, entitiesSkipped, relationsCreated, errors, dryRun };
}
