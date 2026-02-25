/**
 * CLI entrypoint — Commander-based CLI for BTMG.
 * Commands: init, sync, snapshot, changelog, validate, query, serve, migrate
 */

import { Command } from "commander";
import chalk from "chalk";
import { Neo4jClient } from "../neo4j/client.js";
import { SchemaRegistry } from "../schema/registry.js";
import { loadConfig } from "../index.js";
import { applyMigrations } from "../neo4j/migrations.js";
import { sync } from "../sync/engine.js";
import { snapshotAt } from "../temporal/snapshot.js";
import { getCurrent, getHistory } from "../temporal/model.js";
import { buildChangelog } from "../temporal/diff.js";
import { startMcpServer } from "../mcp/index.js";

const program = new Command();

program
  .name("btmg")
  .description("Bidirectional Temporal Memory Graph CLI")
  .version("0.1.0");

function createClient(config: Awaited<ReturnType<typeof loadConfig>>) {
  return new Neo4jClient({
    uri: config.neo4j?.uri ?? process.env.NEO4J_URI ?? "bolt://localhost:7687",
    username: config.neo4j?.username ?? process.env.NEO4J_USERNAME ?? "neo4j",
    password: config.neo4j?.password ?? process.env.NEO4J_PASSWORD ?? "password",
    database: config.neo4j?.database,
  });
}

// init
program
  .command("init")
  .description("Initialize a btmg.config.ts in the current directory")
  .action(async () => {
    const { writeFileSync, existsSync } = await import("node:fs");
    if (existsSync("btmg.config.ts")) {
      console.log(chalk.yellow("btmg.config.ts already exists"));
      return;
    }
    writeFileSync(
      "btmg.config.ts",
      `import { defineSchema } from "btmg-fourthspace";

export default defineSchema({
  schema: {
    nodes: [
      {
        label: "Example",
        properties: {
          name: { type: "string", required: true },
          description: { type: "string" },
        },
      },
    ],
    edges: [],
  },
});
`,
      "utf-8"
    );
    console.log(chalk.green("Created btmg.config.ts"));
  });

// migrate
program
  .command("migrate")
  .description("Apply schema constraints and indexes to Neo4j")
  .option("-c, --config <path>", "Config file path")
  .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const client = createClient(config);
    try {
      const applied = await applyMigrations(client, config.schema);
      console.log(chalk.green(`Applied ${applied.length} constraints/indexes:`));
      applied.forEach((a) => console.log(`  ${a}`));
    } finally {
      await client.close();
    }
  });

// sync
program
  .command("sync")
  .description("Run bidirectional sync between graph and docs")
  .option("-c, --config <path>", "Config file path")
  .option("-d, --docs <dir>", "Docs directory")
  .option("--strategy <strategy>", "Conflict strategy", "graph-wins")
  .option("--actor <actor>", "Actor for audit trail", "btmg-cli")
  .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const client = createClient(config);
    const registry = new SchemaRegistry(config.schema);
    try {
      const result = await sync(client, registry, {
        docsDir: opts.docs ?? config.docs?.directory ?? "./docs",
        conflictStrategy: opts.strategy,
        actor: opts.actor,
      });
      console.log(chalk.green("Sync complete:"));
      console.log(`  Created: ${result.created}`);
      console.log(`  Updated: ${result.updated}`);
      console.log(`  Conflicts: ${result.conflicts.length}`);
      if (result.errors.length) {
        console.log(chalk.red(`  Errors: ${result.errors.length}`));
        result.errors.forEach((e) => console.log(`    ${e.message}`));
      }
    } finally {
      await client.close();
    }
  });

// snapshot
program
  .command("snapshot")
  .description("Reconstruct graph at a point in time")
  .argument("<timestamp>", "ISO timestamp")
  .option("-c, --config <path>", "Config file path")
  .option("-l, --labels <labels>", "Comma-separated labels")
  .action(async (timestamp, opts) => {
    const config = await loadConfig(opts.config);
    const client = createClient(config);
    const registry = new SchemaRegistry(config.schema);
    try {
      const labels = opts.labels?.split(",");
      const snap = await snapshotAt(client, registry, timestamp, labels);
      console.log(JSON.stringify(snap, null, 2));
    } finally {
      await client.close();
    }
  });

// changelog
program
  .command("changelog")
  .description("Show version history for an entity")
  .argument("<id>", "Entity ID")
  .option("-c, --config <path>", "Config file path")
  .action(async (id, opts) => {
    const config = await loadConfig(opts.config);
    const client = createClient(config);
    try {
      const history = await getHistory(client, id);
      const changelog = buildChangelog(id, history);
      console.log(JSON.stringify(changelog, null, 2));
    } finally {
      await client.close();
    }
  });

// validate
program
  .command("validate")
  .description("Validate data against schema")
  .argument("<label>", "Node label")
  .argument("<json>", "JSON properties string")
  .option("-c, --config <path>", "Config file path")
  .action(async (label, json, opts) => {
    const config = await loadConfig(opts.config);
    const registry = new SchemaRegistry(config.schema);
    const props = JSON.parse(json);
    const validator = registry.getNodeValidator(label);
    const result = validator.validate(props);
    if (result.success) {
      console.log(chalk.green("Valid"));
    } else {
      console.log(chalk.red(`Invalid: ${result.error}`));
      process.exitCode = 1;
    }
  });

// query
program
  .command("query")
  .description("Query entity state")
  .option("-c, --config <path>", "Config file path")
  .option("-i, --id <id>", "Entity ID")
  .option("-l, --label <label>", "Node label")
  .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const client = createClient(config);
    try {
      if (opts.id) {
        const entity = await getCurrent(client, opts.id);
        console.log(JSON.stringify(entity, null, 2));
      } else if (opts.label) {
        const { queryByLabel } = await import("../temporal/model.js");
        const entities = await queryByLabel(client, opts.label);
        console.log(JSON.stringify(entities, null, 2));
      } else {
        console.log(chalk.yellow("Provide --id or --label"));
      }
    } finally {
      await client.close();
    }
  });

// serve (MCP server)
program
  .command("serve")
  .description("Start the MCP server (stdio transport)")
  .option("-c, --config <path>", "Config file path")
  .action(async (opts) => {
    await startMcpServer(opts.config);
  });

program.parse();
