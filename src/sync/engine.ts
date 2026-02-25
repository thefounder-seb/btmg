/**
 * Bidirectional sync orchestrator.
 * Coordinates graph ↔ docs synchronization.
 */

import type { Neo4jClient } from "../neo4j/client.js";
import type { SchemaRegistry } from "../schema/registry.js";
import type { ConflictStrategy, SyncResult } from "../schema/types.js";
import { queryByLabel, getRelationshipMap } from "../temporal/model.js";
import { parseDocs } from "../docs/parser.js";
import { writeDocs } from "../docs/renderer.js";
import { computeChanges } from "./differ.js";
import { resolveConflicts } from "./conflict.js";
import { upsert, remove } from "../graph/crud.js";
import type { RenderTemplate } from "../docs/templates.js";
import { defaultTemplate } from "../docs/templates.js";

export interface SyncOptions {
  /** Directory containing doc files */
  docsDir: string;
  /** File format */
  format?: "mdx" | "md";
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Actor for audit trail */
  actor?: string;
  /** Custom render template */
  template?: RenderTemplate;
  /** Only sync specific labels */
  labels?: string[];
}

/** Run a full bidirectional sync */
export async function sync(
  client: Neo4jClient,
  registry: SchemaRegistry,
  options: SyncOptions
): Promise<SyncResult> {
  const {
    docsDir,
    format = "md",
    conflictStrategy = "graph-wins",
    actor = "btmg-sync",
    template = defaultTemplate,
    labels,
  } = options;

  const result: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: [],
    errors: [],
  };

  // 1. Load current graph state
  const targetLabels = labels ?? registry.getNodeLabels();
  const graphEntities = (
    await Promise.all(targetLabels.map((l) => queryByLabel(client, l)))
  ).flat();

  // 2. Load current doc state
  const docs = await parseDocs(docsDir, format);

  // 3. Compute changes
  const changes = computeChanges(graphEntities, docs);

  // 4. Resolve conflicts
  const { resolved, nonConflicts } = resolveConflicts(changes, conflictStrategy);

  // 5. Apply resolved conflicts
  for (const res of resolved) {
    try {
      if (res.target === "graph") {
        await upsert(client, registry, res.label, res.entityId, res.properties, { actor });
        result.updated++;
      }
      // docs target will be handled in re-render step
      result.conflicts.push(res.conflict!);
    } catch (e) {
      result.errors.push({
        entityId: res.entityId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 6. Apply non-conflict changes
  for (const change of nonConflicts) {
    try {
      if (change.type === "create" && change.docProperties) {
        // Doc exists but not in graph → create in graph
        await upsert(client, registry, change.label, change.entityId, change.docProperties, {
          actor,
        });
        result.created++;
      } else if (change.type === "update" && change.docProperties) {
        // Doc has changes → update graph
        await upsert(client, registry, change.label, change.entityId, change.docProperties, {
          actor,
        });
        result.updated++;
      } else if (change.type === "delete") {
        // Entity removed from docs → soft-delete in graph
        await remove(client, change.entityId, { actor });
        result.deleted++;
      }
      // "create" with graphProperties only → will be handled in re-render
    } catch (e) {
      result.errors.push({
        entityId: change.entityId,
        file: change.filePath,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 7. Re-render all current graph state to docs (with Mermaid relationship diagrams)
  const allEntities = (
    await Promise.all(targetLabels.map((l) => queryByLabel(client, l)))
  ).flat();
  const relationshipMap = await getRelationshipMap(
    client,
    allEntities.map((e) => e.entity._id)
  );
  writeDocs(allEntities, docsDir, template, relationshipMap);

  return result;
}
