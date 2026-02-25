/**
 * Generic parser for config/manifest files.
 * Handles: package.json, tsconfig.json, .env, Dockerfile.
 */

import { basename } from "node:path";
import type { RawArtifact, ArtifactRef } from "../../schema/types.js";
import type { DiscoveredFile, LanguageParser } from "../types.js";

// ── Helpers ──

function fileBase(relativePath: string): string {
  return basename(relativePath);
}

// ── package.json ──

function parsePackageJson(file: DiscoveredFile, content: string): RawArtifact[] {
  const artifacts: RawArtifact[] = [];
  let pkg: Record<string, unknown>;

  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }

  const name = (pkg["name"] as string | undefined) ?? file.relativePath;
  const version = (pkg["version"] as string | undefined) ?? "0.0.0";
  const deps = {
    ...((pkg["dependencies"] as Record<string, string> | undefined) ?? {}),
    ...((pkg["devDependencies"] as Record<string, string> | undefined) ?? {}),
    ...((pkg["peerDependencies"] as Record<string, string> | undefined) ?? {}),
  };

  const depRefs: ArtifactRef[] = Object.keys(deps).map((d) => ({
    kind: "depends_on" as const,
    target: d,
  }));

  artifacts.push({
    kind: "module",
    name,
    filePath: file.relativePath,
    language: "generic",
    meta: {
      version,
      scripts: pkg["scripts"] ?? {},
      dependencyCount: Object.keys(deps).length,
    },
    refs: depRefs,
  });

  for (const [depName, depVersion] of Object.entries(deps)) {
    artifacts.push({
      kind: "dependency",
      name: depName,
      filePath: file.relativePath,
      language: "generic",
      meta: { version: depVersion, source: "package.json" },
      refs: [],
    });
  }

  return artifacts;
}

// ── tsconfig.json ──

function parseTsConfig(file: DiscoveredFile, content: string): RawArtifact[] {
  let cfg: Record<string, unknown>;
  try {
    // tsconfig may have comments — strip them with a simple regex before parsing
    const stripped = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    cfg = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return [];
  }

  const compilerOptions = cfg["compilerOptions"] as Record<string, unknown> | undefined;
  const refs: ArtifactRef[] = [];

  const extendsVal = cfg["extends"];
  if (typeof extendsVal === "string") {
    refs.push({ kind: "imports", target: extendsVal });
  }

  return [
    {
      kind: "config_key",
      name: "tsconfig",
      filePath: file.relativePath,
      language: "generic",
      meta: {
        compilerOptions: compilerOptions ?? {},
        extends: extendsVal ?? null,
        include: cfg["include"] ?? [],
        exclude: cfg["exclude"] ?? [],
      },
      refs,
    },
  ];
}

// ── .env ──

const ENV_LINE_RE = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/gm;

function parseEnv(file: DiscoveredFile, content: string): RawArtifact[] {
  const artifacts: RawArtifact[] = [];
  let m: RegExpExecArray | null;

  ENV_LINE_RE.lastIndex = 0;
  while ((m = ENV_LINE_RE.exec(content)) !== null) {
    const key = m[1];
    // Never store the actual value of env vars
    artifacts.push({
      kind: "env_var",
      name: key,
      filePath: file.relativePath,
      language: "generic",
      meta: { hasValue: m[2].trim().length > 0 },
      refs: [],
    });
  }

  return artifacts;
}

// ── Dockerfile ──

const DOCKERFILE_FROM_RE = /^FROM\s+(\S+)/gim;
const DOCKERFILE_ARG_RE = /^ARG\s+(\w+)/gim;
const DOCKERFILE_ENV_RE = /^ENV\s+(\w+)/gim;
const DOCKERFILE_EXPOSE_RE = /^EXPOSE\s+(\d+)/gim;

function parseDockerfile(file: DiscoveredFile, content: string): RawArtifact[] {
  const artifacts: RawArtifact[] = [];
  const refs: ArtifactRef[] = [];

  let m: RegExpExecArray | null;

  const baseImages: string[] = [];
  DOCKERFILE_FROM_RE.lastIndex = 0;
  while ((m = DOCKERFILE_FROM_RE.exec(content)) !== null) {
    baseImages.push(m[1]);
    refs.push({ kind: "depends_on", target: m[1] });
  }

  const exposedPorts: number[] = [];
  DOCKERFILE_EXPOSE_RE.lastIndex = 0;
  while ((m = DOCKERFILE_EXPOSE_RE.exec(content)) !== null) {
    exposedPorts.push(parseInt(m[1], 10));
  }

  const args: string[] = [];
  DOCKERFILE_ARG_RE.lastIndex = 0;
  while ((m = DOCKERFILE_ARG_RE.exec(content)) !== null) {
    args.push(m[1]);
  }

  const envVars: string[] = [];
  DOCKERFILE_ENV_RE.lastIndex = 0;
  while ((m = DOCKERFILE_ENV_RE.exec(content)) !== null) {
    envVars.push(m[1]);
  }

  artifacts.push({
    kind: "config_key",
    name: "Dockerfile",
    filePath: file.relativePath,
    language: "generic",
    meta: { baseImages, exposedPorts, args, envVars },
    refs,
  });

  return artifacts;
}

// ── Generic JSON fallback ──

function parseJsonFallback(file: DiscoveredFile, content: string): RawArtifact[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    const keys = typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : [];
    return [
      {
        kind: "config_key",
        name: fileBase(file.relativePath),
        filePath: file.relativePath,
        language: "generic",
        meta: { keys, topLevelKeyCount: keys.length },
        refs: [],
      },
    ];
  } catch {
    return [];
  }
}

// ── Router ──

function parseGeneric(file: DiscoveredFile, content: string): RawArtifact[] {
  const base = fileBase(file.relativePath);

  if (base === "package.json") return parsePackageJson(file, content);
  if (base === "tsconfig.json" || base.startsWith("tsconfig.")) return parseTsConfig(file, content);
  if (base === ".env" || base.startsWith(".env.")) return parseEnv(file, content);
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return parseDockerfile(file, content);

  // Fall through to extension-based dispatch
  if (file.relativePath.endsWith(".json")) return parseJsonFallback(file, content);
  if (file.relativePath.endsWith(".env")) return parseEnv(file, content);

  // Unknown generic file — emit a bare file artifact
  return [
    {
      kind: "file",
      name: file.relativePath,
      filePath: file.relativePath,
      language: "generic",
      meta: { basename: base, size: file.size },
      refs: [],
    },
  ];
}

export const genericParser: LanguageParser = {
  languages: ["generic"],
  parse: parseGeneric,
};
