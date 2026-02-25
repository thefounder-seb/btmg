/**
 * Render graph state → MDX/MD files via templates.
 * Supports Mermaid.js diagrams for relationship visualization.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import matter from "gray-matter";
import hash from "object-hash";
import type { EntityWithState } from "../temporal/model.js";
import {
  defaultTemplate,
  resolveFilePattern,
  type RenderTemplate,
  type EntityRelationship,
} from "./templates.js";

/** Compute a deterministic sync hash for an entity's current state */
export function computeSyncHash(state: Record<string, unknown>): string {
  // Strip temporal meta, keep only user properties
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith("_")) {
      filtered[key] = value;
    }
  }
  return hash(filtered, { algorithm: "sha1", encoding: "hex" });
}

/** Render a single entity to MDX/MD string */
export function renderDoc(
  entity: EntityWithState,
  template: RenderTemplate = defaultTemplate,
  relationships?: EntityRelationship[]
): string {
  const syncHash = computeSyncHash(entity.state);
  const frontmatter = template.renderFrontmatter(entity, syncHash);
  const body = template.renderBody(entity, relationships);

  return matter.stringify(body ? `\n${body}\n` : "\n", frontmatter);
}

/** Render and write a single entity to disk */
export function writeDoc(
  entity: EntityWithState,
  outputDir: string,
  template: RenderTemplate = defaultTemplate,
  relationships?: EntityRelationship[]
): string {
  const filePath = resolve(
    outputDir,
    resolveFilePattern(template.filePattern, entity)
  );
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const content = renderDoc(entity, template, relationships);

  // Skip write if file already has identical content
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    if (existing === content) return filePath;
  }

  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/** Render and write multiple entities (with optional relationship map) */
export function writeDocs(
  entities: EntityWithState[],
  outputDir: string,
  template: RenderTemplate = defaultTemplate,
  relationshipMap?: Map<string, EntityRelationship[]>
): string[] {
  return entities.map((e) =>
    writeDoc(e, outputDir, template, relationshipMap?.get(e.entity._id))
  );
}
