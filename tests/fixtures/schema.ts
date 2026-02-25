import type { SchemaDef } from "../../src/schema/types.js";

export const testSchema: SchemaDef = {
  nodes: [
    {
      label: "Person",
      properties: {
        name: { type: "string", required: true },
        email: { type: "email" },
        age: { type: "number" },
        active: { type: "boolean" },
        role: { type: "enum", values: ["admin", "user", "guest"] },
        tags: { type: "string[]" },
      },
      uniqueKeys: ["email"],
    },
    {
      label: "Project",
      properties: {
        name: { type: "string", required: true },
        description: { type: "string" },
        url: { type: "url" },
        startDate: { type: "date" },
      },
    },
  ],
  edges: [
    {
      type: "WORKS_ON",
      from: "Person",
      to: "Project",
      properties: {
        since: { type: "date" },
        role: { type: "string" },
      },
    },
    {
      type: "MANAGES",
      from: "Person",
      to: "Person",
    },
  ],
};
