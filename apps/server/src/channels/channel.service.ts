/**
 * Authoritative channel/layer state. All control paths (internal API, OGraf Server API,
 * later rundowns and Companion) go through this service.
 *
 * State is updated optimistically when a command is issued (it represents what the operator
 * asked for), persisted, broadcast to controllers and then dispatched to renderers.
 * Renderers rebuild from this state after a reload/reconnect.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { getDefaultData, resolveTargetStep, validateGraphicData, type ValidationIssue } from '@ogp/ograf-core';
import {
  collectBindings, diffTopLevel, pathsOverlap, resolveBindings,
  type ChannelInfo, type ChannelState, type CommandResult, type LayerState, type RendererCommand,
} from '@ogp/protocol';
import type { Db } from '../db/client.ts';
import { channelLayers, channels } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import type { DataHub } from '../data/data-hub.ts';
import type { GraphicsService } from '../graphics/graphics.service.ts';
import type { Gateway } from '../renderers/gateway.ts';
import { Emitter } from '../events.ts';

export interface CommandOutcome extends CommandResult {
  graphicInstanceId: string;
  /** Number of output renderers that executed the command. */
  rendererCount: number;
  dataWarnings?: ValidationIssue[];
}

interface ChannelRuntime {
  info: ChannelInfo;
  layers: Map<number, LayerState>;
  revision: number;
}

type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);
const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class ChannelService extends Emitter<{ state: ChannelState; removed: { channelId: string } }> {
  private channels = new Map<string, ChannelRuntime>();
  /** Per-layer sequence numbers to avoid applying stale renderer results. */
  private seq = new Map<string, number>();
  private pendingBindingUpdates = new Set<string>();
  private bindingFlushScheduled = false;

  constructor(
    private readonly db: Db,
    private readonly graphics: GraphicsService,
    private readonly hub: DataHub,
    private readonly gateway: Gateway,
    private readonly opts: { defaultChannel: { width: number; height: number; frameRate: number }; timeouts: { loadMs: number; actionMs: number } },
  ) {
    super();
    for (const row of db.select().from(channels).orderBy(asc(channels.sortOrder), asc(channels.createdAt)).all()) {
      const info: ChannelInfo = { id: row.id, name: row.name, width: row.width, height: row.height, frameRate: row.frameRate };
      if (row.description) info.description = row.description;
      this.channels.set(row.id, { info, layers: new Map(), revision: 0 });
    }
    for (const row of db.select().from(channelLayers).all()) {
      this.channels.get(row.channelId)?.layers.set(row.layer, row.state as LayerState);
    }
    if (this.channels.size === 0) this.createChannel({ id: 'main', name: 'Main' });

    hub.on('change', ({ path }) => this.onDataChange(path));
    gateway.on('renderersChanged', ({ channelId }) => {
      if (this.channels.has(channelId)) this.publish(channelId, false);
    });
    gateway.on('layerError', (e) => {
      const layer = this.channels.get(e.channelId)?.layers.get(e.layer);
      if (layer && layer.graphicInstanceId === e.graphicInstanceId) {
        layer.error = { message: e.message, statusCode: e.statusCode, at: Date.now() };
        this.persistLayer(e.channelId, layer);
        this.publish(e.channelId, false);
      }
    });
  }

  // ---------------- channels ----------------

  list(): ChannelState[] {
    return [...this.channels.keys()].map((id) => this.getState(id)!);
  }

  getState(channelId: string): ChannelState | undefined {
    const ch = this.channels.get(channelId);
    if (!ch) return undefined;
    return {
      ...ch.info,
      layers: [...ch.layers.values()].sort((a, b) => a.layer - b.layer),
      revision: ch.revision,
      renderers: this.gateway.rendererInfo(channelId),
    };
  }

  require(channelId: string): ChannelRuntime {
    const ch = this.channels.get(channelId);
    if (!ch) throw notFound(`channel "${channelId}"`);
    return ch;
  }

  createChannel(input: { id?: string; name: string; description?: string; width?: number; height?: number; frameRate?: number }): ChannelState {
    const id = input.id ?? (input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || randomUUID().slice(0, 8));
    if (!CHANNEL_ID_RE.test(id)) throw badRequest('channel id must be lowercase letters, digits, "-" or "_"');
    if (this.channels.has(id)) throw new HttpError(409, `channel "${id}" already exists`);
    const d = this.opts.defaultChannel;
    const info: ChannelInfo = { id, name: input.name, width: input.width ?? d.width, height: input.height ?? d.height, frameRate: input.frameRate ?? d.frameRate };
    if (input.description) info.description = input.description;
    this.db.insert(channels).values({ ...info, description: info.description ?? null, sortOrder: this.channels.size, createdAt: Date.now() }).run();
    this.channels.set(id, { info, layers: new Map(), revision: 0 });
    const state = this.getState(id)!;
    this.gateway.sendSnapshot(id, state); // renderers may already be waiting for this id
    this.emit('state', state);
    return state;
  }

  updateChannel(channelId: string, patch: { name?: string; description?: string; frameRate?: number }): ChannelState {
    const ch = this.require(channelId);
    if (patch.name !== undefined) ch.info.name = patch.name;
    if (patch.description !== undefined) ch.info.description = patch.description;
    if (patch.frameRate !== undefined) ch.info.frameRate = patch.frameRate;
    this.db.update(channels).set({ name: ch.info.name, description: ch.info.description ?? null, frameRate: ch.info.frameRate }).where(eq(channels.id, channelId)).run();
    return this.publish(channelId, false);
  }

  async deleteChannel(channelId: string): Promise<void> {
    this.require(channelId);
    await this.clear(channelId, {});
    this.db.delete(channels).where(eq(channels.id, channelId)).run();
    this.channels.delete(channelId);
    this.emit('removed', { channelId });
  }

  // ---------------- layer commands ----------------

  private layerOrThrow(channelId: string, layer: number, graphicInstanceId?: string): LayerState {
    const l = this.require(channelId).layers.get(layer);
    if (!l) throw notFound(`graphic instance on layer ${layer}`);
    if (graphicInstanceId !== undefined && l.graphicInstanceId !== graphicInstanceId) throw notFound(`graphic instance "${graphicInstanceId}" on layer ${layer}`);
    return l;
  }

  private resolveData(graphicId: string, template: Data): Data {
    const rec = this.graphics.get(graphicId);
    const defaults = rec ? getDefaultData(rec.manifest.schema) : {};
    return { ...defaults, ...(resolveBindings(template, this.hub.getRoot()) as Data) };
  }

  getLayer(channelId: string, layer: number): LayerState | undefined {
    return this.require(channelId).layers.get(layer);
  }

  /** Loads (cues) a graphic on a layer, replacing whatever was there. */
  async load(channelId: string, layer: number, graphicId: string, dataTemplate: unknown = {}): Promise<CommandOutcome> {
    this.require(channelId);
    if (!Number.isInteger(layer) || layer < 0 || layer > 999) throw badRequest('layer must be an integer between 0 and 999');
    if (!isObject(dataTemplate)) throw badRequest('data must be an object');
    const rec = this.graphics.get(graphicId);
    if (!rec) throw notFound(`graphic "${graphicId}"`);
    if (!rec.manifest.supportsRealTime) throw badRequest(`graphic "${graphicId}" does not support real-time rendering`);

    const data = this.resolveData(graphicId, dataTemplate);
    const validation = validateGraphicData(rec.manifest.schema as object | undefined, data);
    const state: LayerState = {
      layer,
      graphicInstanceId: randomUUID(),
      graphic: this.graphics.toRef(rec),
      dataTemplate,
      data,
      status: 'loaded',
      currentStep: null,
      updatedAt: Date.now(),
    };
    this.require(channelId).layers.set(layer, state);
    this.persistLayer(channelId, state);
    this.publish(channelId);

    const outcome = await this.run(channelId, state, {
      action: 'load', layer, graphicInstanceId: state.graphicInstanceId, graphic: state.graphic, params: { data },
    }, this.opts.timeouts.loadMs);
    if (!validation.valid) outcome.dataWarnings = validation.errors;
    return outcome;
  }

  async play(channelId: string, layer: number, params: { goto?: number; delta?: number; skipAnimation?: boolean } = {}, graphicInstanceId?: string): Promise<CommandOutcome> {
    const l = this.layerOrThrow(channelId, layer, graphicInstanceId);
    const stepCount = l.graphic.stepCount;
    const target = resolveTargetStep(l.currentStep, stepCount, params);
    l.currentStep = target ?? null;
    l.status = target === undefined && stepCount !== 0 ? 'stopped' : 'playing';
    l.updatedAt = Date.now();
    this.persistLayer(channelId, l);
    this.publish(channelId);
    const clean: { goto?: number; delta?: number; skipAnimation?: boolean } = {};
    if (params.goto !== undefined) clean.goto = params.goto;
    if (params.delta !== undefined) clean.delta = params.delta;
    if (params.skipAnimation !== undefined) clean.skipAnimation = params.skipAnimation;
    return this.run(channelId, l, { action: 'playAction', layer, graphicInstanceId: l.graphicInstanceId, params: clean }, this.opts.timeouts.actionMs, (r) => {
      // The graphic is authoritative for its step (e.g. stepCount -1).
      if (r.currentStep !== undefined && r.currentStep !== l.currentStep) {
        l.currentStep = r.currentStep;
        l.status = r.currentStep === null && stepCount !== 0 ? 'stopped' : 'playing';
        return true;
      }
      return false;
    });
  }

  async stop(channelId: string, layer: number, params: { skipAnimation?: boolean } = {}, graphicInstanceId?: string): Promise<CommandOutcome> {
    const l = this.layerOrThrow(channelId, layer, graphicInstanceId);
    l.status = 'stopped';
    l.currentStep = null;
    l.updatedAt = Date.now();
    this.persistLayer(channelId, l);
    this.publish(channelId);
    const clean = params.skipAnimation !== undefined ? { skipAnimation: params.skipAnimation } : {};
    return this.run(channelId, l, { action: 'stopAction', layer, graphicInstanceId: l.graphicInstanceId, params: clean }, this.opts.timeouts.actionMs);
  }

  /**
   * Updates data. By default `data` is merged into the existing data template (top-level keys);
   * with `replace` it replaces the template. Only changed keys are sent to the graphic.
   */
  async update(channelId: string, layer: number, data: unknown, opts: { skipAnimation?: boolean; replace?: boolean } = {}, graphicInstanceId?: string): Promise<CommandOutcome> {
    if (!isObject(data)) throw badRequest('data must be an object');
    const l = this.layerOrThrow(channelId, layer, graphicInstanceId);
    l.dataTemplate = opts.replace ? data : { ...l.dataTemplate, ...data };
    const next = this.resolveData(l.graphic.id, l.dataTemplate);
    // Send every key the caller mentioned (even if unchanged), plus keys changed via bindings/replace.
    const partial: Data = { ...(diffTopLevel(l.data, next) ?? {}) };
    for (const k of Object.keys(data)) partial[k] = next[k] ?? null;
    l.data = next;
    l.updatedAt = Date.now();
    this.persistLayer(channelId, l);
    this.publish(channelId);
    const rec = this.graphics.get(l.graphic.id);
    const validation = validateGraphicData(rec?.manifest.schema as object | undefined, next);
    const params: { data: Data; skipAnimation?: boolean } = { data: partial };
    if (opts.skipAnimation !== undefined) params.skipAnimation = opts.skipAnimation;
    const outcome = await this.run(channelId, l, { action: 'updateAction', layer, graphicInstanceId: l.graphicInstanceId, params }, this.opts.timeouts.actionMs);
    if (!validation.valid) outcome.dataWarnings = validation.errors;
    return outcome;
  }

  async customAction(channelId: string, layer: number, id: string, payload: unknown, opts: { skipAnimation?: boolean } = {}, graphicInstanceId?: string): Promise<CommandOutcome> {
    const l = this.layerOrThrow(channelId, layer, graphicInstanceId);
    const rec = this.graphics.get(l.graphic.id);
    if (rec && !(rec.manifest.customActions ?? []).some((a) => a.id === id)) throw notFound(`custom action "${id}" in graphic "${l.graphic.id}"`);
    const params: { id: string; payload: unknown; skipAnimation?: boolean } = { id, payload: payload ?? null };
    if (opts.skipAnimation !== undefined) params.skipAnimation = opts.skipAnimation;
    return this.run(channelId, l, { action: 'customAction', layer, graphicInstanceId: l.graphicInstanceId, params }, this.opts.timeouts.actionMs);
  }

  /** Removes graphic instances (dispose) matching the filter; empty filter clears the channel. */
  async clear(channelId: string, filter: { layer?: number; graphicId?: string; graphicInstanceId?: string }): Promise<{ layer: number; graphicInstanceId: string }[]> {
    const ch = this.require(channelId);
    const targets = [...ch.layers.values()].filter((l) =>
      (filter.layer === undefined || l.layer === filter.layer)
      && (filter.graphicId === undefined || l.graphic.id === filter.graphicId)
      && (filter.graphicInstanceId === undefined || l.graphicInstanceId === filter.graphicInstanceId));
    for (const l of targets) {
      ch.layers.delete(l.layer);
      this.db.delete(channelLayers).where(and(eq(channelLayers.channelId, channelId), eq(channelLayers.layer, l.layer))).run();
    }
    if (targets.length) this.publish(channelId);
    await Promise.all(targets.map((l) => this.gateway.dispatch(channelId, { action: 'clear', layer: l.layer, graphicInstanceId: l.graphicInstanceId }, this.opts.timeouts.actionMs)));
    return targets.map((l) => ({ layer: l.layer, graphicInstanceId: l.graphicInstanceId }));
  }

  reloadRenderers(channelId: string): number {
    this.require(channelId);
    return this.gateway.reloadRenderers(channelId);
  }

  // ---------------- internals ----------------

  private async run(channelId: string, layer: LayerState, command: RendererCommand, timeoutMs: number, reconcile?: (r: CommandResult) => boolean): Promise<CommandOutcome> {
    const key = `${channelId}:${layer.layer}`;
    const mySeq = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, mySeq);
    const { results, rendererCount } = await this.gateway.dispatch(channelId, command, timeoutMs);
    const failed = results.find((r) => r.statusCode >= 400);
    const chosen: CommandResult = failed ?? results[0] ?? { statusCode: 200, statusMessage: 'No renderer connected – state stored' };

    // Only touch state if this layer instance is still current and no newer command was issued.
    const current = this.channels.get(channelId)?.layers.get(layer.layer);
    if (current && current.graphicInstanceId === layer.graphicInstanceId && this.seq.get(key) === mySeq) {
      let changed = false;
      if (failed) {
        current.error = { message: failed.statusMessage ?? `${command.action} failed (${failed.statusCode})`, statusCode: failed.statusCode, at: Date.now() };
        changed = true;
      } else if (command.action === 'load' && current.error) {
        delete current.error;
        changed = true;
      }
      if (!failed && reconcile && results.length) changed = reconcile(chosen) || changed;
      if (changed) {
        this.persistLayer(channelId, current);
        this.publish(channelId);
      }
    }
    const out: CommandOutcome = { ...chosen, graphicInstanceId: layer.graphicInstanceId, rendererCount };
    if (command.action === 'playAction' && out.currentStep === undefined) out.currentStep = layer.currentStep;
    return out;
  }

  private onDataChange(path: string) {
    for (const [channelId, ch] of this.channels) {
      for (const l of ch.layers.values()) {
        if (collectBindings(l.dataTemplate).some((b) => pathsOverlap(b, path))) this.pendingBindingUpdates.add(`${channelId}\n${l.layer}`);
      }
    }
    if (this.pendingBindingUpdates.size && !this.bindingFlushScheduled) {
      this.bindingFlushScheduled = true;
      // Coalesce several data changes in the same tick into one updateAction per layer.
      setImmediate(() => this.flushBindingUpdates());
    }
  }

  private flushBindingUpdates() {
    this.bindingFlushScheduled = false;
    const keys = [...this.pendingBindingUpdates];
    this.pendingBindingUpdates.clear();
    const touched = new Set<string>();
    for (const key of keys) {
      const [channelId, layerStr] = key.split('\n') as [string, string];
      const l = this.channels.get(channelId)?.layers.get(Number(layerStr));
      if (!l) continue;
      const next = this.resolveData(l.graphic.id, l.dataTemplate);
      const diff = diffTopLevel(l.data, next);
      if (!diff) continue;
      l.data = next;
      l.updatedAt = Date.now();
      this.persistLayer(channelId, l);
      touched.add(channelId);
      void this.run(channelId, l, { action: 'updateAction', layer: l.layer, graphicInstanceId: l.graphicInstanceId, params: { data: diff } }, this.opts.timeouts.actionMs);
    }
    for (const channelId of touched) this.publish(channelId);
  }

  private persistLayer(channelId: string, state: LayerState) {
    this.db.insert(channelLayers).values({ channelId, layer: state.layer, state })
      .onConflictDoUpdate({ target: [channelLayers.channelId, channelLayers.layer], set: { state } }).run();
  }

  private publish(channelId: string, bump = true): ChannelState {
    const ch = this.require(channelId);
    if (bump) ch.revision++;
    const state = this.getState(channelId)!;
    this.emit('state', state);
    return state;
  }
}
