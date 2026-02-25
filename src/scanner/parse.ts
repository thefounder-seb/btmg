/**
 * Parser router.
 * Dispatches DiscoveredFile → RawArtifact[] via the appropriate LanguageParser.
 */

import { readFileSync } from "node:fs";
import type { RawArtifact, SupportedLanguage } from "../schema/types.js";
import type { DiscoveredFile, LanguageParser } from "./types.js";
import { typescriptParser } from "./parsers/typescript.js";
import { pythonParser } from "./parsers/python.js";
import { goParser } from "./parsers/go.js";
import { genericParser } from "./parsers/generic.js";

// ── Built-in parser registry ──

const BUILTIN_PARSERS: LanguageParser[] = [
  typescriptParser,
  pythonParser,
  goParser,
  genericParser,
];

/** Build a lookup map from language → parser */
function buildParserMap(parsers: LanguageParser[]): Map<SupportedLanguage, LanguageParser> {
  const map = new Map<SupportedLanguage, LanguageParser>();
  for (const parser of parsers) {
    for (const lang of parser.languages) {
      // Later registrations win (allows overriding built-ins)
      map.set(lang, parser);
    }
  }
  return map;
}

// ── Public API ──

export interface ParseFilesOptions {
  /** Additional / replacement parsers (override built-ins by language key) */
  extraParsers?: LanguageParser[];
  /** Restrict which languages to parse. Defaults to all. */
  languages?: SupportedLanguage[];
}

/**
 * Parse a list of discovered files into raw artifacts.
 * Reads file content from disk and dispatches to the correct parser.
 * Non-fatal errors are silently skipped (the file is just omitted).
 */
export function parseFiles(
  files: DiscoveredFile[],
  options: ParseFilesOptions = {}
): RawArtifact[] {
  const parserMap = buildParserMap([
    ...BUILTIN_PARSERS,
    ...(options.extraParsers ?? []),
  ]);

  const languageFilter = options.languages ? new Set(options.languages) : null;

  const all: RawArtifact[] = [];

  for (const file of files) {
    // Language filter
    if (languageFilter && !languageFilter.has(file.language)) {
      continue;
    }

    const parser = parserMap.get(file.language);
    if (!parser) {
      // No parser available — skip silently
      continue;
    }

    let content: string;
    try {
      content = readFileSync(file.absolutePath, "utf8");
    } catch {
      // File disappeared between discovery and parse — skip
      continue;
    }

    try {
      const artifacts = parser.parse(file, content);
      all.push(...artifacts);
    } catch {
      // Parser threw — skip this file rather than aborting the whole scan
      continue;
    }
  }

  return all;
}
