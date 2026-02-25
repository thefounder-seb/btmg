/**
 * Schema registry — O(1) lookups for node/edge type validators.
 * Built once at startup from the user's schema definition.
 */

import type { SchemaDef, NodeTypeDef, EdgeTypeDef } from "./types.js";
import {
  compileNodeValidator,
  compileEdgeValidator,
  type CompiledNodeValidator,
  type CompiledEdgeValidator,
} from "./validator.js";

export class SchemaRegistry {
  private nodeValidators = new Map<string, CompiledNodeValidator>();
  private edgeValidators = new Map<string, CompiledEdgeValidator>();
  private nodeDefs = new Map<string, NodeTypeDef>();
  private edgeDefs = new Map<string, EdgeTypeDef>();

  constructor(schema: SchemaDef) {
    for (const node of schema.nodes) {
      this.nodeDefs.set(node.label, node);
      this.nodeValidators.set(node.label, compileNodeValidator(node));
    }
    for (const edge of schema.edges) {
      const key = `${edge.from}-[${edge.type}]->${edge.to}`;
      this.edgeDefs.set(key, edge);
      this.edgeValidators.set(key, compileEdgeValidator(edge));
    }
  }

  /** Get validator for a node label. Throws if label is not in schema. */
  getNodeValidator(label: string): CompiledNodeValidator {
    const v = this.nodeValidators.get(label);
    if (!v) {
      throw new Error(
        `Unknown node label "${label}". Valid labels: ${[...this.nodeValidators.keys()].join(", ")}`
      );
    }
    return v;
  }

  /** Get validator for an edge type between two labels. */
  getEdgeValidator(from: string, type: string, to: string): CompiledEdgeValidator {
    const key = `${from}-[${type}]->${to}`;
    const v = this.edgeValidators.get(key);
    if (!v) {
      throw new Error(
        `Unknown edge "${key}". Valid edges: ${[...this.edgeValidators.keys()].join(", ")}`
      );
    }
    return v;
  }

  /** Check if a node label exists in schema */
  hasNodeLabel(label: string): boolean {
    return this.nodeValidators.has(label);
  }

  /** Check if an edge type exists between two labels */
  hasEdgeType(from: string, type: string, to: string): boolean {
    return this.edgeValidators.has(`${from}-[${type}]->${to}`);
  }

  /** Get node type definition */
  getNodeDef(label: string): NodeTypeDef | undefined {
    return this.nodeDefs.get(label);
  }

  /** Get all node labels */
  getNodeLabels(): string[] {
    return [...this.nodeDefs.keys()];
  }

  /** Get all edge type keys */
  getEdgeKeys(): string[] {
    return [...this.edgeDefs.keys()];
  }

  /** Get all node definitions */
  getNodeDefs(): NodeTypeDef[] {
    return [...this.nodeDefs.values()];
  }

  /** Get all edge definitions */
  getEdgeDefs(): EdgeTypeDef[] {
    return [...this.edgeDefs.values()];
  }
}
