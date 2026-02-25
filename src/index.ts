/**
 * BTMG — Bidirectional Temporal Memory Graph
 * Public API facade.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Neo4jClient, type Neo4jClientConfig } from "./neo4j/client.js";
import { SchemaRegistry } from "./schema/registry.js";
import { applyMigrations } from "./neo4j/migrations.js";
import { upsert, remove, relate, unrelate } from "./graph/crud.js";
import { getCurrent, getAtTime, getHistory, queryByLabel } from "./temporal/model.js";
import { snapshotAt } from "./temporal/snapshot.js";
import { buildChangelog } from "./temporal/diff.js";
import { sync } from "./sync/engine.js";
import { queryAudit } from "./audit/logger.js";
import type {
  BTMGConfig,
  ConflictStrategy,
  SyncResult,
} from "./schema/types.js";
import type { EntityWithState } from "./temporal/model.js";
import type { GraphSnapshot } from "./temporal/snapshot.js";
import type { VersionDiff } from "./temporal/diff.js";
import type { AuditEntry } from "./schema/types.js";

// Re-export types
export { defineSchema } from "./schema/types.js";
export type {
  BTMGConfig,
  SchemaDef,
  NodeTypeDef,
  EdgeTypeDef,
  PropertyDef,
  PropertyType,
  ConflictStrategy,
  SyncResult,
  AuditEntry,
  TemporalMeta,
  EntityNode,
  StateNode,
  DocFrontmatter,
  DocsConfig,
  DocsFramework,
  ScanConfig,
  ScanMapping,
  SupportedLanguage,
  ArtifactKind,
  RawArtifact,
  ArtifactRef,
  SchemaPreset,
} from "./schema/types.js";
export type { EntityWithState } from "./temporal/model.js";
export type { GraphSnapshot } from "./temporal/snapshot.js";
export type { VersionDiff, PropertyChange } from "./temporal/diff.js";
export { SchemaRegistry } from "./schema/registry.js";
export { presets } from "./schema/presets.js";
export { Neo4jClient } from "./neo4j/client.js";
export { computeSyncHash } from "./docs/renderer.js";
export { parseDoc, parseDocs, extractProperties } from "./docs/parser.js";
export { renderDoc, writeDoc, writeDocs } from "./docs/renderer.js";
export { createTemplate } from "./docs/templates.js";
export type { RenderTemplate, EntityRelationship } from "./docs/templates.js";
export { runScan } from "./scanner/pipeline.js";
export type { ScanResult, ScanPipelineOptions, ScanError } from "./scanner/types.js";

/** Load config from a btmg config file */
export async function loadConfig(configPath?: string): Promise<BTMGConfig> {
  const paths = configPath
    ? [resolve(configPath)]
    : [
        resolve("btmg.config.js"),
        resolve("btmg.config.mjs"),
        resolve("btmg.config.ts"),
      ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const mod = await import(p);
        return mod.default ?? mod;
      } catch (e) {
        if (p.endsWith(".ts")) {
          throw new Error(
            `Cannot import TypeScript config "${p}" directly. ` +
            `Either compile it to .js first, or run with tsx/ts-node: npx tsx node_modules/.bin/btmg <command>`
          );
        }
        throw e;
      }
    }
  }

  throw new Error(
    "No btmg config file found. Run `btmg init` to create one."
  );
}

/** Main BTMG class — high-level API */
export class BTMG {
  readonly client: Neo4jClient;
  readonly registry: SchemaRegistry;
  /** @internal */ readonly _config: BTMGConfig;

  constructor(config: BTMGConfig, neo4jConfig?: Neo4jClientConfig) {
    this._config = config;
    this.registry = new SchemaRegistry(config.schema);
    this.client = new Neo4jClient(
      neo4jConfig ?? {
        uri: config.neo4j?.uri ?? process.env.NEO4J_URI ?? "bolt://localhost:7687",
        username: config.neo4j?.username ?? process.env.NEO4J_USERNAME ?? "neo4j",
        password: config.neo4j?.password ?? process.env.NEO4J_PASSWORD ?? "password",
        database: config.neo4j?.database,
      }
    );
  }

  /** Apply schema constraints/indexes to Neo4j */
  async migrate(): Promise<string[]> {
    return applyMigrations(this.client, this._config.schema);
  }

  /** Create or update an entity */
  async upsert(
    label: string,
    properties: Record<string, unknown>,
    opts?: { id?: string; actor?: string }
  ) {
    return upsert(this.client, this.registry, label, opts?.id, properties, {
      actor: opts?.actor ?? "btmg",
    });
  }

  /** Soft-delete an entity */
  async delete(id: string, actor = "btmg"): Promise<void> {
    return remove(this.client, id, { actor });
  }

  /** Create a relationship */
  async relate(
    fromId: string,
    toId: string,
    type: string,
    fromLabel: string,
    toLabel: string,
    properties?: Record<string, unknown>,
    actor = "btmg"
  ): Promise<void> {
    return relate(this.client, this.registry, fromId, toId, type, fromLabel, toLabel, properties, {
      actor,
    });
  }

  /** Remove a relationship */
  async unrelate(fromId: string, toId: string, type: string, actor = "btmg"): Promise<void> {
    return unrelate(this.client, fromId, toId, type, { actor });
  }

  /** Get current state */
  async get(id: string): Promise<EntityWithState | null> {
    return getCurrent(this.client, id);
  }

  /** Get state at a point in time */
  async getAt(id: string, timestamp: string): Promise<EntityWithState | null> {
    return getAtTime(this.client, id, timestamp);
  }

  /** Get version history */
  async history(id: string): Promise<Record<string, unknown>[]> {
    return getHistory(this.client, id);
  }

  /** Query by label */
  async query(label: string): Promise<EntityWithState[]> {
    return queryByLabel(this.client, label);
  }

  /** Take a snapshot */
  async snapshot(timestamp: string, labels?: string[]): Promise<GraphSnapshot> {
    return snapshotAt(this.client, this.registry, timestamp, labels);
  }

  /** Get changelog */
  async changelog(id: string): Promise<VersionDiff[]> {
    const history = await getHistory(this.client, id);
    return buildChangelog(id, history);
  }

  /** Get audit trail */
  async audit(entityId: string, limit?: number): Promise<AuditEntry[]> {
    return queryAudit(this.client, entityId, limit);
  }

  /** Run sync */
  async sync(opts?: {
    docsDir?: string;
    format?: "mdx" | "md";
    conflictStrategy?: ConflictStrategy;
    actor?: string;
  }): Promise<SyncResult> {
    return sync(this.client, this.registry, {
      docsDir: opts?.docsDir ?? this._config.docs?.outputDir ?? this._config.docs?.directory ?? "./docs",
      format: opts?.format ?? this._config.docs?.format ?? "md",
      conflictStrategy: opts?.conflictStrategy ?? this._config.sync?.conflictStrategy ?? "graph-wins",
      actor: opts?.actor ?? "btmg",
    });
  }

  /** Validate data against schema */
  validate(label: string, properties: Record<string, unknown>) {
    const validator = this.registry.getNodeValidator(label);
    return validator.validate(properties);
  }

  /** Scan a codebase */
  async scan(target: string, opts?: {
    dryRun?: boolean;
    actor?: string;
    githubToken?: string;
  }): Promise<import("./scanner/types.js").ScanResult> {
    const { runScan } = await import("./scanner/pipeline.js");
    return runScan(this, {
      target,
      actor: opts?.actor ?? "btmg-scanner",
      dryRun: opts?.dryRun,
      githubToken: opts?.githubToken,
    });
  }

  /** Close the Neo4j connection */
  async close(): Promise<void> {
    await this.client.close();
  }
}
