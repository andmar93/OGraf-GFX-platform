import { eq } from 'drizzle-orm';
import {
  createClock, getAtPath, isClockValue, isValidPath, setAtPath, splitPath, updateClock, type ClockValue,
} from '@ogp/protocol';
import type { Db } from '../db/client.ts';
import { dataRoots } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { Emitter } from '../events.ts';

export type ClockAction = 'start' | 'stop' | 'toggle' | 'set' | 'adjust' | 'reset';

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch) || !isPlainObject(target) || isClockValue(patch)) return patch;
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = deepMerge(target[k], v);
  }
  return out;
}

/**
 * The data hub: a JSON tree addressed by dot paths ("match.home.score").
 * Everything that graphics can bind to lives here. Persisted per top-level key.
 */
export class DataHub extends Emitter<{ change: { path: string; value: unknown } }> {
  private root: Record<string, unknown> = {};

  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {
    super();
    for (const row of db.select().from(dataRoots).all()) this.root[row.key] = row.value;
  }

  get(path = ''): unknown {
    return path === '' ? this.root : getAtPath(this.root, path);
  }

  getRoot(): Record<string, unknown> {
    return this.root;
  }

  set(path: string, value: unknown): void {
    if (!isValidPath(path)) throw badRequest(`invalid data path "${path}"`);
    this.root = setAtPath(this.root, path, value);
    this.persist(path);
    this.emit('change', { path, value: this.get(path) });
  }

  /** Deep merge (null deletes a key). */
  patch(path: string, value: unknown): void {
    if (!isValidPath(path)) throw badRequest(`invalid data path "${path}"`);
    this.set(path, deepMerge(this.get(path), value));
  }

  delete(path: string): void {
    this.set(path, undefined);
  }

  /** Clock helper: creates or updates a clock value at `path`. */
  clock(path: string, action: ClockAction, opts: { elapsedMs?: number; adjustMs?: number; direction?: 'up' | 'down'; limitMs?: number; label?: string } = {}): ClockValue {
    const now = this.now();
    const current = this.get(path);
    let clock: ClockValue = isClockValue(current) ? current : createClock(now);
    const meta = { direction: opts.direction, limitMs: opts.limitMs, label: opts.label };
    switch (action) {
      case 'start': clock = updateClock(clock, now, { ...meta, running: true, elapsedMs: opts.elapsedMs }); break;
      case 'stop': clock = updateClock(clock, now, { ...meta, running: false, elapsedMs: opts.elapsedMs }); break;
      case 'toggle': clock = updateClock(clock, now, { ...meta, running: !clock.running }); break;
      case 'set': clock = updateClock(clock, now, { ...meta, elapsedMs: opts.elapsedMs ?? 0 }); break;
      case 'adjust': clock = updateClock(clock, now, { ...meta, adjustMs: opts.adjustMs ?? 0 }); break;
      case 'reset': clock = updateClock(clock, now, { ...meta, running: false, elapsedMs: 0 }); break;
      default: throw badRequest(`unknown clock action "${String(action)}"`);
    }
    this.set(path, clock);
    return clock;
  }

  private persist(path: string) {
    const key = splitPath(path)[0]!;
    const value = this.root[key];
    if (value === undefined) this.db.delete(dataRoots).where(eq(dataRoots.key, key)).run();
    else this.db.insert(dataRoots).values({ key, value, updatedAt: this.now() }).onConflictDoUpdate({ target: dataRoots.key, set: { value, updatedAt: this.now() } }).run();
  }
}
