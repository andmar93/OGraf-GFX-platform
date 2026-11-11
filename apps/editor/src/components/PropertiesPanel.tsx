/**
 * Properties of the selected layer (or of the graphic when nothing is selected).
 */
import { useRef, useState } from 'react';
import {
  applyPreset, ensureFits, removeKeyframe, setKeyframe, slugify, sortedTrack, toggleAnimated, updateLayer, valueAt,
  type AnimType, type Easing, type Field, type Layer, type Prop,
} from '@ogp/editor-core';
import type { EditorApi } from '../App.tsx';
import { api } from '../lib/api.ts';
import type { AlignMode } from '../lib/selection.ts';
import { toast } from '../lib/toast.ts';
import { Check, Color, Num, Select, Text } from './controls.tsx';
import { EASING_OPTIONS } from './Timeline.tsx';

const ANIMS: [AnimType, string][] = [
  ['fade', 'Fade'], ['scale', 'Scale'], ['pop', 'Pop'],
  ['slide-right', 'Slide →'], ['slide-left', 'Slide ←'], ['slide-up', 'Slide ↑'], ['slide-down', 'Slide ↓'],
  ['wipe-right', 'Wipe →'], ['wipe-left', 'Wipe ←'], ['wipe-up', 'Wipe ↑'], ['wipe-down', 'Wipe ↓'],
];
const FONTS = ['Inter, "Segoe UI", Roboto, Arial, sans-serif', 'Arial, Helvetica, sans-serif', '"Helvetica Neue", Helvetica, Arial, sans-serif', 'Georgia, "Times New Roman", serif', '"Roboto Condensed", "Arial Narrow", sans-serif', 'Impact, "Arial Black", sans-serif', 'ui-monospace, Menlo, Consolas, monospace'];

interface PanelProps {
  editor: EditorApi;
  layer: Layer | undefined;
  onAlign: (m: AlignMode) => void;
  onGroup: () => void;
  onUngroup: () => void;
}

export function PropertiesPanel({ editor, layer, onAlign, onGroup, onUngroup }: PanelProps) {
  if (editor.selectedIds.length > 1) return <MultiProperties editor={editor} onAlign={onAlign} onGroup={onGroup} />;
  if (!layer) return <GraphicProperties editor={editor} />;
  const id = layer.id;
  const set = (patch: Partial<Layer>, key = Object.keys(patch).join(',')) => editor.updateLayer(id, patch, `${id}:${key}`);
  const fields = editor.project.fields;
  const fieldsOf = (...types: Field['type'][]) => fields.filter((f) => types.includes(f.type));

  return (
    <div className="panel props">
      <h3>{layer.type === 'shape' ? 'Shape' : layer.type[0]!.toUpperCase() + layer.type.slice(1)} <span className="muted">{layer.name}</span></h3>

      <section>
        <h4>Transform <span className="muted">at {editor.time} ms</span></h4>
        <div className="grid2">
          <AnimNum editor={editor} layer={layer} prop="x" label="X" />
          <AnimNum editor={editor} layer={layer} prop="y" label="Y" />
          <Num label="W" value={layer.width} min={1} onChange={(width) => set({ width })} />
          <Num label="H" value={layer.height} min={1} onChange={(height) => set({ height })} />
          <AnimNum editor={editor} layer={layer} prop="scale" label="Scale" factor={100} suffix="%" min={0} />
          <AnimNum editor={editor} layer={layer} prop="rotation" label="Rotate" suffix="°" />
          <AnimNum editor={editor} layer={layer} prop="opacity" label="Opacity" factor={100} suffix="%" min={0} max={100} />
        </div>
        <div className="row">
          <button className="small" onClick={() => onAlign('hcenter')}>Centre H</button>
          <button className="small" onClick={() => onAlign('vcenter')}>Centre V</button>
          {layer.type === 'group' && <button className="small" onClick={onUngroup}>Ungroup</button>}
        </div>
      </section>

      <section>
        <h4>Mask (crop from each edge)</h4>
        <div className="grid2">
          <AnimNum editor={editor} layer={layer} prop="maskL" label="Left" suffix="%" min={0} max={100} />
          <AnimNum editor={editor} layer={layer} prop="maskR" label="Right" suffix="%" min={0} max={100} />
          <AnimNum editor={editor} layer={layer} prop="maskT" label="Top" suffix="%" min={0} max={100} />
          <AnimNum editor={editor} layer={layer} prop="maskB" label="Bottom" suffix="%" min={0} max={100} />
        </div>
        <p className="hint">⏱ animates a property: changes then create keyframes at the playhead. ◆ adds/removes a keyframe at the playhead.</p>
      </section>

      <QuickAnimation editor={editor} layer={layer} />

      {layer.type === 'text' && (
        <section>
          <h4>Text</h4>
          <label className="ctl">
            <span>Content – insert fields as {'{key}'}</span>
            <textarea rows={3} value={layer.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          {fields.length > 0 && (
            <div className="chips">
              {fields.map((f) => (
                <button key={f.key} className="chip" title={`Insert {${f.key}}`} onClick={() => set({ text: `${layer.text}{${f.key}}` })}>+ {f.key}</button>
              ))}
            </div>
          )}
          <label className="ctl"><span>Font</span>
            <input list="fonts" value={layer.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} />
            <datalist id="fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <div className="grid2">
            <Num label="Size" value={layer.fontSize} min={4} onChange={(fontSize) => set({ fontSize })} suffix="px" />
            <Select label="Weight" value={String(layer.fontWeight)} options={[['300', 'Light'], ['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black']]} onChange={(v) => set({ fontWeight: Number(v) })} />
            <Num label="Spacing" value={layer.letterSpacing} step={0.5} onChange={(letterSpacing) => set({ letterSpacing })} suffix="px" />
            <Num label="Line h." value={layer.lineHeight} step={0.05} min={0.5} onChange={(lineHeight) => set({ lineHeight })} />
            <Select label="Align" value={layer.align} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={(align) => set({ align })} />
            <Select label="Vertical" value={layer.vAlign} options={[['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]} onChange={(vAlign) => set({ vAlign })} />
          </div>
          <Color label="Colour" value={layer.color} onChange={(color) => set({ color })} />
          <div className="row wrap">
            <Check label="UPPERCASE" value={layer.uppercase} onChange={(uppercase) => set({ uppercase })} />
            <Check label="Italic" value={layer.italic} onChange={(italic) => set({ italic })} />
            <Check label="Shrink to fit" value={layer.shrinkToFit} onChange={(shrinkToFit) => set({ shrinkToFit })} title="Single line; the font shrinks when the text is wider than the box" />
            <Check label="Shadow" value={layer.shadow} onChange={(shadow) => set({ shadow })} />
          </div>
        </section>
      )}

      {layer.type === 'shape' && (
        <section>
          <h4>Shape</h4>
          <div className="grid2">
            <Select label="Shape" value={layer.shape} options={[['rect', 'Rectangle'], ['ellipse', 'Ellipse']]} onChange={(shape) => set({ shape })} />
            {layer.shape === 'rect' && <Num label="Radius" value={layer.radius} min={0} onChange={(radius) => set({ radius })} suffix="px" />}
          </div>
          <Color label="Fill" value={layer.fill} onChange={(fill) => set({ fill })} />
          <Check label="Gradient" value={layer.fill2 !== null} onChange={(on) => set({ fill2: on ? '#18245a' : null })} />
          {layer.fill2 !== null && (
            <>
              <Color label="Fill 2" value={layer.fill2} onChange={(fill2) => set({ fill2 })} />
              <Num label="Angle" value={layer.gradientAngle} onChange={(gradientAngle) => set({ gradientAngle })} suffix="°" />
            </>
          )}
          <div className="grid2">
            <Num label="Stroke" value={layer.strokeWidth} min={0} onChange={(strokeWidth) => set({ strokeWidth })} suffix="px" />
            <Check label="Shadow" value={layer.shadow} onChange={(shadow) => set({ shadow })} />
          </div>
          {layer.strokeWidth > 0 && <Color label="Stroke colour" value={layer.strokeColor} onChange={(strokeColor) => set({ strokeColor })} />}
        </section>
      )}

      {layer.type === 'image' && <ImageProps layer={layer} set={set} />}

      {layer.type === 'group' && (
        <section>
          <h4>Group</h4>
          <Check label="Clip children to the group box" value={layer.clip} onChange={(clip) => set({ clip })} />
          <p className="hint">Children are positioned relative to the group. Select the group and add layers to put them inside it.</p>
        </section>
      )}

      <section>
        <h4>Data bindings</h4>
        {layer.type === 'shape' && <BindSelect label="Fill from" value={layer.bindings.fill} fields={fieldsOf('color')} onChange={(v) => set({ bindings: { ...layer.bindings, fill: v } })} />}
        {layer.type === 'text' && <BindSelect label="Colour from" value={layer.bindings.color} fields={fieldsOf('color')} onChange={(v) => set({ bindings: { ...layer.bindings, color: v } })} />}
        {layer.type === 'image' && <BindSelect label="Image from" value={layer.bindings.src} fields={fieldsOf('image', 'string')} onChange={(v) => set({ bindings: { ...layer.bindings, src: v } })} />}
        <BindSelect label="Visible when" value={layer.bindings.visible} fields={fieldsOf('boolean', 'string', 'integer', 'number')} onChange={(v) => set({ bindings: { ...layer.bindings, visible: v } })} />
        {fields.length === 0 && <p className="hint">Add data fields (left, "Data fields") to bind properties.</p>}
      </section>

    </div>
  );
}

function ImageProps({ layer, set }: { layer: Extract<Layer, { type: 'image' }>; set: (p: Partial<Layer>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    try {
      set({ src: await api.uploadImage(f, f.name) });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <section>
      <h4>Image</h4>
      <div className="row">
        {layer.src ? <img className="thumb" src={layer.src} alt="" /> : <span className="hint">No image</span>}
        <button onClick={() => fileRef.current?.click()}>Upload…</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      </div>
      <Text label="Source URL" value={layer.src} onChange={(src) => set({ src })} placeholder="/assets/… or https://…" />
      <Select label="Fit" value={layer.fit} options={[['contain', 'Contain'], ['cover', 'Cover'], ['fill', 'Stretch']]} onChange={(fit) => set({ fit })} />
    </section>
  );
}

function BindSelect(props: { label: string; value: string | undefined; fields: Field[]; onChange: (v: string | undefined) => void }) {
  return (
    <label className="ctl">
      <span>{props.label}</span>
      <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || undefined)}>
        <option value="">— fixed —</option>
        {props.fields.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key})</option>)}
      </select>
    </label>
  );
}

/** Number input for an animatable property (value at the playhead) with stopwatch and keyframe toggle. */
function AnimNum({ editor, layer, prop, label, factor = 1, suffix, min, max }: {
  editor: EditorApi; layer: Layer; prop: Prop; label: string; factor?: number; suffix?: string; min?: number; max?: number;
}) {
  const t = editor.time;
  const track = sortedTrack(layer.tracks[prop]);
  const animated = track.length > 0;
  const atHead = track.find((k) => k.t === t);
  const v = valueAt(layer, prop, t) * factor;
  const upd = (fn: (l: Layer) => Layer, key: string) => editor.change((p) => ({ ...p, layers: updateLayer(p.layers, layer.id, fn) }), key);
  return (
    <div className={`anim-num ${animated ? 'animated' : ''} ${atHead ? 'on-key' : ''}`}>
      <Num label={label} value={Math.round(v * 100) / 100} min={min} max={max} suffix={suffix} step={prop === 'scale' ? 5 : 1}
        onChange={(n) => editor.setProp(layer.id, prop, n / factor, `${layer.id}:${prop}:${t}`)} />
      <button className={`sw ${animated ? 'on' : ''}`} title={animated ? 'Stop animating' : 'Animate (keyframe at the playhead)'} onClick={() => upd((l) => toggleAnimated(l, prop, t), `sw-${layer.id}-${prop}`)}>⏱</button>
      {animated && (
        <button className={`kf-toggle ${atHead ? 'on' : ''}`} title={atHead ? 'Remove keyframe at the playhead' : 'Add keyframe at the playhead'}
          onClick={() => upd((l) => (atHead ? removeKeyframe(l, prop, atHead.id) : setKeyframe(l, prop, t, valueAt(l, prop, t))), `kf-${layer.id}-${prop}`)}>◆</button>
      )}
    </div>
  );
}

/** Generates in/out keyframes from a preset. */
function QuickAnimation({ editor, layer }: { editor: EditorApi; layer: Layer }) {
  const [type, setType] = useState<AnimType>('slide-right');
  const [which, setWhich] = useState<'in' | 'out'>('in');
  const [duration, setDuration] = useState(500);
  const [easing, setEasing] = useState<Easing | 'auto'>('auto');
  const [distance, setDistance] = useState(60);
  const add = () => {
    const tl = editor.project.timeline;
    const t = editor.time;
    const t0 = which === 'in' ? (t < tl.steps[0]! ? t : 0) : Math.max(t, tl.out);
    editor.change((p) => ({
      ...p,
      layers: updateLayer(p.layers, layer.id, (l) => applyPreset(l, type, which, t0, duration, { distance, easing: easing === 'auto' ? undefined : easing })),
      timeline: ensureFits(p.timeline, t0 + duration, which),
    }));
    toast('info', `Added ${which} keyframes ${t0}–${t0 + duration} ms`);
  };
  return (
    <section>
      <h4>Quick animation</h4>
      <div className="grid2">
        <Select label="Segment" value={which} options={[['in', 'In'], ['out', 'Out']]} onChange={setWhich} />
        <Select label="Preset" value={type} options={ANIMS} onChange={setType} />
        <Num label="Duration" value={duration} min={20} step={50} suffix="ms" onChange={setDuration} />
        <Select label="Easing" value={easing} options={[['auto', 'Auto'], ...EASING_OPTIONS.filter(([e]) => e !== 'hold')]} onChange={setEasing} />
        {type.startsWith('slide') && <Num label="Distance" value={distance} min={0} step={10} suffix="px" onChange={setDistance} />}
      </div>
      <button className="small" onClick={add}>Add keyframes</button>
      <p className="hint">In starts at the playhead (or 0 if the playhead is after S1); Out starts at the OUT marker or the playhead, whichever is later.</p>
    </section>
  );
}

function MultiProperties({ editor, onAlign, onGroup }: { editor: EditorApi; onAlign: (m: AlignMode) => void; onGroup: () => void }) {
  const n = editor.selectedIds.length;
  const btn = (m: AlignMode, label: string, title: string, disabled = false) => <button className="small" disabled={disabled} onClick={() => onAlign(m)} title={title}>{label}</button>;
  return (
    <div className="panel props">
      <h3>{n} layers selected</h3>
      <section>
        <h4>Align</h4>
        <div className="align-grid">
          {btn('left', '⇤ Left', 'Align left edges')}
          {btn('hcenter', '↔ Centre', 'Align horizontal centres')}
          {btn('right', 'Right ⇥', 'Align right edges')}
          {btn('top', '⤒ Top', 'Align top edges')}
          {btn('vcenter', '↕ Middle', 'Align vertical centres')}
          {btn('bottom', 'Bottom ⤓', 'Align bottom edges')}
        </div>
        <h4>Distribute</h4>
        <div className="row">
          {btn('hdistribute', 'Horizontally', 'Equal gaps horizontally (3+ layers)', n < 3)}
          {btn('vdistribute', 'Vertically', 'Equal gaps vertically (3+ layers)', n < 3)}
        </div>
        <p className="hint">Positions are set at the playhead ({editor.time} ms) – animated positions get a keyframe.</p>
      </section>
      <section>
        <h4>Arrange</h4>
        <button className="small" onClick={onGroup}>Group (Ctrl/⌘+G)</button>
        <p className="hint">Drag on the canvas to move all, arrows nudge, Ctrl/⌘+C / D / Del work on the whole selection.</p>
      </section>
    </div>
  );
}

function GraphicProperties({ editor }: { editor: EditorApi }) {
  const p = editor.project;
  const set = (patch: Partial<typeof p>, key: string) => editor.change((x) => ({ ...x, ...patch }), `graphic-${key}`);
  return (
    <div className="panel props">
      <h3>Graphic</h3>
      <section>
        <Text label="Name" value={p.name} onChange={(name) => set({ name }, 'name')} />
        <Text label="Graphic id (stays the same across publishes)" value={p.graphicId} onChange={(graphicId) => set({ graphicId: graphicId.replace(/\//g, '-') }, 'id')} />
        <button className="small" onClick={() => set({ graphicId: `user.${slugify(p.name) || 'graphic'}` }, 'id')}>Id from name</button>
        <label className="ctl"><span>Description</span><textarea rows={2} value={p.description} onChange={(e) => set({ description: e.target.value }, 'desc')} /></label>
        <Num label="Default layer in the player" value={p.defaultLayer} min={0} max={999} onChange={(defaultLayer) => set({ defaultLayer }, 'layer')} />
        <p className="hint">Published version: {p.revision || '—'} · canvas {p.width}×{p.height}</p>
      </section>
      <section>
        <h4>Tips</h4>
        <ul className="tips">
          <li>Click a layer on the canvas or in the list to edit it. Arrows nudge (Shift ×10).</li>
          <li>Text can contain data fields: <code>{'{homeCode} {homeScore}'}</code>.</li>
          <li>"Publish to library" makes the graphic available in the player. Publishing again replaces it.</li>
        </ul>
      </section>
    </div>
  );
}

