/**
 * Raw (pass-through) format adapter.
 *
 * Returns everything exactly as-is — no frontmatter transformation, no
 * Mermaid wrapping, no metadata generation. Useful for:
 *   - plain Markdown output with no framework assumptions
 *   - testing/debugging rendered output
 *   - custom pipelines that apply their own post-processing
 */

import type { FormatAdapter } from "./types.js";

export const rawAdapter: FormatAdapter = {
  name: "raw",
  extension: "md",

  transformFrontmatter(base) {
    // Return a shallow copy so callers cannot mutate our internal state,
    // but do not change any key or value.
    return { ...base };
  },

  wrapMermaid(mermaidCode) {
    // Preserve the standard fenced code block exactly as produced by templates.
    return ["```mermaid", mermaidCode, "```"].join("\n");
  },

  // No generateMeta — raw output has no framework-specific navigation files.
};
