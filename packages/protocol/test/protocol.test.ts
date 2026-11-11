import { describe, expect, it } from 'vitest';
import {
  clockElapsed, collectBindings, createClock, diffTopLevel, formatClock, getAtPath, isValidPath,
  localizeClocks, parseClientMessage, pathsOverlap, resolveBindings, setAtPath, updateClock,
} from '../src/index.ts';

describe('clock', () => {
  it('computes elapsed time from the anchor', () => {
    const c = createClock(1000, { running: true, elapsedAtAnchorMs: 5000 });
    expect(clockElapsed(c, 1000)).toBe(5000);
    expect(clockElapsed(c, 4000)).toBe(8000);
    expect(clockElapsed({ ...c, running: false }, 4000)).toBe(5000);
  });
  it('re-anchors on update', () => {
    const c = createClock(0, { running: true });
    const stopped = updateClock(c, 10_000, { running: false });
    expect(stopped).toMatchObject({ running: false, anchorServerMs: 10_000, elapsedAtAnchorMs: 10_000 });
    expect(clockElapsed(stopped, 99_999)).toBe(10_000);
    expect(updateClock(stopped, 20_000, { adjustMs: -3000 }).elapsedAtAnchorMs).toBe(7000);
    expect(updateClock(stopped, 20_000, { elapsedMs: 45 * 60_000 }).elapsedAtAnchorMs).toBe(2_700_000);
  });
  it('localizes nested clocks with the time offset', () => {
    const data = { a: 1, match: { clock: createClock(10_000, { running: true }) }, list: [createClock(500)] };
    const out = localizeClocks(data, 2000); // server is 2 s ahead of local
    expect(out.match.clock.anchorLocalMs).toBe(8000);
    expect(out.list[0]!.anchorLocalMs).toBe(-1500);
    expect(data.match.clock.anchorLocalMs).toBeUndefined();
    expect(clockElapsed(out.match.clock, 9000, true)).toBe(1000);
  });
  it('formats', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65_999)).toBe('01:05');
    expect(formatClock(93 * 60_000 + 12_000)).toBe('93:12');
    expect(formatClock(120 * 60_000)).toBe('120:00');
  });
});

describe('data paths', () => {
  it('gets and sets immutably', () => {
    const a = { match: { home: { score: 1 } } };
    const b = setAtPath(a, 'match.home.score', 2);
    expect(getAtPath(b, 'match.home.score')).toBe(2);
    expect(a.match.home.score).toBe(1);
    expect(getAtPath(setAtPath({}, 'x.y.z', 'v'), 'x.y')).toEqual({ z: 'v' });
    expect(getAtPath(setAtPath(b, 'match.home', undefined), 'match')).toEqual({});
  });
  it('validates paths', () => {
    expect(isValidPath('match.home.score')).toBe(true);
    expect(isValidPath('match.__proto__.x')).toBe(false);
    expect(isValidPath('')).toBe(false);
  });
  it('detects overlapping paths', () => {
    expect(pathsOverlap('match.home.score', 'match.home')).toBe(true);
    expect(pathsOverlap('match.home', 'match.home.score')).toBe(true);
    expect(pathsOverlap('match.home.score', 'match.away.score')).toBe(false);
  });
  it('resolves bindings', () => {
    const root = { match: { home: { score: 3, name: 'Home FC' } } };
    const tpl = { title: 'Static', score: { $bind: 'match.home.score' }, missing: { $bind: 'nope', default: 0 }, nested: { n: { $bind: 'match.home.name' } } };
    expect(resolveBindings(tpl, root)).toEqual({ title: 'Static', score: 3, missing: 0, nested: { n: 'Home FC' } });
    expect(collectBindings(tpl)).toEqual(['match.home.score', 'nope', 'match.home.name']);
  });
  it('diffs top-level keys', () => {
    expect(diffTopLevel({ a: 1, b: { c: 1 } }, { a: 1, b: { c: 2 } })).toEqual({ b: { c: 2 } });
    expect(diffTopLevel({ a: 1 }, { a: 1 })).toBeUndefined();
  });
});

describe('parseClientMessage', () => {
  it('accepts valid messages', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'hello', role: 'renderer', channelId: 'main' }))).toMatchObject({ role: 'renderer' });
    expect(parseClientMessage(JSON.stringify({ type: 'time.ping', t0: 1 }))).toEqual({ type: 'time.ping', t0: 1 });
    expect(parseClientMessage(JSON.stringify({ type: 'renderer.result', reqId: 'r', result: { statusCode: 200, currentStep: null } }))).toBeTruthy();
  });
  it('rejects invalid messages', () => {
    expect(parseClientMessage('nope')).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ type: 'hello', role: 'renderer' }))).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ type: 'unknown' }))).toBeUndefined();
  });
});
