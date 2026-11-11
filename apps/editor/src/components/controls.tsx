/** Small form controls for the panels. */
import { useEffect, useState } from 'react';

export function Num(props: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; title?: string }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return setText(String(props.value));
    let v = n;
    if (props.min !== undefined) v = Math.max(props.min, v);
    if (props.max !== undefined) v = Math.min(props.max, v);
    props.onChange(v);
  };
  return (
    <label className="ctl num" title={props.title}>
      <span>{props.label}</span>
      <input
        type="number"
        value={text}
        step={props.step ?? 1}
        min={props.min}
        max={props.max}
        onChange={(e) => { setText(e.target.value); if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) commit(e.target.value); }}
        onBlur={(e) => commit(e.target.value)}
      />
      {props.suffix && <em>{props.suffix}</em>}
    </label>
  );
}

export function Color(props: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(props.value) ? props.value.toLowerCase() : '#000000';
  return (
    <label className="ctl color">
      <span>{props.label}</span>
      <input type="color" value={hex} onChange={(e) => props.onChange(e.target.value)} />
      <input type="text" value={props.value} onChange={(e) => props.onChange(e.target.value.trim())} />
    </label>
  );
}

export function Select<T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="ctl">
      <span>{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function Check(props: { label: string; value: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="ctl check" title={props.title}>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Text(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; list?: string }) {
  return (
    <label className="ctl">
      <span>{props.label}</span>
      <input type="text" value={props.value} placeholder={props.placeholder} list={props.list} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}
