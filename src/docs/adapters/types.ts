/**
 * FormatAdapter interface — abstracts framework-specific doc formatting.
 *
 * Each adapter handles:
 *   - frontmatter shape (framework-specific keys)
 *   - Mermaid diagram wrapping (some frameworks need special treatment)
 *   - optional sidebar/navigation metadata generation
 */

export interface FormatAdapter {
  /** Human-readable adapter name */
  name: string;
  /** File extension this adapter targets */
  extension: "mdx" | "md";
  /**
   * Transform base frontmatter into framework-specific frontmatter.
   * The base object always contains _id, _label, _sync_hash, _version,
   * plus any user-defined properties.
   */
  transformFrontmatter(base: Record<string, unknown>): Record<string, unknown>;
  /**
   * Wrap a raw Mermaid code block string for the target framework.
   * The input is the content between the ``` fences (not including them).
   * Return the full wrapped string ready to embed in the doc body.
   */
  wrapMermaid(mermaidCode: string): string;
  /**
   * Optionally generate a framework-specific navigation/metadata file
   * (e.g. meta.json for Fumadocs, _category_.json for Docusaurus).
   *
   * Called once after all entity files are written.
   *
   * @param entities   The entities that were written in this batch.
   * @param outputDir  The root output directory.
   * @returns          The file path that was written, or null if nothing was written.
   */
  generateMeta?(
    entities: Array<{
      _id: string;
      _label: string;
      properties: Record<string, unknown>;
    }>,
    outputDir: string
  ): string | null;
}
