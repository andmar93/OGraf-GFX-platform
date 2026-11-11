/**
 * Helpers for GDD (Graphics Data Definition) schemas.
 */
type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Builds the default data object from a GDD schema (uses `default`, recursing into objects). */
export function getDefaultData(schema: unknown): Record<string, unknown> {
  const value = defaultFor(schema);
  return isObj(value) ? value : {};
}

function defaultFor(schema: unknown): unknown {
  if (!isObj(schema)) return undefined;
  if ('default' in schema) return structuredClone(schema.default);
  if (schema.type === 'object' && isObj(schema.properties)) {
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      const v = defaultFor(prop);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return undefined;
}

export interface GddField {
  key: string;
  type: string;
  gddType?: string;
  label: string;
  description?: string;
  hidden: boolean;
  order: number;
  schema: Schema;
}

/** Top-level fields of a GDD object schema, sorted by `order` then declaration order. */
export function listFields(schema: unknown): GddField[] {
  if (!isObj(schema) || !isObj(schema.properties)) return [];
  return Object.entries(schema.properties)
    .filter((e): e is [string, Schema] => isObj(e[1]))
    .map(([key, s], i) => ({
      key,
      type: String(s.type ?? 'string'),
      gddType: typeof s.gddType === 'string' ? s.gddType : undefined,
      label: String(s.label ?? s.title ?? key),
      description: typeof s.description === 'string' ? s.description : undefined,
      hidden: s.hidden === true,
      order: typeof s.order === 'number' ? s.order : 1e6 + i,
      schema: s,
    }))
    .sort((a, b) => a.order - b.order);
}

/** Builds a short display label for a graphic instance from its non-hidden string fields. */
export function buildLabel(schema: unknown, data: unknown, max = 3): string {
  if (!isObj(data)) return '';
  return listFields(schema)
    .filter((f) => !f.hidden && (f.type === 'string' || f.type === 'number' || f.type === 'integer'))
    .map((f) => data[f.key])
    .filter((v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number')
    .slice(0, max)
    .join(' – ');
}
