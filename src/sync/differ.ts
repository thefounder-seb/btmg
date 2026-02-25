/**
 * Compute changeset between graph state and doc state.
 */

import deepEqual from "fast-deep-equal";
import type { EntityWithState } from "../temporal/model.js";
import type { ParsedDoc } from "../docs/parser.js";
import { extractProperties } from "../docs/parser.js";
import { computeSyncHash } from "../docs/renderer.js";

export type ChangeType = "create" | "update" | "delete" | "conflict";

export interface Change {
  type: ChangeType;
  entityId: string;
  label: string;
  /** Properties from graph (current state) */
  graphProperties?: Record<string, unknown>;
  /** Properties from doc (frontmatter) */
  docProperties?: Record<string, unknown>;
  /** File path of the doc */
  filePath?: string;
  /** Whether sync hashes match */
  hashMatch?: boolean;
  /** Graph-side sync hash */
  graphHash?: string;
  /** Doc-side sync hash */
  docHash?: string;
}

/**
 * Compute changes needed to sync graph → docs.
 * Entities in graph but not in docs = create doc.
 * Entities in docs but not in graph = create in graph.
 * Entities in both with different hashes = conflict/update.
 */
export function computeChanges(
  graphEntities: EntityWithState[],
  docs: ParsedDoc[]
): Change[] {
  const changes: Change[] = [];

  const docById = new Map(docs.map((d) => [d.frontmatter._id, d]));
  const graphById = new Map(graphEntities.map((e) => [e.entity._id, e]));

  // Entities in graph but not in docs → create docs
  for (const [id, entity] of graphById) {
    if (!docById.has(id)) {
      changes.push({
        type: "create",
        entityId: id,
        label: entity.entity._label,
        graphProperties: stripMeta(entity.state),
      });
    }
  }

  // Docs not in graph → create in graph
  for (const [id, doc] of docById) {
    if (!graphById.has(id)) {
      changes.push({
        type: "create",
        entityId: id,
        label: doc.frontmatter._label,
        docProperties: extractProperties(doc.frontmatter),
        filePath: doc.filePath,
      });
    }
  }

  // Both exist → check for conflicts
  for (const [id, entity] of graphById) {
    const doc = docById.get(id);
    if (!doc) continue;

    const graphHash = computeSyncHash(entity.state);
    const docHash = doc.frontmatter._sync_hash;
    const graphProps = stripMeta(entity.state);
    const docProps = extractProperties(doc.frontmatter);

    if (graphHash === docHash) {
      // In sync, check if doc has local changes
      if (!deepEqual(graphProps, docProps)) {
        changes.push({
          type: "update",
          entityId: id,
          label: entity.entity._label,
          graphProperties: graphProps,
          docProperties: docProps,
          filePath: doc.filePath,
          hashMatch: false,
        });
      }
      // else: perfectly in sync, no change
    } else {
      // Hash mismatch — conflict
      changes.push({
        type: "conflict",
        entityId: id,
        label: entity.entity._label,
        graphProperties: graphProps,
        docProperties: docProps,
        filePath: doc.filePath,
        hashMatch: false,
        graphHash,
        docHash,
      });
    }
  }

  return changes;
}

function stripMeta(state: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith("_")) {
      result[key] = value;
    }
  }
  return result;
}
