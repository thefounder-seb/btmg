/**
 * Audit logger — query AuditEntry nodes from Neo4j by entity/time/actor.
 * Write operations are now handled atomically inside cypher queries.
 */

import type { Neo4jClient } from "../neo4j/client.js";
import type { AuditEntry } from "../schema/types.js";
import neo4j from "neo4j-driver";

/** Query audit entries for an entity */
export async function queryAudit(
  client: Neo4jClient,
  entityId: string,
  limit = 50
): Promise<AuditEntry[]> {
  const result = await client.read(async (tx) => {
    return tx.run(
      `
      MATCH (e:Entity {_id: $entityId})-[:AUDITED]->(a:AuditEntry)
      RETURN a
      ORDER BY a._timestamp DESC
      LIMIT $limit
      `,
      { entityId, limit: neo4j.int(limit) }
    );
  });

  return result.records.map((r) => {
    const props = r.get("a").properties;
    return {
      ...props,
      _changes: props._changes ? JSON.parse(props._changes) : undefined,
    };
  });
}

/** Query audit entries by actor */
export async function queryAuditByActor(
  client: Neo4jClient,
  actor: string,
  limit = 50
): Promise<AuditEntry[]> {
  const result = await client.read(async (tx) => {
    return tx.run(
      `
      MATCH (a:AuditEntry {_actor: $actor})
      RETURN a
      ORDER BY a._timestamp DESC
      LIMIT $limit
      `,
      { actor, limit: neo4j.int(limit) }
    );
  });

  return result.records.map((r) => {
    const props = r.get("a").properties;
    return {
      ...props,
      _changes: props._changes ? JSON.parse(props._changes) : undefined,
    };
  });
}
