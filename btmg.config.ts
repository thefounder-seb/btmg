import { defineSchema } from "./src/schema/types.js";

export default defineSchema({
  schema: {
    nodes: [
      {
        label: "Concept",
        description: "A knowledge concept in the graph",
        properties: {
          name: { type: "string", required: true },
          description: { type: "string" },
          category: { type: "enum", values: ["core", "pattern", "tool", "reference"] },
          tags: { type: "string[]" },
          url: { type: "url" },
        },
      },
      {
        label: "Document",
        description: "A documentation page",
        properties: {
          title: { type: "string", required: true },
          slug: { type: "string", required: true },
          content: { type: "string" },
          status: { type: "enum", values: ["draft", "published", "archived"] },
        },
      },
    ],
    edges: [
      {
        type: "RELATES_TO",
        from: "Concept",
        to: "Concept",
        properties: {
          strength: { type: "number" },
          description: { type: "string" },
        },
      },
      {
        type: "DOCUMENTED_IN",
        from: "Concept",
        to: "Document",
      },
    ],
  },
  docs: {
    directory: "./docs",
    format: "md",
  },
  sync: {
    conflictStrategy: "graph-wins",
  },
});
