import { describe, it, expect } from "vitest";
import { SchemaRegistry } from "../../src/schema/registry.js";
import { compileNodeValidator, compileEdgeValidator } from "../../src/schema/validator.js";
import { testSchema } from "../fixtures/schema.js";

describe("Schema Validator", () => {
  describe("compileNodeValidator", () => {
    const personDef = testSchema.nodes[0];
    const validator = compileNodeValidator(personDef);

    it("validates correct data", () => {
      const result = validator.validate({
        name: "Alice",
        email: "alice@example.com",
        age: 30,
        active: true,
        role: "admin",
        tags: ["dev", "lead"],
      });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("Alice");
    });

    it("rejects missing required fields", () => {
      const result = validator.validate({ email: "a@b.com" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("name");
    });

    it("rejects invalid email", () => {
      const result = validator.validate({ name: "Test", email: "not-an-email" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("email");
    });

    it("rejects invalid enum values", () => {
      const result = validator.validate({ name: "Test", role: "superadmin" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("role");
    });

    it("rejects unknown properties (strict mode)", () => {
      const result = validator.validate({ name: "Test", unknownField: "boom" });
      expect(result.success).toBe(false);
    });

    it("accepts optional fields as undefined", () => {
      const result = validator.validate({ name: "Alice" });
      expect(result.success).toBe(true);
    });
  });

  describe("compileEdgeValidator", () => {
    const edgeDef = testSchema.edges[0]; // WORKS_ON
    const validator = compileEdgeValidator(edgeDef);

    it("validates edge with properties", () => {
      const result = validator.validate({ since: "2024-01-01", role: "lead" });
      expect(result.success).toBe(true);
    });

    it("validates edge without required properties", () => {
      const result = validator.validate({});
      expect(result.success).toBe(true);
    });

    const noPropsEdge = testSchema.edges[1]; // MANAGES
    const noPropValidator = compileEdgeValidator(noPropsEdge);

    it("validates edge with no property schema", () => {
      const result = noPropValidator.validate({});
      expect(result.success).toBe(true);
    });
  });
});

describe("Schema Registry", () => {
  const registry = new SchemaRegistry(testSchema);

  it("looks up node validators by label", () => {
    const v = registry.getNodeValidator("Person");
    expect(v.label).toBe("Person");
  });

  it("throws for unknown node labels", () => {
    expect(() => registry.getNodeValidator("Unknown")).toThrow("Unknown node label");
  });

  it("looks up edge validators", () => {
    const v = registry.getEdgeValidator("Person", "WORKS_ON", "Project");
    expect(v.type).toBe("WORKS_ON");
  });

  it("throws for unknown edge types", () => {
    expect(() => registry.getEdgeValidator("Person", "LIKES", "Project")).toThrow("Unknown edge");
  });

  it("checks node label existence", () => {
    expect(registry.hasNodeLabel("Person")).toBe(true);
    expect(registry.hasNodeLabel("Animal")).toBe(false);
  });

  it("lists all node labels", () => {
    const labels = registry.getNodeLabels();
    expect(labels).toContain("Person");
    expect(labels).toContain("Project");
  });

  it("lists all edge keys", () => {
    const keys = registry.getEdgeKeys();
    expect(keys).toContain("Person-[WORKS_ON]->Project");
  });
});
