/**
 * Timeline: playhead / scrubbing, step and out markers, per-layer keyframe tracks with drag, snap and
 * multi-select, and a small keyframe inspector.
 *
 * Model (see docs/editor.md): In plays 0 → S1, each Next plays S(k) → S(k+1), Out plays OUT → end.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  addStepMarker, isAnimated, keyframeTimes, moveOutMarker, moveStepMarker, PROPS, removeKeyframe, removeStepMarker, setDuration,
  setKeyframe, sortedTrack, toggleAnimated, updateKeyframe, updateLayer, valueAt, type Easing, type Layer, type Project, type Prop,
} from '@ogp/editor-core';
import type { EditorApi, KeyRef } from '../App.tsx';
import { useSize } from '../lib/hooks.ts';
import { flatten } from '../lib/selection.ts';

/** Implemented by the canvas: drives the graphic in the preview frame. */
export interface PreviewController {
  /** Shows the graphic at time t (edit mode) */
  seek: (t: number) => void;
  /** Animates t0 → t1 with the real runtime */
  playRange: (t0: number, t1: number) => Promise<void>;
  takeIn: () => Promise<void>;
  next: () => Promise<void>;
  out: () => Promise<void>;
  backToEdit: () => void;
}

export const PROP_LABEL: Record<Prop, string> = {
  x: 'X', y: 'Y', scale: 'Scale', opacity: 'Opacity', rotation: 'Rotation', maskL: 'Mask left', maskR: 'Mask right', maskT: 'Mask top', maskB: 'Mask bottom',
};
export const EASING_OPTIONS: [Easing, string][] = [
  ['smooth', 'Smooth'], ['ease-out', 'Ease out'], ['ease-in', 'Ease in'], ['ease-in-out', 'Ease in-out'], ['back', 'Overshoot'], ['linear', 'Linear'], ['hold', 'Hold (jump)'],
];

export function formatValue(prop: Prop, v: number): string {
  if (prop === 'opacity') return `${Math.round(v * 100)}%`;
  if (prop === 'scale') return `${Math.round(v * 100) / 100}×`;
  if (prop === 'rotation') return `${Math.round(v * 10) / 10}°`;
  if (prop.startsWith('mask')) return `${Math.round(v * 10) / 10}%`;
  return String(Math.round(v * 10) / 10);
}

const LABEL_W = 210;
const TICKS = [20, 50, 100, 200, 250, 500, 1000, 2000, 5000];

type Drag =
  | { kind: 'scrub' }
  | { kind: 'step'; index: number }
  | { kind: 'out' }
  | { kind: 'end' }
  | { kind: 'keys'; sx: number; origin: Layer[]; keys: (KeyRef & { t: number })[]; moved: boolean };

export function Timeline({ editor, preview, toggleRef }: {
  editor: EditorApi;
  preview: MutableRefObject<PreviewController | null>;
  toggleRef: MutableRefObject<(() => void) | null>;
}) {
  const { project, time, selectedIds, selectedKeys } = editor;
  const tl = project.timeline;
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [playT, setPlayT] = useState(0);
  const [twist, setTwist] = useState<Record<string, boolean>>({});
  const drag = useRef<Drag | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const laneW = Math.max(200, size.width - LABEL_W - 24);
  const px = (laneW / Math.max(tl.duration, 100)) * zoom; // px per ms
  const tick = TICKS.find((t) => t * px >= 64) ?? 10_000;
  const head = playing ? playT : time;
  const keySet = useMemo(() => new Set(selectedKeys.map((k) => k.id)), [selectedKeys]);

  // ---------------- playback (seeks the frame directly; commits the playhead when it stops)
  const stop = (commit: number | null) => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    if (commit !== null) {
      editor.setTime(commit);
      preview.current?.seek(commit);
    }
  };
  const play = () => {
    if (playing) return stop(playT);
    const from = time >= tl.duration ? 0 : time;
    const start = performance.now();
    setPlaying(true);
    setPlayT(from);
    const frame = () => {
      const t = Math.min(tl.duration, from + performance.now() - start);
      setPlayT(t);
      preview.current?.seek(t);
      if (t >= tl.duration) return stop(t);
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  toggleRef.current = play;

  // ---------------- pointer helpers
  const tAt = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / px);
  };
  const snap = (t: number, extra: number[], alt: boolean) => {
    if (alt) return Math.round(t);
    const cands = [0, time, tl.duration, tl.out, ...tl.steps, ...extra];
    let best = t;
    let dist = 7 / px;
    for (const c of cands) {
      if (Math.abs(c - t) < dist) {
        dist = Math.abs(c - t);
        best = c;
      }
    }
    return Math.round(best);
  };
  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    if (playing) stop(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
  };
  const changeTl = (fn: (t: Project['timeline']) => Project['timeline'], key: string) => editor.change((p) => ({ ...p, timeline: fn(p.timeline) }), key);

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = tAt(e.clientX);
    if (d.kind === 'scrub') return editor.setTime(snap(Math.min(raw, tl.duration), allKeyTimes(project), e.altKey));
    if (d.kind === 'step') return changeTl((t) => moveStepMarker(t, d.index, snap(raw, allKeyTimes(project), e.altKey)), `tl-step-${d.index}`);
    if (d.kind === 'out') return changeTl((t) => moveOutMarker(t, snap(raw, allKeyTimes(project), e.altKey)), 'tl-out');
    if (d.kind === 'end') return changeTl((t) => setDuration(t, Math.max(100, snap(raw, allKeyTimes(project), e.altKey))), 'tl-end');
    // keyframes: shift all dragged keys by the snapped delta of the grabbed one
    const dtRaw = (e.clientX - d.sx) / px;
    if (!d.moved && Math.abs(e.clientX - d.sx) < 3) return;
    d.moved = true;
    const lead = d.keys[0]!;
    const dt = snap(lead.t + dtRaw, [], e.altKey) - lead.t;
    const minT = Math.min(...d.keys.map((k) => k.t));
    const shift = Math.max(-minT, dt);
    editor.change((p) => {
      let layers = d.origin;
      for (const k of d.keys) layers = updateLayer(layers, k.layerId, (l) => updateKeyframe(l, k.prop, k.id, { t: k.t + shift }));
      const maxT = Math.max(...d.keys.map((k) => k.t + shift));
      return { ...p, layers, timeline: maxT > p.timeline.duration ? setDuration(p.timeline, maxT) : p.timeline };
    }, `tl-keys-${d.keys.map((k) => k.id).join()}`);
  };
  const onUp = () => {
    drag.current = null;
  };

  /** Press on keyframes: (shift = add) select them, then drag. */
  const pressKeys = (e: React.PointerEvent, refs: KeyRef[]) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const allSel = refs.every((r) => keySet.has(r.id));
    let sel: KeyRef[];
    if (additive) sel = allSel ? selectedKeys.filter((k) => !refs.some((r) => r.id === k.id)) : [...selectedKeys, ...refs.filter((r) => !keySet.has(r.id))];
    else sel = allSel ? selectedKeys : refs;
    editor.setSelectedKeys(sel);
    if (additive && allSel) return;
    const withT = sel.flatMap((k) => {
      const l = findIn(project.layers, k.layerId);
      const kf = l?.tracks[k.prop]?.find((x) => x.id === k.id);
      return kf ? [{ ...k, t: kf.t }] : [];
    });
    // grabbed key first (its time is what snaps)
    withT.sort((a, b) => (refs.some((r) => r.id === a.id) ? -1 : refs.some((r) => r.id === b.id) ? 1 : 0));
    begin(e, { kind: 'keys', sx: e.clientX, origin: project.layers, keys: withT, moved: false });
  };

  const rows = flatten(project.layers);
  const ticks: number[] = [];
  for (let t = 0; t <= tl.duration; t += tick) ticks.push(t);

  return (
    <section className="timeline" ref={wrapRef}>
      <div className="tl-tools">
        <button className="small" onClick={play} title="Play / pause from the playhead (Space)">{playing ? '❚❚' : '▶'}</button>
        <button className="small" onClick={() => { stop(null); editor.setTime(0); }} title="To start">⏮</button>
        <span className="tl-time">{fmt(head)}</span>
        <span className="hint">/</span>
        <label className="tl-dur" title="Total timeline length">
          <input type="number" min={100} step={100} value={tl.duration} onChange={(e) => { const v = Number(e.target.value); if (v >= 100) changeTl((t) => setDuration(t, v), 'tl-end'); }} /> ms
        </label>
        <button className="small" onClick={() => changeTl((t) => addStepMarker(t, time), 'tl-add-step')} title="Add a step (pause point) at the playhead – one more Next in the player">+ Step</button>
        <span className="hint tl-summary">{tl.steps.length === 1 ? '1 step' : `${tl.steps.length} steps`} · out at {tl.out} ms</span>
        <span className="grow" />
        <KeyInspector editor={editor} />
        <label className="toggle" title="Zoom">⌕ <input type="range" min={1} max={8} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
      </div>
      <div className="tl-body" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="tl-grid" style={{ width: LABEL_W + tl.duration * px + 40 }}>
          {/* ruler */}
          <div className="tl-row tl-ruler-row">
            <div className="tl-label tl-corner">
              <span className="hint">Drag markers · double-click a step to remove</span>
            </div>
            <div className="tl-lane tl-ruler" ref={laneRef} onPointerDown={(e) => { begin(e, { kind: 'scrub' }); editor.setTime(Math.min(tAt(e.clientX), tl.duration)); }}>
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: t * px }}>{t % 1000 === 0 ? `${t / 1000}s` : t}</span>
              ))}
              <span className="seg-in" style={{ left: 0, width: tl.steps[0]! * px }} title="In" />
              <span className="seg-out" style={{ left: tl.out * px, width: (tl.duration - tl.out) * px }} title="Out" />
              {tl.steps.map((s, i) => (
                <span
                  key={i}
                  className="marker step"
                  style={{ left: s * px }}
                  title={`Step ${i + 1} at ${s} ms – playback pauses here${tl.steps.length > 1 ? ' (double-click to remove)' : ''}`}
                  onPointerDown={(e) => begin(e, { kind: 'step', index: i })}
                  onDoubleClick={() => changeTl((t) => removeStepMarker(t, i), 'tl-rm-step')}
                >S{i + 1}</span>
              ))}
              <span className="marker out" style={{ left: tl.out * px }} title={`Out starts at ${tl.out} ms`} onPointerDown={(e) => begin(e, { kind: 'out' })}>OUT</span>
              <span className="marker end" style={{ left: tl.duration * px }} title="End of the timeline (drag to change the length)" onPointerDown={(e) => begin(e, { kind: 'end' })}>▏</span>
            </div>
          </div>

          {rows.map(({ layer, depth }) => {
            const sel = selectedIds.includes(layer.id);
            const open = twist[layer.id] ?? (sel && selectedIds.length === 1);
            const times = keyframeTimes(layer);
            return (
              <div key={layer.id} className={`tl-layer ${sel ? 'sel' : ''}`}>
                <div className="tl-row">
                  <div className="tl-label" style={{ paddingLeft: 6 + depth * 12 }} onClick={(e) => editor.select(layer.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace')}>
                    <button className="twist" onClick={(e) => { e.stopPropagation(); setTwist((m) => ({ ...m, [layer.id]: !open })); }}>{open ? '▾' : '▸'}</button>
                    <span className="nm">{layer.name}</span>
                    {isAnimated(layer) && <span className="hint">{times.length}◆</span>}
                  </div>
                  <div className="tl-lane" onPointerDown={() => editor.setSelectedKeys([])}>
                    <Bands tl={tl} px={px} />
                    {times.map((t) => {
                      const refs = PROPS.flatMap((prop) => (layer.tracks[prop] ?? []).filter((k) => k.t === t).map((k) => ({ layerId: layer.id, prop, id: k.id })));
                      const on = refs.every((r) => keySet.has(r.id));
                      return <span key={t} className={`kf agg ${on ? 'on' : ''}`} style={{ left: t * px }} title={`${t} ms – ${refs.length} keyframe(s)`} onPointerDown={(e) => pressKeys(e, refs)} />;
                    })}
                    <span className="tl-head" style={{ left: head * px }} />
                  </div>
                </div>
                {open && PROPS.map((prop) => <PropRow key={prop} editor={editor} layer={layer} prop={prop} px={px} head={head} keySet={keySet} onPressKey={pressKeys} />)}
              </div>
            );
          })}
          {rows.length === 0 && <p className="hint" style={{ padding: 10 }}>No layers.</p>}
          <span className="tl-head-line" style={{ left: LABEL_W + head * px }} />
        </div>
      </div>
    </section>
  );
}

function PropRow({ editor, layer, prop, px, head, keySet, onPressKey }: {
  editor: EditorApi; layer: Layer; prop: Prop; px: number; head: number; keySet: Set<string>;
  onPressKey: (e: React.PointerEvent, refs: KeyRef[]) => void;
}) {
  const track = sortedTrack(layer.tracks[prop]);
  const animated = track.length > 0;
  const t = Math.round(head);
  const atHead = track.find((k) => k.t === t);
  const upd = (fn: (l: Layer) => Layer, key: string) => editor.change((p) => ({ ...p, layers: updateLayer(p.layers, layer.id, fn) }), key);
  const toggleKey = () => {
    if (atHead) {
      upd((l) => removeKeyframe(l, prop, atHead.id), `kf-rm-${layer.id}-${prop}`);
      editor.setSelectedKeys(editor.selectedKeys.filter((k) => k.id !== atHead.id));
    } else {
      upd((l) => setKeyframe(l, prop, t, valueAt(l, prop, t)), `kf-add-${layer.id}-${prop}`);
    }
  };
  // index of the previous/next keyframe for the ◀ ▶ jump buttons
  const prev = [...track].reverse().find((k) => k.t < t);
  const next = track.find((k) => k.t > t);
  return (
    <div className="tl-row prop">
      <div className="tl-label">
        <button className={`sw ${animated ? 'on' : ''}`} title={animated ? 'Stop animating (keeps the value at the playhead)' : 'Animate this property (adds a keyframe at the playhead)'} onClick={() => upd((l) => toggleAnimated(l, prop, t), `sw-${layer.id}-${prop}`)}>⏱</button>
        <span className="pn">{PROP_LABEL[prop]}</span>
        <span className="pv">{formatValue(prop, valueAt(layer, prop, head))}</span>
        {animated && (
          <span className="kf-nav">
            <button className="icon" disabled={!prev} onClick={() => prev && editor.setTime(prev.t)} title="Previous keyframe">◂</button>
            <button className={`icon kf-toggle ${atHead ? 'on' : ''}`} onClick={toggleKey} title={atHead ? 'Remove the keyframe at the playhead' : 'Add a keyframe at the playhead'}>◆</button>
            <button className="icon" disabled={!next} onClick={() => next && editor.setTime(next.t)} title="Next keyframe">▸</button>
          </span>
        )}
      </div>
      <div className="tl-lane" onPointerDown={() => editor.setSelectedKeys([])}>
        {track.slice(0, -1).map((k, i) => {
          const b = track[i + 1]!;
          return <span key={k.id} className={`kf-span ${k.ease === 'hold' ? 'hold' : ''} ${k.v === b.v ? 'flat' : ''}`} style={{ left: k.t * px, width: (b.t - k.t) * px }} />;
        })}
        {track.map((k) => (
          <span
            key={k.id}
            className={`kf ${keySet.has(k.id) ? 'on' : ''} ${k.ease}`}
            style={{ left: k.t * px }}
            title={`${k.t} ms · ${formatValue(prop, k.v)} · ${k.ease}`}
            onPointerDown={(e) => onPressKey(e, [{ layerId: layer.id, prop, id: k.id }])}
            onDoubleClick={() => editor.setTime(k.t)}
          />
        ))}
      </div>
    </div>
  );
}

function Bands({ tl, px }: { tl: Project['timeline']; px: number }) {
  return (
    <>
      <span className="band in" style={{ left: 0, width: tl.steps[0]! * px }} />
      <span className="band out" style={{ left: tl.out * px, width: (tl.duration - tl.out) * px }} />
      {tl.steps.map((s, i) => <span key={i} className="band-line" style={{ left: s * px }} />)}
    </>
  );
}

/** Edits the selected keyframe(s): time, value, easing. */
function KeyInspector({ editor }: { editor: EditorApi }) {
  const keys = editor.selectedKeys.flatMap((k) => {
    const l = findIn(editor.project.layers, k.layerId);
    const kf = l?.tracks[k.prop]?.find((x) => x.id === k.id);
    return kf && l ? [{ ref: k, kf, layer: l }] : [];
  });
  if (!keys.length) return <span className="hint">Click ◆ to select keyframes (Shift adds) · drag to move · Del removes</span>;
  const apply = (fn: (l: Layer, k: KeyRef) => Layer, key: string) => editor.change((p) => ({
    ...p,
    layers: keys.reduce((ls, { ref }) => updateLayer(ls, ref.layerId, (l) => fn(l, ref)), p.layers),
  }), key);
  const one = keys.length === 1 ? keys[0]! : null;
  const eases = new Set(keys.map((k) => k.kf.ease));
  const isPct = one && one.ref.prop === 'opacity';
  return (
    <span className="kf-inspector">
      <strong>{one ? `${one.layer.name} · ${PROP_LABEL[one.ref.prop]}` : `${keys.length} keyframes`}</strong>
      {one && (
        <>
          <label>t <input type="number" min={0} step={10} value={one.kf.t} onChange={(e) => apply((l, r) => updateKeyframe(l, r.prop, r.id, { t: Math.max(0, Number(e.target.value)) }), `kfi-t-${one.ref.id}`)} /></label>
          <label>value <input type="number" step={isPct ? 1 : one.ref.prop === 'scale' ? 0.05 : 1} value={isPct ? Math.round(one.kf.v * 100) : Math.round(one.kf.v * 100) / 100}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) apply((l, r) => updateKeyframe(l, r.prop, r.id, { v: isPct ? v / 100 : v }), `kfi-v-${one.ref.id}`); }} /></label>
        </>
      )}
      <label title="Easing towards the next keyframe">ease
        <select value={eases.size === 1 ? [...eases][0] : ''} onChange={(e) => apply((l, r) => updateKeyframe(l, r.prop, r.id, { ease: e.target.value as Easing }), 'kfi-ease')}>
          {eases.size > 1 && <option value="">mixed</option>}
          {EASING_OPTIONS.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}
        </select>
      </label>
      <button className="small" onClick={() => { apply((l, r) => removeKeyframe(l, r.prop, r.id), 'kfi-rm'); editor.setSelectedKeys([]); }} title="Delete (Del)">Delete</button>
    </span>
  );
}

function findIn(layers: Layer[], id: string): Layer | undefined {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === 'group') {
      const f = findIn(l.children, id);
      if (f) return f;
    }
  }
  return undefined;
}

function allKeyTimes(p: Project): number[] {
  const out = new Set<number>();
  const visit = (ls: Layer[]) => ls.forEach((l) => { keyframeTimes(l).forEach((t) => out.add(t)); if (l.type === 'group') visit(l.children); });
  visit(p.layers);
  return [...out];
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${s}.${String(Math.round(ms) % 1000).padStart(3, '0')} s`;
}
