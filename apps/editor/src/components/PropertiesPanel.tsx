/**
 * Properties of the selected layer (or of the graphic when nothing is selected).
 */
import { useRef } from 'react';
import { slugify, type AnimPreset, type AnimType, type Field, type Layer } from '@ogp/editor-core';
import type { EditorApi } from '../App.tsx';
import { api } from '../lib/api.ts';
import { toast } from '../lib/toast.ts';
import { Check, Color, Num, Select, Text } from './controls.tsx';

const ANIMS: [AnimType, string][] = [
  ['none', 'None'], ['fade', 'Fade'], ['scale', 'Scale'], ['pop', 'Pop'],
  ['slide-right', 'Slide →'], ['slide-left', 'Slide ←'], ['slide-up', 'Slide ↑'], ['slide-down', 'Slide ↓'],
  ['wipe-right', 'Wipe →'], ['wipe-left', 'Wipe ←'], ['wipe-up', 'Wipe ↑'], ['wipe-down', 'Wipe ↓'],
];
const EASINGS: [AnimPreset['easing'], string][] = [['smooth', 'Smooth'], ['ease-out', 'Ease out'], ['ease-in', 'Ease in'], ['ease-in-out', 'Ease in-out'], ['back', 'Overshoot'], ['linear', 'Linear']];
const FONTS = ['Inter, "Segoe UI", Roboto, Arial, sans-serif', 'Arial, Helvetica, sans-serif', '"Helvetica Neue", Helvetica, Arial, sans-serif', 'Georgia, "Times New Roman", serif', '"Roboto Condensed", "Arial Narrow", sans-serif', 'Impact, "Arial Black", sans-serif', 'ui-monospace, Menlo, Consolas, monospace'];

export function PropertiesPanel({ editor, layer }: { editor: EditorApi; layer: Layer | undefined }) {
  if (!layer) return <GraphicProperties editor={editor} />;
  const id = layer.id;
  const set = (patch: Partial<Layer>, key = Object.keys(patch).join(',')) => editor.updateLayer(id, patch, `${id}:${key}`);
  const fields = editor.project.fields;
  const fieldsOf = (...types: Field['type'][]) => fields.filter((f) => types.includes(f.type));

  return (
    <div className="panel props">
      <h3>{layer.type === 'shape' ? 'Shape' : layer.type[0]!.toUpperCase() + layer.type.slice(1)} <span className="muted">{layer.name}</span></h3>

      <section>
        <h4>Position & size</h4>
        <div className="grid2">
          <Num label="X" value={layer.x} onChange={(x) => set({ x })} />
          <Num label="Y" value={layer.y} onChange={(y) => set({ y })} />
          <Num label="W" value={layer.width} min={1} onChange={(width) => set({ width })} />
          <Num label="H" value={layer.height} min={1} onChange={(height) => set({ height })} />
          <Num label="Rotate" value={layer.rotation} step={1} suffix="°" onChange={(rotation) => set({ rotation })} />
          <Num label="Opacity" value={Math.round(layer.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ opacity: v / 100 })} />
        </div>
        <div className="row">
          <button className="small" onClick={() => set({ x: Math.round((editor.project.width - layer.width) / 2) })}>Centre H</button>
          <button className="small" onClick={() => set({ y: Math.round((editor.project.height - layer.height) / 2) })}>Centre V</button>
        </div>
      </section>

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

      <section>
        <h4>Animation</h4>
        <AnimEditor label="In" value={layer.anim.in} onChange={(a) => set({ anim: { ...layer.anim, in: a } }, 'anim-in')} />
        <AnimEditor label="Out" value={layer.anim.out} onChange={(a) => set({ anim: { ...layer.anim, out: a } }, 'anim-out')} />
        <p className="hint">Delays are relative to the take / out. Use ▶ In and ■ Out above the canvas to preview.</p>
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

function AnimEditor({ label, value, onChange }: { label: string; value: AnimPreset; onChange: (a: AnimPreset) => void }) {
  const set = (p: Partial<AnimPreset>) => onChange({ ...value, ...p });
  return (
    <div className="anim">
      <div className="grid2">
        <Select label={label} value={value.type} options={ANIMS} onChange={(type) => set({ type, duration: type !== 'none' && value.duration === 0 ? 500 : value.duration })} />
        {value.type !== 'none' && <Select label="Easing" value={value.easing} options={EASINGS} onChange={(easing) => set({ easing })} />}
      </div>
      {value.type !== 'none' && (
        <div className="grid2">
          <Num label="Delay" value={value.delay} min={0} step={20} suffix="ms" onChange={(delay) => set({ delay })} />
          <Num label="Duration" value={value.duration} min={0} step={20} suffix="ms" onChange={(duration) => set({ duration })} />
          {value.type.startsWith('slide') && <Num label="Distance" value={value.distance} min={0} step={5} suffix="px" onChange={(distance) => set({ distance })} />}
        </div>
      )}
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

