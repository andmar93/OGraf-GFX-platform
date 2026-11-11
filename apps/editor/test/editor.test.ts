import { describe, expect, it } from 'vitest';
import { createProject, type TextLayer } from '@ogp/editor-core';
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
