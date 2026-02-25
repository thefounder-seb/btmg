/**
 * Mapping layer.
 * Resolves ScanMapping rules against RawArtifacts to produce MappedEntity records
 * with deterministic IDs and resolved properties.
 */

import { createHash } from "node:crypto";
import type { RawArtifact, ScanMapping, PropertyMapping } from "../schema/types.js";
import type { SchemaRegistry } from "../schema/registry.js";
import type { MappedEntity } from "./types.js";

// ── ID generation ──

/**
 * Generate a deterministic entity ID from the combination of project root,
 * file path, artifact kind, and name.
 * Uses the first 32 hex chars of SHA-256 — long enough to avoid collisions.
 */
export function generateEntityId(
  projectRoot: string,
  relativePath: string,
  kind: string,
  name: string
): string {
  const key = `${projectRoot}:${relativePath}:${kind}:${name}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// ── Property resolution ──

function resolvePropertyMapping(
  mapping: PropertyMapping,
  artifact: RawArtifact
): unknown {
  // Plain string: field name on artifact.meta or top-level artifact fields
  if (typeof mapping === "string") {
    const artifactRecord = artifact as unknown as Record<string, unknown>;
    if (mapping in artifactRecord) {
      return artifactRecord[mapping];
    }
    if (mapping in artifact.meta) {
      return artifact.meta[mapping];
    }
    return undefined;
  }

  // { from: "fieldPath" } — dotted path into artifact
  if ("from" in mapping) {
    return resolveDottedPath(artifact, mapping.from);
  }

  // { value: <literal> } — static value
  if ("value" in mapping) {
    return mapping.value;
  }

  // { compute: (artifact) => unknown }
  if ("compute" in mapping) {
    try {
      return mapping.compute(artifact);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/** Resolve a dotted key path like "meta.exported" against an object */
function resolveDottedPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Main mapping function ──

export interface MapResult {
  entities: MappedEntity[];
  /** Artifacts that matched no mapping rule */
  unmapped: RawArtifact[];
}

/**
 * Map raw artifacts to MappedEntity records using the user-defined ScanMapping rules.
 * An artifact is mapped by the first matching rule (matched on artifact.kind === mapping.artifact).
 * If a filter function is defined on the mapping it must also pass.
 */
export function mapArtifacts(
  artifacts: RawArtifact[],
  mappings: ScanMapping[],
  registry: SchemaRegistry,
  projectRoot: string = ""
): MapResult {
  const entities: MappedEntity[] = [];
  const unmapped: RawArtifact[] = [];

  for (const artifact of artifacts) {
    const mapping = findMapping(artifact, mappings);

    if (!mapping) {
      unmapped.push(artifact);
      continue;
    }

    // Resolve properties
    const properties: Record<string, unknown> = {};
    for (const [propKey, propMapping] of Object.entries(mapping.properties)) {
      const value = resolvePropertyMapping(propMapping, artifact);
      if (value !== undefined) {
        properties[propKey] = value;
      }
    }

    // Validate that the label is known to the registry
    try {
      registry.getNodeValidator(mapping.label);
    } catch {
      // Label not in schema — skip rather than crash
      unmapped.push(artifact);
      continue;
    }

    const id = generateEntityId(
      projectRoot,
      artifact.filePath,
      artifact.kind,
      artifact.name
    );

    entities.push({
      id,
      label: mapping.label,
      properties,
      artifact,
    });
  }

  return { entities, unmapped };
}

/** Find the first ScanMapping that applies to this artifact */
function findMapping(
  artifact: RawArtifact,
  mappings: ScanMapping[]
): ScanMapping | undefined {
  for (const mapping of mappings) {
    if (mapping.artifact !== artifact.kind) continue;
    if (mapping.filter && !mapping.filter(artifact)) continue;
    return mapping;
  }
  return undefined;
}
