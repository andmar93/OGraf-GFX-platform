/**
 * Fields -> OGraf GDD schema (manifest "schema"), and default/test data.
 */
import type { Field, Project } from './model.ts';

type Schema = Record<string, unknown>;

export function fieldSchema(f: Field, order: number): Schema {
  const s: Schema = { label: f.label || f.key, order };
  switch (f.type) {
    case 'string': Object.assign(s, { type: 'string', gddType: 'single-line' }); break;
    case 'multiline': Object.assign(s, { type: 'string', gddType: 'multi-line' }); break;
    case 'number': Object.assign(s, { type: 'number' }); break;
    case 'integer': Object.assign(s, { type: 'integer' }); break;
    case 'boolean': Object.assign(s, { type: 'boolean' }); break;
    case 'color': Object.assign(s, { type: 'string', gddType: 'color-rrggbb', pattern: '^#[0-9a-f]{6}$' }); break;
    case 'image': Object.assign(s, { type: 'string', gddType: 'file-path/image-path' }); break;
    case 'clock':
      Object.assign(s, {
        type: 'object',
        description: 'Clock anchor (bind to e.g. match.clock); the graphic counts locally.',
        properties: {
          $type: { type: 'string', default: 'clock' },
          running: { type: 'boolean', default: false },
          anchorServerMs: { type: 'number', default: 0 },
          anchorLocalMs: { type: 'number' },
          elapsedAtAnchorMs: { type: 'number', default: 0 },
          limitMs: { type: 'number' },
        },
      });
      break;
  }
  const def = coerceDefault(f);
  if (def !== undefined) s.default = def;
  if (f.hidden) s.hidden = true;
  if (f.bind) s.v_ogp_bind = f.bind;
  return s;
}

export function coerceDefault(f: Field): unknown {
  const d = f.default;
  switch (f.type) {
    case 'number': return typeof d === 'number' ? d : d !== undefined && d !== '' && !Number.isNaN(Number(d)) ? Number(d) : 0;
    case 'integer': return typeof d === 'number' ? Math.round(d) : d !== undefined && d !== '' && !Number.isNaN(Number(d)) ? Math.round(Number(d)) : 0;
    case 'boolean': return d === true || d === 'true';
    case 'color': return typeof d === 'string' && /^#[0-9a-f]{6}$/i.test(d) ? d.toLowerCase() : '#ffffff';
    case 'clock': return undefined;
    default: return typeof d === 'string' ? d : d === undefined ? '' : String(d);
  }
}

export function projectSchema(project: Project): Schema {
  const properties: Record<string, Schema> = {};
  project.fields.forEach((f, i) => {
    properties[f.key] = fieldSchema(f, i + 1);
  });
  return { type: 'object', properties };
}

export function defaultData(project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of project.fields) {
    const d = coerceDefault(f);
    if (d !== undefined) out[f.key] = d;
  }
  return out;
}

export const FIELD_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
