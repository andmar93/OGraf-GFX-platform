/**
 * Event-driven match clock (pure). Produces the ClockValue anchors graphics compute locally.
 */
import { CLOCK_TYPE, type ClockValue } from '@ogp/protocol/clock';

export interface ClockState {
  running: boolean;
  /** server ms of the last (re)anchor */
  anchorAt: number;
  elapsedAtAnchor: number;
  /** ms where the current period's regulation time ends (e.g. 45:00), null = no limit */
  limitMs: number | null;
  label?: string;
}

export const stoppedClock = (elapsed = 0, limitMs: number | null = null): ClockState => ({ running: false, anchorAt: 0, elapsedAtAnchor: elapsed, limitMs });

export function elapsedAt(c: ClockState, at: number): number {
  return Math.max(0, c.elapsedAtAnchor + (c.running ? Math.max(0, at - c.anchorAt) : 0));
}

export function startClock(c: ClockState, at: number): ClockState {
  return c.running ? c : { ...c, running: true, anchorAt: at };
}

export function stopClock(c: ClockState, at: number): ClockState {
  return c.running ? { ...c, running: false, elapsedAtAnchor: elapsedAt(c, at), anchorAt: at } : c;
}

export function setClock(c: ClockState, at: number, elapsed: number): ClockState {
  return { ...c, elapsedAtAnchor: Math.max(0, elapsed), anchorAt: at };
}

export function adjustClock(c: ClockState, at: number, delta: number): ClockState {
  return setClock(c, at, elapsedAt(c, at) + delta);
}

export function toClockValue(c: ClockState): ClockValue {
  const v: ClockValue = { $type: CLOCK_TYPE, running: c.running, anchorServerMs: c.anchorAt, elapsedAtAnchorMs: c.elapsedAtAnchor, direction: 'up' };
  if (c.limitMs !== null) v.limitMs = c.limitMs;
  if (c.label) v.label = c.label;
  return v;
}

/** Football-style minute: 23:10 -> "24'", 46:30 with a 45:00 limit -> "45+2'". */
export function displayMinute(elapsedMs: number, limitMs: number | null): string {
  const minute = Math.floor(Math.max(0, elapsedMs) / 60_000) + 1;
  if (limitMs !== null) {
    const limitMin = Math.round(limitMs / 60_000);
    if (minute > limitMin) return `${limitMin}+${minute - limitMin}'`;
  }
  return `${minute}'`;
}
