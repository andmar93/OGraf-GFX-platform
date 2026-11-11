/**
 * Applies server commands and snapshots to the layers of one channel.
 *
 * - load replaces whatever is on the layer (old instance is disposed and its iframe removed)
 * - snapshots are reconciled: instances that still exist are kept (no flicker on reconnect),
 *   others are created and brought to their state with skipAnimation.
 * - never throws: every failure becomes an ActionResult.
 */
import type { ActionResult } from '@ogp/ograf-core/host';
import type { ChannelState, CommandResult, GraphicRef, LayerState, LayerStatus, RendererCommand } from '@ogp/protocol';
import type { LayerMethod } from './layer-api.ts';

export interface LayerInstance {
  readonly graphicInstanceId: string;
  readonly graphic: GraphicRef;
  /** Resolves with the result of the graphic's load(). */
  readonly ready: Promise<ActionResult>;
  call(method: LayerMethod, params: Record<string, unknown>): Promise<ActionResult>;
  dispose(): Promise<void>;
}

export interface LayerFactoryOptions {
  layer: number;
  graphicInstanceId: string;
  graphic: GraphicRef;
  /** Already localized (clock anchors converted to local time). */
  data: Record<string, unknown>;
  channel: Pick<ChannelState, 'width' | 'height' | 'frameRate'>;
  onError: (message: string) => void;
}

export type LayerFactory = (opts: LayerFactoryOptions) => LayerInstance;

interface Entry {
  instance: LayerInstance;
  layer: number;
  /** Raw (server time base) data as last sent. */
  data: Record<string, unknown>;
  status: LayerStatus;
  currentStep: number | null;
  error?: string;
}

const toResult = (r: ActionResult): CommandResult => {
  const out: CommandResult = { statusCode: r.statusCode };
  if (r.statusMessage !== undefined) out.statusMessage = r.statusMessage;
  if (r.result !== undefined) out.result = r.result;
  if (r.currentStep !== undefined) out.currentStep = r.currentStep;
  return out;
};

export class ChannelRenderer {
  readonly layers = new Map<number, Entry>();
  channel: Pick<ChannelState, 'width' | 'height' | 'frameRate'> = { width: 1920, height: 1080, frameRate: 50 };

  constructor(
    private readonly factory: LayerFactory,
    private readonly localize: <T>(data: T) => T,
    private readonly reportError: (layer: number, graphicInstanceId: string, message: string) => void,
    private readonly onChange: () => void = () => {},
  ) {}

  private create(layer: number, graphicInstanceId: string, graphic: GraphicRef, data: Record<string, unknown>): Entry {
    const old = this.layers.get(layer);
    if (old) void this.remove(old);
    const entry: Entry = { layer, data, status: 'loaded', currentStep: null, instance: undefined as unknown as LayerInstance };
    entry.instance = this.factory({
      layer, graphicInstanceId, graphic, data: this.localize(data), channel: this.channel,
      onError: (message) => {
        entry.error = message;
        this.reportError(layer, graphicInstanceId, message);
        this.onChange();
      },
    });
    this.layers.set(layer, entry);
    void entry.instance.ready.then((r) => {
      if (r.statusCode >= 400) entry.error = r.statusMessage ?? `load failed (${r.statusCode})`;
      this.onChange();
    });
    this.onChange();
    return entry;
  }

  private async remove(entry: Entry) {
    if (this.layers.get(entry.layer) === entry) this.layers.delete(entry.layer);
    this.onChange();
    try {
      await entry.instance.dispose();
    } catch {
      /* dispose must never break the renderer */
    }
  }

  private track(entry: Entry, r: ActionResult): CommandResult {
    if (r.statusCode >= 400) entry.error = r.statusMessage ?? `failed (${r.statusCode})`;
    this.onChange();
    return toResult(r);
  }

  async execute(cmd: RendererCommand): Promise<CommandResult> {
    try {
      if (cmd.action === 'load') {
        const entry = this.create(cmd.layer, cmd.graphicInstanceId, cmd.graphic, cmd.params.data);
        return this.track(entry, await entry.instance.ready);
      }
      const entry = this.layers.get(cmd.layer);
      if (!entry || entry.instance.graphicInstanceId !== cmd.graphicInstanceId) {
        return cmd.action === 'clear' ? { statusCode: 200 } : { statusCode: 404, statusMessage: `graphic instance ${cmd.graphicInstanceId} is not loaded on layer ${cmd.layer}` };
      }
      switch (cmd.action) {
        case 'clear':
          await this.remove(entry);
          return { statusCode: 200 };
        case 'playAction': {
          const r = await entry.instance.call('playAction', cmd.params);
          if (r.statusCode < 400) {
            entry.currentStep = r.currentStep ?? null;
            entry.status = entry.currentStep === null && entry.instance.graphic.stepCount !== 0 ? 'stopped' : 'playing';
          }
          return this.track(entry, r);
        }
        case 'stopAction': {
          const r = await entry.instance.call('stopAction', cmd.params);
          if (r.statusCode < 400) {
            entry.status = 'stopped';
            entry.currentStep = null;
          }
          return this.track(entry, r);
        }
        case 'updateAction': {
          entry.data = { ...entry.data, ...cmd.params.data };
          const params = { ...cmd.params, data: this.localize(cmd.params.data) };
          return this.track(entry, await entry.instance.call('updateAction', params));
        }
        case 'customAction':
          return this.track(entry, await entry.instance.call('customAction', cmd.params));
      }
    } catch (err) {
      return { statusCode: 500, statusMessage: `renderer error: ${(err as Error).message}` };
    }
    return { statusCode: 400, statusMessage: 'unknown command' };
  }

  /** Brings the renderer in line with the server's authoritative state. */
  applySnapshot(state: ChannelState) {
    this.channel = { width: state.width, height: state.height, frameRate: state.frameRate };
    const wanted = new Map(state.layers.map((l) => [l.layer, l]));
    for (const entry of [...this.layers.values()]) {
      const w = wanted.get(entry.layer);
      if (!w || w.graphicInstanceId !== entry.instance.graphicInstanceId) void this.remove(entry);
    }
    for (const l of state.layers) {
      const entry = this.layers.get(l.layer);
      if (entry && entry.instance.graphicInstanceId === l.graphicInstanceId) this.reconcile(entry, l);
      else this.restore(l);
    }
    this.onChange();
  }

  /** Re-creates a layer from state (after page reload or for a missed load). */
  private restore(l: LayerState) {
    const entry = this.create(l.layer, l.graphicInstanceId, l.graphic, l.data);
    // stepCount 0 graphics play once and leave by themselves: do not replay them on recovery.
    if (l.status === 'playing' && l.graphic.stepCount !== 0) {
      entry.status = 'playing';
      entry.currentStep = l.currentStep;
      void entry.instance.call('playAction', { goto: l.currentStep ?? 0, skipAnimation: true });
    }
  }

  /** Corrects an existing instance (after reconnect) without reloading it. */
  private reconcile(entry: Entry, l: LayerState) {
    const changed: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(entry.data), ...Object.keys(l.data)])) {
      if (JSON.stringify(entry.data[k]) !== JSON.stringify(l.data[k])) changed[k] = l.data[k] ?? null;
    }
    if (Object.keys(changed).length) {
      entry.data = { ...l.data };
      void entry.instance.call('updateAction', { data: this.localize(changed), skipAnimation: true });
    }
    if (l.status === 'playing' && l.graphic.stepCount !== 0 && (entry.status !== 'playing' || entry.currentStep !== l.currentStep)) {
      entry.status = 'playing';
      entry.currentStep = l.currentStep;
      void entry.instance.call('playAction', { goto: l.currentStep ?? 0, skipAnimation: true });
    } else if (l.status !== 'playing' && entry.status === 'playing') {
      entry.status = l.status;
      entry.currentStep = null;
      void entry.instance.call('stopAction', { skipAnimation: true });
    }
  }

  /** Re-sends clock values after the time offset estimate changed noticeably. */
  relocalizeClocks(isClock: (v: unknown) => boolean) {
    for (const entry of this.layers.values()) {
      const clocks = Object.fromEntries(Object.entries(entry.data).filter(([, v]) => isClock(v) || (typeof v === 'object' && v !== null && JSON.stringify(v).includes('"$type":"clock"'))));
      if (Object.keys(clocks).length) void entry.instance.call('updateAction', { data: this.localize(clocks), skipAnimation: true });
    }
  }
}
