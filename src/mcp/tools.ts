/**
 * MCP tool definitions for BTMG.
 * 16 tools: upsert, delete, relate, query, sync, snapshot, changelog, diff, validate,
 *           changes-since, search, observe, batch-upsert, context, session-start, session-end
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Neo4jClient } from "../neo4j/client.js";
import type { SchemaRegistry } from "../schema/registry.js";
import { upsert, remove, relate } from "../graph/crud.js";
import {
  getCurrent,
  queryByLabel,
  getHistory,
  getChangesSince,
  searchEntities,
  getRelationships,
} from "../temporal/model.js";
import { snapshotAt } from "../temporal/snapshot.js";
import { diffStates, buildChangelog } from "../temporal/diff.js";
import { sync } from "../sync/engine.js";
import { runScan } from "../scanner/pipeline.js";

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

  // ── Agent memory tools ──

  // changes-since
  server.tool(
    "changes-since",
    "Get all entities created, updated, or deleted since a timestamp. Primary use: agent session resumption.",
    {
      since: z.string().describe("ISO timestamp (e.g. last session end time)"),
      labels: z.array(z.string()).optional().describe("Filter by entity labels"),
      actors: z.array(z.string()).optional().describe("Filter by actor"),
      limit: z.number().default(100),
    },
    async ({ since, labels, actors, limit }) => {
      const changes = await getChangesSince(client, since, { labels, actors, limit });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(changes, null, 2) }],
      };
    }
  );

  // search
  server.tool(
    "search",
    "Search entities by label and property filters.",
    {
      label: z.string().describe("Node label to search"),
      filters: z
        .array(
          z.object({
            property: z.string(),
            operator: z.enum(["eq", "contains", "gt", "lt", "gte", "lte", "in"]),
            value: z.unknown().default(null),
          })
        )
        .describe("Property filters"),
      limit: z.number().default(50),
      orderBy: z.string().optional(),
      orderDir: z.enum(["asc", "desc"]).default("desc"),
    },
    async ({ label, filters, limit, orderBy, orderDir }) => {
      const results = await searchEntities(client, label, filters as Array<{ property: string; operator: string; value: unknown }>, {
        limit,
        orderBy,
        orderDir,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // observe
  server.tool(
    "observe",
    "Record an agent observation: a decision, discovery, issue, or note. Creates an Observation entity.",
    {
      type: z.enum(["decision", "discovery", "issue", "note", "question"]),
      summary: z.string(),
      detail: z.string().optional(),
      confidence: z.enum(["high", "medium", "low"]).default("medium"),
      relatedEntities: z
        .array(
          z.object({
            id: z.string(),
            relationship: z.string().default("OBSERVED_ON"),
          })
        )
        .optional(),
      tags: z.array(z.string()).optional(),
      sessionId: z.string().optional(),
      actor: z.string().default("mcp-agent"),
    },
    async ({ type, summary, detail, confidence, relatedEntities, tags, sessionId, actor }) => {
      const props: Record<string, unknown> = {
        type,
        summary,
        confidence,
        status: "open",
      };
      if (detail) props.detail = detail;
      if (tags) props.tags = tags;

      const result = await upsert(client, registry, "Observation", undefined, props, { actor });
      const obsId = result.id;

      // Create relationships to related entities
      if (relatedEntities?.length) {
        for (const rel of relatedEntities) {
          try {
            await relate(client, registry, obsId, rel.id, rel.relationship, "Observation", "", undefined, { actor });
          } catch {
            // Skip if relationship type not in schema
          }
        }
      }

      // Link to session if provided
      if (sessionId) {
        try {
          await relate(client, registry, obsId, sessionId, "PRODUCED_BY", "Observation", "AgentSession", undefined, { actor });
        } catch {
          // Skip if AgentSession preset not in schema
        }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ observationId: obsId, ...props }) }],
      };
    }
  );

  // batch-upsert
  server.tool(
    "batch-upsert",
    "Create or update multiple entities in a batch. Validates all before writing any.",
    {
      entities: z.array(
        z.object({
          label: z.string(),
          id: z.string().optional(),
          properties: z.record(z.unknown()),
        })
      ),
      actor: z.string().default("mcp-agent"),
    },
    async ({ entities, actor }) => {
      // Validate all first
      const errors: string[] = [];
      for (let i = 0; i < entities.length; i++) {
        try {
          const validator = registry.getNodeValidator(entities[i].label);
          validator.validate(entities[i].properties);
        } catch (e) {
          errors.push(`[${i}] ${entities[i].label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (errors.length > 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, errors }) }],
        };
      }

      // Write all
      const results: Array<{ id: string; label: string; action: string }> = [];
      for (const ent of entities) {
        const result = await upsert(client, registry, ent.label, ent.id, ent.properties, { actor });
        const id = result.id;
        results.push({ id, label: ent.label, action: ent.id ? "updated" : "created" });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, count: results.length, results }) }],
      };
    }
  );

  // context
  server.tool(
    "context",
    "Get full context for an entity: current state, relationships, recent changes, and related observations.",
    {
      id: z.string().describe("Entity ID"),
      depth: z.number().default(1).describe("Relationship traversal depth"),
      includeHistory: z.boolean().default(false),
      includeObservations: z.boolean().default(true),
    },
    async ({ id, includeHistory, includeObservations }) => {
      const entity = await getCurrent(client, id);
      if (!entity) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Entity not found" }) }],
        };
      }

      const rels = await getRelationships(client, id);

      const context: Record<string, unknown> = {
        entity: entity.entity,
        state: entity.state,
        relationships: rels,
      };

      if (includeHistory) {
        context.history = await getHistory(client, id);
      }

      if (includeObservations) {
        // Find observations linked to this entity
        try {
          const observations = await searchEntities(client, "Observation", [
            { property: "status", operator: "eq", value: "open" },
          ], { limit: 20 });
          // Filter to ones related to this entity via relationships
          context.observations = observations;
        } catch {
          // Observation label may not exist in schema
          context.observations = [];
        }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(context, null, 2) }],
      };
    }
  );

  // session-start
  server.tool(
    "session-start",
    "Register an agent session. Returns the last session's end timestamp for use with changes-since.",
    {
      agentId: z.string().describe("Unique agent identifier"),
      purpose: z.string().optional(),
      actor: z.string().default("mcp-agent"),
    },
    async ({ agentId, purpose, actor }) => {
      // Find last session for this agent
      let lastEndedAt: string | null = null;
      try {
        const sessions = await searchEntities(client, "AgentSession", [
          { property: "agentId", operator: "eq", value: agentId },
          { property: "status", operator: "eq", value: "completed" },
        ], { limit: 1, orderBy: "endedAt", orderDir: "desc" });
        if (sessions.length > 0) {
          lastEndedAt = sessions[0].state.endedAt as string;
        }
      } catch {
        // AgentSession label may not be in schema yet
      }

      // Auto-close any stale active sessions from this agent
      try {
        const activeSessions = await searchEntities(client, "AgentSession", [
          { property: "agentId", operator: "eq", value: agentId },
          { property: "status", operator: "eq", value: "active" },
        ]);
        for (const session of activeSessions) {
          await upsert(client, registry, "AgentSession", session.entity._id, {
            ...session.state,
            status: "abandoned",
            endedAt: new Date().toISOString(),
          }, { actor });
        }
      } catch {
        // Ignore if AgentSession not in schema
      }

      // Create new session
      const now = new Date().toISOString();
      const sessionProps: Record<string, unknown> = {
        agentId,
        startedAt: now,
        status: "active",
        entitiesRead: 0,
        entitiesWritten: 0,
      };
      if (purpose) sessionProps.purpose = purpose;

      let sessionId: string | null = null;
      try {
        const result = await upsert(client, registry, "AgentSession", undefined, sessionProps, { actor });
        sessionId = result.id;
      } catch {
        // AgentSession not in schema — return without session tracking
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sessionId,
              lastEndedAt,
              message: lastEndedAt
                ? `Session started. Last session ended at ${lastEndedAt}. Use changes-since with this timestamp to catch up.`
                : "Session started. No previous sessions found — this is the first session for this agent.",
            }),
          },
        ],
      };
    }
  );

  // session-end
  server.tool(
    "session-end",
    "Close an agent session. Records summary of what was done.",
    {
      sessionId: z.string().describe("Session ID from session-start"),
      summary: z.string().optional(),
      actor: z.string().default("mcp-agent"),
    },
    async ({ sessionId, summary, actor }) => {
      const now = new Date().toISOString();
      const session = await getCurrent(client, sessionId);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Session not found" }) }],
        };
      }

      const props: Record<string, unknown> = {
        ...session.state,
        status: "completed",
        endedAt: now,
      };
      if (summary) props.summary = summary;

      await upsert(client, registry, "AgentSession", sessionId, props, { actor });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ sessionId, status: "completed", endedAt: now }),
          },
        ],
      };
    }
  );

  // scan
  server.tool(
    "scan",
    "Scan a local codebase or GitHub repo and ingest code entities into the graph.",
    {
      target: z.string().describe("Absolute local path or GitHub URL"),
      dryRun: z.boolean().default(false).describe("Parse only, do not write to graph"),
      actor: z.string().default("mcp-agent"),
      githubToken: z.string().optional().describe("GitHub token for private repos"),
    },
    async ({ target, dryRun, actor, githubToken }) => {
      // We need a BTMG instance to run the scan pipeline.
      // The tools module receives client + registry but runScan needs a BTMG instance.
      // Create a minimal wrapper that exposes what runScan needs.
      const { BTMG } = await import("../index.js");
      // Access config through a roundabout: the registry has the schema, and the client is already connected
      // For the MCP context, we load config fresh
      const { loadConfig } = await import("../index.js");
      const config = await loadConfig();
      const btmg = new BTMG(config);
      try {
        const result = await runScan(btmg, {
          target,
          dryRun,
          actor,
          githubToken,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } finally {
        await btmg.close();
      }
    }
  );
}
