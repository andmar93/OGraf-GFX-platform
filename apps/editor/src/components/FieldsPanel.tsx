/**
 * Data fields of the graphic (the OGraf schema). Each field can have a default data-path binding
 * (e.g. match.home.score) that new rundown items in the player use automatically.
 */
import { useEffect, useMemo, useState } from 'react';
import { FIELD_KEY_RE, templateFields, usedFields, type Field, type FieldType, type Layer, type Project } from '@ogp/editor-core';
import type { EditorApi } from '../App.tsx';
import { api } from '../lib/api.ts';
import { toast } from '../lib/toast.ts';

const TYPES: [FieldType, string][] = [
  ['string', 'Text'], ['multiline', 'Multi-line text'], ['number', 'Number'], ['integer', 'Whole number'], ['boolean', 'On/off'],
  ['color', 'Colour'], ['image', 'Image URL'], ['clock', 'Clock (live)'],
];

/** Renames a field key everywhere it is used (templates and bindings). */
export function renameFieldKey(p: Project, from: string, to: string): Project {
  const re = new RegExp(`\\{${from}(:[a-z0-9]+)?\\}`, 'g');
  const rec = (layers: Layer[]): Layer[] => layers.map((l) => {
    const bindings = Object.fromEntries(Object.entries(l.bindings).map(([k, v]) => [k, v === from ? to : v]));
    const next = { ...l, bindings } as Layer;
    if (next.type === 'text') next.text = next.text.replace(re, (_m, fmt: string | undefined) => `{${to}${fmt ?? ''}}`);
    if (next.type === 'group') next.children = rec(next.children);
    return next;
  });
  return { ...p, fields: p.fields.map((f) => (f.key === from ? { ...f, key: to } : f)), layers: rec(p.layers) };
}

function flattenPaths(root: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (depth > 6 || typeof root !== 'object' || root === null || Array.isArray(root)) return out;
  if ((root as { $type?: unknown }).$type === 'clock') return out;
  for (const [k, v] of Object.entries(root)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    flattenPaths(v, p, out, depth + 1);
  }
  return out;
}

export function FieldsPanel({ editor }: { editor: EditorApi }) {
  const { project } = editor;
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => { void api.data().then((d) => setPaths(flattenPaths(d))).catch(() => {}); }, []);
  const used = useMemo(() => usedFields(project), [project]);

  const setField = (key: string, patch: Partial<Field>) => editor.change((p) => ({ ...p, fields: p.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) }), `field-${key}`);
  const add = () => {
    let i = project.fields.length + 1;
    while (project.fields.some((f) => f.key === `field${i}`)) i++;
    editor.change((p) => ({ ...p, fields: [...p.fields, { key: `field${i}`, label: `Field ${i}`, type: 'string', default: '' }] }));
  };
  const rename = (from: string, to: string) => {
    if (from === to) return;
    if (!FIELD_KEY_RE.test(to)) return toast('error', 'Keys use letters, digits and _ (not starting with a digit)');
    if (project.fields.some((f) => f.key === to)) return toast('error', `"${to}" already exists`);
    editor.change((p) => renameFieldKey(p, from, to));
  };

  return (
    <div className="panel fields-panel">
      <p className="hint">Use fields in text as <code>{'{key}'}</code> (clocks: <code>{'{clock}'}</code>, <code>{'{clock:stoppage}'}</code>, <code>{'{clock:minute}'}</code>), or bind colours, images and visibility in the properties.</p>
      <datalist id="data-paths">{paths.map((p) => <option key={p} value={p} />)}</datalist>
      {project.fields.map((f) => (
        <div key={f.key} className={`field-card ${used.has(f.key) ? '' : 'unused'}`}>
          <div className="row2">
            <label className="ctl"><span>Key</span><input defaultValue={f.key} key={f.key} onBlur={(e) => rename(f.key, e.target.value.trim())} /></label>
            <label className="ctl"><span>Label</span><input value={f.label} onChange={(e) => setField(f.key, { label: e.target.value })} /></label>
          </div>
          <div className="row2">
            <label className="ctl"><span>Type</span>
              <select value={f.type} onChange={(e) => setField(f.key, { type: e.target.value as FieldType, default: e.target.value === 'color' ? '#ffffff' : e.target.value === 'boolean' ? true : e.target.value === 'number' || e.target.value === 'integer' ? 0 : '' })}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <DefaultInput field={f} onChange={(v) => setField(f.key, { default: v })} />
          </div>
          <label className="ctl"><span>Bind to data path (default for the player)</span>
            <input list="data-paths" value={f.bind ?? ''} placeholder={f.type === 'clock' ? 'match.clock' : 'e.g. match.home.score'} onChange={(e) => setField(f.key, { bind: e.target.value.trim() || undefined })} />
          </label>
          <div className="field-foot">
            <label className="ctl check"><input type="checkbox" checked={!!f.hidden} onChange={(e) => setField(f.key, { hidden: e.target.checked })} /><span>Hide in item labels</span></label>
            {!used.has(f.key) && <span className="warn">not used by any layer</span>}
            <span className="grow" />
            <button className="icon" title="Delete field" onClick={() => editor.change((p) => ({ ...p, fields: p.fields.filter((x) => x.key !== f.key) }))}>✕</button>
          </div>
        </div>
      ))}
      <button className="wide" onClick={add}>+ Add field</button>
      <MissingFields project={project} onAdd={(key) => editor.change((p) => ({ ...p, fields: [...p.fields, { key, label: key, type: 'string', default: key }] }))} />
    </div>
  );
}

function DefaultInput({ field, onChange }: { field: Field; onChange: (v: string | number | boolean) => void }) {
  if (field.type === 'clock') return <label className="ctl"><span>Test value</span><input disabled value="(live clock)" /></label>;
  if (field.type === 'boolean') return <label className="ctl check"><input type="checkbox" checked={field.default === true} onChange={(e) => onChange(e.target.checked)} /><span>Default on</span></label>;
  if (field.type === 'color') return <label className="ctl"><span>Default</span><input type="color" value={typeof field.default === 'string' && /^#[0-9a-f]{6}$/i.test(field.default) ? field.default : '#ffffff'} onChange={(e) => onChange(e.target.value)} /></label>;
  if (field.type === 'number' || field.type === 'integer') return <label className="ctl"><span>Default / test</span><input type="number" value={typeof field.default === 'number' ? field.default : 0} onChange={(e) => onChange(Number(e.target.value))} /></label>;
  return <label className="ctl"><span>Default / test</span><input value={String(field.default ?? '')} onChange={(e) => onChange(e.target.value)} /></label>;
}

/** Offers to create fields that text layers reference but that do not exist. */
function MissingFields({ project, onAdd }: { project: Project; onAdd: (key: string) => void }) {
  const missing = new Set<string>();
  const known = new Set(project.fields.map((f) => f.key));
  const rec = (layers: Layer[]) => layers.forEach((l) => {
    if (l.type === 'text') templateFields(l.text).forEach((k) => !known.has(k) && missing.add(k));
    Object.values(l.bindings).forEach((k) => k && !known.has(k) && missing.add(k));
    if (l.type === 'group') rec(l.children);
  });
  rec(project.layers);
  if (missing.size === 0) return null;
  return (
    <div className="missing">
      <span className="warn">Used but not defined:</span>
      {[...missing].map((k) => <button key={k} className="small" onClick={() => onAdd(k)}>+ {k}</button>)}
    </div>
  );
}
