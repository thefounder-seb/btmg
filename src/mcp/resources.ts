/**
 * MCP resource definitions for BTMG.
 * 7 resources: schema, entity state, changelog, audit trail, summary, session/last, observations
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Neo4jClient } from "../neo4j/client.js";
import type { SchemaRegistry } from "../schema/registry.js";
import { getCurrent, getHistory, getGraphSummary, searchEntities } from "../temporal/model.js";
import { queryAudit } from "../audit/logger.js";
import { buildChangelog } from "../temporal/diff.js";

export function registerResources(
  server: McpServer,
  client: Neo4jClient,
  registry: SchemaRegistry
) {
  // Schema resource — lets AI agents discover valid types/properties
  server.resource("schema", "btmg://schema", async () => {
    const nodes = registry.getNodeDefs();
    const edges = registry.getEdgeDefs();
    return {
      contents: [
        {
          uri: "btmg://schema",
          mimeType: "application/json",
          text: JSON.stringify({ nodes, edges }, null, 2),
        },
      ],
    };
  });

  // Entity state resource (parameterized by ID)
  server.resource(
    "entity",
    "btmg://entity/{id}",
    async (uri) => {
      const id = uri.pathname.split("/").pop() ?? "";
      const entity = await getCurrent(client, id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(entity, null, 2),
          },
        ],
      };
    }
  );

  // Changelog resource
  server.resource(
    "changelog",
    "btmg://changelog/{id}",
    async (uri) => {
      const id = uri.pathname.split("/").pop() ?? "";
      const history = await getHistory(client, id);
      const changelog = buildChangelog(id, history);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(changelog, null, 2),
          },
        ],
      };
    }
  );

  // Audit trail resource
  server.resource(
    "audit",
    "btmg://audit/{id}",
    async (uri) => {
      const id = uri.pathname.split("/").pop() ?? "";
      const entries = await queryAudit(client, id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(entries, null, 2),
          },
        ],
      };
    }
  );

  // Graph summary resource
  server.resource("summary", "btmg://summary", async () => {
    const summary = await getGraphSummary(client);
    return {
      contents: [
        {
          uri: "btmg://summary",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              entityCounts: summary,
              totalEntities: summary.reduce((acc, s) => acc + s.count, 0),
            },
            null,
            2
          ),
        },
      ],
    };
  });

  // Last session for an agent
  server.resource(
    "session-last",
    "btmg://session/{agentId}/last",
    async (uri) => {
      const parts = uri.pathname.split("/");
      const agentId = parts[parts.length - 2] ?? "";
      let session = null;
      try {
        const sessions = await searchEntities(client, "AgentSession", [
          { property: "agentId", operator: "eq", value: agentId },
        ], { limit: 1, orderBy: "startedAt", orderDir: "desc" });
        if (sessions.length > 0) session = sessions[0];
      } catch {
        // AgentSession not in schema
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(session, null, 2),
          },
        ],
      };
    }
  );

  // Observations for an entity
  server.resource(
    "observations",
    "btmg://observations/{entityId}",
    async (uri) => {
      const entityId = uri.pathname.split("/").pop() ?? "";
      let observations: unknown[] = [];
      try {
        const allObs = await searchEntities(client, "Observation", [
          { property: "status", operator: "eq", value: "open" },
        ], { limit: 50 });
        // Return all open observations (filtering by entity relationship would need a custom query)
        observations = allObs;
      } catch {
        // Observation not in schema
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ entityId, observations }, null, 2),
          },
        ],
      };
    }
  );
}
