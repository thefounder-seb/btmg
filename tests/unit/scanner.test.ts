import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { discoverFiles, detectLanguage } from "../../src/scanner/discover.js";
import { parseFiles } from "../../src/scanner/parse.js";
import { mapArtifacts, generateEntityId } from "../../src/scanner/map.js";
import {
  computeFingerprint,
  loadFingerprints,
  saveFingerprints,
  diffFingerprints,
} from "../../src/scanner/fingerprint.js";
import { SchemaRegistry } from "../../src/schema/registry.js";
import type { ScanConfig, ScanMapping, RawArtifact, SchemaDef } from "../../src/schema/types.js";
import type { FingerprintStore } from "../../src/scanner/types.js";

// ── Helpers ──

/** Create an isolated temp directory for each test. */
function makeTmpDir(): string {
  const dir = join(tmpdir(), `btmg-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a file inside the temp dir, creating parent dirs as needed. */
function writeFixture(root: string, relativePath: string, content: string): void {
  const abs = join(root, relativePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

// ── Schema for mapping tests ──

const scanTestSchema: SchemaDef = {
  nodes: [
    {
      label: "Service",
      properties: {
        name: { type: "string", required: true },
        filePath: { type: "string" },
      },
    },
    {
      label: "Function",
      properties: {
        name: { type: "string", required: true },
        async: { type: "boolean" },
      },
    },
  ],
  edges: [],
};

// ────────────────────────────────────────────────────────────────
// 1. discoverFiles
// ────────────────────────────────────────────────────────────────

describe("discoverFiles", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("discovers TypeScript files with default include patterns", async () => {
    writeFixture(root, "src/index.ts", "export const x = 1;");
    writeFixture(root, "src/utils.ts", "export function y() {}");

    const config: ScanConfig = { mappings: [] };
    const result = await discoverFiles(root, config);

    expect(result.files.length).toBe(2);
    expect(result.files.every((f) => f.language === "typescript")).toBe(true);
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      "src/index.ts",
      "src/utils.ts",
    ]);
  });

  it("respects custom include patterns", async () => {
    writeFixture(root, "src/app.ts", "export const a = 1;");
    writeFixture(root, "lib/helper.ts", "export const b = 2;");

    const config: ScanConfig = { include: ["src/**/*.ts"], mappings: [] };
    const result = await discoverFiles(root, config);

    expect(result.files.length).toBe(1);
    expect(result.files[0].relativePath).toBe("src/app.ts");
  });

  it("respects custom exclude patterns", async () => {
    writeFixture(root, "src/index.ts", "export const x = 1;");
    writeFixture(root, "src/generated/auto.ts", "// generated");

    const config: ScanConfig = {
      exclude: ["**/generated/**"],
      mappings: [],
    };
    const result = await discoverFiles(root, config);

    expect(result.files.length).toBe(1);
    expect(result.files[0].relativePath).toBe("src/index.ts");
  });

  it("excludes node_modules by default", async () => {
    writeFixture(root, "src/index.ts", "export const x = 1;");
    writeFixture(root, "node_modules/pkg/index.ts", "// vendored");

    const config: ScanConfig = { mappings: [] };
    const result = await discoverFiles(root, config);

    const paths = result.files.map((f) => f.relativePath);
    expect(paths).not.toContain("node_modules/pkg/index.ts");
    expect(paths).toContain("src/index.ts");
  });

  it("filters by language when config.languages is set", async () => {
    writeFixture(root, "src/index.ts", "export const x = 1;");
    writeFixture(root, "src/main.py", "def main(): pass");

    const config: ScanConfig = { languages: ["typescript"], mappings: [] };
    const result = await discoverFiles(root, config);

    expect(result.files.length).toBe(1);
    expect(result.files[0].language).toBe("typescript");
  });

  it("populates absolutePath, relativePath, size, mtime on each file", async () => {
    writeFixture(root, "src/index.ts", "hello");

    const config: ScanConfig = { mappings: [] };
    const result = await discoverFiles(root, config);

    const f = result.files[0];
    expect(f.absolutePath).toBe(join(root, "src/index.ts"));
    expect(f.relativePath).toBe("src/index.ts");
    expect(f.size).toBe(5); // "hello" = 5 bytes
    expect(typeof f.mtime).toBe("number");
    expect(f.mtime).toBeGreaterThan(0);
  });

  it("computes currentFingerprints for all discovered files", async () => {
    writeFixture(root, "src/a.ts", "aaa");
    writeFixture(root, "src/b.ts", "bbb");

    const config: ScanConfig = { mappings: [] };
    const result = await discoverFiles(root, config);

    expect(Object.keys(result.currentFingerprints).length).toBe(2);
    expect(result.currentFingerprints["src/a.ts"]).toBeDefined();
    expect(result.currentFingerprints["src/b.ts"]).toBeDefined();
    expect(result.currentFingerprints["src/a.ts"].hash).toHaveLength(64);
  });

  it("returns only changed/added files when previousFingerprints is supplied", async () => {
    writeFixture(root, "src/unchanged.ts", "same");
    writeFixture(root, "src/changed.ts", "new content");
    writeFixture(root, "src/added.ts", "brand new");

    // Build a fake previous store where unchanged.ts has same hash, changed.ts has different hash
    const unchangedFp = computeFingerprint("src/unchanged.ts", "same");
    const oldChangedFp = computeFingerprint("src/changed.ts", "old content");
    const removedFp = computeFingerprint("src/removed.ts", "gone");

    const previous: FingerprintStore = {
      "src/unchanged.ts": unchangedFp,
      "src/changed.ts": oldChangedFp,
      "src/removed.ts": removedFp,
    };

    const config: ScanConfig = { mappings: [] };
    const result = await discoverFiles(root, config, previous);

    const returnedPaths = result.files.map((f) => f.relativePath).sort();
    // unchanged.ts should NOT be returned
    expect(returnedPaths).not.toContain("src/unchanged.ts");
    // changed.ts and added.ts should be returned
    expect(returnedPaths).toContain("src/changed.ts");
    expect(returnedPaths).toContain("src/added.ts");
    // removed files go into the removed list
    expect(result.removed).toContain("src/removed.ts");
    expect(result.changed).toContain("src/changed.ts");
  });
});

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    expect(detectLanguage("src/index.ts")).toBe("typescript");
    expect(detectLanguage("foo.tsx")).toBe("typescript");
    expect(detectLanguage("bar.mts")).toBe("typescript");
  });

  it("detects JavaScript", () => {
    expect(detectLanguage("index.js")).toBe("javascript");
    expect(detectLanguage("lib.mjs")).toBe("javascript");
  });

  it("detects Python", () => {
    expect(detectLanguage("main.py")).toBe("python");
  });

  it("detects Go", () => {
    expect(detectLanguage("main.go")).toBe("go");
    expect(detectLanguage("go.mod")).toBe("go");
  });

  it("falls back to generic for unknown extensions", () => {
    expect(detectLanguage("data.csv")).toBe("generic");
  });

  it("detects Dockerfile as generic", () => {
    expect(detectLanguage("Dockerfile")).toBe("generic");
  });
});

// ────────────────────────────────────────────────────────────────
// 2. parseFiles
// ────────────────────────────────────────────────────────────────

describe("parseFiles", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("parses a TypeScript file and extracts exported functions", () => {
    const code = [
      'import { foo } from "./foo";',
      "",
      "export function handleRequest(req: Request) {",
      "  return foo(req);",
      "}",
      "",
      "export async function processQueue() {",
      "  // ...",
      "}",
    ].join("\n");
    writeFixture(root, "src/handler.ts", code);

    const files = [
      {
        absolutePath: join(root, "src/handler.ts"),
        relativePath: "src/handler.ts",
        language: "typescript" as const,
        size: Buffer.byteLength(code),
        mtime: Date.now(),
      },
    ];

    const artifacts = parseFiles(files);

    // Should have: 1 file artifact + 2 function artifacts
    expect(artifacts.length).toBe(3);

    const fileArtifact = artifacts.find((a) => a.kind === "file");
    expect(fileArtifact).toBeDefined();
    expect(fileArtifact!.name).toBe("src/handler.ts");
    expect(fileArtifact!.refs).toEqual([{ kind: "imports", target: "./foo" }]);

    const fns = artifacts.filter((a) => a.kind === "function");
    expect(fns.length).toBe(2);
    expect(fns.map((f) => f.name).sort()).toEqual(["handleRequest", "processQueue"]);

    const asyncFn = fns.find((f) => f.name === "processQueue");
    expect(asyncFn!.meta.async).toBe(true);
    expect(asyncFn!.meta.exported).toBe(true);
  });

  it("parses exported classes and interfaces", () => {
    const code = [
      "export class UserService {",
      "  getUser() {}",
      "}",
      "",
      "export interface UserConfig {",
      "  timeout: number;",
      "}",
      "",
      "export type UserId = string;",
    ].join("\n");
    writeFixture(root, "src/user.ts", code);

    const files = [
      {
        absolutePath: join(root, "src/user.ts"),
        relativePath: "src/user.ts",
        language: "typescript" as const,
        size: Buffer.byteLength(code),
        mtime: Date.now(),
      },
    ];

    const artifacts = parseFiles(files);

    const kinds = artifacts.map((a) => a.kind);
    expect(kinds).toContain("file");
    expect(kinds).toContain("class");
    expect(kinds).toContain("interface");
    expect(kinds).toContain("type");

    expect(artifacts.find((a) => a.kind === "class")!.name).toBe("UserService");
    expect(artifacts.find((a) => a.kind === "interface")!.name).toBe("UserConfig");
    expect(artifacts.find((a) => a.kind === "type")!.name).toBe("UserId");
  });

  it("filters by language option", () => {
    const tsCode = "export function tsFunc() {}";
    const pyCode = "def py_func():\n    pass";
    writeFixture(root, "src/a.ts", tsCode);
    writeFixture(root, "src/b.py", pyCode);

    const files = [
      {
        absolutePath: join(root, "src/a.ts"),
        relativePath: "src/a.ts",
        language: "typescript" as const,
        size: Buffer.byteLength(tsCode),
        mtime: Date.now(),
      },
      {
        absolutePath: join(root, "src/b.py"),
        relativePath: "src/b.py",
        language: "python" as const,
        size: Buffer.byteLength(pyCode),
        mtime: Date.now(),
      },
    ];

    const artifacts = parseFiles(files, { languages: ["typescript"] });

    // Only TS artifacts
    expect(artifacts.every((a) => a.language === "typescript")).toBe(true);
  });

  it("silently skips files that have disappeared", () => {
    // Point to a file that does not exist
    const files = [
      {
        absolutePath: join(root, "src/ghost.ts"),
        relativePath: "src/ghost.ts",
        language: "typescript" as const,
        size: 0,
        mtime: Date.now(),
      },
    ];

    const artifacts = parseFiles(files);
    expect(artifacts).toEqual([]);
  });

  it("supports custom parsers via extraParsers", () => {
    writeFixture(root, "src/data.ts", "// data file");

    const files = [
      {
        absolutePath: join(root, "src/data.ts"),
        relativePath: "src/data.ts",
        language: "typescript" as const,
        size: 12,
        mtime: Date.now(),
      },
    ];

    const customArtifact: RawArtifact = {
      kind: "module",
      name: "custom-module",
      filePath: "src/data.ts",
      language: "typescript",
      meta: { custom: true },
      refs: [],
    };

    const artifacts = parseFiles(files, {
      extraParsers: [
        {
          languages: ["typescript"],
          parse: () => [customArtifact],
        },
      ],
    });

    // Custom parser overrides the built-in TS parser
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].name).toBe("custom-module");
    expect(artifacts[0].meta.custom).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. mapArtifacts
// ────────────────────────────────────────────────────────────────

describe("mapArtifacts", () => {
  const registry = new SchemaRegistry(scanTestSchema);

  const fileArtifact: RawArtifact = {
    kind: "file",
    name: "src/api/handler.ts",
    filePath: "src/api/handler.ts",
    language: "typescript",
    meta: { basename: "handler.ts", size: 512 },
    refs: [],
  };

  const funcArtifact: RawArtifact = {
    kind: "function",
    name: "handleRequest",
    filePath: "src/api/handler.ts",
    language: "typescript",
    meta: { exported: true, async: true },
    location: { start: 5, end: 12 },
    refs: [],
  };

  const unmappedArtifact: RawArtifact = {
    kind: "dependency",
    name: "express",
    filePath: "package.json",
    language: "generic",
    meta: { version: "4.18.0" },
    refs: [],
  };

  const mappings: ScanMapping[] = [
    {
      artifact: "file",
      label: "Service",
      properties: {
        name: { from: "meta.basename" },
        filePath: "filePath",
      },
    },
    {
      artifact: "function",
      label: "Function",
      properties: {
        name: "name",
        async: { from: "meta.async" },
      },
    },
  ];

  it("maps artifacts to entities when mapping rules match", () => {
    const result = mapArtifacts([fileArtifact, funcArtifact], mappings, registry, "/project");

    expect(result.entities.length).toBe(2);
    expect(result.unmapped.length).toBe(0);

    const serviceEntity = result.entities.find((e) => e.label === "Service");
    expect(serviceEntity).toBeDefined();
    expect(serviceEntity!.properties.name).toBe("handler.ts");
    expect(serviceEntity!.properties.filePath).toBe("src/api/handler.ts");

    const funcEntity = result.entities.find((e) => e.label === "Function");
    expect(funcEntity).toBeDefined();
    expect(funcEntity!.properties.name).toBe("handleRequest");
    expect(funcEntity!.properties.async).toBe(true);
  });

  it("places artifacts with no matching mapping into unmapped", () => {
    const result = mapArtifacts([unmappedArtifact], mappings, registry, "/project");

    expect(result.entities.length).toBe(0);
    expect(result.unmapped.length).toBe(1);
    expect(result.unmapped[0].name).toBe("express");
  });

  it("uses filter predicate to skip non-matching artifacts", () => {
    const filteredMappings: ScanMapping[] = [
      {
        artifact: "function",
        label: "Function",
        properties: { name: "name" },
        filter: (a) => a.meta.async === true,
      },
    ];

    const syncFunc: RawArtifact = {
      kind: "function",
      name: "syncHelper",
      filePath: "src/helpers.ts",
      language: "typescript",
      meta: { exported: true, async: false },
      refs: [],
    };

    const result = mapArtifacts([funcArtifact, syncFunc], filteredMappings, registry, "/project");

    // Only the async function should match
    expect(result.entities.length).toBe(1);
    expect(result.entities[0].properties.name).toBe("handleRequest");
    // syncHelper goes to unmapped
    expect(result.unmapped.length).toBe(1);
    expect(result.unmapped[0].name).toBe("syncHelper");
  });

  it("resolves { value: ... } static property mappings", () => {
    const staticMappings: ScanMapping[] = [
      {
        artifact: "function",
        label: "Function",
        properties: {
          name: "name",
          async: { value: false },
        },
      },
    ];

    const result = mapArtifacts([funcArtifact], staticMappings, registry, "/project");
    expect(result.entities[0].properties.async).toBe(false);
  });

  it("resolves { compute: ... } property mappings", () => {
    const computeMappings: ScanMapping[] = [
      {
        artifact: "function",
        label: "Function",
        properties: {
          name: { compute: (a) => a.name.toUpperCase() },
        },
      },
    ];

    const result = mapArtifacts([funcArtifact], computeMappings, registry, "/project");
    expect(result.entities[0].properties.name).toBe("HANDLEREQUEST");
  });

  it("skips artifacts whose label is not in the schema registry", () => {
    const badMappings: ScanMapping[] = [
      {
        artifact: "function",
        label: "NonExistentLabel",
        properties: { name: "name" },
      },
    ];

    const result = mapArtifacts([funcArtifact], badMappings, registry, "/project");
    expect(result.entities.length).toBe(0);
    expect(result.unmapped.length).toBe(1);
  });

  it("generates deterministic entity IDs", () => {
    const result1 = mapArtifacts([funcArtifact], mappings, registry, "/project");
    const result2 = mapArtifacts([funcArtifact], mappings, registry, "/project");

    expect(result1.entities[0].id).toBe(result2.entities[0].id);
    expect(result1.entities[0].id).toHaveLength(32);
  });
});

describe("generateEntityId", () => {
  it("produces a 32-char hex string", () => {
    const id = generateEntityId("/project", "src/foo.ts", "function", "bar");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = generateEntityId("/project", "src/foo.ts", "function", "bar");
    const b = generateEntityId("/project", "src/foo.ts", "function", "bar");
    expect(a).toBe(b);
  });

  it("differs when any component changes", () => {
    const base = generateEntityId("/project", "src/foo.ts", "function", "bar");
    const diffPath = generateEntityId("/project", "src/baz.ts", "function", "bar");
    const diffKind = generateEntityId("/project", "src/foo.ts", "class", "bar");
    const diffName = generateEntityId("/project", "src/foo.ts", "function", "qux");
    const diffRoot = generateEntityId("/other", "src/foo.ts", "function", "bar");

    expect(base).not.toBe(diffPath);
    expect(base).not.toBe(diffKind);
    expect(base).not.toBe(diffName);
    expect(base).not.toBe(diffRoot);
  });
});

// ────────────────────────────────────────────────────────────────
// 4. Fingerprinting
// ────────────────────────────────────────────────────────────────

describe("computeFingerprint", () => {
  it("returns a FileFingerprint with SHA-256 hash", () => {
    const fp = computeFingerprint("src/index.ts", "hello world");

    expect(fp.relativePath).toBe("src/index.ts");
    expect(fp.hash).toHaveLength(64);
    expect(fp.hash).toMatch(/^[0-9a-f]+$/);
    expect(fp.size).toBe(Buffer.byteLength("hello world"));
    expect(typeof fp.recordedAt).toBe("number");
  });

  it("produces the same hash for the same content", () => {
    const a = computeFingerprint("a.ts", "content");
    const b = computeFingerprint("b.ts", "content");
    expect(a.hash).toBe(b.hash);
  });

  it("produces different hashes for different content", () => {
    const a = computeFingerprint("a.ts", "version 1");
    const b = computeFingerprint("a.ts", "version 2");
    expect(a.hash).not.toBe(b.hash);
  });

  it("accepts a Buffer as content", () => {
    const buf = Buffer.from("binary content", "utf8");
    const fp = computeFingerprint("data.bin", buf);
    expect(fp.hash).toHaveLength(64);
    expect(fp.size).toBe(buf.byteLength);
  });
});

describe("loadFingerprints / saveFingerprints", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns null when no store exists", () => {
    const store = loadFingerprints(root);
    expect(store).toBeNull();
  });

  it("roundtrips a store through save and load", () => {
    const store: FingerprintStore = {
      "src/a.ts": {
        relativePath: "src/a.ts",
        hash: "abc123",
        size: 100,
        recordedAt: Date.now(),
      },
      "src/b.ts": {
        relativePath: "src/b.ts",
        hash: "def456",
        size: 200,
        recordedAt: Date.now(),
      },
    };

    saveFingerprints(root, store);
    const loaded = loadFingerprints(root);

    expect(loaded).not.toBeNull();
    expect(loaded!["src/a.ts"].hash).toBe("abc123");
    expect(loaded!["src/b.ts"].hash).toBe("def456");
  });

  it("creates the .btmg directory if it does not exist", () => {
    saveFingerprints(root, {});
    expect(existsSync(join(root, ".btmg"))).toBe(true);
    expect(existsSync(join(root, ".btmg", "fingerprints.json"))).toBe(true);
  });

  it("returns null for corrupt JSON", () => {
    mkdirSync(join(root, ".btmg"), { recursive: true });
    writeFileSync(join(root, ".btmg", "fingerprints.json"), "NOT VALID JSON", "utf8");

    const store = loadFingerprints(root);
    expect(store).toBeNull();
  });
});

describe("diffFingerprints", () => {
  it("detects added files", () => {
    const previous: FingerprintStore = {};
    const current: FingerprintStore = {
      "src/new.ts": { relativePath: "src/new.ts", hash: "aaa", size: 10, recordedAt: 1 },
    };

    const diff = diffFingerprints(previous, current);
    expect(diff.added).toEqual(["src/new.ts"]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("detects removed files", () => {
    const previous: FingerprintStore = {
      "src/old.ts": { relativePath: "src/old.ts", hash: "bbb", size: 10, recordedAt: 1 },
    };
    const current: FingerprintStore = {};

    const diff = diffFingerprints(previous, current);
    expect(diff.removed).toEqual(["src/old.ts"]);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("detects changed files", () => {
    const previous: FingerprintStore = {
      "src/mod.ts": { relativePath: "src/mod.ts", hash: "v1", size: 10, recordedAt: 1 },
    };
    const current: FingerprintStore = {
      "src/mod.ts": { relativePath: "src/mod.ts", hash: "v2", size: 12, recordedAt: 2 },
    };

    const diff = diffFingerprints(previous, current);
    expect(diff.changed).toEqual(["src/mod.ts"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("reports unchanged files as neither changed, added, nor removed", () => {
    const fp = { relativePath: "src/stable.ts", hash: "same", size: 10, recordedAt: 1 };
    const previous: FingerprintStore = { "src/stable.ts": fp };
    const current: FingerprintStore = { "src/stable.ts": { ...fp, recordedAt: 2 } };

    const diff = diffFingerprints(previous, current);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("handles a mix of added, changed, removed, and unchanged", () => {
    const previous: FingerprintStore = {
      "src/a.ts": { relativePath: "src/a.ts", hash: "unchanged", size: 10, recordedAt: 1 },
      "src/b.ts": { relativePath: "src/b.ts", hash: "old-hash", size: 20, recordedAt: 1 },
      "src/c.ts": { relativePath: "src/c.ts", hash: "gone", size: 30, recordedAt: 1 },
    };
    const current: FingerprintStore = {
      "src/a.ts": { relativePath: "src/a.ts", hash: "unchanged", size: 10, recordedAt: 2 },
      "src/b.ts": { relativePath: "src/b.ts", hash: "new-hash", size: 25, recordedAt: 2 },
      "src/d.ts": { relativePath: "src/d.ts", hash: "brand-new", size: 15, recordedAt: 2 },
    };

    const diff = diffFingerprints(previous, current);
    expect(diff.changed).toEqual(["src/b.ts"]);
    expect(diff.added).toEqual(["src/d.ts"]);
    expect(diff.removed).toEqual(["src/c.ts"]);
  });
});
