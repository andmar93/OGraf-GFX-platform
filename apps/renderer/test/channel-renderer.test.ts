import { describe, expect, it } from 'vitest';
import type { ChannelState, GraphicRef, LayerState } from '@ogp/protocol';
import { ChannelRenderer, type LayerFactory, type LayerInstance } from '../src/channel-renderer.ts';

const graphic = (stepCount = 1): GraphicRef => ({ id: 'g', name: 'G', packageId: 'p', mainUrl: '/x.mjs', stepCount, supportsRealTime: true, supportsNonRealTime: false });

function setup(opts: { loadStatus?: number } = {}) {
  const log: string[] = [];
  const created: string[] = [];
  const disposed: string[] = [];
  const factory: LayerFactory = (o) => {
    created.push(o.graphicInstanceId);
    const inst: LayerInstance = {
      graphicInstanceId: o.graphicInstanceId,
      graphic: o.graphic,
      ready: Promise.resolve({ statusCode: opts.loadStatus ?? 200 }),
      async call(method, params) {
        log.push(`${o.graphicInstanceId}:${method}:${JSON.stringify(params)}`);
        if (method === 'playAction') return { statusCode: 200, currentStep: (params.goto as number | undefined) ?? 0 };
        return { statusCode: 200 };
      },
      async dispose() { disposed.push(o.graphicInstanceId); },
    };
    return inst;
  };
  const renderer = new ChannelRenderer(factory, (d) => d, () => {});
  return { renderer, log, created, disposed };
}

const layer = (l: Partial<LayerState> & { graphicInstanceId: string; layer: number }): LayerState => ({
  graphic: graphic(), dataTemplate: {}, data: {}, status: 'loaded', currentStep: null, updatedAt: 0, ...l,
});
const snapshot = (layers: LayerState[]): ChannelState => ({ id: 'main', name: 'Main', width: 1920, height: 1080, frameRate: 50, layers, revision: 1, renderers: [] });

describe('ChannelRenderer', () => {
  it('load replaces the instance on the same layer', async () => {
    const { renderer, disposed } = setup();
    await renderer.execute({ action: 'load', layer: 10, graphicInstanceId: 'a', graphic: graphic(), params: { data: {} } });
    await renderer.execute({ action: 'load', layer: 10, graphicInstanceId: 'b', graphic: graphic(), params: { data: {} } });
    expect(disposed).toEqual(['a']);
    expect(renderer.layers.get(10)?.instance.graphicInstanceId).toBe('b');
  });

  it('rejects commands for unknown instances', async () => {
    const { renderer } = setup();
    const r = await renderer.execute({ action: 'playAction', layer: 1, graphicInstanceId: 'nope', params: {} });
    expect(r.statusCode).toBe(404);
  });

  it('reports load failures', async () => {
    const { renderer } = setup({ loadStatus: 550 });
    const r = await renderer.execute({ action: 'load', layer: 1, graphicInstanceId: 'a', graphic: graphic(), params: { data: {} } });
    expect(r.statusCode).toBe(550);
    expect(renderer.layers.get(1)?.error).toBeTruthy();
  });

  it('restores playing layers from a snapshot with skipAnimation', () => {
    const { renderer, log, created } = setup();
    renderer.applySnapshot(snapshot([
      layer({ layer: 10, graphicInstanceId: 'a', status: 'playing', currentStep: 1, graphic: graphic(2) }),
      layer({ layer: 20, graphicInstanceId: 'b', status: 'loaded' }),
    ]));
    expect(created).toEqual(['a', 'b']);
    expect(log).toEqual(['a:playAction:{"goto":1,"skipAnimation":true}']);
  });

  it('does not replay stepCount 0 graphics on recovery', () => {
    const { renderer, log } = setup();
    renderer.applySnapshot(snapshot([layer({ layer: 1, graphicInstanceId: 'a', status: 'playing', graphic: graphic(0) })]));
    expect(log).toEqual([]);
  });

  it('keeps existing instances on reconnect and only fixes differences', async () => {
    const { renderer, log, created, disposed } = setup();
    await renderer.execute({ action: 'load', layer: 10, graphicInstanceId: 'a', graphic: graphic(), params: { data: { name: 'A', score: 1 } } });
    await renderer.execute({ action: 'playAction', layer: 10, graphicInstanceId: 'a', params: {} });
    await renderer.execute({ action: 'load', layer: 20, graphicInstanceId: 'old', graphic: graphic(), params: { data: {} } });
    log.length = 0;
    // while disconnected: score changed, layer 20 replaced
    renderer.applySnapshot(snapshot([
      layer({ layer: 10, graphicInstanceId: 'a', status: 'playing', currentStep: 0, data: { name: 'A', score: 2 } }),
      layer({ layer: 20, graphicInstanceId: 'new' }),
    ]));
    expect(created).toEqual(['a', 'old', 'new']);
    expect(disposed).toEqual(['old']);
    expect(log).toEqual(['a:updateAction:{"data":{"score":2},"skipAnimation":true}']);
  });

  it('stops instances that were taken out while disconnected', async () => {
    const { renderer, log } = setup();
    await renderer.execute({ action: 'load', layer: 10, graphicInstanceId: 'a', graphic: graphic(), params: { data: {} } });
    await renderer.execute({ action: 'playAction', layer: 10, graphicInstanceId: 'a', params: {} });
    log.length = 0;
    renderer.applySnapshot(snapshot([layer({ layer: 10, graphicInstanceId: 'a', status: 'stopped' })]));
    expect(log).toEqual(['a:stopAction:{"skipAnimation":true}']);
  });

  it('removes layers that no longer exist', async () => {
    const { renderer, disposed } = setup();
    await renderer.execute({ action: 'load', layer: 10, graphicInstanceId: 'a', graphic: graphic(), params: { data: {} } });
    renderer.applySnapshot(snapshot([]));
    expect(disposed).toEqual(['a']);
    expect(renderer.layers.size).toBe(0);
  });
});
