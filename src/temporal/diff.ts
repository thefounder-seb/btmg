/**
 * Version-to-version diff computation.
 * Compares two states (or versions) and returns a structured diff.
 */

import deepEqual from "fast-deep-equal";

export interface PropertyChange {
  property: string;
  old: unknown;
  new: unknown;
}

export interface VersionDiff {
  entityId: string;
  fromVersion: number;
  toVersion: number;
  changes: PropertyChange[];
}

/** Internal temporal/system keys to skip when diffing */
const SKIP_KEYS = new Set([
  "_entity_id",
  "_valid_from",
  "_valid_to",
  "_recorded_at",
  "_version",
  "_actor",
]);

/** Diff two state objects */
export function diffStates(
  entityId: string,
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>
): VersionDiff {
  const changes: PropertyChange[] = [];

  const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
  for (const key of allKeys) {
    if (SKIP_KEYS.has(key)) continue;
    const oldVal = oldState[key];
    const newVal = newState[key];
    if (!deepEqual(oldVal, newVal)) {
      changes.push({ property: key, old: oldVal, new: newVal });
    }
  }

  return {
    entityId,
    fromVersion: Number(oldState._version ?? 0),
    toVersion: Number(newState._version ?? 0),
    changes,
  };
}

/** Diff a full version history into a changelog */
export function buildChangelog(
  entityId: string,
  history: Record<string, unknown>[]
): VersionDiff[] {
  const sorted = [...history].sort(
    (a, b) => Number(a._version ?? 0) - Number(b._version ?? 0)
  );

  const diffs: VersionDiff[] = [];
  for (let i = 1; i < sorted.length; i++) {
    diffs.push(diffStates(entityId, sorted[i - 1], sorted[i]));
  }
  return diffs;
}
