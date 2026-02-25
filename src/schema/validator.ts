/**
 * Compiles user-defined schema into Zod validators.
 * Every write path passes through these validators to reject
 * unknown labels, missing required properties, or type mismatches.
 */

import { z, type ZodObject, type ZodRawShape } from "zod";
import type { NodeTypeDef, EdgeTypeDef, PropertyDef, PropertyType } from "./types.js";

/** Map a PropertyDef to a Zod schema */
function propertyToZod(def: PropertyDef): z.ZodTypeAny {
  const typeMap: Record<PropertyType, () => z.ZodTypeAny> = {
    string: () => z.string(),
    number: () => z.number(),
    boolean: () => z.boolean(),
    date: () => z.string().datetime({ offset: true }).or(z.string().date()),
    url: () => z.string().url(),
    email: () => z.string().email(),
    enum: () => (def.values ? z.enum(def.values as [string, ...string[]]) : z.string()),
    "string[]": () => z.array(z.string()),
    json: () => z.unknown(),
  };

  let schema = typeMap[def.type]();

  if (!def.required) {
    schema = schema.optional();
  }

  if (def.default !== undefined) {
    schema = schema.default(def.default);
  }

  return schema;
}

/** Build a Zod object schema from property definitions */
function buildPropertiesSchema(
  properties: Record<string, PropertyDef>
): ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};
  for (const [key, def] of Object.entries(properties)) {
    shape[key] = propertyToZod(def);
  }
  return z.object(shape).strict();
}

export interface CompiledNodeValidator {
  label: string;
  schema: ZodObject<ZodRawShape>;
  validate: (data: unknown) => { success: boolean; data?: Record<string, unknown>; error?: string };
}

export interface CompiledEdgeValidator {
  type: string;
  from: string;
  to: string;
  schema: ZodObject<ZodRawShape> | null;
  validate: (data: unknown) => { success: boolean; data?: Record<string, unknown>; error?: string };
}

/** Compile a NodeTypeDef into a validator */
export function compileNodeValidator(def: NodeTypeDef): CompiledNodeValidator {
  const schema = buildPropertiesSchema(def.properties);
  return {
    label: def.label,
    schema,
    validate(data: unknown) {
      const result = schema.safeParse(data);
      if (result.success) {
        return { success: true, data: result.data as Record<string, unknown> };
      }
      return {
        success: false,
        error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      };
    },
  };
}

/** Compile an EdgeTypeDef into a validator */
export function compileEdgeValidator(def: EdgeTypeDef): CompiledEdgeValidator {
  const schema = def.properties ? buildPropertiesSchema(def.properties) : null;
  return {
    type: def.type,
    from: def.from,
    to: def.to,
    schema,
    validate(data: unknown) {
      if (!schema) {
        return { success: true, data: {} };
      }
      const result = schema.safeParse(data);
      if (result.success) {
        return { success: true, data: result.data as Record<string, unknown> };
      }
      return {
        success: false,
        error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      };
    },
  };
}
