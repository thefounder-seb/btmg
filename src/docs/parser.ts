/**
 * Parse MDX/MD files, extract frontmatter → graph-compatible structures.
 */

import matter from "gray-matter";
import { readFileSync, existsSync } from "node:fs";
import { glob } from "glob";
import { resolve, relative } from "node:path";
import type { DocFrontmatter } from "../schema/types.js";

export interface ParsedDoc {
  filePath: string;
  relativePath: string;
  frontmatter: DocFrontmatter;
  content: string;
  raw: string;
}

/** Parse a single MDX/MD file */
export function parseDoc(filePath: string, basePath?: string): ParsedDoc {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  if (!data._id || !data._label) {
    throw new Error(
      `Missing required frontmatter (_id, _label) in ${filePath}`
    );
  }

  return {
    filePath,
    relativePath: basePath ? relative(basePath, filePath) : filePath,
    frontmatter: data as DocFrontmatter,
    content: content.trim(),
    raw,
  };
}

/** Parse all docs in a directory */
export async function parseDocs(
  directory: string,
  format: "mdx" | "md" = "md"
): Promise<ParsedDoc[]> {
  const pattern = resolve(directory, `**/*.${format}`);
  const files = await glob(pattern);

  const docs: ParsedDoc[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      docs.push(parseDoc(file, directory));
    } catch (e) {
      errors.push({
        file,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (errors.length > 0) {
    console.warn(
      `Warning: ${errors.length} file(s) skipped:\n` +
        errors.map((e) => `  ${e.file}: ${e.error}`).join("\n")
    );
  }

  return docs;
}

/** Extract graph-compatible properties from frontmatter (strip internal keys) */
export function extractProperties(
  frontmatter: DocFrontmatter
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!key.startsWith("_")) {
      props[key] = value;
    }
  }
  return props;
}
