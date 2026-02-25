/**
 * Default + user-definable render templates.
 * Templates control how graph state is rendered to MDX/MD files.
 * All diagrams use Mermaid.js for rendering.
 */

import type { EntityWithState } from "../temporal/model.js";

/** Relationship info attached to an entity for rendering */
export interface EntityRelationship {
  type: string;
  direction: "outgoing" | "incoming";
  targetId: string;
  targetLabel: string;
  targetName?: string;
}

export interface RenderTemplate {
  /** File name pattern. Use {_id} and {_label} placeholders. */
  filePattern: string;
  /** Render frontmatter from entity + state */
  renderFrontmatter: (entity: EntityWithState, syncHash: string) => Record<string, unknown>;
  /** Render body content (receives relationships if available) */
  renderBody: (entity: EntityWithState, relationships?: EntityRelationship[]) => string;
}

/** Render a Mermaid diagram showing an entity's relationships */
function renderMermaidRelationships(
  entity: EntityWithState,
  relationships: EntityRelationship[]
): string {
  if (relationships.length === 0) return "";

  const entityName = (entity.state.name as string) ?? entity.entity._id;
  const entityId = sanitizeMermaidId(entity.entity._id);

  const lines: string[] = [
    "```mermaid",
    "graph LR",
    `    ${entityId}["${entityName}"]`,
  ];

  for (const rel of relationships) {
    const targetId = sanitizeMermaidId(rel.targetId);
    const targetName = rel.targetName ?? rel.targetId;

    if (rel.direction === "outgoing") {
      lines.push(`    ${entityId} -->|${rel.type}| ${targetId}["${targetName}"]`);
    } else {
      lines.push(`    ${targetId}["${targetName}"] -->|${rel.type}| ${entityId}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/** Sanitize an ID for use as a Mermaid node identifier */
function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Default template: renders all properties as frontmatter, body from 'content' property + Mermaid diagrams */
export const defaultTemplate: RenderTemplate = {
  filePattern: "{_label}/{_id}.md",

  renderFrontmatter(entity, syncHash) {
    const fm: Record<string, unknown> = {
      _id: entity.entity._id,
      _label: entity.entity._label,
      _sync_hash: syncHash,
      _version: entity.state._version,
    };

    for (const [key, value] of Object.entries(entity.state)) {
      if (!key.startsWith("_")) {
        fm[key] = value;
      }
    }

    return fm;
  },

  renderBody(entity, relationships) {
    const parts: string[] = [];

    // User content
    const content = entity.state.content;
    if (typeof content === "string") {
      parts.push(content);
    }

    // Mermaid relationship diagram
    if (relationships && relationships.length > 0) {
      parts.push("");
      parts.push("## Relationships");
      parts.push("");
      parts.push(renderMermaidRelationships(entity, relationships));
    }

    return parts.join("\n");
  },
};

/** Create a template from partial overrides */
export function createTemplate(overrides: Partial<RenderTemplate>): RenderTemplate {
  return { ...defaultTemplate, ...overrides };
}

/** Resolve file pattern to actual path */
export function resolveFilePattern(
  pattern: string,
  entity: EntityWithState
): string {
  return pattern
    .replace("{_id}", entity.entity._id)
    .replace("{_label}", entity.entity._label);
}
