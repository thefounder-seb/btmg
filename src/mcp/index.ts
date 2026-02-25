/**
 * MCP server entrypoint — stdio transport.
 * Connects BTMG's graph operations as MCP tools + resources for AI agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Neo4jClient } from "../neo4j/client.js";
import { SchemaRegistry } from "../schema/registry.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { loadConfig } from "../index.js";

export async function startMcpServer(configPath?: string) {
  const config = await loadConfig(configPath);
  const registry = new SchemaRegistry(config.schema);

  const client = new Neo4jClient({
    uri: config.neo4j?.uri ?? process.env.NEO4J_URI ?? "bolt://localhost:7687",
    username: config.neo4j?.username ?? process.env.NEO4J_USERNAME ?? "neo4j",
    password: config.neo4j?.password ?? process.env.NEO4J_PASSWORD ?? "password",
    database: config.neo4j?.database,
  });

  const server = new McpServer({
    name: "btmg",
    version: "0.1.0",
  });

  registerTools(server, client, registry, config.docs?.directory);
  registerResources(server, client, registry);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  const shutdown = async () => {
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
