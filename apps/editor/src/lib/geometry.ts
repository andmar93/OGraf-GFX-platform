/** Pure helpers for the canvas: snapping and resizing (tested). */

export interface Rect { x: number; y: number; width: number; height: number }

/** EBU R95: action-safe 93 %, graphics-safe 90 % of 1920x1080. */
export function safeAreas(w: number, h: number) {
  return {
    action: { x: w * 0.035, y: h * 0.035, width: w * 0.93, height: h * 0.93 },
    graphics: { x: w * 0.05, y: h * 0.05, width: w * 0.9, height: h * 0.9 },
  };
}

/** Vertical (x) and horizontal (y) guide lines a moving box can snap to. */
export function snapLines(w: number, h: number, others: Rect[]): { x: number[]; y: number[] } {
  const s = safeAreas(w, h);
  const xs = [0, w / 2, w, s.action.x, s.action.x + s.action.width, s.graphics.x, s.graphics.x + s.graphics.width];
  const ys = [0, h / 2, h, s.action.y, s.action.y + s.action.height, s.graphics.y, s.graphics.y + s.graphics.height];
  for (const o of others) {
    xs.push(o.x, o.x + o.width / 2, o.x + o.width);
    ys.push(o.y, o.y + o.height / 2, o.y + o.height);
  }
  return { x: xs, y: ys };
}

/** Snaps a moving rect: tries its left/centre/right (top/middle/bottom) against the lines. */
export function snapMove(r: Rect, lines: { x: number[]; y: number[] }, threshold: number): { x: number; y: number; guideX: number | null; guideY: number | null } {
  const best = (edges: number[], targets: number[]) => {
    let d: { delta: number; line: number } | null = null;
    for (const e of edges) for (const t of targets) {
      const delta = t - e;
      if (Math.abs(delta) <= threshold && (!d || Math.abs(delta) < Math.abs(d.delta))) d = { delta, line: t };
    }
    return d;
  };
  const bx = best([r.x, r.x + r.width / 2, r.x + r.width], lines.x);
  const by = best([r.y, r.y + r.height / 2, r.y + r.height], lines.y);
  return { x: r.x + (bx?.delta ?? 0), y: r.y + (by?.delta ?? 0), guideX: bx?.line ?? null, guideY: by?.line ?? null };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** New rect when dragging a resize handle by (dx, dy); `keepRatio` scales proportionally (corner handles). */
export function resize(r: Rect, handle: Handle, dx: number, dy: number, keepRatio = false, min = 4): Rect {
  let { x, y, width, height } = r;
  if (handle.includes('e')) width = r.width + dx;
  if (handle.includes('s')) height = r.height + dy;
  if (handle.includes('w')) { width = r.width - dx; x = r.x + dx; }
  if (handle.includes('n')) { height = r.height - dy; y = r.y + dy; }
  if (keepRatio && handle.length === 2 && r.width > 0 && r.height > 0) {
    const ratio = r.width / r.height;
    if (Math.abs(width / r.width) > Math.abs(height / r.height)) {
      const nh = width / ratio;
      if (handle.includes('n')) y = r.y + r.height - nh;
      height = nh;
    } else {
      const nw = height * ratio;
      if (handle.includes('w')) x = r.x + r.width - nw;
      width = nw;
    }
  }
  if (width < min) { if (handle.includes('w')) x -= min - width; width = min; }
  if (height < min) { if (handle.includes('n')) y -= min - height; height = min; }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
