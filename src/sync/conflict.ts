/**
 * Conflict detection and resolution strategies.
 */

import type { ConflictStrategy, ConflictRecord } from "../schema/types.js";
import type { Change } from "./differ.js";

export interface ResolvedChange {
  entityId: string;
  label: string;
  /** The winning properties to apply */
  properties: Record<string, unknown>;
  /** Where to apply: "graph" or "docs" */
  target: "graph" | "docs";
  /** Original conflict record if applicable */
  conflict?: ConflictRecord;
}

/** Resolve a conflict change using the configured strategy */
export function resolveConflict(
  change: Change,
  strategy: ConflictStrategy
): ResolvedChange {
  if (change.type !== "conflict") {
    throw new Error(`resolveConflict called on non-conflict change: ${change.type}`);
  }

  switch (strategy) {
    case "graph-wins":
      return {
        entityId: change.entityId,
        label: change.label,
        properties: change.graphProperties ?? {},
        target: "docs",
        conflict: {
          entityId: change.entityId,
          label: change.label,
          graphHash: change.graphHash ?? "",
          docHash: change.docHash ?? "",
          resolution: strategy,
        },
      };

    case "docs-wins":
      return {
        entityId: change.entityId,
        label: change.label,
        properties: change.docProperties ?? {},
        target: "graph",
        conflict: {
          entityId: change.entityId,
          label: change.label,
          graphHash: change.graphHash ?? "",
          docHash: change.docHash ?? "",
          resolution: strategy,
        },
      };

    case "merge":
      // Merge: doc properties override graph where present
      return {
        entityId: change.entityId,
        label: change.label,
        properties: {
          ...(change.graphProperties ?? {}),
          ...(change.docProperties ?? {}),
        },
        target: "graph", // merged result goes to graph, then re-rendered to docs
        conflict: {
          entityId: change.entityId,
          label: change.label,
          graphHash: change.graphHash ?? "",
          docHash: change.docHash ?? "",
          resolution: strategy,
        },
      };

    case "fail":
      throw new Error(
        `Sync conflict for entity ${change.entityId} (${change.label}). ` +
          `Strategy is "fail". Manual resolution required.`
      );
  }
}

/** Resolve all conflict changes in a changeset */
export function resolveConflicts(
  changes: Change[],
  strategy: ConflictStrategy
): { resolved: ResolvedChange[]; nonConflicts: Change[] } {
  const resolved: ResolvedChange[] = [];
  const nonConflicts: Change[] = [];

  for (const change of changes) {
    if (change.type === "conflict") {
      resolved.push(resolveConflict(change, strategy));
    } else {
      nonConflicts.push(change);
    }
  }

  return { resolved, nonConflicts };
}
