/**
 * Pure helpers for the GDD-driven data form (no React).
 */
import { isBinding, type Binding } from '@ogp/protocol/data-paths';
import { isClockValue } from '@ogp/protocol/clock';

export type Schema = Record<string, unknown>;
export type FieldKind = 'text' | 'textarea' | 'color' | 'select' | 'number' | 'boolean' | 'image' | 'file' | 'array' | 'object' | 'json';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Picks the input widget for a GDD property, degrading gracefully (longest gddType first). */
export function fieldKind(schema: Schema): FieldKind {
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  const gdd = typeof schema.gddType === 'string' ? schema.gddType : '';
  if (gdd.startsWith('file-path/image-path')) return 'image';
  if (gdd.startsWith('file-path')) return 'file';
  if (gdd.startsWith('color-rrggbb')) return 'color';
  if (gdd.startsWith('select') || Array.isArray(schema.enum)) return 'select';
  if (gdd.startsWith('multi-line')) return 'textarea';
  switch (type) {
    case 'string': return 'text';
    case 'number':
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return 'array';
    case 'object': return isObj(schema.properties) ? 'object' : 'json';
    default: return 'json';
  }
}

export function selectOptions(schema: Schema): { value: string | number; label: string }[] {
  const values = Array.isArray(schema.enum) ? (schema.enum as (string | number)[]) : [];
  const labels = isObj(schema.gddOptions) && isObj(schema.gddOptions.labels) ? (schema.gddOptions.labels as Record<string, string>) : {};
  return values.map((v) => ({ value: v, label: labels[String(v)] ?? String(v) }));
}

/** Turns a value into a binding (keeping the value as fallback) or a binding back into a plain value. */
export function toggleBinding(value: unknown, schemaDefault: unknown, path = ''): unknown {
  if (isBinding(value)) return value.default !== undefined ? value.default : schemaDefault;
  const b: Binding = { $bind: path };
  const fallback = value !== undefined ? value : schemaDefault;
  if (fallback !== undefined) b.default = fallback;
  return b;
}

/** Converts a number input string to a schema-typed number (or undefined when empty). */
export function parseNumber(raw: string, schema: Schema): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return schema.type === 'integer' ? Math.round(n) : n;
}

export interface DataPathInfo {
  path: string;
  preview: string;
}

/** Lists bindable paths of the data tree (leaves, arrays and clocks are bindable as a whole). */
export function flattenDataPaths(root: unknown, maxDepth = 6): DataPathInfo[] {
  const out: DataPathInfo[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (path) out.push({ path, preview: previewValue(v) });
    if (!isObj(v) || isClockValue(v) || depth >= maxDepth) return;
    for (const [k, child] of Object.entries(v)) walk(child, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(root, '', 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function previewValue(v: unknown): string {
  if (v === undefined) return '—';
  if (isClockValue(v)) return `clock (${v.running ? 'running' : 'stopped'})`;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isObj(v)) return '{…}';
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/** Default value for a new array row. */
export function newArrayItem(itemSchema: Schema): unknown {
  const kind = fieldKind(itemSchema);
  if ('default' in itemSchema) return structuredClone(itemSchema.default);
  if (kind === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(itemSchema.properties as Record<string, Schema>)) if (isObj(s) && 'default' in s) o[k] = structuredClone(s.default);
    return o;
  }
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  return '';
}

export function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length || from === to) return arr;
  const copy = [...arr];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x as T);
  return copy;
}
