/**
 * Cypher query builders for entity-state temporal model.
 */

import type { ManagedTransaction } from "neo4j-driver";

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Sanitize a label or relationship type for safe Cypher interpolation */
export function sanitizeIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Invalid Cypher identifier "${value}". Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`
    );
  }
  return value;
}

/** Safely convert Neo4j integer objects to JS numbers */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "low" in value && "high" in value) {
    return (value as { low: number; high: number }).low;
  }
  return Number(value);
}

/** Create an Entity node with its first State node + audit entry in one query */
export function cypherCreateEntity(params: {
  id: string;
  label: string;
  properties: Record<string, unknown>;
  actor: string;
  now: string;
  auditId: string;
}): { query: string; params: Record<string, unknown> } {
  const label = sanitizeIdentifier(params.label);
  return {
    query: `
      CREATE (e:Entity:${label} {
        _id: $id,
        _label: $label,
        _created_at: $now
      })
      CREATE (s:State {
        _entity_id: $id,
        _valid_from: $now,
        _valid_to: null,
        _recorded_at: $now,
        _version: 1,
        _actor: $actor
      })
      SET s += $properties
      CREATE (e)-[:CURRENT]->(s)
      CREATE (a:AuditEntry {
        _id: $auditId,
        _entity_id: $id,
        _entity_label: $label,
        _action: 'create',
        _actor: $actor,
        _timestamp: $now,
        _changes: null
      })
      CREATE (e)-[:AUDITED]->(a)
      RETURN e, s
    `,
    params: {
      id: params.id,
      label: params.label,
      now: params.now,
      actor: params.actor,
      properties: params.properties,
      auditId: params.auditId,
    },
  };
}

/** Update: close current state, create new state, re-point CURRENT + audit in one query */
export function cypherUpdateEntity(params: {
  id: string;
  label: string;
  properties: Record<string, unknown>;
  actor: string;
  now: string;
  auditId: string;
  changes?: string | null;
}): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity {_id: $id})-[cur:CURRENT]->(old:State)
      SET old._valid_to = $now
      DELETE cur
      WITH e, old
      CREATE (s:State {
        _entity_id: $id,
        _valid_from: $now,
        _valid_to: null,
        _recorded_at: $now,
        _version: old._version + 1,
        _actor: $actor
      })
      SET s += $properties
      CREATE (e)-[:CURRENT]->(s)
      CREATE (s)-[:PREVIOUS]->(old)
      CREATE (a:AuditEntry {
        _id: $auditId,
        _entity_id: $id,
        _entity_label: e._label,
        _action: 'update',
        _actor: $actor,
        _timestamp: $now,
        _changes: $changes
      })
      CREATE (e)-[:AUDITED]->(a)
      RETURN e, s, old
    `,
    params: {
      id: params.id,
      now: params.now,
      actor: params.actor,
      properties: params.properties,
      auditId: params.auditId,
      changes: params.changes ?? null,
    },
  };
}

/** Soft-delete: close current state's _valid_to + audit in one query */
export function cypherDeleteEntity(params: {
  id: string;
  actor: string;
  now: string;
  auditId: string;
}): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity {_id: $id})-[:CURRENT]->(s:State)
      SET s._valid_to = $now
      SET e._deleted_at = $now
      SET e._deleted_by = $actor
      WITH e, s
      CREATE (a:AuditEntry {
        _id: $auditId,
        _entity_id: $id,
        _entity_label: e._label,
        _action: 'delete',
        _actor: $actor,
        _timestamp: $now,
        _changes: null
      })
      CREATE (e)-[:AUDITED]->(a)
      RETURN e, s
    `,
    params: { id: params.id, actor: params.actor, now: params.now, auditId: params.auditId },
  };
}

/** Create a relationship between two entities + audit in one query */
export function cypherRelate(params: {
  fromId: string;
  toId: string;
  type: string;
  properties?: Record<string, unknown>;
  now: string;
  actor: string;
  auditId: string;
}): { query: string; params: Record<string, unknown> } {
  const type = sanitizeIdentifier(params.type);
  return {
    query: `
      MATCH (from:Entity {_id: $fromId})
      MATCH (to:Entity {_id: $toId})
      CREATE (from)-[r:${type} {
        _created_at: $now,
        _valid_from: $now,
        _valid_to: null,
        _actor: $actor
      }]->(to)
      SET r += $properties
      CREATE (a:AuditEntry {
        _id: $auditId,
        _entity_id: $fromId,
        _entity_label: from._label,
        _action: 'relate',
        _actor: $actor,
        _timestamp: $now,
        _changes: null
      })
      CREATE (from)-[:AUDITED]->(a)
      RETURN from, r, to
    `,
    params: {
      fromId: params.fromId,
      toId: params.toId,
      now: params.now,
      actor: params.actor,
      properties: params.properties ?? {},
      auditId: params.auditId,
    },
  };
}

/** Soft-delete a relationship + audit in one query */
export function cypherUnrelate(params: {
  fromId: string;
  toId: string;
  type: string;
  now: string;
  actor: string;
  auditId: string;
}): { query: string; params: Record<string, unknown> } {
  const type = sanitizeIdentifier(params.type);
  return {
    query: `
      MATCH (from:Entity {_id: $fromId})-[r:${type}]->(to:Entity {_id: $toId})
      WHERE r._valid_to IS NULL
      SET r._valid_to = $now
      WITH from, r, to
      CREATE (a:AuditEntry {
        _id: $auditId,
        _entity_id: $fromId,
        _entity_label: from._label,
        _action: 'unrelate',
        _actor: $actor,
        _timestamp: $now,
        _changes: null
      })
      CREATE (from)-[:AUDITED]->(a)
      RETURN from, r, to
    `,
    params: {
      fromId: params.fromId,
      toId: params.toId,
      now: params.now,
      actor: params.actor,
      auditId: params.auditId,
    },
  };
}

/** Query current state of an entity */
export function cypherGetCurrent(id: string): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity {_id: $id})-[:CURRENT]->(s:State)
      WHERE e._deleted_at IS NULL
      RETURN e, s
    `,
    params: { id },
  };
}

/** Query state at a point in time */
export function cypherGetAtTime(params: {
  id: string;
  timestamp: string;
}): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity {_id: $id})-[:CURRENT|PREVIOUS*]->(s:State)
      WHERE s._valid_from <= $timestamp
        AND (s._valid_to IS NULL OR s._valid_to > $timestamp)
      RETURN e, s
      LIMIT 1
    `,
    params: { id: params.id, timestamp: params.timestamp },
  };
}

/** Get version history for an entity */
export function cypherGetHistory(id: string): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity {_id: $id})-[:CURRENT|PREVIOUS*]->(s:State)
      RETURN s
      ORDER BY s._version DESC
    `,
    params: { id },
  };
}

/** Query all current entities of a label */
export function cypherQueryByLabel(label: string): { query: string; params: Record<string, unknown> } {
  const safeLabel = sanitizeIdentifier(label);
  return {
    query: `
      MATCH (e:Entity:${safeLabel})-[:CURRENT]->(s:State)
      WHERE e._deleted_at IS NULL AND s._valid_to IS NULL
      RETURN e, s
    `,
    params: {},
  };
}

/** Query all active relationships for an entity */
export function cypherGetRelationships(id: string): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity {_id: $id})-[r]->(t:Entity)
      WHERE type(r) <> 'CURRENT' AND type(r) <> 'PREVIOUS' AND type(r) <> 'AUDITED'
        AND (r._valid_to IS NULL)
      RETURN type(r) AS relType, 'outgoing' AS direction, t._id AS targetId, t._label AS targetLabel
      UNION ALL
      MATCH (e:Entity {_id: $id})<-[r]-(s:Entity)
      WHERE type(r) <> 'CURRENT' AND type(r) <> 'PREVIOUS' AND type(r) <> 'AUDITED'
        AND (r._valid_to IS NULL)
      RETURN type(r) AS relType, 'incoming' AS direction, s._id AS targetId, s._label AS targetLabel
    `,
    params: { id },
  };
}

// ── Agent memory queries ──

/** Get all entities changed since a timestamp via audit trail */
export function cypherChangesSince(params: {
  since: string;
  labels?: string[];
  actors?: string[];
  limit: number;
}): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity)-[:AUDITED]->(a:AuditEntry)
      WHERE a._timestamp > $since
        AND ($labels IS NULL OR e._label IN $labels)
        AND ($actors IS NULL OR a._actor IN $actors)
        AND e._deleted_at IS NULL
      WITH e, collect(a { .* }) AS audits, max(a._timestamp) AS lastChange
      ORDER BY lastChange DESC
      LIMIT $limit
      OPTIONAL MATCH (e)-[:CURRENT]->(s:State)
      RETURN e, s, audits, lastChange
    `,
    params: {
      since: params.since,
      labels: params.labels ?? null,
      actors: params.actors ?? null,
      limit: params.limit,
    },
  };
}

/** Search entities by label with property filters */
export function cypherSearch(params: {
  label: string;
  filters: Array<{ property: string; operator: string; value: unknown }>;
  limit: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
}): { query: string; params: Record<string, unknown> } {
  const safeLabel = sanitizeIdentifier(params.label);
  const whereClauses: string[] = [];
  const queryParams: Record<string, unknown> = { limit: params.limit };

  for (let i = 0; i < params.filters.length; i++) {
    const f = params.filters[i];
    const prop = sanitizeIdentifier(f.property);
    const paramKey = `filter_${i}`;
    queryParams[paramKey] = f.value;

    switch (f.operator) {
      case "eq":
        whereClauses.push(`s.${prop} = $${paramKey}`);
        break;
      case "contains":
        whereClauses.push(`s.${prop} CONTAINS $${paramKey}`);
        break;
      case "gt":
        whereClauses.push(`s.${prop} > $${paramKey}`);
        break;
      case "lt":
        whereClauses.push(`s.${prop} < $${paramKey}`);
        break;
      case "gte":
        whereClauses.push(`s.${prop} >= $${paramKey}`);
        break;
      case "lte":
        whereClauses.push(`s.${prop} <= $${paramKey}`);
        break;
      case "in":
        whereClauses.push(`s.${prop} IN $${paramKey}`);
        break;
    }
  }

  const whereStr = whereClauses.length > 0 ? `AND ${whereClauses.join(" AND ")}` : "";
  const orderProp = params.orderBy ? sanitizeIdentifier(params.orderBy) : null;
  const orderStr = orderProp
    ? `ORDER BY s.${orderProp} ${params.orderDir === "asc" ? "ASC" : "DESC"}`
    : "";

  return {
    query: `
      MATCH (e:Entity:${safeLabel})-[:CURRENT]->(s:State)
      WHERE e._deleted_at IS NULL AND s._valid_to IS NULL ${whereStr}
      RETURN e, s
      ${orderStr}
      LIMIT $limit
    `,
    params: queryParams,
  };
}

/** Get a graph summary: entity counts by label, last activity */
export function cypherGraphSummary(): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      MATCH (e:Entity)-[:CURRENT]->(s:State)
      WHERE e._deleted_at IS NULL AND s._valid_to IS NULL
      WITH e._label AS label, count(*) AS count, max(s._valid_from) AS lastModified
      RETURN label, count, lastModified
      ORDER BY count DESC
    `,
    params: {},
  };
}

/** Write standalone audit entry (for cases not covered by combined queries) */
export function cypherAuditEntry(params: {
  id: string;
  entityId: string;
  entityLabel: string;
  action: string;
  actor: string;
  timestamp: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
}): { query: string; params: Record<string, unknown> } {
  return {
    query: `
      CREATE (a:AuditEntry {
        _id: $auditId,
        _entity_id: $entityId,
        _entity_label: $entityLabel,
        _action: $action,
        _actor: $actor,
        _timestamp: $timestamp,
        _changes: $changes
      })
      WITH a
      MATCH (e:Entity {_id: $entityId})
      CREATE (e)-[:AUDITED]->(a)
      RETURN a
    `,
    params: {
      auditId: params.id,
      entityId: params.entityId,
      entityLabel: params.entityLabel,
      action: params.action,
      actor: params.actor,
      timestamp: params.timestamp,
      changes: params.changes ? JSON.stringify(params.changes) : null,
    },
  };
}

/** Run a compiled query in a transaction */
export async function runQuery(
  tx: ManagedTransaction,
  compiled: { query: string; params: Record<string, unknown> }
) {
  return tx.run(compiled.query, compiled.params);
}
