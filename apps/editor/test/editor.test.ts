import { describe, expect, it } from 'vitest';
import { createLayer, createProject, editProp, findLayer, toggleAnimated, valueAt, type Layer, type TextLayer } from '@ogp/editor-core';
import { absRectAt, alignLayers, flatten, groupLayers, normaliseSelection, rangeSelect, ungroupLayer } from '../src/lib/selection.ts';
import { pushState, redoState, undoState } from '../src/lib/history.ts';
import { resize, safeAreas, snapLines, snapMove } from '../src/lib/geometry.ts';
import { renameFieldKey } from '../src/components/FieldsPanel.tsx';

describe('history', () => {
  it('undoes, redoes and coalesces', () => {
    let h = { past: [] as number[], present: 0, future: [] as number[] };
    h = pushState(h, 1, false);
    h = pushState(h, 2, true); // coalesced into the same step
    h = pushState(h, 3, false);
    expect(h.past).toEqual([0, 2]); // the coalesced step replaced 1
    h = undoState(h);
    expect(h.present).toBe(2);
    h = undoState(h);
    expect(h.present).toBe(0);
    h = redoState(redoState(h));
    expect(h.present).toBe(3);
    expect(undoState({ past: [], present: 5, future: [] }).present).toBe(5);
  });
});

describe('geometry', () => {
  it('computes EBU safe areas', () => {
    expect(safeAreas(1920, 1080).graphics).toEqual({ x: 96, y: 54, width: 1728, height: 972 });
  });
  it('snaps to centre lines and other layers', () => {
    const lines = snapLines(1920, 1080, [{ x: 100, y: 100, width: 200, height: 50 }]);
    const s = snapMove({ x: 857, y: 300, width: 200, height: 50 }, lines, 6);
    expect(s).toMatchObject({ x: 860, guideX: 960 }); // centre 957 -> 960
    // nearest edge wins: of the edges 147 / 152 / 157 the middle (152) is closest to the line at 150
    expect(snapMove({ x: 302, y: 147, width: 10, height: 10 }, lines, 6)).toMatchObject({ x: 300, y: 145, guideY: 150 });
    expect(snapMove({ x: 500, y: 500, width: 10, height: 10 }, lines, 2)).toMatchObject({ x: 500, guideX: null });
  });
  it('resizes from any handle and keeps the ratio with corner handles', () => {
    const r = { x: 100, y: 100, width: 200, height: 100 };
    expect(resize(r, 'e', 50, 0)).toEqual({ x: 100, y: 100, width: 250, height: 100 });
    expect(resize(r, 'nw', 20, 10)).toEqual({ x: 120, y: 110, width: 180, height: 90 });
    expect(resize(r, 'se', 100, 0, true)).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(resize(r, 'w', 500, 0).width).toBe(4);
  });
});

describe('fields', () => {
  it('renames a field key in templates and bindings', () => {
    const p = createProject();
    p.layers[0]!.bindings.fill = 'title';
    const r = renameFieldKey(p, 'title', 'name');
    expect(r.fields.map((f) => f.key)).toEqual(['name', 'subtitle']);
    expect((r.layers[2] as TextLayer).text).toBe('{name}');
    expect(r.layers[0]!.bindings.fill).toBe('name');
  });
});

describe('clipboard', async () => {
  const { serialize, parse, prepareForPaste } = await import('../src/lib/clipboard.ts');
  const { createProject, createLayer } = await import('@ogp/editor-core');

  it('copies layers with the fields they use and pastes them with new ids', () => {
    const src = createProject('Source');
    src.fields.push({ key: 'color', label: 'Colour', type: 'color', default: '#ff0000' });
    src.layers[0]!.bindings.fill = 'color';
    const text = serialize(src, [src.layers[0]!.id, src.layers[2]!.id]);
    const payload = parse(text)!;
    expect(payload.layers).toHaveLength(2);
    expect(payload.fields.map((f) => f.key).sort()).toEqual(['color', 'title']);

    // into the same graphic: offset, new ids, no new fields
    const same = prepareForPaste(payload, src);
    expect(same.layers[0]!.id).not.toBe(src.layers[0]!.id);
    expect(same.layers[0]!.x).toBe(src.layers[0]!.x + 20);
    expect(same.layers[0]!.name).toBe(src.layers[0]!.name);
    expect(same.newFields).toEqual([]);

    // into another graphic: same position, missing fields are added
    const other = createProject('Other');
    other.fields = [];
    const into = prepareForPaste(payload, other);
    expect(into.layers[0]!.x).toBe(src.layers[0]!.x);
    expect(into.newFields.map((f) => f.key).sort()).toEqual(['color', 'title']);
  });

  it('gives group children new ids too', () => {
    const p = createProject();
    const g = createLayer('group') as import('@ogp/editor-core').GroupLayer;
    g.children.push(createLayer('text'));
    p.layers.push(g);
    const r = prepareForPaste(parse(serialize(p, [g.id]))!, p);
    const pasted = r.layers[0] as import('@ogp/editor-core').GroupLayer;
    expect(pasted.children[0]!.id).not.toBe(g.children[0]!.id);
  });

  it('ignores clipboard text that is not ours', () => {
    expect(parse('hello')).toBeUndefined();
    expect(parse('{"kind":"other","layers":[]}')).toBeUndefined();
    expect(parse('{broken')).toBeUndefined();
  });
});

describe('multi-selection helpers', () => {
  const mk = (id: string, x: number, y: number, w = 100, h = 50): Layer => ({ ...createLayer('shape', { x, y }), id, name: id, width: w, height: h });

  it('flattens top-most first and range-selects in list order', () => {
    const layers = [mk('a', 0, 0), mk('b', 0, 0), mk('c', 0, 0)];
    expect(flatten(layers).map((r) => r.layer.id)).toEqual(['c', 'b', 'a']);
    expect(rangeSelect(layers, 'c', 'a')).toEqual(['c', 'b', 'a']);
  });

  it('groups keeping absolute positions (incl. keyframes) and ungroups back', () => {
    let a = mk('a', 100, 200);
    a = editProp(toggleAnimated(a, 'x', 0), 'x', 300, 500);
    const layers = [a, mk('b', 150, 120), mk('c', 0, 0)];
    const r = groupLayers(layers, ['a', 'b']);
    if ('error' in r) throw new Error(r.error);
    const g = findLayer(r.layers, r.groupId)!;
    expect(g).toMatchObject({ x: 100, y: 120, width: 150, height: 130 });
    expect(absRectAt(r.layers, 'a', 500)).toMatchObject({ x: 300, y: 200 });
    expect(absRectAt(r.layers, 'b', 0)).toMatchObject({ x: 150, y: 120 });
    expect(r.layers.map((l) => l.id)).toEqual([r.groupId, 'c']);
    const u = ungroupLayer(r.layers, r.groupId);
    if ('error' in u) throw new Error(u.error);
    expect(absRectAt(u.layers, 'a', 500).x).toBe(300);
    expect(absRectAt(u.layers, 'b', 0)).toMatchObject({ x: 150, y: 120 });
  });

  it('refuses to group layers from different parents', () => {
    const r = groupLayers([mk('a', 0, 0), mk('b', 0, 0)], ['a', 'b']);
    if ('error' in r) throw new Error(r.error);
    const r2 = groupLayers([...r.layers, mk('c', 0, 0)], ['a', 'c']);
    expect('error' in r2).toBe(true);
  });

  it('aligns and distributes', () => {
    const layers = [mk('a', 10, 0), mk('b', 200, 40, 50), mk('c', 400, 80)];
    const left = alignLayers(layers, ['a', 'b', 'c'], 'left', 0);
    expect(left.map((l) => l.x)).toEqual([10, 10, 10]);
    const right = alignLayers(layers, ['a', 'b', 'c'], 'right', 0);
    expect(right.map((l) => l.x + l.width)).toEqual([500, 500, 500]);
    const dist = alignLayers(layers, ['a', 'b', 'c'], 'hdistribute', 0);
    // span 10..500 = 490, widths 250 → gap 120
    expect(dist.map((l) => l.x)).toEqual([10, 230, 400]);
    // a single layer aligns to the canvas
    expect(alignLayers(layers, ['a'], 'hcenter', 0, { width: 1920, height: 1080 })[0]!.x).toBe(910);
  });

  it('align at the playhead keyframes animated positions', () => {
    let a = mk('a', 0, 0);
    a = editProp(toggleAnimated(a, 'x', 0), 'x', 500, 1000);
    const out = alignLayers([a, mk('b', 50, 0)], ['a', 'b'], 'left', 1000);
    const na = findLayer(out, 'a')!;
    expect(valueAt(na, 'x', 1000)).toBe(50);
    expect(valueAt(na, 'x', 0)).toBe(0);
  });

  it('normalises selections that contain a group and its child', () => {
    const r = groupLayers([mk('a', 0, 0), mk('b', 0, 0)], ['a', 'b']);
    if ('error' in r) throw new Error(r.error);
    expect(normaliseSelection(r.layers, ['a', r.groupId])).toEqual([r.groupId]);
  });
});
