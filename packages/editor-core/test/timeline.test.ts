import { describe, expect, it } from 'vitest';
import {
  addStepMarker, applyPreset, createLayer, createProject, cubicBezier, ease, editProp, ensureFits, exportPackage, generateModule,
  isAnimated, kf, migrateProject, moveOutMarker, moveStepMarker, normaliseTimeline, removeKeyframe, removeStepMarker,
  segmentFor, setKeyframe, stateAt, toggleAnimated, updateKeyframe, valueAt, PROPS, type Layer,
} from '../src/index.ts';

const shape = (): Layer => ({ ...createLayer('shape'), x: 100, y: 200 });

describe('easing', () => {
  it('matches the standard curves at the ends and is monotonic', () => {
    for (const e of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'smooth'] as const) {
      expect(ease(e, 0)).toBeCloseTo(0, 5);
      expect(ease(e, 1)).toBeCloseTo(1, 5);
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = ease(e, i / 20);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
    expect(ease('ease-in-out', 0.5)).toBeCloseTo(0.5, 3);
    expect(cubicBezier(0.34, 1.56, 0.64, 1, 0.6)).toBeGreaterThan(1); // overshoot
    expect(ease('hold', 0.99)).toBe(0);
  });
});

describe('values at a time', () => {
  it('uses static values without keyframes and holds outside the keyframes', () => {
    let l = shape();
    expect(valueAt(l, 'x', 500)).toBe(100);
    l = { ...l, tracks: { x: [kf(100, 0, 'linear'), kf(300, 200, 'linear')] } };
    expect(valueAt(l, 'x', 0)).toBe(0);
    expect(valueAt(l, 'x', 200)).toBe(100);
    expect(valueAt(l, 'x', 999)).toBe(200);
    expect(stateAt(l, 200)).toMatchObject({ x: 100, y: 200, scale: 1, opacity: 1, maskL: 0 });
  });
});

describe('editing keyframes', () => {
  it('stopwatch, edit at playhead, update and remove', () => {
    let l = shape();
    l = editProp(l, 'x', 150, 0); // not animated: static
    expect(l.x).toBe(150);
    expect(isAnimated(l, 'x')).toBe(false);
    l = toggleAnimated(l, 'x', 0); // start animating: keyframe at 0 with the current value
    expect(l.tracks.x).toMatchObject([{ t: 0, v: 150 }]);
    l = editProp(l, 'x', 400, 500); // new keyframe at the playhead
    l = editProp(l, 'x', 450, 500.5); // same time (within 1 ms): updates
    expect(l.tracks.x!.map((k) => [k.t, k.v])).toEqual([[0, 150], [500, 450]]);
    const id = l.tracks.x![1]!.id;
    l = updateKeyframe(l, 'x', id, { t: 250, ease: 'linear' });
    expect(valueAt(l, 'x', 250)).toBe(450);
    l = removeKeyframe(l, 'x', id);
    l = removeKeyframe(l, 'x', l.tracks.x![0]!.id);
    expect(isAnimated(l, 'x')).toBe(false);
    expect(l.x).toBe(150); // value of the last removed keyframe stays
    l = setKeyframe(l, 'opacity', 100, 0);
    l = toggleAnimated(l, 'opacity', 300); // stop animating keeps the value at the playhead
    expect(l.opacity).toBe(0);
  });

  it('generates keyframes from presets', () => {
    const l = applyPreset(shape(), 'slide-right', 'in', 0, 500, { distance: 50 });
    expect(l.tracks.x!.map((k) => [k.t, k.v])).toEqual([[0, 50], [500, 100]]);
    expect(l.tracks.opacity!.map((k) => [k.t, k.v])).toEqual([[0, 0], [500, 1]]);
    const w = applyPreset(shape(), 'wipe-right', 'out', 1000, 300);
    expect(w.tracks.maskL!.map((k) => [k.t, k.v])).toEqual([[1000, 0], [1300, 100]]);
    expect(applyPreset(shape(), 'pop', 'in', 0, 400).tracks.scale![0]!.ease).toBe('back');
  });
});

describe('timeline markers', () => {
  it('normalises, adds, moves and removes markers', () => {
    expect(normaliseTimeline({ steps: [900, 300], out: 100, duration: 50 })).toEqual({ steps: [300, 900], out: 900, duration: 900 });
    let tl = normaliseTimeline({ steps: [800], out: 800, duration: 1200 });
    tl = addStepMarker(tl, 1000);
    expect(tl).toEqual({ steps: [800, 1000], out: 1000, duration: 1200 });
    tl = moveStepMarker(tl, 0, 2000); // clamped by the next marker
    expect(tl.steps).toEqual([1000, 1000]);
    tl = moveStepMarker(tl, 0, 600);
    tl = moveOutMarker(tl, 1100);
    expect(tl).toEqual({ steps: [600, 1000], out: 1100, duration: 1200 });
    expect(segmentFor(tl, { type: 'step', step: 0 })).toEqual([0, 600]);
    expect(segmentFor(tl, { type: 'step', step: 1 })).toEqual([600, 1000]);
    expect(segmentFor(tl, { type: 'out' })).toEqual([1100, 1200]);
    tl = removeStepMarker(tl, 0);
    expect(tl.steps).toEqual([1000]);
    expect(removeStepMarker(tl, 0).steps).toEqual([1000]); // at least one step
    expect(ensureFits({ steps: [500, 600], out: 600, duration: 900 }, 700, 'in')).toEqual({ steps: [700, 700], out: 700, duration: 900 });
    expect(ensureFits({ steps: [500], out: 500, duration: 900 }, 1500, 'out').duration).toBe(1500);
  });

  it('exports the step count and per-step durations', async () => {
    const p = createProject('Steps');
    p.timeline = { steps: [800, 1500, 2100], out: 2100, duration: 2600 };
    const r = await exportPackage(p, async () => new Uint8Array());
    expect(r.errors).toEqual([]);
    expect(r.manifest.stepCount).toBe(3);
    expect(r.manifest.actionDurations).toEqual([
      { type: 'playAction', duration: 800, steps: [{ step: 0, duration: 800 }, { step: 1, duration: 700 }, { step: 2, duration: 600 }] },
      { type: 'stopAction', duration: 500 },
      { type: 'updateAction', duration: 0 },
    ]);
  });
});

describe('migration from format 1 (presets)', () => {
  it('turns in/out presets into keyframes and a timeline', () => {
    const v1 = {
      format: 1, id: 'p1', name: 'Old', graphicId: 'user.old', width: 1920, height: 1080, fields: [], revision: 2,
      layers: [
        { ...createLayer('text'), x: 100, anim: { in: { type: 'slide-right', delay: 200, duration: 500, easing: 'smooth', distance: 40 }, out: { type: 'fade', delay: 0, duration: 300, easing: 'linear', distance: 60 } } },
        { ...createLayer('group'), anim: { in: { type: 'none', delay: 0, duration: 0, easing: 'smooth', distance: 60 }, out: { type: 'none', delay: 0, duration: 0, easing: 'smooth', distance: 60 } },
          children: [{ ...createLayer('shape'), anim: { in: { type: 'wipe-right', delay: 0, duration: 400, easing: 'smooth', distance: 60 }, out: { type: 'none', delay: 0, duration: 0, easing: 'smooth', distance: 60 } } }] },
      ],
    };
    for (const l of v1.layers) { delete (l as Record<string, unknown>).tracks; delete (l as Record<string, unknown>).scale; }
    const p = migrateProject(v1);
    expect(p.format).toBe(2);
    expect(p.timeline).toEqual({ steps: [700], out: 700, duration: 1000 });
    const t = p.layers[0]!;
    expect('anim' in t).toBe(false);
    expect(t.scale).toBe(1);
    expect(t.tracks.x!.map((k) => [k.t, k.v])).toEqual([[200, 60], [700, 100]]);
    expect(t.tracks.opacity!.map((k) => [k.t, k.v])).toEqual([[200, 0], [700, 1], [1000, 0]]);
    const child = (p.layers[1] as Extract<Layer, { type: 'group' }>).children[0]!;
    expect(child.tracks.maskR!.map((k) => [k.t, k.v])).toEqual([[0, 100], [400, 0]]);
    expect(p.revision).toBe(2);
  });
});

describe('runtime parity', () => {
  it('computes exactly the same values as the editor', async () => {
    (globalThis as Record<string, unknown>).HTMLElement ??= class {};
    const p = createProject('Parity');
    p.layers[0]!.tracks.rotation = [kf(0, -10, 'back'), kf(600, 20, 'ease-in-out')];
    p.layers[1]!.tracks.scale = [kf(100, 0.5, 'ease-out'), kf(900, 1.2, 'linear'), kf(1100, 1, 'hold')];
    const code = generateModule(p);
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const rt = mod.__ogpRuntime as { stateAt: (l: Layer, t: number) => Record<string, number> };
    expect(typeof mod.default).toBe('function');
    for (const l of p.layers) {
      for (let t = -50; t <= 1300; t += 37) {
        const a = stateAt(l, t);
        const b = rt.stateAt(l, t);
        for (const prop of PROPS) expect(b[prop]).toBeCloseTo(a[prop], 9);
      }
    }
  });
});
