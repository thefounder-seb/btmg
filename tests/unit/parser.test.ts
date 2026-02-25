import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseDoc, parseDocs, extractProperties } from "../../src/docs/parser.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/docs");

describe("Doc Parser", () => {
  describe("parseDoc", () => {
    it("parses valid doc with frontmatter", () => {
      const doc = parseDoc(resolve(fixturesDir, "Person/alice.md"), fixturesDir);
      expect(doc.frontmatter._id).toBe("alice-123");
      expect(doc.frontmatter._label).toBe("Person");
      expect(doc.frontmatter.name).toBe("Alice");
      expect(doc.content).toContain("Alice is a software engineer");
    });

    it("throws for missing file", () => {
      expect(() => parseDoc("/nonexistent/file.md")).toThrow("File not found");
    });

    it("throws for missing _id/_label", () => {
      expect(() =>
        parseDoc(resolve(fixturesDir, "invalid-no-id.md"))
      ).toThrow("Missing required frontmatter");
    });

    it("computes relative path", () => {
      const doc = parseDoc(resolve(fixturesDir, "Person/bob.md"), fixturesDir);
      expect(doc.relativePath).toBe("Person/bob.md");
    });
  });

  describe("parseDocs", () => {
    it("parses all md files in directory", async () => {
      const docs = await parseDocs(fixturesDir, "md");
      // Should get alice and bob (invalid-no-id will be warned but skipped)
      const validDocs = docs.filter((d) => d.frontmatter._id);
      expect(validDocs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("extractProperties", () => {
    it("strips internal keys", () => {
      const props = extractProperties({
        _id: "123",
        _label: "Person",
        _sync_hash: "abc",
        _version: 1,
        name: "Alice",
        email: "a@b.com",
      });
      expect(props).toEqual({ name: "Alice", email: "a@b.com" });
      expect(props).not.toHaveProperty("_id");
    });
  });
});
