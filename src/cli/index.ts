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
import { runScan } from "../scanner/pipeline.js";

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
  .option("--framework <framework>", "Docs framework (fumadocs, docusaurus, nextra, vitepress, raw)")
  .option("--docs-dir <dir>", "Docs output directory")
  .option("--scan", "Include scan config for codebase ingestion")
  .action(async (opts) => {
    const { writeFileSync, existsSync } = await import("node:fs");
    if (existsSync("btmg.config.ts")) {
      console.log(chalk.yellow("btmg.config.ts already exists"));
      return;
    }

    const framework = opts.framework ?? "raw";
    const docsDir = opts.docsDir ?? "./docs";

    const scanSection = opts.scan ? `
  scan: {
    mappings: [
      {
        artifactKinds: ["file", "module", "function", "class", "interface", "type"],
        nodeLabel: "CodeEntity",
        properties: {
          name: { from: "name" },
          kind: { from: "kind" },
          filePath: { from: "filePath" },
          language: { from: "language" },
        },
      },
    ],
  },` : "";

    const presetsImport = opts.scan ? ', presets' : '';

    const presetsSection = opts.scan ? `
  // Include codeScanner preset for CodeEntity/Dependency node types
  // Merge with your custom schema nodes/edges:
  // schema: { nodes: [...presets.codeScanner.nodes, ...yourNodes], edges: [...presets.codeScanner.edges] },` : "";

    writeFileSync(
      "btmg.config.ts",
      `import { defineSchema${presetsImport} } from "btmg-fourthspace";
${presetsSection}
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
  docs: {
    outputDir: "${docsDir}",
    framework: "${framework}",
    format: "${framework === "fumadocs" || framework === "nextra" ? "mdx" : "md"}",
  },${scanSection}
});
`,
      "utf-8"
    );
    console.log(chalk.green("Created btmg.config.ts"));
    console.log(`  Framework: ${framework}`);
    console.log(`  Docs dir:  ${docsDir}`);
    if (opts.scan) console.log(`  Scan config: included`);
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

// scan
program
  .command("scan")
  .description("Scan a codebase and ingest entities into the graph")
  .argument("<target>", "Local path or GitHub URL to scan")
  .option("-c, --config <path>", "Config file path")
  .option("--dry-run", "Parse but do not write to graph")
  .option("--actor <actor>", "Actor for audit trail", "btmg-scanner")
  .option("--token <token>", "GitHub token for private repos")
  .action(async (target, opts) => {
    const config = await loadConfig(opts.config);
    const { BTMG: BTMGClass } = await import("../index.js");
    const btmg = new BTMGClass(config);
    try {
      const result = await runScan(btmg, {
        target,
        actor: opts.actor,
        dryRun: opts.dryRun ?? false,
        githubToken: opts.token ?? process.env.GITHUB_TOKEN,
      });
      console.log(chalk.green("Scan complete:"));
      console.log(`  Files discovered: ${result.filesDiscovered}`);
      console.log(`  Files parsed:     ${result.filesParsed}`);
      console.log(`  Artifacts found:  ${result.artifactsExtracted}`);
      console.log(`  Entities upserted: ${result.entitiesUpserted}`);
      console.log(`  Entities skipped:  ${result.entitiesSkipped}`);
      console.log(`  Relations created: ${result.relationsCreated}`);
      if (result.dryRun) console.log(chalk.yellow("  (dry run — nothing written)"));
      if (result.errors.length) {
        console.log(chalk.red(`  Errors: ${result.errors.length}`));
        result.errors.forEach((e) => console.log(`    ${e.message}`));
      }
    } finally {
      await btmg.close();
    }
  });

// docs
const docs = program
  .command("docs")
  .description("Documentation commands");

docs
  .command("sync")
  .description("Generate/sync documentation from the graph to the docs directory")
  .option("-c, --config <path>", "Config file path")
  .option("-d, --dir <dir>", "Override docs directory")
  .option("--framework <framework>", "Override docs framework")
  .option("--actor <actor>", "Actor for audit trail", "btmg-cli")
  .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const client = createClient(config);
    const registry = new SchemaRegistry(config.schema);
    try {
      const result = await sync(client, registry, {
        docsDir: opts.dir ?? config.docs?.outputDir ?? config.docs?.directory ?? "./docs",
        framework: opts.framework ?? config.docs?.framework,
        conflictStrategy: "graph-wins",
        actor: opts.actor,
      });
      console.log(chalk.green("Docs sync complete:"));
      console.log(`  Created: ${result.created}`);
      console.log(`  Updated: ${result.updated}`);
      if (result.conflicts.length) console.log(`  Conflicts: ${result.conflicts.length}`);
      if (result.errors.length) {
        console.log(chalk.red(`  Errors: ${result.errors.length}`));
        result.errors.forEach((e) => console.log(`    ${e.message}`));
      }
    } finally {
      await client.close();
    }
  });

docs
  .command("serve")
  .description("Start the built-in docs viewer (requires Fumadocs)")
  .option("-c, --config <path>", "Config file path")
  .option("-p, --port <port>", "Port number", "3456")
  .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const docsDir = config.docs?.outputDir ?? config.docs?.directory ?? "./docs";

    // Check if docs-site/ exists in the project
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { execSync } = await import("node:child_process");

    // Look for a package.json with fumadocs in the docs directory
    const docsPackageJson = resolve(docsDir, "package.json");
    if (existsSync(docsPackageJson)) {
      // Existing docs site — just run its dev server
      console.log(chalk.blue(`Starting docs dev server from ${docsDir}...`));
      try {
        execSync(`npx next dev --port ${opts.port}`, {
          cwd: docsDir,
          stdio: "inherit",
        });
      } catch {
        // User ctrl+C'd
      }
      return;
    }

    console.log(chalk.yellow("No docs site found."));
    console.log(`Run ${chalk.cyan("btmg docs init")} to scaffold a Fumadocs viewer.`);
  });

docs
  .command("build")
  .description("Build the docs site for production")
  .option("-c, --config <path>", "Config file path")
  .action(async (opts) => {
    const config = await loadConfig(opts.config);
    const docsDir = config.docs?.outputDir ?? config.docs?.directory ?? "./docs";

    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { execSync } = await import("node:child_process");

    const docsPackageJson = resolve(docsDir, "package.json");
    if (!existsSync(docsPackageJson)) {
      console.log(chalk.yellow("No docs site found."));
      console.log(`Run ${chalk.cyan("btmg docs init")} to scaffold a Fumadocs viewer.`);
      return;
    }

    console.log(chalk.blue("Building docs site..."));
    try {
      execSync("npx next build", {
        cwd: docsDir,
        stdio: "inherit",
      });
      console.log(chalk.green("Build complete!"));
    } catch {
      console.log(chalk.red("Build failed."));
      process.exitCode = 1;
    }
  });

docs
  .command("init")
  .description("Scaffold a built-in Fumadocs viewer for generated documentation")
  .option("-c, --config <path>", "Config file path")
  .option("-d, --dir <dir>", "Directory for the docs site", "./docs-site")
  .action(async (opts) => {
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const siteDir = resolve(opts.dir);
    if (existsSync(resolve(siteDir, "package.json"))) {
      console.log(chalk.yellow(`Docs site already exists at ${siteDir}`));
      return;
    }

    console.log(chalk.blue(`Scaffolding Fumadocs viewer at ${siteDir}...`));
    mkdirSync(siteDir, { recursive: true });

    // Create a minimal package.json
    writeFileSync(
      resolve(siteDir, "package.json"),
      JSON.stringify(
        {
          name: "btmg-docs",
          private: true,
          scripts: {
            dev: "next dev --port 3456",
            build: "next build",
            start: "next start",
          },
          dependencies: {
            "fumadocs-core": "latest",
            "fumadocs-mdx": "latest",
            "fumadocs-ui": "latest",
            next: "^15",
            react: "^19",
            "react-dom": "^19",
          },
          devDependencies: {
            "@types/react": "^19",
            typescript: "^5",
            tailwindcss: "^4",
            "@tailwindcss/postcss": "^4",
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    // Create .gitignore
    writeFileSync(
      resolve(siteDir, ".gitignore"),
      ".next/\nnode_modules/\n.source/\n",
      "utf-8"
    );

    console.log(chalk.green(`Docs site scaffolded at ${siteDir}`));
    console.log(`Next steps:`);
    console.log(`  cd ${opts.dir} && npm install`);
    console.log(`  btmg docs sync`);
    console.log(`  btmg docs serve`);
  });

program.parse();
