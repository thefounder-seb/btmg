/**
 * Python parser.
 * Extracts: def, class, import/from-import, decorators.
 */

import { basename } from "node:path";
import type { RawArtifact, ArtifactRef } from "../../schema/types.js";
import type { DiscoveredFile, LanguageParser } from "../types.js";

// ── Regex patterns ──

// def foo( / async def foo(
const DEF_RE_JS = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/gm;

// class Foo( / class Foo:
const CLASS_RE = /^class\s+(\w+)\s*(?:\(([^)]*)\))?:/gm;

// import foo / import foo as bar
const IMPORT_RE = /^import\s+([\w.,\s]+)/gm;

// from foo import bar / from foo import bar, baz
const FROM_IMPORT_RE = /^from\s+([\w.]+)\s+import\s+([\w.,\s*]+)/gm;

// @decorator
const DECORATOR_RE = /^(\s*)@(\w[\w.]*)/gm;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function parsePython(file: DiscoveredFile, content: string): RawArtifact[] {
  const artifacts: RawArtifact[] = [];

  // Collect imports as refs
  const importRefs: ArtifactRef[] = [];
  let m: RegExpExecArray | null;

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    for (const mod of m[1].split(",")) {
      importRefs.push({ kind: "imports", target: mod.trim().split(" ")[0] });
    }
  }

  FROM_IMPORT_RE.lastIndex = 0;
  while ((m = FROM_IMPORT_RE.exec(content)) !== null) {
    importRefs.push({ kind: "imports", target: m[1] });
  }

  // File-level artifact
  artifacts.push({
    kind: "file",
    name: file.relativePath,
    filePath: file.relativePath,
    language: "python",
    meta: {
      basename: basename(file.relativePath),
      size: file.size,
    },
    refs: importRefs,
  });

  // Build a map of line → decorators for attaching to defs/classes
  const decoratorsByLine: Record<number, string[]> = {};
  DECORATOR_RE.lastIndex = 0;
  while ((m = DECORATOR_RE.exec(content)) !== null) {
    const line = lineOf(content, m.index);
    if (!decoratorsByLine[line]) decoratorsByLine[line] = [];
    decoratorsByLine[line].push(m[2]);
  }

  // Functions — only top-level (no leading whitespace) or module-level
  DEF_RE_JS.lastIndex = 0;
  while ((m = DEF_RE_JS.exec(content)) !== null) {
    const indent = m[1];
    const name = m[2];
    const isTopLevel = indent.length === 0;
    const line = lineOf(content, m.index);

    // Gather decorators from the preceding lines
    const decorators: string[] = [];
    for (let l = line - 1; l >= Math.max(1, line - 5); l--) {
      if (decoratorsByLine[l]) decorators.push(...decoratorsByLine[l]);
    }

    artifacts.push({
      kind: "function",
      name,
      filePath: file.relativePath,
      language: "python",
      meta: {
        topLevel: isTopLevel,
        async: content.slice(m.index, m.index + 20).includes("async"),
        decorators,
      },
      location: { start: line, end: line },
      refs: [],
    });
  }

  // Classes
  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(content)) !== null) {
    const name = m[1];
    const bases = m[2] ? m[2].split(",").map((b) => b.trim()).filter(Boolean) : [];
    const line = lineOf(content, m.index);

    const classRefs: ArtifactRef[] = bases.map((b) => ({
      kind: "extends" as const,
      target: b,
    }));

    // Gather decorators
    const decorators: string[] = [];
    for (let l = line - 1; l >= Math.max(1, line - 5); l--) {
      if (decoratorsByLine[l]) decorators.push(...decoratorsByLine[l]);
    }

    artifacts.push({
      kind: "class",
      name,
      filePath: file.relativePath,
      language: "python",
      meta: { bases, decorators },
      location: { start: line, end: line },
      refs: classRefs,
    });
  }

  return artifacts;
}

export const pythonParser: LanguageParser = {
  languages: ["python"],
  parse: parsePython,
};
