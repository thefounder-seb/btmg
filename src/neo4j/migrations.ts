/**
 * Apply Neo4j constraints and indexes from schema definition.
 */

import type { Neo4jClient } from "./client.js";
import type { SchemaDef } from "../schema/types.js";
import { sanitizeIdentifier } from "./cypher.js";

/** Apply schema constraints and indexes to Neo4j */
export async function applyMigrations(client: Neo4jClient, schema: SchemaDef): Promise<string[]> {
  const applied: string[] = [];

  // Always create Entity._id uniqueness constraint
  await client.run(
    "CREATE CONSTRAINT entity_id_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e._id IS UNIQUE"
  );
  applied.push("CONSTRAINT entity_id_unique");

  // Create index on State._entity_id
  await client.run(
    "CREATE INDEX state_entity_id IF NOT EXISTS FOR (s:State) ON (s._entity_id)"
  );
  applied.push("INDEX state_entity_id");

  // Create index on AuditEntry
  await client.run(
    "CREATE INDEX audit_entity_id IF NOT EXISTS FOR (a:AuditEntry) ON (a._entity_id)"
  );
  applied.push("INDEX audit_entity_id");

  // Create label-specific constraints
  for (const node of schema.nodes) {
    const label = sanitizeIdentifier(node.label);
    const indexName = sanitizeIdentifier(`entity_${label.toLowerCase()}_label`);
    await client.run(
      `CREATE INDEX ${indexName} IF NOT EXISTS FOR (e:${label}) ON (e._id)`
    );
    applied.push(`INDEX ${indexName}`);
  }

  // User-defined constraints
  if (schema.constraints) {
    for (const c of schema.constraints) {
      const label = sanitizeIdentifier(c.label);
      const property = sanitizeIdentifier(c.property);
      const name = sanitizeIdentifier(`user_${label}_${property}_${c.type}`.toLowerCase());
      switch (c.type) {
        case "unique":
          await client.run(
            `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${property} IS UNIQUE`
          );
          break;
        case "exists":
          await client.run(
            `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${property} IS NOT NULL`
          );
          break;
        case "index":
          await client.run(
            `CREATE INDEX ${name} IF NOT EXISTS FOR (n:${label}) ON (n.${property})`
          );
          break;
      }
      applied.push(`${c.type.toUpperCase()} ${name}`);
    }
  }

  return applied;
}
