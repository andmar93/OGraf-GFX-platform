/**
 * Multi-selection helpers (pure): flattening, range selection, group/ungroup, align/distribute.
 */
import { ancestors, editProp, findLayer, newId, valueAt, walk, type GroupLayer, type Layer, type Prop } from '@ogp/editor-core';

export interface FlatRow {
  layer: Layer;
  depth: number;
}

/** Layer list order of the layers panel: top-most first, children after their group. */
export function flatten(layers: Layer[], depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const l of [...layers].reverse()) {
    out.push({ layer: l, depth });
    if (l.type === 'group') flatten(l.children, depth + 1, out);
  }
  return out;
}

/** Removes ids whose ancestor group is also selected (the group carries them). Keeps order. */
export function normaliseSelection(layers: Layer[], ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id, i) => ids.indexOf(id) === i && findLayer(layers, id) && !ancestors(layers, id).some((a) => set.has(a.id)));
}

/** Shift-click: everything between the anchor and the target in list order. */
export function rangeSelect(layers: Layer[], anchorId: string, targetId: string): string[] {
  const rows = flatten(layers).map((r) => r.layer.id);
  const a = rows.indexOf(anchorId);
  const b = rows.indexOf(targetId);
  if (a < 0 || b < 0) return [targetId];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return rows.slice(lo, hi + 1);
}

function parentList(layers: Layer[], id: string): Layer[] | undefined {
  const anc = ancestors(layers, id);
  return anc.length ? anc[anc.length - 1]!.children : layers.some((l) => l.id === id) ? layers : undefined;
}

/** Shifts a layer's x/y (static and keyframes) by (dx, dy). */
function offsetLayer(l: Layer, dx: number, dy: number): Layer {
  const tracks = { ...l.tracks };
  if (tracks.x) tracks.x = tracks.x.map((k) => ({ ...k, v: k.v + dx }));
  if (tracks.y) tracks.y = tracks.y.map((k) => ({ ...k, v: k.v + dy }));
  return { ...l, x: l.x + dx, y: l.y + dy, tracks };
}

function replaceList(layers: Layer[], parentId: string | null, next: Layer[]): Layer[] {
  if (parentId === null) return next;
  return layers.map((l) => {
    if (l.id === parentId && l.type === 'group') return { ...l, children: next };
    if (l.type === 'group') return { ...l, children: replaceList(l.children, parentId, next) };
    return l;
  });
}

/**
 * Wraps sibling layers in a new group (positioned at their bounding box). Child positions and x/y keyframes
 * become relative to the group, so nothing moves.
 */
export function groupLayers(layers: Layer[], ids: string[]): { layers: Layer[]; groupId: string } | { error: string } {
  const sel = normaliseSelection(layers, ids);
  if (sel.length === 0) return { error: 'nothing selected' };
  const list = parentList(layers, sel[0]!);
  if (!list || !sel.every((id) => list.some((l) => l.id === id))) return { error: 'select layers in the same group to group them' };
  const parentId = ancestors(layers, sel[0]!).at(-1)?.id ?? null;
  const members = list.filter((l) => sel.includes(l.id));
  const x = Math.min(...members.map((l) => l.x));
  const y = Math.min(...members.map((l) => l.y));
  const right = Math.max(...members.map((l) => l.x + l.width));
  const bottom = Math.max(...members.map((l) => l.y + l.height));
  const group: GroupLayer = {
    id: newId(), name: 'Group', type: 'group', x, y, width: right - x, height: bottom - y, rotation: 0, opacity: 1, scale: 1,
    maskL: 0, maskR: 0, maskT: 0, maskB: 0, visible: true, locked: false, bindings: {}, tracks: {}, clip: false,
    children: members.map((l) => offsetLayer(l, -x, -y)),
  };
  const topIndex = Math.max(...members.map((m) => list.indexOf(m)));
  const next: Layer[] = [];
  list.forEach((l, i) => {
    if (i === topIndex) next.push(group);
    if (!sel.includes(l.id)) next.push(l);
  });
  return { layers: replaceList(layers, parentId, next), groupId: group.id };
}

/** Replaces a group by its children (positions converted back to the parent's coordinates). */
export function ungroupLayer(layers: Layer[], groupId: string): { layers: Layer[]; childIds: string[] } | { error: string } {
  const g = findLayer(layers, groupId);
  if (!g || g.type !== 'group') return { error: 'select a group to ungroup' };
  const list = parentList(layers, groupId)!;
  const parentId = ancestors(layers, groupId).at(-1)?.id ?? null;
  const children = g.children.map((c) => offsetLayer(c, g.x, g.y));
  const next = list.flatMap((l) => (l.id === groupId ? children : [l]));
  return { layers: replaceList(layers, parentId, next), childIds: children.map((c) => c.id) };
}

/** Absolute (artboard) rect of a layer at time t, using animated x/y of the layer and its groups. */
export function absRectAt(layers: Layer[], id: string, t: number): { x: number; y: number; width: number; height: number } {
  const l = findLayer(layers, id)!;
  let x = valueAt(l, 'x', t);
  let y = valueAt(l, 'y', t);
  for (const a of ancestors(layers, id)) {
    x += valueAt(a, 'x', t);
    y += valueAt(a, 'y', t);
  }
  return { x, y, width: l.width, height: l.height };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdistribute' | 'vdistribute';

/** Align / distribute the selected layers (at time t: animated positions get a keyframe). */
export function alignLayers(layers: Layer[], ids: string[], mode: AlignMode, t: number, canvas?: { width: number; height: number }): Layer[] {
  const sel = normaliseSelection(layers, ids);
  if (sel.length === 0) return layers;
  const rects = sel.map((id) => ({ id, r: absRectAt(layers, id, t) }));
  // one layer aligns to the canvas, several to their common bounds
  const bounds = sel.length === 1 && canvas
    ? { x: 0, y: 0, right: canvas.width, bottom: canvas.height }
    : { x: Math.min(...rects.map((o) => o.r.x)), y: Math.min(...rects.map((o) => o.r.y)), right: Math.max(...rects.map((o) => o.r.x + o.r.width)), bottom: Math.max(...rects.map((o) => o.r.y + o.r.height)) };
  const target = new Map<string, { x?: number; y?: number }>();
  if (mode === 'hdistribute' || mode === 'vdistribute') {
    const horiz = mode === 'hdistribute';
    const sorted = [...rects].sort((a, b) => (horiz ? a.r.x - b.r.x : a.r.y - b.r.y));
    if (sorted.length < 3) return layers;
    const total = sorted.reduce((s, o) => s + (horiz ? o.r.width : o.r.height), 0);
    const span = horiz ? bounds.right - bounds.x : bounds.bottom - bounds.y;
    const gap = (span - total) / (sorted.length - 1);
    let pos = horiz ? bounds.x : bounds.y;
    for (const o of sorted) {
      target.set(o.id, horiz ? { x: pos } : { y: pos });
      pos += (horiz ? o.r.width : o.r.height) + gap;
    }
  } else {
    for (const o of rects) {
      const r = o.r;
      const v: { x?: number; y?: number } = {};
      if (mode === 'left') v.x = bounds.x;
      if (mode === 'right') v.x = bounds.right - r.width;
      if (mode === 'hcenter') v.x = (bounds.x + bounds.right) / 2 - r.width / 2;
      if (mode === 'top') v.y = bounds.y;
      if (mode === 'bottom') v.y = bounds.bottom - r.height;
      if (mode === 'vcenter') v.y = (bounds.y + bounds.bottom) / 2 - r.height / 2;
      target.set(o.id, v);
    }
  }
  let next = layers;
  for (const [id, v] of target) {
    const cur = absRectAt(next, id, t);
    const l = findLayer(next, id)!;
    let updated = l;
    for (const [prop, abs] of [['x', v.x], ['y', v.y]] as [Prop, number | undefined][]) {
      if (abs === undefined) continue;
      const delta = Math.round(abs - (prop === 'x' ? cur.x : cur.y));
      if (delta) updated = editProp(updated, prop, valueAt(updated, prop, t) + delta, t);
    }
    next = replaceLayer(next, id, updated);
  }
  return next;
}

function replaceLayer(layers: Layer[], id: string, layer: Layer): Layer[] {
  return layers.map((l) => (l.id === id ? layer : l.type === 'group' ? { ...l, children: replaceLayer(l.children, id, layer) } : l));
}

/** All layer ids (for select all). */
export function allTopLevelIds(layers: Layer[]): string[] {
  return layers.map((l) => l.id);
}

export function countLayers(layers: Layer[]): number {
  let n = 0;
  walk(layers, () => n++);
  return n;
}
