/**
 * Adapter registry.
 *
 * Maps DocsFramework identifiers to their FormatAdapter implementations.
 * Unknown/unsupported framework strings fall back to the raw adapter so
 * callers never have to handle a null return.
 */

export type { FormatAdapter } from "./types.js";

export { fumadocsAdapter } from "./fumadocs.js";
export { docusaurusAdapter } from "./docusaurus.js";
export { rawAdapter } from "./raw.js";

import type { FormatAdapter } from "./types.js";
import { fumadocsAdapter } from "./fumadocs.js";
import { docusaurusAdapter } from "./docusaurus.js";
import { rawAdapter } from "./raw.js";

const registry: Record<string, FormatAdapter> = {
  fumadocs: fumadocsAdapter,
  docusaurus: docusaurusAdapter,
  // nextra and vitepress are listed in DocsFramework but have no dedicated
  // adapter yet — they fall through to raw.
  nextra: rawAdapter,
  vitepress: rawAdapter,
  raw: rawAdapter,
};

/**
 * Look up an adapter by framework name.
 * Falls back to the raw adapter for unknown or undefined framework strings.
 */
export function getAdapter(framework: string | undefined): FormatAdapter {
  if (!framework) return rawAdapter;
  return registry[framework] ?? rawAdapter;
}
