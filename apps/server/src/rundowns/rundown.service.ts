/**
 * Rundowns and rundown item control.
 *
 * Items are played through the ChannelService (the single source of truth for what is on air);
 * layers loaded from an item carry `source: { rundownId, itemId }`, so every client can show
 * which items are cued / on air.
 */
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { getDefaultData, hasStepControls, listFields } from '@ogp/ograf-core';
import type { LayerState, Rundown, RundownItem, RundownSummary } from '@ogp/protocol';
import type { Db } from '../db/client.ts';
import { rundownItems, rundowns } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { Emitter } from '../events.ts';
import type { ChannelService, CommandOutcome } from '../channels/channel.service.ts';
import type { GraphicsService } from '../graphics/graphics.service.ts';

type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ItemInput {
  graphicId?: string;
  name?: string;
  channelId?: string;
  layer?: number;
  data?: Data;
  durationMs?: number | null;
}

export type ItemAction = 'cue' | 'take' | 'next' | 'prev' | 'out' | 'update' | 'clear';

export interface ItemOutcome extends Partial<CommandOutcome> {
  statusCode: number;
  statusMessage?: string;
  /** cursor after the action */
  cursorItemId: string | null;
}

/** Default layer per graphic: manifest `v_ogp_defaultLayer`, else 20. */
const DEFAULT_LAYER = 20;

export class RundownService extends Emitter<{ changed: Rundown; removed: { rundownId: string }; list: RundownSummary[] }> {
  private autoOut = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: Db,
    private readonly channels: ChannelService,
    private readonly graphics: GraphicsService,
  ) {
    super();
    // Cancel auto-out timers when a layer is changed by anything else.
    channels.on('state', (st) => {
      for (const [key, timer] of this.autoOut) {
        const [channelId, layerStr, instanceId] = key.split('\n');
        if (channelId !== st.id) continue;
        const l = st.layers.find((x) => x.layer === Number(layerStr));
        if (!l || l.graphicInstanceId !== instanceId || l.status !== 'playing') {
          clearTimeout(timer);
          this.autoOut.delete(key);
        }
      }
    });
  }

  close() {
    for (const t of this.autoOut.values()) clearTimeout(t);
    this.autoOut.clear();
  }

  // ---------------- queries ----------------

  list(): RundownSummary[] {
    const all = this.db.select().from(rundowns).orderBy(asc(rundowns.sortOrder), asc(rundowns.createdAt)).all();
    const counts = new Map<string, number>();
    for (const r of this.db.select({ rundownId: rundownItems.rundownId }).from(rundownItems).all()) counts.set(r.rundownId, (counts.get(r.rundownId) ?? 0) + 1);
    return all.map((r) => ({ id: r.id, name: r.name, itemCount: counts.get(r.id) ?? 0, updatedAt: r.updatedAt }));
  }

  get(rundownId: string): Rundown {
    const r = this.db.select().from(rundowns).where(eq(rundowns.id, rundownId)).get();
    if (!r) throw notFound(`rundown "${rundownId}"`);
    const items = this.db.select().from(rundownItems).where(eq(rundownItems.rundownId, rundownId)).orderBy(asc(rundownItems.position)).all();
    return {
      id: r.id,
      name: r.name,
      cursorItemId: r.cursorItemId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      items: items.map((i) => ({
        id: i.id, rundownId: i.rundownId, position: i.position, name: i.name, graphicId: i.graphicId,
        channelId: i.channelId, layer: i.layer, data: i.data as Data, durationMs: i.durationMs, updatedAt: i.updatedAt,
      })),
    };
  }

  getItem(rundownId: string, itemId: string): RundownItem {
    const item = this.get(rundownId).items.find((i) => i.id === itemId);
    if (!item) throw notFound(`rundown item "${itemId}"`);
    return item;
  }

  // ---------------- rundown CRUD ----------------

  create(input: { name: string }): Rundown {
    const name = input.name?.trim();
    if (!name) throw badRequest('name is required');
    const now = Date.now();
    const id = randomUUID();
    this.db.insert(rundowns).values({ id, name, cursorItemId: null, sortOrder: this.list().length, createdAt: now, updatedAt: now }).run();
    return this.changed(id);
  }

  update(rundownId: string, patch: { name?: string; cursorItemId?: string | null }): Rundown {
    const r = this.get(rundownId);
    const set: Partial<typeof rundowns.$inferInsert> = { updatedAt: Date.now() };
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw badRequest('name must not be empty');
      set.name = patch.name.trim();
    }
    if (patch.cursorItemId !== undefined) {
      if (patch.cursorItemId !== null && !r.items.some((i) => i.id === patch.cursorItemId)) throw notFound(`rundown item "${patch.cursorItemId}"`);
      set.cursorItemId = patch.cursorItemId;
    }
    this.db.update(rundowns).set(set).where(eq(rundowns.id, rundownId)).run();
    return this.changed(rundownId);
  }

  delete(rundownId: string): void {
    this.get(rundownId);
    this.db.delete(rundowns).where(eq(rundowns.id, rundownId)).run();
    this.emit('removed', { rundownId });
    this.emit('list', this.list());
  }

  duplicate(rundownId: string, name?: string): Rundown {
    const src = this.get(rundownId);
    const copy = this.create({ name: name?.trim() || `${src.name} (copy)` });
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const i of src.items) {
        tx.insert(rundownItems).values({
          id: randomUUID(), rundownId: copy.id, position: i.position, name: i.name, graphicId: i.graphicId,
          channelId: i.channelId, layer: i.layer, data: i.data, durationMs: i.durationMs, createdAt: now, updatedAt: now,
        }).run();
      }
    });
    return this.changed(copy.id);
  }

  // ---------------- items ----------------

  /** Default data for a new item: schema defaults, with `v_ogp_bind` field hints turned into bindings. */
  defaultItemData(graphicId: string): Data {
    const g = this.graphics.get(graphicId);
    if (!g) return {};
    const data: Data = getDefaultData(g.manifest.schema);
    for (const f of listFields(g.manifest.schema)) {
      const bind = f.schema.v_ogp_bind;
      if (typeof bind === 'string' && bind) data[f.key] = data[f.key] === undefined ? { $bind: bind } : { $bind: bind, default: data[f.key] };
    }
    return data;
  }

  addItem(rundownId: string, input: ItemInput & { afterItemId?: string | null }): Rundown {
    const r = this.get(rundownId);
    if (typeof input.graphicId !== 'string') throw badRequest('graphicId is required');
    const g = this.graphics.get(input.graphicId);
    if (!g) throw notFound(`graphic "${input.graphicId}"`);
    const channelId = input.channelId ?? this.channels.list()[0]?.id;
    if (!channelId) throw badRequest('no channel available');
    this.channels.require(channelId);
    const manifestLayer = (g.manifest as unknown as Data).v_ogp_defaultLayer;
    const layer = input.layer ?? (typeof manifestLayer === 'number' ? manifestLayer : DEFAULT_LAYER);
    this.checkLayer(layer);
    if (input.data !== undefined && !isObject(input.data)) throw badRequest('data must be an object');

    // insert after the given item (or at the end)
    let position = r.items.length;
    if (input.afterItemId) {
      const after = r.items.find((i) => i.id === input.afterItemId);
      if (!after) throw notFound(`rundown item "${input.afterItemId}"`);
      position = after.position + 1;
    }
    const now = Date.now();
    const id = randomUUID();
    this.db.transaction((tx) => {
      for (const i of r.items) if (i.position >= position) tx.update(rundownItems).set({ position: i.position + 1 }).where(eq(rundownItems.id, i.id)).run();
      tx.insert(rundownItems).values({
        id, rundownId, position, name: input.name ?? '', graphicId: g.graphicId, channelId, layer,
        data: input.data ?? this.defaultItemData(g.graphicId), durationMs: this.checkDuration(input.durationMs ?? null), createdAt: now, updatedAt: now,
      }).run();
      if (!r.cursorItemId) tx.update(rundowns).set({ cursorItemId: id }).where(eq(rundowns.id, rundownId)).run();
      tx.update(rundowns).set({ updatedAt: now }).where(eq(rundowns.id, rundownId)).run();
    });
    return this.changed(rundownId);
  }

  updateItem(rundownId: string, itemId: string, patch: ItemInput): Rundown {
    this.getItem(rundownId, itemId);
    const set: Partial<typeof rundownItems.$inferInsert> = { updatedAt: Date.now() };
    if (patch.name !== undefined) set.name = String(patch.name);
    if (patch.graphicId !== undefined) {
      if (!this.graphics.get(patch.graphicId)) throw notFound(`graphic "${patch.graphicId}"`);
      set.graphicId = patch.graphicId;
    }
    if (patch.channelId !== undefined) {
      this.channels.require(patch.channelId);
      set.channelId = patch.channelId;
    }
    if (patch.layer !== undefined) set.layer = this.checkLayer(patch.layer);
    if (patch.data !== undefined) {
      if (!isObject(patch.data)) throw badRequest('data must be an object');
      set.data = patch.data;
    }
    if (patch.durationMs !== undefined) set.durationMs = this.checkDuration(patch.durationMs);
    this.db.update(rundownItems).set(set).where(eq(rundownItems.id, itemId)).run();
    this.touch(rundownId);
    return this.changed(rundownId);
  }

  deleteItem(rundownId: string, itemId: string): Rundown {
    const r = this.get(rundownId);
    const idx = r.items.findIndex((i) => i.id === itemId);
    if (idx < 0) throw notFound(`rundown item "${itemId}"`);
    const rest = r.items.filter((i) => i.id !== itemId);
    this.db.transaction((tx) => {
      tx.delete(rundownItems).where(eq(rundownItems.id, itemId)).run();
      rest.forEach((i, pos) => tx.update(rundownItems).set({ position: pos }).where(eq(rundownItems.id, i.id)).run());
      if (r.cursorItemId === itemId) {
        const next = rest[idx] ?? rest[idx - 1] ?? null;
        tx.update(rundowns).set({ cursorItemId: next?.id ?? null }).where(eq(rundowns.id, rundownId)).run();
      }
    });
    this.touch(rundownId);
    return this.changed(rundownId);
  }

  duplicateItem(rundownId: string, itemId: string): Rundown {
    const src = this.getItem(rundownId, itemId);
    return this.addItem(rundownId, { graphicId: src.graphicId, name: src.name, channelId: src.channelId, layer: src.layer, data: structuredClone(src.data), durationMs: src.durationMs, afterItemId: src.id });
  }

  reorder(rundownId: string, itemIds: string[]): Rundown {
    const r = this.get(rundownId);
    if (!Array.isArray(itemIds) || itemIds.length !== r.items.length || new Set(itemIds).size !== itemIds.length || !itemIds.every((id) => r.items.some((i) => i.id === id))) {
      throw badRequest('itemIds must contain every item of the rundown exactly once');
    }
    this.db.transaction((tx) => itemIds.forEach((id, pos) => tx.update(rundownItems).set({ position: pos }).where(eq(rundownItems.id, id)).run()));
    this.touch(rundownId);
    return this.changed(rundownId);
  }

  // ---------------- control ----------------

  /** The layer state if it currently holds an instance loaded from this item. */
  private layerOf(item: RundownItem): LayerState | undefined {
    const l = this.channels.getLayer(item.channelId, item.layer);
    return l?.source?.itemId === item.id ? l : undefined;
  }

  private notOnAir(item: RundownItem): HttpError {
    return new HttpError(409, `item "${item.name || item.graphicId}" is not loaded on ${item.channelId}/${item.layer}`);
  }

  async control(rundownId: string, itemId: string, action: ItemAction, opts: { skipAnimation?: boolean; advance?: boolean; transition?: 'out-in' | 'cut' } = {}): Promise<ItemOutcome> {
    const rundown = this.get(rundownId);
    const item = rundown.items.find((i) => i.id === itemId);
    if (!item) throw notFound(`rundown item "${itemId}"`);
    const skip = opts.skipAnimation !== undefined ? { skipAnimation: opts.skipAnimation } : {};
    let mine = this.layerOf(item);
    // A loaded (cued / out) instance of an older version of the graphic is reloaded on cue/take,
    // so new uploads take effect without clearing the channel. On-air instances are left alone.
    if (mine && mine.status !== 'playing' && (action === 'take' || action === 'cue')) {
      const latest = this.graphics.get(item.graphicId);
      if (latest && latest.packageId !== mine.graphic.packageId) mine = undefined;
    }
    let outcome: CommandOutcome | undefined;

    switch (action) {
      case 'cue':
        outcome = await this.loadItem(rundownId, item, mine, opts.transition ?? 'out-in');
        break;

      case 'take': {
        if (mine && mine.status === 'playing') {
          // Already on air: advance a multi-step graphic, otherwise nothing to do.
          if (hasStepControls(mine.graphic.stepCount)) outcome = await this.channels.play(item.channelId, item.layer, { delta: 1, ...skip });
          else return { statusCode: 200, statusMessage: 'already on air', graphicInstanceId: mine.graphicInstanceId, currentStep: mine.currentStep, cursorItemId: rundown.cursorItemId };
        } else {
          if (mine) {
            // cued earlier: bring the data up to date before playing
            if (JSON.stringify(mine.dataTemplate) !== JSON.stringify(item.data)) await this.channels.update(item.channelId, item.layer, item.data, { replace: true, skipAnimation: true });
          } else {
            const loaded = await this.loadItem(rundownId, item, undefined, opts.transition ?? 'out-in');
            if (loaded.statusCode >= 400) return { ...loaded, cursorItemId: rundown.cursorItemId };
          }
          outcome = await this.channels.play(item.channelId, item.layer, { goto: 0, ...skip });
          if (outcome.statusCode < 400) this.scheduleAutoOut(item);
        }
        let cursor = rundown.cursorItemId;
        if (opts.advance !== false) {
          const next = rundown.items[item.position + 1];
          cursor = next?.id ?? item.id;
          if (cursor !== rundown.cursorItemId) this.update(rundownId, { cursorItemId: cursor });
        }
        return { ...outcome, cursorItemId: cursor };
      }

      case 'next':
      case 'prev':
        if (!mine) throw this.notOnAir(item);
        outcome = await this.channels.play(item.channelId, item.layer, { delta: action === 'next' ? 1 : -1, ...skip });
        break;

      case 'out':
        if (!mine) throw this.notOnAir(item);
        outcome = await this.channels.stop(item.channelId, item.layer, skip);
        break;

      case 'update':
        if (!mine) throw this.notOnAir(item);
        outcome = await this.channels.update(item.channelId, item.layer, item.data, { replace: true, ...skip });
        break;

      case 'clear':
        if (!mine) throw this.notOnAir(item);
        await this.channels.clear(item.channelId, { layer: item.layer, graphicInstanceId: mine.graphicInstanceId });
        return { statusCode: 200, cursorItemId: rundown.cursorItemId };

      default:
        throw badRequest(`unknown action "${String(action)}"`);
    }
    return { ...outcome, cursorItemId: rundown.cursorItemId };
  }

  async customAction(rundownId: string, itemId: string, actionId: string, payload: unknown, opts: { skipAnimation?: boolean } = {}): Promise<ItemOutcome> {
    const item = this.getItem(rundownId, itemId);
    if (!this.layerOf(item)) throw this.notOnAir(item);
    const outcome = await this.channels.customAction(item.channelId, item.layer, actionId, payload, opts);
    return { ...outcome, cursorItemId: this.get(rundownId).cursorItemId };
  }

  /** Takes the cursor item (for automation / Companion). */
  async takeCursor(rundownId: string, opts: { skipAnimation?: boolean } = {}): Promise<ItemOutcome & { itemId?: string }> {
    const r = this.get(rundownId);
    const itemId = r.cursorItemId ?? r.items[0]?.id;
    if (!itemId) throw new HttpError(409, 'rundown is empty');
    return { ...(await this.control(rundownId, itemId, 'take', opts)), itemId };
  }

  private async loadItem(rundownId: string, item: RundownItem, mine: LayerState | undefined, transition: 'out-in' | 'cut'): Promise<CommandOutcome> {
    const current = mine ?? this.channels.getLayer(item.channelId, item.layer);
    // Another graphic on air on this layer: animate it out first (loading would cut it).
    if (transition === 'out-in' && current && current.status === 'playing') {
      await this.channels.stop(item.channelId, item.layer);
    }
    return this.channels.load(item.channelId, item.layer, item.graphicId, item.data, { source: { rundownId, itemId: item.id } });
  }

  private scheduleAutoOut(item: RundownItem) {
    if (!item.durationMs) return;
    const l = this.channels.getLayer(item.channelId, item.layer);
    if (!l) return;
    const key = `${item.channelId}\n${item.layer}\n${l.graphicInstanceId}`;
    clearTimeout(this.autoOut.get(key));
    this.autoOut.set(key, setTimeout(() => {
      this.autoOut.delete(key);
      const now = this.channels.getLayer(item.channelId, item.layer);
      if (now?.graphicInstanceId === l.graphicInstanceId && now.status === 'playing') void this.channels.stop(item.channelId, item.layer).catch(() => {});
    }, item.durationMs));
  }

  // ---------------- helpers ----------------

  private checkLayer(layer: unknown): number {
    if (typeof layer !== 'number' || !Number.isInteger(layer) || layer < 0 || layer > 999) throw badRequest('layer must be an integer between 0 and 999');
    return layer;
  }

  private checkDuration(ms: unknown): number | null {
    if (ms === null) return null;
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) throw badRequest('durationMs must be a positive number or null');
    return ms === 0 ? null : Math.round(ms);
  }

  private touch(rundownId: string) {
    this.db.update(rundowns).set({ updatedAt: Date.now() }).where(eq(rundowns.id, rundownId)).run();
  }

  private changed(rundownId: string): Rundown {
    const r = this.get(rundownId);
    this.emit('changed', r);
    this.emit('list', this.list());
    return r;
  }
}
