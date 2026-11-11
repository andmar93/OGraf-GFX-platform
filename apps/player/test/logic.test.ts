import { describe, expect, it } from 'vitest';
import type { ChannelState, LayerState, RundownItem } from '@ogp/protocol';
import { fieldKind, flattenDataPaths, moveInArray, newArrayItem, parseNumber, selectOptions, toggleBinding } from '../src/lib/gdd-form.ts';
import { formatDuration, itemLabel, itemStatus, stepLabel } from '../src/lib/item-status.ts';
import { isTypingTarget, shortcutFor } from '../src/lib/shortcuts.ts';

describe('gdd form helpers', () => {
  it('picks widgets with graceful degradation', () => {
    expect(fieldKind({ type: 'string' })).toBe('text');
    expect(fieldKind({ type: 'string', gddType: 'multi-line' })).toBe('textarea');
    expect(fieldKind({ type: 'string', gddType: 'single-line/my-custom' })).toBe('text');
    expect(fieldKind({ type: 'string', gddType: 'color-rrggbb' })).toBe('color');
    expect(fieldKind({ type: 'string', gddType: 'file-path/image-path' })).toBe('image');
    expect(fieldKind({ type: 'string', enum: ['a'] })).toBe('select');
    expect(fieldKind({ type: 'integer' })).toBe('number');
    expect(fieldKind({ type: ['number', 'null'] })).toBe('number');
    expect(fieldKind({ type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ type: 'array', items: { type: 'string' } })).toBe('array');
    expect(fieldKind({ type: 'object', properties: {} })).toBe('object');
    expect(fieldKind({ type: 'object' })).toBe('json');
  });

  it('builds select options with labels', () => {
    expect(selectOptions({ enum: ['home', 'away'], gddOptions: { labels: { home: 'Home' } } })).toEqual([{ value: 'home', label: 'Home' }, { value: 'away', label: 'away' }]);
  });

  it('toggles bindings, keeping the value as fallback', () => {
    expect(toggleBinding(3, 0, 'match.home.score')).toEqual({ $bind: 'match.home.score', default: 3 });
    expect(toggleBinding(undefined, 0)).toEqual({ $bind: '', default: 0 });
    expect(toggleBinding(undefined, undefined)).toEqual({ $bind: '' });
    expect(toggleBinding({ $bind: 'x', default: 3 }, 0)).toBe(3);
    expect(toggleBinding({ $bind: 'x' }, 'def')).toBe('def');
  });

  it('parses numbers by schema type', () => {
    expect(parseNumber('2.6', { type: 'integer' })).toBe(3);
    expect(parseNumber('2.6', { type: 'number' })).toBe(2.6);
    expect(parseNumber('', { type: 'number' })).toBeUndefined();
    expect(parseNumber('abc', { type: 'number' })).toBeUndefined();
  });

  it('lists bindable data paths, treating clocks as leaves', () => {
    const paths = flattenDataPaths({ match: { home: { score: 2 }, clock: { $type: 'clock', running: true, anchorServerMs: 0, elapsedAtAnchorMs: 0 } } });
    expect(paths.map((p) => p.path)).toEqual(['match', 'match.clock', 'match.home', 'match.home.score']);
    expect(paths.find((p) => p.path === 'match.clock')?.preview).toBe('clock (running)');
  });

  it('creates array rows and moves them', () => {
    expect(newArrayItem({ type: 'object', properties: { n: { type: 'integer' }, c: { type: 'boolean', default: false } } })).toEqual({ c: false });
    expect(newArrayItem({ type: 'string' })).toBe('');
    expect(moveInArray([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveInArray([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
});

describe('item status', () => {
  const item = (o: Partial<RundownItem> = {}): RundownItem => ({ id: 'i1', rundownId: 'r', position: 0, name: '', graphicId: 'g', channelId: 'main', layer: 20, data: {}, durationMs: null, updatedAt: 0, ...o });
  const layer = (o: Partial<LayerState>): LayerState => ({
    layer: 20, graphicInstanceId: 'x', graphic: { id: 'g', name: 'G', packageId: 'p', mainUrl: '', supportsRealTime: true, supportsNonRealTime: false }, dataTemplate: {}, data: {}, status: 'playing', currentStep: 0, updatedAt: 0, ...o,
  });
  const channel = (layers: LayerState[]): ChannelState[] => [{ id: 'main', name: 'Main', width: 1920, height: 1080, frameRate: 50, layers, revision: 0, renderers: [] }];

  it('maps layer state of the item', () => {
    expect(itemStatus(item(), channel([])).state).toBe('idle');
    expect(itemStatus(item(), channel([layer({ source: { rundownId: 'r', itemId: 'i1' } })])).state).toBe('onair');
    expect(itemStatus(item(), channel([layer({ status: 'loaded', source: { rundownId: 'r', itemId: 'i1' } })])).state).toBe('cued');
    expect(itemStatus(item(), channel([layer({ status: 'stopped', source: { rundownId: 'r', itemId: 'i1' } })])).state).toBe('out');
  });
  it('flags a busy layer', () => {
    const st = itemStatus(item(), channel([layer({ source: { rundownId: 'r', itemId: 'other' } })]));
    expect(st).toMatchObject({ state: 'idle', layerBusy: true });
  });
  it('labels steps, durations and items', () => {
    expect(stepLabel(1, 3)).toBe('step 2/3');
    expect(stepLabel(4, -1)).toBe('step 5');
    expect(stepLabel(0, 1)).toBe('');
    expect(stepLabel(null, 3)).toBe('');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(itemLabel(item({ name: ' Coach ' }), 'G', () => 'x')).toBe('Coach');
    expect(itemLabel(item(), 'G', () => 'Anna – Coach')).toBe('Anna – Coach');
    expect(itemLabel(item(), 'G', () => '')).toBe('G');
  });
});

describe('shortcuts', () => {
  it('maps keys', () => {
    expect(shortcutFor({ key: ' ' })).toBe('take');
    expect(shortcutFor({ key: 'F2' })).toBe('take');
    expect(shortcutFor({ key: 'C' })).toBe('cue');
    expect(shortcutFor({ key: 'ArrowRight' })).toBe('next');
    expect(shortcutFor({ key: 'ArrowLeft' })).toBe('prev');
    expect(shortcutFor({ key: 'Escape' })).toBe('out');
    expect(shortcutFor({ key: 'o' })).toBe('out');
    expect(shortcutFor({ key: 'O', shiftKey: true })).toBe('outAll');
    expect(shortcutFor({ key: 'Escape', shiftKey: true })).toBe('clearAll');
    expect(shortcutFor({ key: 'u' })).toBe('update');
    expect(shortcutFor({ key: 'ArrowUp', altKey: true })).toBe('moveUp');
    expect(shortcutFor({ key: 'd', metaKey: true })).toBe('duplicate');
    expect(shortcutFor({ key: 's', ctrlKey: true })).toBeUndefined();
    expect(shortcutFor({ key: '?', shiftKey: true })).toBe('help');
    expect(shortcutFor({ key: 'x' })).toBeUndefined();
  });
  it('ignores typing targets', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
