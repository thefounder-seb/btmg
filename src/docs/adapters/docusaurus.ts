/**
 * Docusaurus format adapter.
 *
 * Docusaurus (https://docusaurus.io) uses Markdown/MDX with sidebar_label
 * and sidebar_position frontmatter keys to control navigation ordering.
 *
 * Mermaid is supported via the standard fenced code block with the `mermaid`
 * language tag when the @docusaurus/theme-mermaid plugin is installed, so no
 * special wrapping is needed beyond re-emitting the fence.
 */

import type { FormatAdapter } from "./types.js";

export const docusaurusAdapter: FormatAdapter = {
  name: "docusaurus",
  extension: "md",

  transformFrontmatter(base) {
    const {
      _id,
      _label,
      _sync_hash,
      _version,
      title: existingTitle,
      sidebar_label: existingSidebarLabel,
      sidebar_position: existingSidebarPosition,
      ...rest
    } = base as Record<string, unknown> & {
      _id: string;
      _label: string;
      _sync_hash: string;
      _version: unknown;
      title?: unknown;
      sidebar_label?: unknown;
      sidebar_position?: unknown;
    };

    // Human-readable label: prefer explicit title/sidebar_label, then name, then _id.
    const derivedTitle =
      existingTitle ??
      (rest.name as string | undefined) ??
      _id;

    const sidebarLabel = existingSidebarLabel ?? derivedTitle;

    const fm: Record<string, unknown> = {
      // Docusaurus sidebar keys
      sidebar_label: sidebarLabel,
      // Keep title for the page heading
      title: derivedTitle,
      // Internal sync keys
      _id,
      _label,
      _sync_hash,
      _version,
      // All remaining user properties
      ...rest,
    };

    // Only set sidebar_position if it was explicitly provided (to avoid
    // overriding Docusaurus's own auto-positioning with a stale value).
    if (existingSidebarPosition !== undefined) {
      fm.sidebar_position = existingSidebarPosition;
    }

    return fm;
  },

  wrapMermaid(mermaidCode) {
    // @docusaurus/theme-mermaid handles standard fenced mermaid blocks.
    return ["```mermaid", mermaidCode, "```"].join("\n");
  },

  // Docusaurus infers sidebar structure from the filesystem and frontmatter;
  // no additional metadata file is needed from this adapter.
};
