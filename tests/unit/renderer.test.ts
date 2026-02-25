import { describe, it, expect } from "vitest";
import { renderDoc, computeSyncHash } from "../../src/docs/renderer.js";
import { defaultTemplate, resolveFilePattern } from "../../src/docs/templates.js";
import type { EntityWithState } from "../../src/temporal/model.js";

const mockEntity: EntityWithState = {
  entity: {
    _id: "test-123",
    _label: "Person",
    _created_at: "2024-01-01T00:00:00Z",
  },
  state: {
    _entity_id: "test-123",
    _valid_from: "2024-01-01T00:00:00Z",
    _valid_to: null,
    _recorded_at: "2024-01-01T00:00:00Z",
    _version: 1,
    _actor: "test",
    name: "Alice",
    email: "alice@example.com",
    content: "Alice is a software engineer.",
  },
};

describe("Renderer", () => {
  describe("computeSyncHash", () => {
    it("produces consistent hashes for same data", () => {
      const h1 = computeSyncHash({ name: "Alice", email: "a@b.com" });
      const h2 = computeSyncHash({ name: "Alice", email: "a@b.com" });
      expect(h1).toBe(h2);
    });

    it("produces different hashes for different data", () => {
      const h1 = computeSyncHash({ name: "Alice" });
      const h2 = computeSyncHash({ name: "Bob" });
      expect(h1).not.toBe(h2);
    });

    it("ignores internal keys", () => {
      const h1 = computeSyncHash({ _version: 1, name: "Alice" });
      const h2 = computeSyncHash({ _version: 2, name: "Alice" });
      expect(h1).toBe(h2);
    });
  });

  describe("renderDoc", () => {
    it("renders frontmatter and body", () => {
      const output = renderDoc(mockEntity);
      expect(output).toContain("_id: test-123");
      expect(output).toContain("_label: Person");
      expect(output).toContain("_sync_hash:");
      expect(output).toContain("name: Alice");
      expect(output).toContain("Alice is a software engineer.");
    });

    it("includes version in frontmatter", () => {
      const output = renderDoc(mockEntity);
      expect(output).toContain("_version: 1");
    });
  });

  describe("resolveFilePattern", () => {
    it("resolves {_id} and {_label}", () => {
      const path = resolveFilePattern("{_label}/{_id}.md", mockEntity);
      expect(path).toBe("Person/test-123.md");
    });
  });
});
