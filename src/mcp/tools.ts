/**
 * MCP tool definitions for BTMG.
 * 9 tools: upsert, delete, relate, query, sync, snapshot, changelog, diff, validate
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Neo4jClient } from "../neo4j/client.js";
import type { SchemaRegistry } from "../schema/registry.js";
import { upsert, remove, relate } from "../graph/crud.js";
import { getCurrent, queryByLabel, getHistory } from "../temporal/model.js";
import { snapshotAt } from "../temporal/snapshot.js";
import { diffStates, buildChangelog } from "../temporal/diff.js";
import { sync } from "../sync/engine.js";

export function registerTools(
  server: McpServer,
  client: Neo4jClient,
  registry: SchemaRegistry,
  docsDir?: string
) {
  // upsert
  server.tool(
    "upsert",
    "Create or update a graph entity. Properties are validated against the schema.",
    {
      label: z.string().describe("Node label (must be in schema)"),
      id: z.string().optional().describe("Entity ID (auto-generated if omitted)"),
      properties: z.record(z.unknown()).describe("Entity properties"),
      actor: z.string().default("mcp-agent").describe("Actor for audit trail"),
    },
    async ({ label, id, properties, actor }) => {
      const result = await upsert(client, registry, label, id, properties, { actor });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }
  );

  // delete
  server.tool(
    "delete",
    "Soft-delete a graph entity (sets _valid_to, preserves history).",
    {
      id: z.string().describe("Entity ID to delete"),
      actor: z.string().default("mcp-agent"),
    },
    async ({ id, actor }) => {
      await remove(client, id, { actor });
      return {
        content: [{ type: "text" as const, text: `Deleted entity ${id}` }],
      };
    }
  );

  // relate
  server.tool(
    "relate",
    "Create a typed relationship between two entities.",
    {
      fromId: z.string(),
      toId: z.string(),
      type: z.string().describe("Relationship type (must be in schema)"),
      fromLabel: z.string(),
      toLabel: z.string(),
      properties: z.record(z.unknown()).optional(),
      actor: z.string().default("mcp-agent"),
    },
    async ({ fromId, toId, type, fromLabel, toLabel, properties, actor }) => {
      await relate(client, registry, fromId, toId, type, fromLabel, toLabel, properties, {
        actor,
      });
      return {
        content: [{ type: "text" as const, text: `Created ${type} from ${fromId} to ${toId}` }],
      };
    }
  );

  // query
  server.tool(
    "query",
    "Query current state of entities by label or ID.",
    {
      label: z.string().optional().describe("Filter by node label"),
      id: z.string().optional().describe("Get specific entity by ID"),
    },
    async ({ label, id }) => {
      if (id) {
        const entity = await getCurrent(client, id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(entity, null, 2) }],
        };
      }
      if (label) {
        const entities = await queryByLabel(client, label);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(entities, null, 2) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: "Provide either label or id" }],
      };
    }
  );

  // sync
  server.tool(
    "sync",
    "Run bidirectional sync between graph and documentation files.",
    {
      docsDir: z.string().optional().describe("Docs directory (uses config default if omitted)"),
      conflictStrategy: z
        .enum(["graph-wins", "docs-wins", "fail", "merge"])
        .default("graph-wins"),
      actor: z.string().default("mcp-agent"),
    },
    async ({ docsDir: dir, conflictStrategy, actor }) => {
      const syncDir = dir ?? docsDir ?? "./docs";
      const result = await sync(client, registry, {
        docsDir: syncDir,
        conflictStrategy,
        actor,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // snapshot
  server.tool(
    "snapshot",
    "Reconstruct the graph at a specific point in time.",
    {
      timestamp: z.string().describe("ISO timestamp for point-in-time query"),
      labels: z.array(z.string()).optional(),
    },
    async ({ timestamp, labels }) => {
      const snap = await snapshotAt(client, registry, timestamp, labels);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(snap, null, 2) }],
      };
    }
  );

  // changelog
  server.tool(
    "changelog",
    "Get the version changelog for an entity.",
    {
      id: z.string().describe("Entity ID"),
    },
    async ({ id }) => {
      const history = await getHistory(client, id);
      const changelog = buildChangelog(id, history);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(changelog, null, 2) }],
      };
    }
  );

  // diff
  server.tool(
    "diff",
    "Compare two versions of an entity.",
    {
      id: z.string(),
      fromVersion: z.number(),
      toVersion: z.number(),
    },
    async ({ id, fromVersion, toVersion }) => {
      const history = await getHistory(client, id);
      const from = history.find((s) => Number(s._version) === fromVersion);
      const to = history.find((s) => Number(s._version) === toVersion);
      if (!from || !to) {
        return {
          content: [{ type: "text" as const, text: "Version not found" }],
        };
      }
      const d = diffStates(id, from, to);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }],
      };
    }
  );

  // validate
  server.tool(
    "validate",
    "Validate data against the schema without writing.",
    {
      label: z.string(),
      properties: z.record(z.unknown()),
    },
    async ({ label, properties }) => {
      try {
        const validator = registry.getNodeValidator(label);
        const result = validator.validate(properties);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: e instanceof Error ? e.message : String(e),
              }),
            },
          ],
        };
      }
    }
  );
}
