/**
 * Form generated from a graphic's GDD schema. Every top-level field can be bound to a data path.
 */
import { useState } from 'react';
import { listFields, type GddField } from '@ogp/ograf-core/gdd';
import { getAtPath, isBinding } from '@ogp/protocol/data-paths';
import { fieldKind, moveInArray, newArrayItem, parseNumber, previewValue, selectOptions, toggleBinding, type Schema } from '../lib/gdd-form.ts';

type Data = Record<string, unknown>;

export function GddForm(props: { schema: Schema | null | undefined; value: Data; onChange: (next: Data) => void; liveData: Data }) {
  const fields = listFields(props.schema);
  if (fields.length === 0) return <p className="hint">This graphic has no data fields.</p>;
  const visible = fields.filter((f) => !f.hidden);
  const more = fields.filter((f) => f.hidden);
  const set = (key: string, v: unknown) => {
    const next = { ...props.value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    props.onChange(next);
  };
  const row = (f: GddField) => <FieldRow key={f.key} field={f} value={props.value[f.key]} onChange={(v) => set(f.key, v)} liveData={props.liveData} />;
  return (
    <div className="gdd-form">
      {visible.map(row)}
      {more.length > 0 && (
        <details className="more-fields">
          <summary>More fields ({more.length}){more.some((f) => isBinding(props.value[f.key])) ? ` · ${more.filter((f) => isBinding(props.value[f.key])).length} bound` : ''}</summary>
          {more.map(row)}
        </details>
      )}
    </div>
  );
}

function FieldRow(props: { field: GddField; value: unknown; onChange: (v: unknown) => void; liveData: Data }) {
  const { field, value } = props;
  const bound = isBinding(value);
  const schemaDefault = field.schema.default;
  return (
    <div className={`field ${bound ? 'bound' : ''}`}>
      <div className="field-head">
        <label title={field.description ?? field.key}>{field.label}</label>
        <span className="grow" />
        {value !== undefined && !bound && <button className="icon" title="Reset to default" onClick={() => props.onChange(undefined)}>↺</button>}
        <button
          className={`icon link ${bound ? 'on' : ''}`}
          title={bound ? 'Bound to a data path – click to use a fixed value' : 'Bind to a data path'}
          onClick={() => props.onChange(toggleBinding(value, schemaDefault, typeof field.schema.v_ogp_bind === 'string' ? field.schema.v_ogp_bind : ''))}
        >🔗</button>
      </div>
      {bound ? (
        <div className="binding">
          <input
            list="ogp-data-paths"
            placeholder="data path, e.g. match.home.score"
            value={value.$bind}
            onChange={(e) => props.onChange({ ...value, $bind: e.target.value.trim() })}
          />
          <span className="resolved" title="Current value">= {previewValue(value.$bind ? getAtPath(props.liveData, value.$bind) ?? value.default : value.default)}</span>
        </div>
      ) : (
        <FieldInput schema={field.schema} value={value} onChange={props.onChange} />
      )}
    </div>
  );
}

function FieldInput(props: { schema: Schema; value: unknown; onChange: (v: unknown) => void; compact?: boolean }) {
  const { schema, value, onChange } = props;
  const kind = fieldKind(schema);
  const def = schema.default;
  const shown = value !== undefined ? value : def;
  switch (kind) {
    case 'text':
    case 'image':
    case 'file':
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          placeholder={typeof def === 'string' ? def : kind === 'image' ? 'image URL or path' : ''}
          maxLength={typeof schema.maxLength === 'number' ? schema.maxLength : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'textarea':
      return <textarea rows={props.compact ? 2 : 3} value={typeof value === 'string' ? value : ''} placeholder={typeof def === 'string' ? def : ''} onChange={(e) => onChange(e.target.value)} />;
    case 'color': {
      const hex = typeof shown === 'string' && /^#[0-9a-f]{6}$/i.test(shown) ? shown.toLowerCase() : '#000000';
      return (
        <span className="color-input">
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value.toLowerCase())} />
          <input type="text" value={typeof value === 'string' ? value : ''} placeholder={typeof def === 'string' ? def : '#rrggbb'} onChange={(e) => onChange(e.target.value.toLowerCase())} />
        </span>
      );
    }
    case 'select': {
      const opts = selectOptions(schema);
      return (
        <select value={shown === undefined ? '' : String(shown)} onChange={(e) => {
          const o = opts.find((x) => String(x.value) === e.target.value);
          onChange(o ? o.value : undefined);
        }}>
          {shown === undefined && <option value="">—</option>}
          {opts.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      );
    }
    case 'number':
      return (
        <NumberInput schema={schema} value={typeof value === 'number' ? value : undefined} placeholder={typeof def === 'number' ? String(def) : ''} onChange={onChange} />
      );
    case 'boolean':
      return <input type="checkbox" checked={shown === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'array':
      return <ArrayInput schema={schema} value={Array.isArray(value) ? value : Array.isArray(def) ? def : []} onChange={onChange} />;
    case 'object': {
      const obj = (typeof shown === 'object' && shown !== null ? shown : {}) as Data;
      return (
        <div className="object-fields">
          {listFields(schema).map((f) => (
            <label key={f.key} className="sub-field">
              <span>{f.label}</span>
              <FieldInput schema={f.schema} value={obj[f.key]} compact onChange={(v) => {
                const next = { ...obj };
                if (v === undefined) delete next[f.key];
                else next[f.key] = v;
                onChange(next);
              }} />
            </label>
          ))}
        </div>
      );
    }
    default:
      return <JsonInput value={value} onChange={onChange} />;
  }
}

function NumberInput(props: { schema: Schema; value: number | undefined; placeholder: string; onChange: (v: unknown) => void }) {
  const { schema } = props;
  const step = schema.type === 'integer' ? 1 : typeof schema.multipleOf === 'number' ? schema.multipleOf : 'any';
  return (
    <span className="number-input">
      {schema.type === 'integer' && <button className="icon" onClick={() => props.onChange((props.value ?? Number(props.placeholder || 0)) - 1)}>−</button>}
      <input
        type="number"
        value={props.value ?? ''}
        placeholder={props.placeholder}
        step={step}
        min={typeof schema.minimum === 'number' ? schema.minimum : undefined}
        max={typeof schema.maximum === 'number' ? schema.maximum : undefined}
        onChange={(e) => props.onChange(parseNumber(e.target.value, schema))}
      />
      {schema.type === 'integer' && <button className="icon" onClick={() => props.onChange((props.value ?? Number(props.placeholder || 0)) + 1)}>+</button>}
    </span>
  );
}

function ArrayInput(props: { schema: Schema; value: unknown[]; onChange: (v: unknown) => void }) {
  const itemSchema = (props.schema.items ?? { type: 'string' }) as Schema;
  const columns = fieldKind(itemSchema) === 'object' ? listFields(itemSchema) : null;
  const rows = props.value;
  const setRow = (i: number, v: unknown) => props.onChange(rows.map((r, j) => (j === i ? v : r)));
  const max = typeof props.schema.maxItems === 'number' ? props.schema.maxItems : Infinity;
  return (
    <div className="array-input">
      <table>
        {columns && (
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns ? columns.map((c) => {
                const obj = (typeof row === 'object' && row !== null ? row : {}) as Data;
                return (
                  <td key={c.key} className={`col-${fieldKind(c.schema)}`}>
                    <FieldInput schema={c.schema} value={obj[c.key]} compact onChange={(v) => {
                      const next = { ...obj };
                      if (v === undefined) delete next[c.key];
                      else next[c.key] = v;
                      setRow(i, next);
                    }} />
                  </td>
                );
              }) : (
                <td><FieldInput schema={itemSchema} value={row} compact onChange={(v) => setRow(i, v)} /></td>
              )}
              <td className="row-tools">
                <button className="icon" title="Move up" disabled={i === 0} onClick={() => props.onChange(moveInArray(rows, i, i - 1))}>↑</button>
                <button className="icon" title="Move down" disabled={i === rows.length - 1} onClick={() => props.onChange(moveInArray(rows, i, i + 1))}>↓</button>
                <button className="icon" title="Remove" onClick={() => props.onChange(rows.filter((_, j) => j !== i))}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small" disabled={rows.length >= max} onClick={() => props.onChange([...rows, newArrayItem(itemSchema)])}>+ Add row</button>
    </div>
  );
}

function JsonInput(props: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => (props.value === undefined ? '' : JSON.stringify(props.value, null, 2)));
  const [bad, setBad] = useState(false);
  return (
    <textarea
      className={`json ${bad ? 'invalid' : ''}`}
      rows={4}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!text.trim()) return props.onChange(undefined);
        try {
          props.onChange(JSON.parse(text));
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}
