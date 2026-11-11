/**
 * Data paths: dot separated keys into the data hub tree, e.g. "match.home.score".
 * Array indices are plain numeric segments ("match.events.0.minute").
 */
export type DataPath = string;

export function splitPath(path: DataPath): string[] {
  return path.split('.').map((s) => s.trim()).filter((s) => s.length > 0);
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function isValidPath(path: DataPath): boolean {
  const parts = splitPath(path);
  return parts.length > 0 && parts.every((p) => /^[A-Za-z0-9_\-$]+$/.test(p) && !FORBIDDEN.has(p));
}

export function getAtPath(root: unknown, path: DataPath): unknown {
  let cur: unknown = root;
  for (const key of splitPath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Immutable set; returns a new root. Creates intermediate objects as needed. */
export function setAtPath(root: unknown, path: DataPath, value: unknown): Record<string, unknown> {
  const parts = splitPath(path);
  const base = (typeof root === 'object' && root !== null ? root : {}) as Record<string, unknown>;
  if (parts.length === 0) return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const rec = (node: unknown, i: number): unknown => {
    const key = parts[i]!;
    const obj = (typeof node === 'object' && node !== null ? node : {}) as Record<string, unknown>;
    const copy: Record<string, unknown> = Array.isArray(obj) ? ([...obj] as unknown as Record<string, unknown>) : { ...obj };
    if (i === parts.length - 1) {
      if (value === undefined) delete copy[key];
      else copy[key] = value;
    } else copy[key] = rec(obj[key], i + 1);
    return copy;
  };
  return rec(base, 0) as Record<string, unknown>;
}

/** True when a change at `changed` can affect the value at `watched` (one is a prefix of the other). */
export function pathsOverlap(watched: DataPath, changed: DataPath): boolean {
  const a = splitPath(watched);
  const b = splitPath(changed);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A binding inside graphic data: `{ "$bind": "match.home.score", "default": 0 }`. */
export interface Binding {
  $bind: DataPath;
  default?: unknown;
}

export function isBinding(v: unknown): v is Binding {
  return typeof v === 'object' && v !== null && typeof (v as { $bind?: unknown }).$bind === 'string';
}

/** All binding paths used in a data template. */
export function collectBindings(template: unknown, out: DataPath[] = []): DataPath[] {
  if (isBinding(template)) out.push(template.$bind);
  else if (Array.isArray(template)) template.forEach((t) => collectBindings(t, out));
  else if (typeof template === 'object' && template !== null) Object.values(template).forEach((t) => collectBindings(t, out));
  return out;
}

/** Replaces bindings in a data template with values from the data tree. */
export function resolveBindings(template: unknown, root: unknown): unknown {
  if (isBinding(template)) {
    const v = getAtPath(root, template.$bind);
    return v === undefined ? template.default : structuredClone(v);
  }
  if (Array.isArray(template)) return template.map((t) => resolveBindings(t, root));
  if (typeof template === 'object' && template !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      const r = resolveBindings(v, root);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return template;
}

/** Shallow diff of top-level keys; returns only the keys whose JSON differs (for partial updateAction). */
export function diffTopLevel(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      out[k] = next[k] ?? null;
      changed = true;
    }
  }
  return changed ? out : undefined;
}
