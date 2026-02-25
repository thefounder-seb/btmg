/**
 * Render graph state → MDX/MD files via templates.
 * Supports Mermaid.js diagrams for relationship visualization.
 * Supports optional FormatAdapters for framework-specific output.
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
import type { FormatAdapter } from "./adapters/types.js";

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

/**
 * Extract the raw content of a fenced mermaid block so an adapter can
 * re-wrap it in a framework-appropriate way.
 *
 * Accepts the full fenced block string (including the ``` fences) and
 * returns just the inner code. If the string is not a mermaid fence, it
 * is returned unchanged.
 */
function applyMermaidWrap(raw: string, adapter: FormatAdapter): string {
  // Match the entire fenced mermaid block (handles optional trailing newline)
  return raw.replace(
    /^```mermaid\n([\s\S]*?)```$/gm,
    (_match, code: string) => adapter.wrapMermaid(code.replace(/\n$/, ""))
  );
}

/** Render a single entity to MDX/MD string */
export function renderDoc(
  entity: EntityWithState,
  template: RenderTemplate = defaultTemplate,
  relationships?: EntityRelationship[],
  adapter?: FormatAdapter
): string {
  const syncHash = computeSyncHash(entity.state);
  const baseFrontmatter = template.renderFrontmatter(entity, syncHash);
  const frontmatter = adapter
    ? adapter.transformFrontmatter(baseFrontmatter)
    : baseFrontmatter;

  let body = template.renderBody(entity, relationships);

  // Let the adapter re-wrap any Mermaid blocks the template emitted
  if (adapter && body) {
    body = applyMermaidWrap(body, adapter);
  }

  return matter.stringify(body ? `\n${body}\n` : "\n", frontmatter);
}

/** Render and write a single entity to disk */
export function writeDoc(
  entity: EntityWithState,
  outputDir: string,
  template: RenderTemplate = defaultTemplate,
  relationships?: EntityRelationship[],
  adapter?: FormatAdapter
): string {
  const filePath = resolve(
    outputDir,
    resolveFilePattern(template.filePattern, entity)
  );
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const content = renderDoc(entity, template, relationships, adapter);

  // Skip write if file already has identical content
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    if (existing === content) return filePath;
  }

  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/** Render and write multiple entities (with optional relationship map and adapter) */
export function writeDocs(
  entities: EntityWithState[],
  outputDir: string,
  template: RenderTemplate = defaultTemplate,
  relationshipMap?: Map<string, EntityRelationship[]>,
  adapter?: FormatAdapter
): string[] {
  const written = entities.map((e) =>
    writeDoc(
      e,
      outputDir,
      template,
      relationshipMap?.get(e.entity._id),
      adapter
    )
  );

  // After all files are written, invoke generateMeta if the adapter provides it
  if (adapter?.generateMeta) {
    const metaEntities = entities.map((e) => ({
      _id: e.entity._id,
      _label: e.entity._label,
      properties: Object.fromEntries(
        Object.entries(e.state).filter(([k]) => !k.startsWith("_"))
      ),
    }));
    adapter.generateMeta(metaEntities, outputDir);
  }

  return written;
}
