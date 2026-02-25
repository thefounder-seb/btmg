import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  getAdapter,
  fumadocsAdapter,
  docusaurusAdapter,
  rawAdapter,
} from "../../src/docs/adapters/index.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const baseFrontmatter = {
  _id: "entity-1",
  _label: "Service",
  _sync_hash: "abc123",
  _version: 2,
  name: "Auth Service",
  status: "active",
};

const baseFrontmatterWithTitle = {
  ...baseFrontmatter,
  title: "Authentication Service",
};

const baseFrontmatterWithDescription = {
  ...baseFrontmatter,
  title: "Auth",
  description: "Handles authentication flows.",
};

const mermaidCode = `graph TD
  A[Start] --> B[End]`;

// ---------------------------------------------------------------------------
// getAdapter()
// ---------------------------------------------------------------------------

describe("getAdapter", () => {
  it("returns fumadocsAdapter for 'fumadocs'", () => {
    const adapter = getAdapter("fumadocs");
    expect(adapter).toBe(fumadocsAdapter);
    expect(adapter.name).toBe("fumadocs");
  });

  it("returns docusaurusAdapter for 'docusaurus'", () => {
    const adapter = getAdapter("docusaurus");
    expect(adapter).toBe(docusaurusAdapter);
    expect(adapter.name).toBe("docusaurus");
  });

  it("returns rawAdapter for 'raw'", () => {
    const adapter = getAdapter("raw");
    expect(adapter).toBe(rawAdapter);
    expect(adapter.name).toBe("raw");
  });

  it("returns rawAdapter for 'nextra' (no dedicated adapter yet)", () => {
    expect(getAdapter("nextra")).toBe(rawAdapter);
  });

  it("returns rawAdapter for 'vitepress' (no dedicated adapter yet)", () => {
    expect(getAdapter("vitepress")).toBe(rawAdapter);
  });

  it("falls back to rawAdapter for unknown framework strings", () => {
    expect(getAdapter("unknown-framework")).toBe(rawAdapter);
  });

  it("falls back to rawAdapter when framework is undefined", () => {
    expect(getAdapter(undefined)).toBe(rawAdapter);
  });

  it("falls back to rawAdapter for empty string", () => {
    // empty string is falsy, so the guard `if (!framework)` triggers
    expect(getAdapter("")).toBe(rawAdapter);
  });
});

// ---------------------------------------------------------------------------
// fumadocsAdapter
// ---------------------------------------------------------------------------

describe("fumadocsAdapter", () => {
  describe("metadata", () => {
    it("has name 'fumadocs'", () => {
      expect(fumadocsAdapter.name).toBe("fumadocs");
    });

    it("uses mdx extension", () => {
      expect(fumadocsAdapter.extension).toBe("mdx");
    });
  });

  describe("transformFrontmatter", () => {
    it("derives title from explicit title property", () => {
      const fm = fumadocsAdapter.transformFrontmatter(baseFrontmatterWithTitle);
      expect(fm.title).toBe("Authentication Service");
    });

    it("falls back to name when no explicit title", () => {
      const fm = fumadocsAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm.title).toBe("Auth Service");
    });

    it("falls back to _id when neither title nor name exist", () => {
      const fm = fumadocsAdapter.transformFrontmatter({
        _id: "fallback-id",
        _label: "Thing",
        _sync_hash: "h",
        _version: 1,
      });
      expect(fm.title).toBe("fallback-id");
    });

    it("preserves internal sync keys", () => {
      const fm = fumadocsAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm._id).toBe("entity-1");
      expect(fm._label).toBe("Service");
      expect(fm._sync_hash).toBe("abc123");
      expect(fm._version).toBe(2);
    });

    it("passes through extra user properties", () => {
      const fm = fumadocsAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm.status).toBe("active");
    });

    it("includes description when provided", () => {
      const fm = fumadocsAdapter.transformFrontmatter(baseFrontmatterWithDescription);
      expect(fm.description).toBe("Handles authentication flows.");
    });

    it("omits description key when not provided", () => {
      const fm = fumadocsAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm).not.toHaveProperty("description");
    });
  });

  describe("wrapMermaid", () => {
    it("wraps mermaid code in standard fenced code block", () => {
      const result = fumadocsAdapter.wrapMermaid(mermaidCode);
      expect(result).toBe("```mermaid\n" + mermaidCode + "\n```");
    });

    it("starts with ```mermaid and ends with ```", () => {
      const result = fumadocsAdapter.wrapMermaid("flowchart LR\n  A-->B");
      const lines = result.split("\n");
      expect(lines[0]).toBe("```mermaid");
      expect(lines[lines.length - 1]).toBe("```");
    });
  });

  describe("generateMeta", () => {
    it("is defined as a function", () => {
      expect(typeof fumadocsAdapter.generateMeta).toBe("function");
    });

    it("returns null for empty entities array", () => {
      const result = fumadocsAdapter.generateMeta!([], "/tmp/out");
      expect(result).toBeNull();
    });

    it("writes meta.json and returns path for non-empty entities", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "btmg-test-"));
      try {
        const entities = [
          { _id: "svc-1", _label: "Service", properties: {} },
          { _id: "svc-2", _label: "Service", properties: {} },
        ];

        const result = fumadocsAdapter.generateMeta!(entities, tmpDir);
        const expectedPath = resolve(tmpDir, "Service", "meta.json");

        expect(result).toBe(expectedPath);

        const written = JSON.parse(readFileSync(expectedPath, "utf-8"));
        expect(written).toEqual({ title: "Service", pages: ["svc-1", "svc-2"] });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("groups entities by label and writes multiple meta.json files", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "btmg-test-"));
      try {
        const entities = [
          { _id: "svc-1", _label: "Service", properties: {} },
          { _id: "ep-1", _label: "Endpoint", properties: {} },
        ];

        const result = fumadocsAdapter.generateMeta!(entities, tmpDir);

        // Returns the last written path (Endpoint comes after Service in iteration)
        expect(result).toBe(resolve(tmpDir, "Endpoint", "meta.json"));

        // Both meta.json files should exist
        const serviceMeta = JSON.parse(
          readFileSync(resolve(tmpDir, "Service", "meta.json"), "utf-8")
        );
        expect(serviceMeta).toEqual({ title: "Service", pages: ["svc-1"] });

        const endpointMeta = JSON.parse(
          readFileSync(resolve(tmpDir, "Endpoint", "meta.json"), "utf-8")
        );
        expect(endpointMeta).toEqual({ title: "Endpoint", pages: ["ep-1"] });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// docusaurusAdapter
// ---------------------------------------------------------------------------

describe("docusaurusAdapter", () => {
  describe("metadata", () => {
    it("has name 'docusaurus'", () => {
      expect(docusaurusAdapter.name).toBe("docusaurus");
    });

    it("uses md extension", () => {
      expect(docusaurusAdapter.extension).toBe("md");
    });
  });

  describe("transformFrontmatter", () => {
    it("includes sidebar_label derived from title", () => {
      const fm = docusaurusAdapter.transformFrontmatter(baseFrontmatterWithTitle);
      expect(fm.sidebar_label).toBe("Authentication Service");
      expect(fm.title).toBe("Authentication Service");
    });

    it("falls back to name for sidebar_label when no explicit title", () => {
      const fm = docusaurusAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm.sidebar_label).toBe("Auth Service");
      expect(fm.title).toBe("Auth Service");
    });

    it("falls back to _id when neither title nor name", () => {
      const fm = docusaurusAdapter.transformFrontmatter({
        _id: "my-id",
        _label: "Thing",
        _sync_hash: "h",
        _version: 1,
      });
      expect(fm.sidebar_label).toBe("my-id");
      expect(fm.title).toBe("my-id");
    });

    it("uses explicit sidebar_label when provided", () => {
      const fm = docusaurusAdapter.transformFrontmatter({
        ...baseFrontmatter,
        sidebar_label: "Custom Label",
      });
      expect(fm.sidebar_label).toBe("Custom Label");
    });

    it("includes sidebar_position when explicitly provided", () => {
      const fm = docusaurusAdapter.transformFrontmatter({
        ...baseFrontmatter,
        sidebar_position: 3,
      });
      expect(fm.sidebar_position).toBe(3);
    });

    it("omits sidebar_position when not provided", () => {
      const fm = docusaurusAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm).not.toHaveProperty("sidebar_position");
    });

    it("preserves internal sync keys", () => {
      const fm = docusaurusAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm._id).toBe("entity-1");
      expect(fm._label).toBe("Service");
      expect(fm._sync_hash).toBe("abc123");
      expect(fm._version).toBe(2);
    });

    it("passes through extra user properties", () => {
      const fm = docusaurusAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm.status).toBe("active");
    });
  });

  describe("wrapMermaid", () => {
    it("wraps mermaid code in standard fenced code block", () => {
      const result = docusaurusAdapter.wrapMermaid(mermaidCode);
      expect(result).toBe("```mermaid\n" + mermaidCode + "\n```");
    });
  });

  describe("generateMeta", () => {
    it("is not defined (Docusaurus infers sidebar from filesystem)", () => {
      expect(docusaurusAdapter.generateMeta).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// rawAdapter
// ---------------------------------------------------------------------------

describe("rawAdapter", () => {
  describe("metadata", () => {
    it("has name 'raw'", () => {
      expect(rawAdapter.name).toBe("raw");
    });

    it("uses md extension", () => {
      expect(rawAdapter.extension).toBe("md");
    });
  });

  describe("transformFrontmatter", () => {
    it("returns a shallow copy of the base frontmatter unchanged", () => {
      const fm = rawAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm).toEqual(baseFrontmatter);
    });

    it("does not mutate the original object", () => {
      const original = { ...baseFrontmatter };
      const fm = rawAdapter.transformFrontmatter(original);
      fm.title = "CHANGED";
      expect(original).not.toHaveProperty("title");
    });

    it("preserves all keys including internal ones", () => {
      const fm = rawAdapter.transformFrontmatter(baseFrontmatter);
      expect(fm._id).toBe("entity-1");
      expect(fm._label).toBe("Service");
      expect(fm._sync_hash).toBe("abc123");
      expect(fm._version).toBe(2);
      expect(fm.name).toBe("Auth Service");
      expect(fm.status).toBe("active");
    });
  });

  describe("wrapMermaid", () => {
    it("wraps mermaid code in standard fenced code block", () => {
      const result = rawAdapter.wrapMermaid(mermaidCode);
      expect(result).toBe("```mermaid\n" + mermaidCode + "\n```");
    });
  });

  describe("generateMeta", () => {
    it("is not defined (raw has no framework-specific meta)", () => {
      expect(rawAdapter.generateMeta).toBeUndefined();
    });
  });
});
