import type { ValidateFunction } from 'ajv';
import { createDataAjv, type AjvInstance } from './ajv.ts';
import { fromAjvErrors, type ValidationResult } from './issues.ts';

let ajv: AjvInstance | undefined;
const cache = new WeakMap<object, { full?: ValidateFunction; partial?: ValidateFunction }>();

/** Removes `required` recursively, used to validate partial updateAction() payloads. */
function stripRequired(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripRequired);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'required' && Array.isArray(v)) continue;
    out[k] = stripRequired(v);
  }
  return out;
}

/**
 * Validates Graphic data against the manifest's GDD `schema`.
 * Use `partial: true` for updateAction() payloads (which may be partial).
 */
export function validateGraphicData(schema: object | undefined, data: unknown, opts: { partial?: boolean } = {}): ValidationResult {
  if (!schema) return { valid: true, errors: [], warnings: [] };
  ajv ??= createDataAjv();
  let entry = cache.get(schema);
  if (!entry) cache.set(schema, (entry = {}));
  const key = opts.partial ? 'partial' : 'full';
  let fn = entry[key];
  if (!fn) {
    try {
      fn = ajv.compile(opts.partial ? (stripRequired(schema) as object) : schema);
    } catch (err) {
      return { valid: false, errors: [{ path: '', code: 'schema-compile', message: `manifest schema could not be compiled: ${(err as Error).message}` }], warnings: [] };
    }
    entry[key] = fn;
  }
  const ok = fn(data);
  return { valid: !!ok, errors: ok ? [] : fromAjvErrors(fn.errors), warnings: [] };
}
