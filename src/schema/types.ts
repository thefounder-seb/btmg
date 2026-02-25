/**
 * Schema definition types for BTMG.
 *
 * Users define their graph schema using these types in btmg.config.ts.
 * The schema is compiled to Zod validators at startup to enforce
 * structure on every write path (anti-hallucination gate).
 */

/** Supported property types */
export type PropertyType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "url"
  | "email"
  | "enum"
  | "string[]"
  | "json";

/** A single property definition */
export interface PropertyDef {
  type: PropertyType;
  required?: boolean;
  description?: string;
  /** Only used when type is "enum" */
  values?: string[];
  /** Default value */
  default?: unknown;
}

/** Node type definition */
export interface NodeTypeDef {
  label: string;
  description?: string;
  properties: Record<string, PropertyDef>;
  /** Properties that form a unique natural key (besides _id) */
  uniqueKeys?: string[];
}

/** Edge type definition */
export interface EdgeTypeDef {
  type: string;
  description?: string;
  from: string; // source node label
  to: string; // target node label
  properties?: Record<string, PropertyDef>;
}

/** Constraint definition for Neo4j indexes/constraints */
export interface ConstraintDef {
  label: string;
  property: string;
  type: "unique" | "exists" | "index";
}

/** Top-level schema definition */
export interface SchemaDef {
  nodes: NodeTypeDef[];
  edges: EdgeTypeDef[];
  constraints?: ConstraintDef[];
}

/** Config file shape (returned by defineSchema helper) */
export interface BTMGConfig {
  schema: SchemaDef;
  neo4j?: {
    uri?: string;
    username?: string;
    password?: string;
    database?: string;
  };
  docs?: DocsConfig;
  sync?: {
    conflictStrategy?: ConflictStrategy;
  };
  scan?: ScanConfig;
}

// ── Docs config ──

export interface DocsConfig {
  /** Where generated MDX/MD files are written */
  outputDir?: string;
  /** @deprecated Use outputDir instead */
  directory?: string;
  /** File format for output */
  format?: "mdx" | "md";
  /** Custom template directory */
  templateDir?: string;
  /** Target framework for format adapter */
  framework?: DocsFramework;
  /** Built-in viewer config */
  viewer?: {
    port?: number;
    title?: string;
    open?: boolean;
  };
}

export type DocsFramework =
  | "fumadocs"
  | "docusaurus"
  | "nextra"
  | "vitepress"
  | "raw";

// ── Scan config ──

export interface ScanConfig {
  /** Directories/patterns to scan (relative to project root) */
  include?: string[];
  /** Directories/patterns to ignore */
  exclude?: string[];
  /** Language hints (auto-detected if omitted) */
  languages?: SupportedLanguage[];
  /** Schema mapping rules: how code artifacts map to user-defined node labels */
  mappings: ScanMapping[];
  /** GitHub-specific config */
  github?: {
    depth?: number;
    branch?: string;
    apiMode?: boolean;
  };
}

export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "generic";

export type ArtifactKind =
  | "file"
  | "module"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "api_endpoint"
  | "dependency"
  | "env_var"
  | "config_key"
  | "export";

export interface ScanMapping {
  /** What kind of code artifact this mapping targets */
  artifact: ArtifactKind;
  /** Which user-defined node label to map to */
  label: string;
  /** How to populate node properties from the artifact */
  properties: Record<string, PropertyMapping>;
  /** Optional filter predicate */
  filter?: (artifact: RawArtifact) => boolean;
}

export type PropertyMapping =
  | string
  | { from: string }
  | { value: unknown }
  | { compute: (artifact: RawArtifact) => unknown };

export interface RawArtifact {
  kind: ArtifactKind;
  name: string;
  filePath: string;
  language: SupportedLanguage;
  meta: Record<string, unknown>;
  location?: { start: number; end: number };
  refs: ArtifactRef[];
}

export interface ArtifactRef {
  kind: "imports" | "extends" | "implements" | "calls" | "depends_on" | "configures";
  target: string;
}

// ── Schema presets ──

export interface SchemaPreset {
  name: string;
  nodes: NodeTypeDef[];
  edges: EdgeTypeDef[];
}

export type ConflictStrategy = "graph-wins" | "docs-wins" | "fail" | "merge";

/** Helper to define a schema with full type inference */
export function defineSchema(config: BTMGConfig): BTMGConfig {
  return config;
}

// ── Temporal types ──

export interface TemporalMeta {
  _valid_from: string; // ISO datetime
  _valid_to: string | null; // null = current
  _recorded_at: string; // ISO datetime (transaction time)
  _version: number;
  _actor: string;
}

export interface EntityNode {
  _id: string;
  _label: string;
  _created_at: string;
}

export interface StateNode extends TemporalMeta {
  _entity_id: string;
  [key: string]: unknown;
}

export interface AuditEntry {
  _id: string;
  _entity_id: string;
  _entity_label: string;
  _action: "create" | "update" | "delete" | "relate" | "unrelate";
  _actor: string;
  _timestamp: string;
  _changes?: Record<string, { old: unknown; new: unknown }>;
}

// ── Sync types ──

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  conflicts: ConflictRecord[];
  errors: SyncError[];
}

export interface ConflictRecord {
  entityId: string;
  label: string;
  graphHash: string;
  docHash: string;
  resolution: ConflictStrategy;
}

export interface SyncError {
  entityId?: string;
  file?: string;
  message: string;
}

export interface DocFrontmatter {
  _id: string;
  _label: string;
  _sync_hash: string;
  _version: number;
  [key: string]: unknown;
}
