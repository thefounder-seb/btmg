import { describe, it, expect } from "vitest";
import { diffStates, buildChangelog } from "../../src/temporal/diff.js";
import { computeChanges } from "../../src/sync/differ.js";
import type { EntityWithState } from "../../src/temporal/model.js";
import type { ParsedDoc } from "../../src/docs/parser.js";
import { computeSyncHash } from "../../src/docs/renderer.js";

describe("Temporal Diff", () => {
  describe("diffStates", () => {
    it("detects added properties", () => {
      const diff = diffStates(
        "e1",
        { _version: 1, name: "Alice" },
        { _version: 2, name: "Alice", email: "a@b.com" }
      );
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].property).toBe("email");
      expect(diff.changes[0].old).toBeUndefined();
      expect(diff.changes[0].new).toBe("a@b.com");
    });

    it("detects changed properties", () => {
      const diff = diffStates(
        "e1",
        { _version: 1, name: "Alice" },
        { _version: 2, name: "Bob" }
      );
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].old).toBe("Alice");
      expect(diff.changes[0].new).toBe("Bob");
    });

    it("detects removed properties", () => {
      const diff = diffStates(
        "e1",
        { _version: 1, name: "Alice", email: "a@b.com" },
        { _version: 2, name: "Alice" }
      );
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].property).toBe("email");
      expect(diff.changes[0].new).toBeUndefined();
    });

    it("skips temporal metadata keys", () => {
      const diff = diffStates(
        "e1",
        { _version: 1, _actor: "a", _valid_from: "t1", name: "Alice" },
        { _version: 2, _actor: "b", _valid_from: "t2", name: "Alice" }
      );
      expect(diff.changes).toHaveLength(0);
    });

    it("returns version numbers", () => {
      const diff = diffStates(
        "e1",
        { _version: 1, name: "a" },
        { _version: 3, name: "b" }
      );
      expect(diff.fromVersion).toBe(1);
      expect(diff.toVersion).toBe(3);
    });
  });

  describe("buildChangelog", () => {
    it("builds diffs from version history", () => {
      const history = [
        { _version: 1, name: "v1" },
        { _version: 2, name: "v2" },
        { _version: 3, name: "v3" },
      ];
      const changelog = buildChangelog("e1", history);
      expect(changelog).toHaveLength(2);
      expect(changelog[0].fromVersion).toBe(1);
      expect(changelog[0].toVersion).toBe(2);
      expect(changelog[1].fromVersion).toBe(2);
      expect(changelog[1].toVersion).toBe(3);
    });

    it("sorts by version before diffing", () => {
      const history = [
        { _version: 3, name: "v3" },
        { _version: 1, name: "v1" },
        { _version: 2, name: "v2" },
      ];
      const changelog = buildChangelog("e1", history);
      expect(changelog[0].fromVersion).toBe(1);
    });
  });
});

describe("Sync Differ", () => {
  const makeEntity = (id: string, props: Record<string, unknown>): EntityWithState => ({
    entity: { _id: id, _label: "Person", _created_at: "2024-01-01T00:00:00Z" },
    state: {
      _entity_id: id,
      _valid_from: "2024-01-01T00:00:00Z",
      _valid_to: null,
      _recorded_at: "2024-01-01T00:00:00Z",
      _version: 1,
      _actor: "test",
      ...props,
    },
  });

  const makeDoc = (id: string, props: Record<string, unknown>, syncHash: string): ParsedDoc => ({
    filePath: `/docs/Person/${id}.md`,
    relativePath: `Person/${id}.md`,
    frontmatter: { _id: id, _label: "Person", _sync_hash: syncHash, _version: 1, ...props },
    content: "",
    raw: "",
  });

  it("detects entities in graph but not in docs", () => {
    const changes = computeChanges([makeEntity("e1", { name: "Alice" })], []);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("create");
    expect(changes[0].entityId).toBe("e1");
  });

  it("detects docs not in graph", () => {
    const changes = computeChanges([], [makeDoc("e1", { name: "Alice" }, "xxx")]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("create");
    expect(changes[0].docProperties).toBeDefined();
  });

  it("detects conflicts when hashes differ", () => {
    const entity = makeEntity("e1", { name: "Alice" });
    const doc = makeDoc("e1", { name: "Bob" }, "wrong-hash");
    const changes = computeChanges([entity], [doc]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("conflict");
  });

  it("detects updates when hash matches but props differ", () => {
    const entity = makeEntity("e1", { name: "Alice" });
    const hash = computeSyncHash(entity.state);
    const doc = makeDoc("e1", { name: "Bob" }, hash);
    const changes = computeChanges([entity], [doc]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("update");
  });

  it("detects no changes when in sync", () => {
    const entity = makeEntity("e1", { name: "Alice" });
    const hash = computeSyncHash(entity.state);
    const doc = makeDoc("e1", { name: "Alice" }, hash);
    const changes = computeChanges([entity], [doc]);
    expect(changes).toHaveLength(0);
  });
});
