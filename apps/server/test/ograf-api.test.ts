import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestServer, FakeRenderer } from './helpers.ts';

type B = Record<string, any>;

describe('OGraf Server API adapter (/ograf/v1)', () => {
  let s: Awaited<ReturnType<typeof createTestServer>>;
  let renderer: FakeRenderer | undefined;
  beforeAll(async () => { s = await createTestServer(); });
  afterEach(async () => {
    await renderer?.close();
    renderer = undefined;
    await api(s.baseUrl, 'PUT', '/ograf/v1/renderers/main/target/graphicInstance/clear', { filters: [] });
  });
  afterAll(async () => { await s.close(); });

  const load = (layer: number, graphicId = 'ogp.scorebug', data: B = {}) =>
    api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/load', { renderTarget: { layer }, graphicId, params: { data } });

  it('returns server info', async () => {
    const r = await api<B>(s.baseUrl, 'GET', '/ograf/v1/');
    expect(r.body.name).toBeTruthy();
  });

  it('lists and gets graphics', async () => {
    const list = await api<B>(s.baseUrl, 'GET', '/ograf/v1/graphics');
    expect(list.body.graphics.find((g: B) => g.id === 'ogp.scorebug')).toMatchObject({ name: 'Scorebug – Football' });
    const one = await api<B>(s.baseUrl, 'GET', '/ograf/v1/graphics/ogp.scorebug');
    expect(one.body.graphic.$schema).toBe('https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json');
    expect(one.body.metadata.createdAt).toMatch(/^\d{4}-/);
    expect((await api(s.baseUrl, 'GET', '/ograf/v1/graphics/nope')).status).toBe(404);
  });

  it('lists renderers and describes one', async () => {
    const list = await api<B>(s.baseUrl, 'GET', '/ograf/v1/renderers');
    expect(list.body.renderers).toEqual([{ id: 'main', name: 'Main' }]);
    const r = await api<B>(s.baseUrl, 'GET', '/ograf/v1/renderers/main');
    expect(r.body.renderer).toMatchObject({
      id: 'main',
      status: { status: 'WARNING' },
      renderCharacteristics: { resolution: { width: 1920, height: 1080 } },
      renderTargetSchema: { required: ['layer'] },
    });
  });

  it('loads, plays, updates, stops and clears a GraphicInstance', async () => {
    renderer = new FakeRenderer();
    await renderer.connect(s.wsUrl, 'main');
    const loaded = await load(10, 'ogp.scorebug', { homeCode: 'IFK' });
    expect(loaded.status).toBe(200);
    expect(loaded.body).toMatchObject({ statusCode: 200 });
    const graphicInstanceId = loaded.body.graphicInstanceId;
    const base = { renderTarget: { layer: 10 }, graphicInstanceId };

    const play = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/playAction', { ...base, params: {} });
    expect(play.body).toMatchObject({ graphicInstanceId, statusCode: 200, currentStep: 0 });

    const target = await api<B>(s.baseUrl, 'GET', `/ograf/v1/renderers/main/target?renderTarget=${encodeURIComponent(JSON.stringify({ layer: 10 }))}`);
    expect(target.body).toMatchObject({ renderTarget: { layer: 10 }, graphicInstances: [{ graphicInstanceId, graphic: { id: 'ogp.scorebug' } }] });

    const upd = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/updateAction', { ...base, params: { data: { homeScore: 2 } } });
    expect(upd.body.statusCode).toBe(200);
    expect(renderer.commands.at(-1)).toMatchObject({ action: 'updateAction', params: { data: { homeScore: 2 } } });

    const custom = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/customActions/goal', { ...base, params: { payload: { team: 'home' } } });
    expect(custom.body.statusCode).toBe(200);

    const stop = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/stopAction', { ...base, params: { skipAnimation: true } });
    expect(stop.body.statusCode).toBe(200);

    const cleared = await api<B>(s.baseUrl, 'PUT', '/ograf/v1/renderers/main/target/graphicInstance/clear', { filters: [{ graphicInstanceId }] });
    expect(cleared.body.graphicInstances).toEqual([{ renderTarget: { layer: 10 }, graphicInstanceId }]);
    expect(renderer.commands.map((c) => c.action)).toEqual(['load', 'playAction', 'updateAction', 'customAction', 'stopAction', 'clear']);
  });

  it('clears by filters (render target / graphic id)', async () => {
    await load(10, 'ogp.scorebug');
    await load(20, 'ogp.lower-third');
    await load(30, 'ogp.lower-third');
    const byId = await api<B>(s.baseUrl, 'PUT', '/ograf/v1/renderers/main/target/graphicInstance/clear', { filters: [{ graphicId: 'ogp.lower-third' }] });
    expect(byId.body.graphicInstances.map((g: B) => g.renderTarget.layer).sort()).toEqual([20, 30]);
    const all = await api<B>(s.baseUrl, 'PUT', '/ograf/v1/renderers/main/target/graphicInstance/clear', { filters: [] });
    expect(all.body.graphicInstances.map((g: B) => g.renderTarget.layer)).toEqual([10]);
  });

  it('returns 404 for a wrong graphicInstanceId and 400 for a bad renderTarget', async () => {
    await load(10);
    const wrong = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/playAction', { renderTarget: { layer: 10 }, graphicInstanceId: 'nope', params: {} });
    expect(wrong.status).toBe(404);
    expect(wrong.body).toMatchObject({ status: 404 });
    const bad = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/load', { renderTarget: { bank: 1 }, graphicId: 'ogp.scorebug', params: { data: {} } });
    expect(bad.status).toBe(400);
    expect((await api(s.baseUrl, 'GET', '/ograf/v1/renderers/nope')).status).toBe(404);
  });

  it('maps errors thrown inside the graphic to HTTP 550', async () => {
    renderer = new FakeRenderer((cmd) => (cmd.action === 'playAction' ? { statusCode: 550, statusMessage: 'playAction() threw: boom' } : undefined));
    await renderer.connect(s.wsUrl, 'main');
    const loaded = await load(10);
    const play = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/playAction', { renderTarget: { layer: 10 }, graphicInstanceId: loaded.body.graphicInstanceId, params: {} });
    expect(play.status).toBe(550);
    expect(play.body.detail).toMatch(/boom/);
  });

  it('passes graphic status codes through in the body', async () => {
    renderer = new FakeRenderer((cmd) => (cmd.action === 'customAction' ? { statusCode: 400, statusMessage: 'nope' } : undefined));
    await renderer.connect(s.wsUrl, 'main');
    const loaded = await load(10);
    const r = await api<B>(s.baseUrl, 'POST', '/ograf/v1/renderers/main/target/graphicInstance/customActions/goal', { renderTarget: { layer: 10 }, graphicInstanceId: loaded.body.graphicInstanceId, params: { payload: {} } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ statusCode: 400, statusMessage: 'nope' });
  });

  it('serves thumbnails referenced in the manifest only', async () => {
    expect((await api(s.baseUrl, 'GET', '/ograf/v1/graphics/ogp.scorebug/thumbnail?file=../../etc/passwd')).status).toBe(404);
    expect((await api(s.baseUrl, 'GET', '/ograf/v1/graphics/ogp.scorebug/thumbnail')).status).toBe(400);
  });
});
