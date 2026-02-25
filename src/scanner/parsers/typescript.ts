/**
 * TypeScript / JavaScript parser.
 * Uses regex — no compiler API dependency.
 * Extracts: exported functions, classes, interfaces, types, and imports.
 */

import { basename } from "node:path";
import type { RawArtifact, ArtifactRef } from "../../schema/types.js";
import type { DiscoveredFile, LanguageParser } from "../types.js";

// ── Regex patterns ──

// export function foo / export async function foo / export default function foo
const EXPORT_FUNCTION_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s+(\w+)\s*[(<]/gm;

// export const foo = (...) => / export const foo = function
const EXPORT_ARROW_RE =
  /^export\s+(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function\s*\()/gm;

// export class Foo
const EXPORT_CLASS_RE = /^export\s+(?:abstract\s+)?class\s+(\w+)/gm;

// export interface Foo
const EXPORT_INTERFACE_RE = /^export\s+interface\s+(\w+)/gm;

// export type Foo = ...
const EXPORT_TYPE_RE = /^export\s+type\s+(\w+)\s*[=<{]/gm;

// import ... from "..."  /  import "..."
const IMPORT_RE = /^import\s+(?:[^"']*from\s+)?["']([^"']+)["']/gm;

// Line ranges: capture start line of a match
function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

// ── Parser implementation ──

function parseTsJs(file: DiscoveredFile, content: string): RawArtifact[] {
  const artifacts: RawArtifact[] = [];

  // Collect all import targets as refs (shared across file-level artifact)
  const importRefs: ArtifactRef[] = [];
  let m: RegExpExecArray | null;

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    importRefs.push({ kind: "imports", target: m[1] });
  }

  // File-level artifact
  artifacts.push({
    kind: "file",
    name: file.relativePath,
    filePath: file.relativePath,
    language: file.language,
    meta: {
      basename: basename(file.relativePath),
      size: file.size,
    },
    refs: importRefs,
  });

  // Exported functions
  EXPORT_FUNCTION_RE.lastIndex = 0;
  while ((m = EXPORT_FUNCTION_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(content, m.index);
    artifacts.push({
      kind: "function",
      name,
      filePath: file.relativePath,
      language: file.language,
      meta: { exported: true, async: m[0].includes("async") },
      location: { start: line, end: line },
      refs: [],
    });
  }

  // Exported arrow / const functions
  EXPORT_ARROW_RE.lastIndex = 0;
  while ((m = EXPORT_ARROW_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(content, m.index);
    artifacts.push({
      kind: "function",
      name,
      filePath: file.relativePath,
      language: file.language,
      meta: { exported: true, async: m[0].includes("async"), arrow: true },
      location: { start: line, end: line },
      refs: [],
    });
  }

  // Exported classes
  EXPORT_CLASS_RE.lastIndex = 0;
  while ((m = EXPORT_CLASS_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(content, m.index);

    // Look for extends / implements on the same line
    const lineText = content.slice(m.index, content.indexOf("\n", m.index));
    const classRefs: ArtifactRef[] = [];

    const extendsMatch = lineText.match(/extends\s+([\w.]+)/);
    if (extendsMatch) {
      classRefs.push({ kind: "extends", target: extendsMatch[1] });
    }

    const implementsMatch = lineText.match(/implements\s+([\w,\s]+?)(?:\{|$)/);
    if (implementsMatch) {
      for (const iface of implementsMatch[1].split(",")) {
        classRefs.push({ kind: "implements", target: iface.trim() });
      }
    }

    artifacts.push({
      kind: "class",
      name,
      filePath: file.relativePath,
      language: file.language,
      meta: { exported: true, abstract: m[0].includes("abstract") },
      location: { start: line, end: line },
      refs: classRefs,
    });
  }

  // Exported interfaces
  EXPORT_INTERFACE_RE.lastIndex = 0;
  while ((m = EXPORT_INTERFACE_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(content, m.index);

    const lineText = content.slice(m.index, content.indexOf("\n", m.index));
    const ifaceRefs: ArtifactRef[] = [];

    const extendsMatch = lineText.match(/extends\s+([\w,\s]+?)(?:\{|$)/);
    if (extendsMatch) {
      for (const base of extendsMatch[1].split(",")) {
        ifaceRefs.push({ kind: "extends", target: base.trim() });
      }
    }

    artifacts.push({
      kind: "interface",
      name,
      filePath: file.relativePath,
      language: file.language,
      meta: { exported: true },
      location: { start: line, end: line },
      refs: ifaceRefs,
    });
  }

  // Exported types
  EXPORT_TYPE_RE.lastIndex = 0;
  while ((m = EXPORT_TYPE_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(content, m.index);
    artifacts.push({
      kind: "type",
      name,
      filePath: file.relativePath,
      language: file.language,
      meta: { exported: true },
      location: { start: line, end: line },
      refs: [],
    });
  }

  return artifacts;
}

export const typescriptParser: LanguageParser = {
  languages: ["typescript", "javascript"],
  parse: parseTsJs,
};
