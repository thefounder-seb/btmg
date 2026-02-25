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
  docs?: {
    directory?: string;
    format?: "mdx" | "md";
    templateDir?: string;
  };
  sync?: {
    conflictStrategy?: ConflictStrategy;
  };
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
