import { describe, expect, it, vi } from 'vitest';
import { GraphicHost, normaliseResult, type GraphicLike } from '../src/index.ts';

const loadParams = { data: {}, renderType: 'realtime' as const, renderCharacteristics: {} };

function goodGraphic(): GraphicLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    load: async () => { calls.push('load'); return { statusCode: 200 }; },
    playAction: async () => { calls.push('play'); return undefined; },
    stopAction: async () => { calls.push('stop'); },
    updateAction: async () => { calls.push('update'); return { statusCode: 200, statusMessage: 'ok' }; },
    customAction: async () => ({ statusCode: 200, result: 42 }),
    dispose: async () => { calls.push('dispose'); },
  };
}

describe('normaliseResult', () => {
  it('treats undefined as 200', () => expect(normaliseResult(undefined)).toEqual({ statusCode: 200 }));
  it('keeps statusCode, statusMessage, result, currentStep', () => {
    expect(normaliseResult({ statusCode: 201, statusMessage: 'x', result: 1, currentStep: 2, junk: true })).toEqual({ statusCode: 201, statusMessage: 'x', result: 1, currentStep: 2 });
  });
  it('maps currentStep undefined to null', () => {
    expect(normaliseResult({ statusCode: 200, currentStep: undefined })).toEqual({ statusCode: 200, currentStep: null });
  });
});

describe('GraphicHost', () => {
  it('tracks the step model for a 2-step graphic', async () => {
    const host = new GraphicHost(goodGraphic(), { stepCount: 2 });
    expect((await host.load(loadParams)).statusCode).toBe(200);
    expect((await host.playAction()).currentStep).toBe(0);
    expect((await host.playAction({ delta: 1 })).currentStep).toBe(1);
    expect((await host.playAction({ delta: 1 })).currentStep).toBeNull();
    expect(host.lifecycle).toBe('stopped');
  });

  it('prefers the step reported by the graphic', async () => {
    const g = goodGraphic();
    g.playAction = async () => ({ statusCode: 200, currentStep: 7 });
    const host = new GraphicHost(g, { stepCount: -1 });
    await host.load(loadParams);
    expect((await host.playAction()).currentStep).toBe(7);
  });

  it('turns thrown errors into 550 results and reports them', async () => {
    const onError = vi.fn();
    const g = goodGraphic();
    g.playAction = () => { throw new Error('boom'); };
    const host = new GraphicHost(g, { onError });
    await host.load(loadParams);
    const r = await host.playAction();
    expect(r.statusCode).toBe(550);
    expect(r.statusMessage).toMatch(/boom/);
    expect(onError).toHaveBeenCalledWith('playAction', r);
  });

  it('turns rejections into 550 results', async () => {
    const g = goodGraphic();
    g.updateAction = async () => { throw new TypeError('bad data'); };
    const host = new GraphicHost(g);
    await host.load(loadParams);
    expect((await host.updateAction({ data: {} })).statusCode).toBe(550);
  });

  it('times out hanging calls', async () => {
    const g = goodGraphic();
    g.stopAction = () => new Promise(() => {});
    const host = new GraphicHost(g, { timeouts: { action: 30 } });
    await host.load(loadParams);
    const r = await host.stopAction();
    expect(r.statusCode).toBe(504);
  });

  it('times out a hanging load and refuses actions afterwards', async () => {
    const g = goodGraphic();
    g.load = () => new Promise(() => {});
    const host = new GraphicHost(g, { timeouts: { load: 20 } });
    expect((await host.load(loadParams)).statusCode).toBe(504);
    expect(host.lifecycle).toBe('error');
    expect((await host.playAction()).statusCode).toBe(409);
  });

  it('reports missing methods as 501', async () => {
    const g = goodGraphic();
    delete g.customAction;
    const host = new GraphicHost(g);
    await host.load(loadParams);
    expect((await host.customAction({ id: 'x', payload: null })).statusCode).toBe(501);
  });

  it('waits for load before calling actions', async () => {
    const g = goodGraphic();
    let release!: () => void;
    g.load = () => new Promise((res) => { release = () => { g.calls.push('load'); res(undefined); }; });
    const host = new GraphicHost(g);
    void host.load(loadParams);
    const play = host.playAction();
    await new Promise((r) => setTimeout(r, 10));
    expect(g.calls).toEqual([]);
    release();
    await play;
    expect(g.calls).toEqual(['load', 'play']);
  });

  it('does not serialise overlapping actions (stop while play is running)', async () => {
    const g = goodGraphic();
    g.playAction = () => new Promise((res) => setTimeout(() => res(undefined), 50));
    const host = new GraphicHost(g);
    await host.load(loadParams);
    const t0 = Date.now();
    const play = host.playAction();
    await new Promise((r) => setTimeout(r, 0));
    await host.stopAction();
    expect(Date.now() - t0).toBeLessThan(40);
    await play;
  });

  it('treats non-2xx returns as failures but does not throw', async () => {
    const onError = vi.fn();
    const g = goodGraphic();
    g.customAction = async () => ({ statusCode: 400, statusMessage: 'Unknown action' });
    const host = new GraphicHost(g, { onError });
    await host.load(loadParams);
    expect((await host.customAction({ id: 'x', payload: null })).statusCode).toBe(400);
    expect(onError).toHaveBeenCalled();
  });

  it('dispose is idempotent and survives a throwing dispose()', async () => {
    const g = goodGraphic();
    g.dispose = () => { throw new Error('nope'); };
    const host = new GraphicHost(g);
    await host.load(loadParams);
    expect((await host.dispose()).statusCode).toBe(550);
    expect(host.lifecycle).toBe('disposed');
    expect((await host.dispose()).statusCode).toBe(200);
  });
});
