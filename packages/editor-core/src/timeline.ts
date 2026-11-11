/**
 * Timeline maths and editing helpers (pure). The same interpolation is implemented in the runtime (runtime.ts);
 * a test checks both give identical results.
 */
import {
  kf, newId, PROJECT_FORMAT, PROPS,
  type AnimPreset, type AnimType, type Easing, type Keyframe, type Layer, type Project, type Prop, type Timeline,
} from './model.ts';

// ---------------------------------------------------------------- easing

export const EASING_CURVES: Record<Exclude<Easing, 'hold' | 'linear'>, [number, number, number, number]> = {
  'ease-in': [0.7, 0, 0.84, 0],
  'ease-out': [0.16, 1, 0.3, 1],
  'ease-in-out': [0.65, 0, 0.35, 1],
  smooth: [0.16, 1, 0.3, 1],
  back: [0.34, 1.56, 0.64, 1],
};

/** cubic-bezier(x1, y1, x2, y2) evaluated at progress x (0–1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  // Newton, then bisection as a fallback
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sx(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) {
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

export function ease(e: Easing, p: number): number {
  if (e === 'linear') return p;
  if (e === 'hold') return p >= 1 ? 1 : 0;
  const c = EASING_CURVES[e] ?? EASING_CURVES.smooth;
  return cubicBezier(c[0], c[1], c[2], c[3], p);
}

// ---------------------------------------------------------------- values

export function staticValue(l: Layer, prop: Prop): number {
  const v = (l as unknown as Record<string, unknown>)[prop];
  if (typeof v === 'number') return v;
  return prop === 'scale' || prop === 'opacity' ? 1 : 0;
}

export function sortedTrack(track: Keyframe[] | undefined): Keyframe[] {
  return track && track.length ? [...track].sort((a, b) => a.t - b.t) : [];
}

/** Value of a property at time t: static without keyframes, held before the first and after the last keyframe. */
export function valueAt(l: Layer, prop: Prop, t: number): number {
  const track = sortedTrack(l.tracks?.[prop]);
  if (!track.length) return staticValue(l, prop);
  if (t <= track[0]!.t) return track[0]!.v;
  const last = track[track.length - 1]!;
  if (t >= last.t) return last.v;
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i]!, b = track[i + 1]!;
    if (t >= a.t && t <= b.t) {
      if (b.t === a.t) return b.v;
      return a.v + (b.v - a.v) * ease(a.ease, (t - a.t) / (b.t - a.t));
    }
  }
  return last.v;
}

export type LayerState = Record<Prop, number>;

export function stateAt(l: Layer, t: number): LayerState {
  const s = {} as LayerState;
  for (const p of PROPS) s[p] = valueAt(l, p, t);
  return s;
}

export function isAnimated(l: Layer, prop?: Prop): boolean {
  if (prop) return (l.tracks?.[prop]?.length ?? 0) > 0;
  return PROPS.some((p) => (l.tracks?.[p]?.length ?? 0) > 0);
}

// ---------------------------------------------------------------- editing

const SAME_TIME_MS = 1;

/** Sets the value of a property "at the playhead": keyframe when animated, static value otherwise. */
export function editProp(l: Layer, prop: Prop, value: number, t: number): Layer {
  if (isAnimated(l, prop)) return setKeyframe(l, prop, t, value);
  return { ...l, [prop]: value } as Layer;
}

export function setKeyframe(l: Layer, prop: Prop, t: number, v: number, easing?: Easing): Layer {
  const track = [...(l.tracks?.[prop] ?? [])];
  const i = track.findIndex((k) => Math.abs(k.t - t) <= SAME_TIME_MS);
  if (i >= 0) track[i] = { ...track[i]!, v, ...(easing ? { ease: easing } : {}) };
  else track.push(kf(Math.max(0, Math.round(t)), v, easing ?? previousEase(track, t)));
  return { ...l, tracks: { ...l.tracks, [prop]: track.sort((a, b) => a.t - b.t) } };
}

function previousEase(track: Keyframe[], t: number): Easing {
  const prev = sortedTrack(track).filter((k) => k.t < t).at(-1);
  return prev?.ease ?? 'smooth';
}

/** Stopwatch: start animating (keyframe at t with the current value) or stop (keep the value at t as static). */
export function toggleAnimated(l: Layer, prop: Prop, t: number): Layer {
  if (isAnimated(l, prop)) {
    const v = valueAt(l, prop, t);
    const tracks = { ...l.tracks };
    delete tracks[prop];
    return { ...l, [prop]: v, tracks } as Layer;
  }
  return setKeyframe(l, prop, t, staticValue(l, prop));
}

export function removeKeyframe(l: Layer, prop: Prop, id: string): Layer {
  const track = (l.tracks?.[prop] ?? []).filter((k) => k.id !== id);
  const tracks = { ...l.tracks };
  if (track.length) tracks[prop] = track;
  else {
    // the last keyframe goes: keep its value as the static value
    const last = l.tracks?.[prop]?.find((k) => k.id === id);
    delete tracks[prop];
    if (last) return { ...l, [prop]: last.v, tracks } as Layer;
  }
  return { ...l, tracks };
}

export function updateKeyframe(l: Layer, prop: Prop, id: string, patch: Partial<Pick<Keyframe, 't' | 'v' | 'ease'>>): Layer {
  const track = (l.tracks?.[prop] ?? []).map((k) => (k.id === id ? { ...k, ...patch, ...(patch.t !== undefined ? { t: Math.max(0, Math.round(patch.t)) } : {}) } : k));
  return { ...l, tracks: { ...l.tracks, [prop]: track.sort((a, b) => a.t - b.t) } };
}

/** Moves every keyframe of a layer (all properties) by dt; used when dragging a layer bar. */
export function shiftKeyframes(l: Layer, ids: Set<string>, dt: number): Layer {
  const tracks: Layer['tracks'] = {};
  for (const p of PROPS) {
    const tr = l.tracks?.[p];
    if (tr) tracks[p] = tr.map((k) => (ids.has(k.id) ? { ...k, t: Math.max(0, Math.round(k.t + dt)) } : k)).sort((a, b) => a.t - b.t);
  }
  return { ...l, tracks };
}

/** All keyframe times of a layer (for the collapsed timeline row). */
export function keyframeTimes(l: Layer): number[] {
  const set = new Set<number>();
  for (const p of PROPS) l.tracks?.[p]?.forEach((k) => set.add(k.t));
  return [...set].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- presets

/** Hidden-state values of a preset (relative to the layer's shown state). */
function presetHidden(type: AnimType, which: 'in' | 'out', l: Layer, distance: number): Partial<Record<Prop, number>> {
  const x = staticValue(l, 'x'), y = staticValue(l, 'y');
  const inv = which === 'in' ? -1 : 1;
  switch (type) {
    case 'fade': return { opacity: 0 };
    case 'scale': return { opacity: 0, scale: 0.6 };
    case 'pop': return { opacity: 0, scale: 0.2 };
    case 'slide-right': return { opacity: 0, x: x + inv * distance };
    case 'slide-left': return { opacity: 0, x: x - inv * distance };
    case 'slide-down': return { opacity: 0, y: y + inv * distance };
    case 'slide-up': return { opacity: 0, y: y - inv * distance };
    case 'wipe-right': return which === 'in' ? { maskR: 100 } : { maskL: 100 };
    case 'wipe-left': return which === 'in' ? { maskL: 100 } : { maskR: 100 };
    case 'wipe-down': return which === 'in' ? { maskB: 100 } : { maskT: 100 };
    case 'wipe-up': return which === 'in' ? { maskT: 100 } : { maskB: 100 };
    default: return {};
  }
}

/** Adds keyframes for an in or out preset between t0 and t0 + duration. */
export function applyPreset(l: Layer, type: AnimType, which: 'in' | 'out', t0: number, duration: number, opts: { distance?: number; easing?: Easing } = {}): Layer {
  if (type === 'none') return l;
  const hidden = presetHidden(type, which, l, opts.distance ?? 60);
  const easing: Easing = opts.easing ?? (type === 'pop' ? 'back' : which === 'in' ? 'smooth' : 'ease-in');
  let out = l;
  for (const [prop, hv] of Object.entries(hidden) as [Prop, number][]) {
    const shown = staticValue(l, prop);
    const [a, b] = which === 'in' ? [hv, shown] : [shown, hv];
    out = setKeyframe(out, prop, t0, a, easing);
    out = setKeyframe(out, prop, t0 + duration, b, easing);
  }
  return out;
}

// ---------------------------------------------------------------- timeline markers

export function normaliseTimeline(tl: Partial<Timeline> | undefined): Timeline {
  const steps = (Array.isArray(tl?.steps) && tl!.steps.length ? tl!.steps : [0]).map((s) => Math.max(0, Math.round(s))).sort((a, b) => a - b);
  const out = Math.max(steps[steps.length - 1]!, Math.round(tl?.out ?? steps[steps.length - 1]!));
  const duration = Math.max(out, Math.round(tl?.duration ?? out));
  return { duration, steps, out };
}

/** Segment [from, to] played for an action. */
export function segmentFor(tl: Timeline, action: { type: 'step'; step: number } | { type: 'out' }): [number, number] {
  if (action.type === 'out') return [tl.out, tl.duration];
  const k = Math.min(Math.max(0, action.step), tl.steps.length - 1);
  return [k === 0 ? 0 : tl.steps[k - 1]!, tl.steps[k]!];
}

export function addStepMarker(tl: Timeline, t: number): Timeline {
  const steps = [...tl.steps, Math.round(t)].sort((a, b) => a - b);
  return normaliseTimeline({ ...tl, steps, out: Math.max(tl.out, steps[steps.length - 1]!) });
}

export function removeStepMarker(tl: Timeline, index: number): Timeline {
  if (tl.steps.length <= 1) return tl;
  return normaliseTimeline({ ...tl, steps: tl.steps.filter((_, i) => i !== index) });
}

export function moveStepMarker(tl: Timeline, index: number, t: number): Timeline {
  const lo = index > 0 ? tl.steps[index - 1]! : 0;
  const hi = index < tl.steps.length - 1 ? tl.steps[index + 1]! : Math.max(tl.out, tl.duration);
  const steps = tl.steps.map((s, i) => (i === index ? Math.min(hi, Math.max(lo, Math.round(t))) : s));
  return normaliseTimeline({ ...tl, steps, out: Math.max(tl.out, steps[steps.length - 1]!) });
}

export function moveOutMarker(tl: Timeline, t: number): Timeline {
  const last = tl.steps[tl.steps.length - 1]!;
  return normaliseTimeline({ ...tl, out: Math.min(Math.max(last, Math.round(t)), tl.duration) });
}

export function setDuration(tl: Timeline, d: number): Timeline {
  return normaliseTimeline({ ...tl, duration: Math.max(tl.out, Math.round(d)) });
}

/** Grows the timeline so that `t` fits (used by presets): pushes the first step (and anything after it) later. */
export function ensureFits(tl: Timeline, t: number, segment: 'in' | 'out'): Timeline {
  if (segment === 'in' && t > tl.steps[0]!) {
    const steps = [...tl.steps];
    steps[0] = Math.round(t);
    for (let i = 1; i < steps.length; i++) steps[i] = Math.max(steps[i]!, steps[i - 1]!);
    const out = Math.max(tl.out, steps[steps.length - 1]!);
    return normaliseTimeline({ steps, out, duration: Math.max(tl.duration, out) });
  }
  if (segment === 'out' && t > tl.duration) return normaliseTimeline({ ...tl, duration: t });
  return tl;
}

// ---------------------------------------------------------------- migration (format 1 -> 2)

type V1Layer = Layer & { anim?: { in?: AnimPreset; out?: AnimPreset }; children?: V1Layer[] };

/** Brings older/partial project JSON up to the current format. */
export function migrateProject(p: Record<string, unknown>): Project {
  const fmt = typeof p.format === 'number' ? p.format : 1;
  const layers = (Array.isArray(p.layers) ? p.layers : []) as V1Layer[];
  const fill = (l: V1Layer): Layer => {
    const base = l as unknown as Record<string, unknown>;
    const out = {
      ...l,
      scale: typeof base.scale === 'number' ? base.scale : 1,
      maskL: typeof base.maskL === 'number' ? base.maskL : 0,
      maskR: typeof base.maskR === 'number' ? base.maskR : 0,
      maskT: typeof base.maskT === 'number' ? base.maskT : 0,
      maskB: typeof base.maskB === 'number' ? base.maskB : 0,
      tracks: l.tracks ?? {},
      bindings: l.bindings ?? {},
    } as Layer & { anim?: unknown };
    if (out.type === 'group') out.children = ((l.children ?? []) as V1Layer[]).map(fill);
    return out;
  };
  let migrated = layers.map(fill);
  let timeline = normaliseTimeline(p.timeline as Partial<Timeline> | undefined);

  if (fmt < 2) {
    // in-presets end at the first step, out-presets start at the out marker
    let inEnd = 0;
    let outLen = 0;
    const visit = (l: V1Layer) => {
      const a = l.anim;
      if (a?.in && a.in.type !== 'none') inEnd = Math.max(inEnd, a.in.delay + a.in.duration);
      if (a?.out && a.out.type !== 'none') outLen = Math.max(outLen, a.out.delay + a.out.duration);
      (l.children ?? []).forEach(visit);
    };
    layers.forEach(visit);
    timeline = { steps: [inEnd], out: inEnd, duration: inEnd + outLen };
    const convert = (l: Layer, v1: V1Layer): Layer => {
      let out = l;
      const map: Record<string, Easing> = { 'ease-out': 'ease-out', 'ease-in': 'ease-in', 'ease-in-out': 'ease-in-out', linear: 'linear', smooth: 'smooth', back: 'back' };
      const ai = v1.anim?.in;
      const ao = v1.anim?.out;
      if (ai && ai.type !== 'none') out = applyPreset(out, ai.type, 'in', ai.delay, ai.duration, { distance: ai.distance, easing: map[ai.easing] ?? 'smooth' });
      if (ao && ao.type !== 'none') out = applyPreset(out, ao.type, 'out', inEnd + ao.delay, ao.duration, { distance: ao.distance, easing: map[ao.easing] ?? 'ease-in' });
      delete (out as Layer & { anim?: unknown }).anim;
      if (out.type === 'group' && v1.children) out = { ...out, children: out.children.map((c, i) => convert(c, v1.children![i]!)) };
      return out;
    };
    migrated = migrated.map((l, i) => convert(l, layers[i]!));
  }

  return {
    format: PROJECT_FORMAT,
    id: typeof p.id === 'string' ? p.id : newId('p'),
    name: typeof p.name === 'string' ? p.name : 'Imported graphic',
    graphicId: typeof p.graphicId === 'string' ? p.graphicId : `user.${newId('g')}`,
    description: typeof p.description === 'string' ? p.description : '',
    width: typeof p.width === 'number' ? p.width : 1920,
    height: typeof p.height === 'number' ? p.height : 1080,
    defaultLayer: typeof p.defaultLayer === 'number' ? p.defaultLayer : 20,
    fields: Array.isArray(p.fields) ? (p.fields as Project['fields']) : [],
    layers: migrated,
    timeline,
    revision: typeof p.revision === 'number' ? p.revision : 0,
  };
}
