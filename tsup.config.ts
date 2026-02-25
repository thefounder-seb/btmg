import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: "dist",
  },
  {
    entry: ["src/mcp/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist/mcp",
  },
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    outDir: "dist/cli",
  },
]);
