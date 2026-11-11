/**
 * Copy/paste of layers. The clipboard holds a small JSON document (marked with `kind`) so layers can be pasted
 * into another graphic or another browser tab; the data fields the layers use travel along.
 */
import { cloneLayer, findLayer, templateFields, walk, type Field, type Layer, type Project } from '@ogp/editor-core';

export const CLIPBOARD_KIND = 'ogp-editor-layers';

export interface ClipboardPayload {
  kind: typeof CLIPBOARD_KIND;
  version: 1;
  layers: Layer[];
  /** Definitions of the fields the layers use */
  fields: Field[];
  /** Project the layers were copied from (to offset pastes into the same graphic) */
  sourceProjectId: string;
}

/** Field keys used by layers (templates + bindings), including nested group children. */
export function fieldsUsedBy(layers: Layer[]): Set<string> {
  const keys = new Set<string>();
  walk(layers, (l) => {
    if (l.type === 'text') templateFields(l.text).forEach((k) => keys.add(k));
    Object.values(l.bindings).forEach((k) => k && keys.add(k));
  });
  return keys;
}

export function serialize(project: Project, layerIds: string[]): string {
  const layers = layerIds.map((id) => findLayer(project.layers, id)).filter((l): l is Layer => !!l);
  const used = fieldsUsedBy(layers);
  const payload: ClipboardPayload = {
    kind: CLIPBOARD_KIND,
    version: 1,
    layers: structuredClone(layers),
    fields: project.fields.filter((f) => used.has(f.key)),
    sourceProjectId: project.id,
  };
  return JSON.stringify(payload);
}

export function parse(text: string): ClipboardPayload | undefined {
  if (!text || !text.trimStart().startsWith('{')) return undefined;
  try {
    const p = JSON.parse(text) as Partial<ClipboardPayload>;
    if (p.kind !== CLIPBOARD_KIND || !Array.isArray(p.layers)) return undefined;
    return { kind: CLIPBOARD_KIND, version: 1, layers: p.layers, fields: Array.isArray(p.fields) ? p.fields : [], sourceProjectId: String(p.sourceProjectId ?? '') };
  } catch {
    return undefined;
  }
}

/**
 * Prepares layers for pasting into `project`: new ids, a 20 px offset when pasting into the same graphic,
 * and the field definitions the project does not have yet.
 */
export function prepareForPaste(payload: ClipboardPayload, project: Project): { layers: Layer[]; newFields: Field[] } {
  const offset = payload.sourceProjectId === project.id ? 20 : 0;
  const layers = payload.layers.map((l) => {
    const c = cloneLayer(l, offset);
    c.name = l.name; // keep the name; it is a copy in another place
    return c;
  });
  const known = new Set(project.fields.map((f) => f.key));
  const newFields = payload.fields.filter((f) => !known.has(f.key));
  return { layers, newFields };
}
