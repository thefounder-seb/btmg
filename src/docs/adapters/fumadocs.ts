/**
 * Fumadocs format adapter.
 *
 * Fumadocs (https://fumadocs.dev) uses MDX with a specific frontmatter shape
 * and supports Mermaid natively via the `<Mermaid>` component or the
 * `rehype-mermaid` plugin — both of which handle standard fenced code blocks
 * with the `mermaid` language tag, so no special wrapping is needed.
 *
 * generateMeta writes a `meta.json` file per label subdirectory so Fumadocs
 * can order the sidebar automatically.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { FormatAdapter } from "./types.js";

export const fumadocsAdapter: FormatAdapter = {
  name: "fumadocs",
  extension: "mdx",

  transformFrontmatter(base) {
    const {
      _id,
      _label,
      _sync_hash,
      _version,
      title: existingTitle,
      description: existingDescription,
      ...rest
    } = base as Record<string, unknown> & {
      _id: string;
      _label: string;
      _sync_hash: string;
      _version: unknown;
      title?: unknown;
      description?: unknown;
    };

    // Derive a human-readable title: prefer explicit title property, fall back
    // to the name property, then the entity _id.
    const title =
      existingTitle ??
      (rest.name as string | undefined) ??
      _id;

    const description =
      existingDescription ??
      (rest.description as string | undefined) ??
      undefined;

    const fm: Record<string, unknown> = {
      // Fumadocs required/recommended keys
      title,
      // Internal sync keys kept for round-trip fidelity
      _id,
      _label,
      _sync_hash,
      _version,
      // All remaining user properties
      ...rest,
    };

    if (description !== undefined) {
      fm.description = description;
    }

    return fm;
  },

  wrapMermaid(mermaidCode) {
    // Fumadocs handles standard fenced mermaid blocks via rehype-mermaid or
    // the built-in <Mermaid> MDX component — both triggered by the standard
    // fenced code block, so we just re-emit the fence.
    return ["```mermaid", mermaidCode, "```"].join("\n");
  },

  generateMeta(entities, outputDir) {
    if (entities.length === 0) return null;

    // Group entity IDs by label so we emit one meta.json per label subdir.
    const byLabel = new Map<string, string[]>();
    for (const entity of entities) {
      const existing = byLabel.get(entity._label) ?? [];
      existing.push(entity._id);
      byLabel.set(entity._label, existing);
    }

    // Write the last label's meta.json and return its path (callers that need
    // all paths can call generateMeta per-label group; here we write all and
    // return the last one as a representative path).
    let lastPath: string | null = null;

    for (const [label, ids] of byLabel) {
      const labelDir = resolve(outputDir, label);
      mkdirSync(labelDir, { recursive: true });

      // meta.json format expected by Fumadocs source.config.ts / pageTree
      const meta = {
        title: label,
        pages: ids,
      };

      const metaPath = resolve(labelDir, "meta.json");
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
      lastPath = metaPath;
    }

    return lastPath;
  },
};
