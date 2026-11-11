/**
 * Clock values are published as data and computed locally by graphics.
 * No ticks are sent: a clock is an anchor (server time + elapsed at that time + running flag).
 *
 *   elapsed(now) = elapsedAtAnchorMs + (running ? now - anchor : 0)
 *
 * The server publishes `anchorServerMs` (server epoch ms). Renderers measure their clock
 * offset to the server and add `anchorLocalMs` (renderer epoch ms) before passing data to a
 * graphic, so a graphic only ever needs `Date.now()`.
 */
export const CLOCK_TYPE = 'clock';

export interface ClockValue {
  $type: typeof CLOCK_TYPE;
  running: boolean;
  /** Server epoch ms at which `elapsedAtAnchorMs` was true. */
  anchorServerMs: number;
  /** Renderer epoch ms equivalent of anchorServerMs (added by the renderer). */
  anchorLocalMs?: number;
  /** Elapsed time at the anchor, in ms. */
  elapsedAtAnchorMs: number;
  /** 'up' counts up from 0, 'down' displays limitMs - elapsed. */
  direction?: 'up' | 'down';
  /** Optional limit in ms: an up-clock stops displaying beyond it (e.g. 45:00), a down-clock stops at 0. */
  limitMs?: number;
  /** Free label (e.g. "1st half"). */
  label?: string;
}

export function isClockValue(v: unknown): v is ClockValue {
  return typeof v === 'object' && v !== null && (v as { $type?: unknown }).$type === CLOCK_TYPE;
}

export function createClock(nowServerMs: number, init: Partial<Omit<ClockValue, '$type'>> = {}): ClockValue {
  return {
    $type: CLOCK_TYPE,
    running: false,
    anchorServerMs: nowServerMs,
    elapsedAtAnchorMs: 0,
    direction: 'up',
    ...init,
  };
}

/** Elapsed ms at the given time (in the same time base as the anchor used). */
export function clockElapsed(clock: ClockValue, now: number, useLocal = false): number {
  const anchor = useLocal && clock.anchorLocalMs !== undefined ? clock.anchorLocalMs : clock.anchorServerMs;
  const elapsed = clock.elapsedAtAnchorMs + (clock.running ? Math.max(0, now - anchor) : 0);
  return Math.max(0, elapsed);
}

/** Re-anchors a clock at `now` (keeping its elapsed time) and applies changes. */
export function updateClock(clock: ClockValue, nowServerMs: number, change: { running?: boolean; elapsedMs?: number; adjustMs?: number } & Partial<Pick<ClockValue, 'direction' | 'limitMs' | 'label'>>): ClockValue {
  let elapsed = change.elapsedMs ?? clockElapsed(clock, nowServerMs);
  if (change.adjustMs) elapsed = Math.max(0, elapsed + change.adjustMs);
  const next: ClockValue = {
    ...clock,
    running: change.running ?? clock.running,
    anchorServerMs: nowServerMs,
    elapsedAtAnchorMs: elapsed,
  };
  delete next.anchorLocalMs;
  if (change.direction !== undefined) next.direction = change.direction;
  if (change.limitMs !== undefined) next.limitMs = change.limitMs;
  if (change.label !== undefined) next.label = change.label;
  return next;
}

/**
 * Returns a copy of `data` where every clock value gets `anchorLocalMs`
 * (offsetMs = serverTime - localTime).
 */
export function localizeClocks<T>(data: T, offsetMs: number): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null) return v;
    if (isClockValue(v)) return { ...v, anchorLocalMs: v.anchorServerMs - offsetMs };
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = walk(val);
    return out;
  };
  return walk(data) as T;
}

/** Formats ms as M:SS / MM:SS (minutes are not capped at 59: "93:12"). */
export function formatClock(ms: number, opts: { padMinutes?: number } = {}): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(opts.padMinutes ?? 2, '0')}:${String(s).padStart(2, '0')}`;
}
