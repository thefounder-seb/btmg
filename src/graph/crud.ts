/**
 * High-level graph CRUD operations.
 * Pipeline: validate → version → audit → write (all in one transaction)
 */

import { randomUUID } from "node:crypto";
import type { Neo4jClient } from "../neo4j/client.js";
import type { SchemaRegistry } from "../schema/registry.js";
import * as cypher from "../neo4j/cypher.js";
import { getCurrent } from "../temporal/model.js";

export interface MutationOptions {
  actor: string;
}

export interface UpsertResult {
  id: string;
  version: number;
  created: boolean;
}

/** Create or update an entity. Validates against schema before writing. */
export async function upsert(
  client: Neo4jClient,
  registry: SchemaRegistry,
  label: string,
  id: string | undefined,
  properties: Record<string, unknown>,
  opts: MutationOptions
): Promise<UpsertResult> {
  // Validate
  const validator = registry.getNodeValidator(label);
  const validation = validator.validate(properties);
  if (!validation.success) {
    throw new Error(`Validation failed for ${label}: ${validation.error}`);
  }

  const now = new Date().toISOString();
  const entityId = id ?? randomUUID();
  const auditId = randomUUID();

  // Check if entity exists
  const current = await getCurrent(client, entityId);
  const isCreate = current === null;

  if (isCreate) {
    // Create entity + first state + audit in one transaction
    await client.write(async (tx) => {
      const compiled = cypher.cypherCreateEntity({
        id: entityId,
        label,
        properties: validation.data!,
        actor: opts.actor,
        now,
        auditId,
      });
      return cypher.runQuery(tx, compiled);
    });

    return { id: entityId, version: 1, created: true };
  } else {
    // Update entity + new state + audit in one transaction
    const result = await client.write(async (tx) => {
      const compiled = cypher.cypherUpdateEntity({
        id: entityId,
        label,
        properties: validation.data!,
        actor: opts.actor,
        now,
        auditId,
      });
      return cypher.runQuery(tx, compiled);
    });

    const newVersion = cypher.toNumber(result.records[0].get("s").properties._version);
    return { id: entityId, version: newVersion, created: false };
  }
}

/** Soft-delete an entity (with audit in same transaction) */
export async function remove(
  client: Neo4jClient,
  id: string,
  opts: MutationOptions
): Promise<void> {
  const now = new Date().toISOString();
  const auditId = randomUUID();

  await client.write(async (tx) => {
    const compiled = cypher.cypherDeleteEntity({
      id,
      actor: opts.actor,
      now,
      auditId,
    });
    return cypher.runQuery(tx, compiled);
  });
}

/** Create a relationship between two entities (with audit in same transaction) */
export async function relate(
  client: Neo4jClient,
  registry: SchemaRegistry,
  fromId: string,
  toId: string,
  type: string,
  fromLabel: string,
  toLabel: string,
  properties?: Record<string, unknown>,
  opts?: MutationOptions
): Promise<void> {
  // Validate edge schema
  const validator = registry.getEdgeValidator(fromLabel, type, toLabel);
  if (properties) {
    const validation = validator.validate(properties);
    if (!validation.success) {
      throw new Error(`Edge validation failed for ${type}: ${validation.error}`);
    }
  }

  const now = new Date().toISOString();
  const actor = opts?.actor ?? "system";
  const auditId = randomUUID();

  await client.write(async (tx) => {
    const compiled = cypher.cypherRelate({
      fromId,
      toId,
      type,
      properties,
      now,
      actor,
      auditId,
    });
    return cypher.runQuery(tx, compiled);
  });
}

/** Soft-delete a relationship (with audit in same transaction) */
export async function unrelate(
  client: Neo4jClient,
  fromId: string,
  toId: string,
  type: string,
  opts?: MutationOptions
): Promise<void> {
  const now = new Date().toISOString();
  const actor = opts?.actor ?? "system";
  const auditId = randomUUID();

  await client.write(async (tx) => {
    const compiled = cypher.cypherUnrelate({
      fromId,
      toId,
      type,
      now,
      actor,
      auditId,
    });
    return cypher.runQuery(tx, compiled);
  });
}
