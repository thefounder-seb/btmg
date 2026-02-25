/**
 * Schema presets — opt-in entity definitions for common BTMG patterns.
 *
 * Usage in btmg.config.ts:
 *   import { defineSchema, presets } from "btmg";
 *   export default defineSchema({
 *     schema: {
 *       nodes: [...presets.agentMemory.nodes, ...presets.codeScanner.nodes, ...myNodes],
 *       edges: [...presets.agentMemory.edges, ...presets.codeScanner.edges, ...myEdges],
 *     },
 *   });
 */

import type { SchemaPreset } from "./types.js";

export const agentMemory: SchemaPreset = {
  name: "agentMemory",
  nodes: [
    {
      label: "AgentSession",
      description: "Tracks an agent's interaction session with the graph",
      properties: {
        agentId: { type: "string", required: true },
        startedAt: { type: "date", required: true },
        endedAt: { type: "date" },
        purpose: { type: "string" },
        summary: { type: "string" },
        entitiesRead: { type: "number", default: 0 },
        entitiesWritten: { type: "number", default: 0 },
        status: {
          type: "enum",
          values: ["active", "completed", "abandoned"],
          required: true,
        },
      },
    },
    {
      label: "Observation",
      description: "An agent's recorded observation about the system",
      properties: {
        type: {
          type: "enum",
          values: ["decision", "discovery", "issue", "note", "question"],
          required: true,
        },
        summary: { type: "string", required: true },
        detail: { type: "string" },
        confidence: { type: "enum", values: ["high", "medium", "low"] },
        status: {
          type: "enum",
          values: ["open", "resolved", "superseded"],
          default: "open",
        },
        tags: { type: "string[]" },
        resolvedBy: { type: "string" },
      },
    },
  ],
  edges: [
    {
      type: "PRODUCED_BY",
      from: "Observation",
      to: "AgentSession",
      description: "Observation was created during this session",
    },
    {
      type: "OBSERVED_ON",
      from: "Observation",
      to: "CodeEntity",
      description: "Observation relates to this code entity",
    },
    {
      type: "SUPERSEDES",
      from: "Observation",
      to: "Observation",
      description: "This observation replaces a previous one",
    },
  ],
};

export const codeScanner: SchemaPreset = {
  name: "codeScanner",
  nodes: [
    {
      label: "CodeEntity",
      description: "A code-level entity discovered by the scanner",
      properties: {
        name: { type: "string", required: true },
        kind: {
          type: "enum",
          values: [
            "function",
            "class",
            "interface",
            "type",
            "module",
            "component",
            "hook",
            "route",
            "config",
          ],
          required: true,
        },
        filePath: { type: "string", required: true },
        exportType: { type: "enum", values: ["default", "named", "internal"] },
        signature: { type: "string" },
        docstring: { type: "string" },
        lineStart: { type: "number" },
        lineEnd: { type: "number" },
        tags: { type: "string[]" },
      },
    },
    {
      label: "Dependency",
      description: "An external package dependency",
      properties: {
        name: { type: "string", required: true },
        version: { type: "string" },
        devOnly: { type: "boolean" },
      },
    },
  ],
  edges: [
    { type: "IMPORTS", from: "CodeEntity", to: "CodeEntity" },
    { type: "CALLS", from: "CodeEntity", to: "CodeEntity" },
    { type: "CONTAINS", from: "CodeEntity", to: "CodeEntity" },
    { type: "IMPLEMENTS", from: "CodeEntity", to: "CodeEntity" },
    { type: "DEPENDS_ON", from: "CodeEntity", to: "Dependency" },
    {
      type: "DOCUMENTS",
      from: "CodeEntity",
      to: "CodeEntity",
      description: "A documentation link between code entities",
    },
  ],
};

/** All available presets */
export const presets = { agentMemory, codeScanner } as const;
