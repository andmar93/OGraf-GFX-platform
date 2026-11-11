import { describe, expect, it } from 'vitest';
import { getActionDuration, hasStepControls, resolveTargetStep } from '../src/index.ts';

describe('resolveTargetStep – table from the OGraf v1 spec', () => {
  // current step | stepCount | goto | delta | target step
  const table: [number | undefined, number, number | undefined, number | undefined, number | undefined][] = [
    [undefined, 1, undefined, undefined, 0],
    [undefined, 1, 0, undefined, 0],
    [undefined, 1, undefined, 1, 0],
    [undefined, 2, 1, 2, 1],
    [0, 2, 1, undefined, 1],
    [0, 3, undefined, 2, 2],
    [2, 3, 1, undefined, 1],
    [2, 3, undefined, -2, 0],
    [0, 1, undefined, 1, undefined],
  ];
  it.each(table)('current=%s stepCount=%s goto=%s delta=%s -> %s', (current, count, goto, delta, expected) => {
    expect(resolveTargetStep(current, count, { goto, delta })).toBe(expected);
  });

  it('defaults stepCount to 1', () => {
    expect(resolveTargetStep(undefined, undefined)).toBe(0);
    expect(resolveTargetStep(0, undefined)).toBeUndefined();
  });
  it('stepCount 0 always goes to the end', () => {
    expect(resolveTargetStep(undefined, 0)).toBeUndefined();
  });
  it('stepCount -1 never ends by step comparison', () => {
    expect(resolveTargetStep(41, -1)).toBe(42);
  });
  it('clamps negative targets to 0', () => {
    expect(resolveTargetStep(0, 3, { delta: -1 })).toBe(0);
  });
  it('treats null like undefined (start state)', () => {
    expect(resolveTargetStep(null, 2)).toBe(0);
  });
});

describe('hasStepControls', () => {
  it.each([[undefined, false], [0, false], [1, false], [2, true], [-1, true]] as const)('%s -> %s', (c, e) => {
    expect(hasStepControls(c)).toBe(e);
  });
});

describe('getActionDuration', () => {
  const manifest = {
    actionDurations: [
      { type: 'playAction' as const, duration: 500, steps: [{ step: 1, duration: 300 }, { duration: 400 }] },
      { type: 'stopAction' as const, duration: 250 },
      { type: 'customAction' as const, customActionId: 'goal', duration: 600 },
    ],
  };
  it('uses exact step, then step fallback, then action duration', () => {
    expect(getActionDuration(manifest, { type: 'playAction', targetStep: 1 })).toBe(300);
    expect(getActionDuration(manifest, { type: 'playAction', targetStep: 0 })).toBe(400);
    expect(getActionDuration({ actionDurations: [{ type: 'playAction', duration: 500 }] }, { type: 'playAction', targetStep: 0 })).toBe(500);
  });
  it('finds other action types', () => {
    expect(getActionDuration(manifest, { type: 'stopAction' })).toBe(250);
    expect(getActionDuration(manifest, { type: 'customAction', customActionId: 'goal' })).toBe(600);
    expect(getActionDuration(manifest, { type: 'updateAction' })).toBeUndefined();
  });
});
