/**
 * MCP resource definitions for BTMG.
 * 5 resources: schema, entity state, changelog, audit trail, sync status
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Neo4jClient } from "../neo4j/client.js";
import type { SchemaRegistry } from "../schema/registry.js";
import { getCurrent, getHistory } from "../temporal/model.js";
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
}
