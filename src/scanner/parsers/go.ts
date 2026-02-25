/**
 * Go parser.
 * Extracts: func declarations, type struct/interface, import blocks, go.mod module/require.
 */

import { basename } from "node:path";
import type { RawArtifact, ArtifactRef } from "../../schema/types.js";
import type { DiscoveredFile, LanguageParser } from "../types.js";

// ── Regex patterns ──

// func FuncName( / func (recv Type) MethodName(
const FUNC_RE = /^func\s+(?:\(\s*\w*\s+\*?(\w+)\s*\)\s+)?(\w+)\s*[([]/gm;

// type Foo struct { / type Bar interface {
const TYPE_STRUCT_RE = /^type\s+(\w+)\s+struct\s*\{/gm;
const TYPE_INTERFACE_RE = /^type\s+(\w+)\s+interface\s*\{/gm;

// Single-line import: import "pkg"
const IMPORT_SINGLE_RE = /^import\s+"([^"]+)"/gm;

// Import block: import ( ... )
const IMPORT_BLOCK_RE = /^import\s*\(([^)]+)\)/gm;
const IMPORT_LINE_RE = /"([^"]+)"/g;

// go.mod: module declaration
const GOMOD_MODULE_RE = /^module\s+(\S+)/m;
// go.mod: require lines
const GOMOD_REQUIRE_RE = /^\s+?(\S+)\s+v[\d.]+/gm;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function collectImports(content: string): ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  let m: RegExpExecArray | null;

  IMPORT_SINGLE_RE.lastIndex = 0;
  while ((m = IMPORT_SINGLE_RE.exec(content)) !== null) {
    refs.push({ kind: "imports", target: m[1] });
  }

  IMPORT_BLOCK_RE.lastIndex = 0;
  while ((m = IMPORT_BLOCK_RE.exec(content)) !== null) {
    const block = m[1];
    IMPORT_LINE_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = IMPORT_LINE_RE.exec(block)) !== null) {
      refs.push({ kind: "imports", target: im[1] });
    }
  }

  return refs;
}

function parseGoMod(file: DiscoveredFile, content: string): RawArtifact[] {
  const artifacts: RawArtifact[] = [];
  const moduleMatch = content.match(GOMOD_MODULE_RE);
  const moduleName = moduleMatch ? moduleMatch[1] : basename(file.relativePath);

  const deps: string[] = [];
  let m: RegExpExecArray | null;
  GOMOD_REQUIRE_RE.lastIndex = 0;
  while ((m = GOMOD_REQUIRE_RE.exec(content)) !== null) {
    deps.push(m[1]);
  }

  artifacts.push({
    kind: "module",
    name: moduleName,
    filePath: file.relativePath,
    language: "go",
    meta: { goModule: true, dependencies: deps },
    refs: deps.map((d) => ({ kind: "depends_on" as const, target: d })),
  });

  for (const dep of deps) {
    artifacts.push({
      kind: "dependency",
      name: dep,
      filePath: file.relativePath,
      language: "go",
      meta: { source: "go.mod" },
      refs: [],
    });
  }

  return artifacts;
}

function parseGo(file: DiscoveredFile, content: string): RawArtifact[] {
  // Delegate go.mod parsing
  if (basename(file.relativePath) === "go.mod") {
    return parseGoMod(file, content);
  }

  const artifacts: RawArtifact[] = [];
  const importRefs = collectImports(content);

  // File artifact
  artifacts.push({
    kind: "file",
    name: file.relativePath,
    filePath: file.relativePath,
    language: "go",
    meta: {
      basename: basename(file.relativePath),
      size: file.size,
    },
    refs: importRefs,
  });

  let m: RegExpExecArray | null;

  // Functions and methods
  FUNC_RE.lastIndex = 0;
  while ((m = FUNC_RE.exec(content)) !== null) {
    const receiverType = m[1] ?? null;
    const funcName = m[2];
    const line = lineOf(content, m.index);
    const isExported = /^[A-Z]/.test(funcName);

    artifacts.push({
      kind: "function",
      name: funcName,
      filePath: file.relativePath,
      language: "go",
      meta: {
        exported: isExported,
        receiverType,
        method: receiverType !== null,
      },
      location: { start: line, end: line },
      refs: [],
    });
  }

  // Struct types
  TYPE_STRUCT_RE.lastIndex = 0;
  while ((m = TYPE_STRUCT_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(content, m.index);
    artifacts.push({
      kind: "class",
      name,
      filePath: file.relativePath,
      language: "go",
      meta: { exported: /^[A-Z]/.test(name), goKind: "struct" },
      location: { start: line, end: line },
      refs: [],
    });
  }

  // Interface types
  TYPE_INTERFACE_RE.lastIndex = 0;
  while ((m = TYPE_INTERFACE_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(content, m.index);
    artifacts.push({
      kind: "interface",
      name,
      filePath: file.relativePath,
      language: "go",
      meta: { exported: /^[A-Z]/.test(name) },
      location: { start: line, end: line },
      refs: [],
    });
  }

  return artifacts;
}

export const goParser: LanguageParser = {
  languages: ["go"],
  parse: parseGo,
};
