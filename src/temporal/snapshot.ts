/**
 * Point-in-time graph reconstruction.
 * Produces a snapshot of the entire graph (or a subset) at a given timestamp.
 */

import type { Neo4jClient } from "../neo4j/client.js";
import type { SchemaRegistry } from "../schema/registry.js";
import type { EntityWithState } from "./model.js";
import { sanitizeIdentifier } from "../neo4j/cypher.js";

export interface GraphSnapshot {
  timestamp: string;
  entities: EntityWithState[];
  edges: SnapshotEdge[];
}

export interface SnapshotEdge {
  fromId: string;
  toId: string;
  type: string;
  properties: Record<string, unknown>;
}

/** Take a snapshot of the graph at a specific timestamp */
export async function snapshotAt(
  client: Neo4jClient,
  registry: SchemaRegistry,
  timestamp: string,
  labels?: string[]
): Promise<GraphSnapshot> {
  const targetLabels = labels ?? registry.getNodeLabels();

  // Query entities valid at the timestamp
  const entities: EntityWithState[] = [];
  for (const label of targetLabels) {
    const safeLabel = sanitizeIdentifier(label);
    const result = await client.read(async (tx) => {
      return tx.run(
        `
        MATCH (e:Entity:${safeLabel})-[:CURRENT|PREVIOUS*]->(s:State)
        WHERE e._deleted_at IS NULL
          AND s._valid_from <= $timestamp
          AND (s._valid_to IS NULL OR s._valid_to > $timestamp)
        RETURN e, s
        `,
        { timestamp }
      );
    });

    for (const record of result.records) {
      entities.push({
        entity: record.get("e").properties,
        state: record.get("s").properties,
      });
    }
  }

  // Query edges valid at the timestamp
  const edgeResult = await client.read(async (tx) => {
    return tx.run(
      `
      MATCH (from:Entity)-[r]->(to:Entity)
      WHERE type(r) <> 'CURRENT' AND type(r) <> 'PREVIOUS' AND type(r) <> 'AUDITED'
        AND r._valid_from <= $timestamp
        AND (r._valid_to IS NULL OR r._valid_to > $timestamp)
      RETURN from._id AS fromId, to._id AS toId, type(r) AS relType, properties(r) AS props
      `,
      { timestamp }
    );
  });

  const edges: SnapshotEdge[] = edgeResult.records.map((r) => ({
    fromId: r.get("fromId"),
    toId: r.get("toId"),
    type: r.get("relType"),
    properties: r.get("props"),
  }));

  return { timestamp, entities, edges };
}
