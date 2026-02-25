/**
 * Entity-State bitemporal model.
 *
 * Entity nodes hold immutable identity (_id, _label, _created_at).
 * State nodes hold mutable properties + temporal metadata.
 * CURRENT rel points Entity → latest State.
 * PREVIOUS chain links States in version order.
 */

import type { Neo4jClient } from "../neo4j/client.js";
import type { EntityRelationship } from "../docs/templates.js";
import * as cypher from "../neo4j/cypher.js";
import { toNumber } from "../neo4j/cypher.js";

export interface EntityWithState {
  entity: {
    _id: string;
    _label: string;
    _created_at: string;
  };
  state: {
    _entity_id: string;
    _valid_from: string;
    _valid_to: string | null;
    _recorded_at: string;
    _version: number;
    _actor: string;
    [key: string]: unknown;
  };
}

/** Normalize Neo4j record properties (convert Integer objects to numbers) */
function normalizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value && typeof value === "object" && "low" in value && "high" in value) {
      result[key] = toNumber(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Get current state of an entity */
export async function getCurrent(client: Neo4jClient, id: string): Promise<EntityWithState | null> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherGetCurrent(id);
    return tx.run(compiled.query, compiled.params);
  });

  if (result.records.length === 0) return null;

  const record = result.records[0];
  return {
    entity: normalizeProps(record.get("e").properties),
    state: normalizeProps(record.get("s").properties),
  } as EntityWithState;
}

/** Get state at a specific point in time */
export async function getAtTime(
  client: Neo4jClient,
  id: string,
  timestamp: string
): Promise<EntityWithState | null> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherGetAtTime({ id, timestamp });
    return tx.run(compiled.query, compiled.params);
  });

  if (result.records.length === 0) return null;

  const record = result.records[0];
  return {
    entity: normalizeProps(record.get("e").properties),
    state: normalizeProps(record.get("s").properties),
  } as EntityWithState;
}

/** Get full version history */
export async function getHistory(
  client: Neo4jClient,
  id: string
): Promise<Record<string, unknown>[]> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherGetHistory(id);
    return tx.run(compiled.query, compiled.params);
  });

  return result.records.map((r) => normalizeProps(r.get("s").properties));
}

/** Query all current entities of a label */
export async function queryByLabel(
  client: Neo4jClient,
  label: string
): Promise<EntityWithState[]> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherQueryByLabel(label);
    return tx.run(compiled.query, compiled.params);
  });

  return result.records.map((r) => ({
    entity: normalizeProps(r.get("e").properties),
    state: normalizeProps(r.get("s").properties),
  })) as EntityWithState[];
}

/** Get entities changed since a timestamp */
export async function getChangesSince(
  client: Neo4jClient,
  since: string,
  opts?: { labels?: string[]; actors?: string[]; limit?: number }
): Promise<Array<EntityWithState & { audits: Record<string, unknown>[]; lastChange: string }>> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherChangesSince({
      since,
      labels: opts?.labels,
      actors: opts?.actors,
      limit: opts?.limit ?? 100,
    });
    return tx.run(compiled.query, compiled.params);
  });

  return result.records.map((r) => ({
    entity: normalizeProps(r.get("e").properties),
    state: r.get("s") ? normalizeProps(r.get("s").properties) : null,
    audits: r.get("audits") as Record<string, unknown>[],
    lastChange: r.get("lastChange") as string,
  })) as Array<EntityWithState & { audits: Record<string, unknown>[]; lastChange: string }>;
}

/** Search entities by label with property filters */
export async function searchEntities(
  client: Neo4jClient,
  label: string,
  filters: Array<{ property: string; operator: string; value: unknown }>,
  opts?: { limit?: number; orderBy?: string; orderDir?: "asc" | "desc" }
): Promise<EntityWithState[]> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherSearch({
      label,
      filters,
      limit: opts?.limit ?? 50,
      orderBy: opts?.orderBy,
      orderDir: opts?.orderDir,
    });
    return tx.run(compiled.query, compiled.params);
  });

  return result.records.map((r) => ({
    entity: normalizeProps(r.get("e").properties),
    state: normalizeProps(r.get("s").properties),
  })) as EntityWithState[];
}

/** Get graph summary: entity counts by label */
export async function getGraphSummary(
  client: Neo4jClient
): Promise<Array<{ label: string; count: number; lastModified: string }>> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherGraphSummary();
    return tx.run(compiled.query, compiled.params);
  });

  return result.records.map((r) => ({
    label: r.get("label") as string,
    count: toNumber(r.get("count")),
    lastModified: r.get("lastModified") as string,
  }));
}

/** Get all active relationships for an entity */
export async function getRelationships(
  client: Neo4jClient,
  entityId: string
): Promise<EntityRelationship[]> {
  const result = await client.read(async (tx) => {
    const compiled = cypher.cypherGetRelationships(entityId);
    return tx.run(compiled.query, compiled.params);
  });

  return result.records.map((r) => ({
    type: r.get("relType") as string,
    direction: r.get("direction") as "outgoing" | "incoming",
    targetId: r.get("targetId") as string,
    targetLabel: r.get("targetLabel") as string,
  }));
}

/** Build a relationship map for multiple entities */
export async function getRelationshipMap(
  client: Neo4jClient,
  entityIds: string[]
): Promise<Map<string, EntityRelationship[]>> {
  const map = new Map<string, EntityRelationship[]>();
  const results = await Promise.all(
    entityIds.map((id) => getRelationships(client, id).then((rels) => ({ id, rels })))
  );
  for (const { id, rels } of results) {
    if (rels.length > 0) map.set(id, rels);
  }
  return map;
}
