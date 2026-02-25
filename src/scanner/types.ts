/**
 * Scanner-specific types.
 * Types that live only in the scanner module and are not part of the public schema API.
 */

import type { RawArtifact, SupportedLanguage, ArtifactKind } from "../schema/types.js";

// ── File discovery ──

export interface DiscoveredFile {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to project root */
  relativePath: string;
  /** Detected language */
  language: SupportedLanguage;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp (ms since epoch) */
  mtime: number;
}

// ── Fingerprinting ──

export interface FileFingerprint {
  /** Relative path used as the stable key */
  relativePath: string;
  /** SHA-256 hex digest of the file content */
  hash: string;
  /** File size in bytes at hash time */
  size: number;
  /** Unix epoch ms when the fingerprint was recorded */
  recordedAt: number;
}

/** Map of relativePath → FileFingerprint */
export type FingerprintStore = Record<string, FileFingerprint>;

export interface FingerprintDiff {
  /** Files whose hash changed since the previous store */
  changed: string[];
  /** Files present in current but not previous */
  added: string[];
  /** Files present in previous but not current */
  removed: string[];
}

// ── Mapping ──

export interface MappedEntity {
  /** Deterministic ID: sha256(project:relativePath:kind:name) */
  id: string;
  /** User-defined node label from ScanMapping */
  label: string;
  /** Resolved property values */
  properties: Record<string, unknown>;
  /** The source artifact */
  artifact: RawArtifact;
}

export interface PendingRelation {
  fromId: string;
  fromLabel: string;
  toId: string;
  toLabel: string;
  type: string;
  properties?: Record<string, unknown>;
}

// ── Scan result ──

export interface ScanResult {
  /** Total files discovered */
  filesDiscovered: number;
  /** Files actually parsed (changed + added when incremental) */
  filesParsed: number;
  /** Raw artifacts extracted across all parsed files */
  artifactsExtracted: number;
  /** Entities upserted to the graph */
  entitiesUpserted: number;
  /** Entities skipped (dryRun or unchanged) */
  entitiesSkipped: number;
  /** Relationships created */
  relationsCreated: number;
  /** Non-fatal errors */
  errors: ScanError[];
  /** Whether this was a dry run */
  dryRun: boolean;
}

export interface ScanError {
  file?: string;
  artifactName?: string;
  message: string;
  cause?: unknown;
}

// ── Parser interface ──

export interface LanguageParser {
  /** Languages this parser handles */
  languages: SupportedLanguage[];
  /** Parse a single file and return raw artifacts */
  parse(file: DiscoveredFile, content: string): RawArtifact[];
}

// ── Pipeline options ──

export interface ScanPipelineOptions {
  /** Absolute path to the project root directory, or a GitHub URL */
  target: string;
  /** Actor string for audit trail */
  actor?: string;
  /** If true, discover and parse but do not write to the graph */
  dryRun?: boolean;
  /** Override languages to restrict which parsers run */
  languages?: SupportedLanguage[];
  /** GitHub authentication token (used when target is a GitHub URL) */
  githubToken?: string;
}

// ── GitHub resolution ──

export interface ResolvedTarget {
  /** Absolute local path to scan */
  projectRoot: string;
  /** Call to remove tmp directory after scan, if one was created */
  cleanup?: () => void;
}

// ── Artifact kind helpers ──

/** Human-readable label for an ArtifactKind */
export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  file: "File",
  module: "Module",
  function: "Function",
  class: "Class",
  interface: "Interface",
  type: "Type",
  api_endpoint: "API Endpoint",
  dependency: "Dependency",
  env_var: "Environment Variable",
  config_key: "Config Key",
  export: "Export",
};
