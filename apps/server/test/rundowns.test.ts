import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChannelState, LayerState, Rundown } from '@ogp/protocol';
import { api, createTestServer, FakeRenderer, waitFor } from './helpers.ts';

type B = Record<string, any>;

describe('rundowns', () => {
  let s: Awaited<ReturnType<typeof createTestServer>>;
  const renderers: FakeRenderer[] = [];
  beforeAll(async () => { s = await createTestServer(); });
  afterEach(async () => {
    await Promise.all(renderers.splice(0).map((r) => r.close()));
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/clear');
  });
  afterAll(async () => { await s.close(); });

  const create = async (name = 'Show') => (await api<{ rundown: Rundown }>(s.baseUrl, 'POST', '/api/v1/rundowns', { name })).body.rundown;
  const add = async (rid: string, body: B) => (await api<{ rundown: Rundown }>(s.baseUrl, 'POST', `/api/v1/rundowns/${rid}/items`, body));
  const ctl = (rid: string, iid: string, action: string, body: B = {}) => api<B>(s.baseUrl, 'POST', `/api/v1/rundowns/${rid}/items/${iid}/${action}`, body);
  const layer = async (n: number) => (await api<{ channel: ChannelState }>(s.baseUrl, 'GET', '/api/v1/channels/main')).body.channel.layers.find((l) => l.layer === n) as LayerState | undefined;

  it('creates, renames, lists, duplicates and deletes rundowns', async () => {
    const r = await create('Match night');
    expect(r).toMatchObject({ name: 'Match night', items: [], cursorItemId: null });
    await api(s.baseUrl, 'PATCH', `/api/v1/rundowns/${r.id}`, { name: 'Derby' });
    const list = await api<{ rundowns: B[] }>(s.baseUrl, 'GET', '/api/v1/rundowns');
    expect(list.body.rundowns.find((x) => x.id === r.id)).toMatchObject({ name: 'Derby', itemCount: 0 });
    await add(r.id, { graphicId: 'ogp.lower-third' });
    const dup = await api<{ rundown: Rundown }>(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.rundown).toMatchObject({ name: 'Derby (copy)' });
    expect(dup.body.rundown.items).toHaveLength(1);
    expect((await api(s.baseUrl, 'DELETE', `/api/v1/rundowns/${r.id}`)).status).toBe(200);
    expect((await api(s.baseUrl, 'GET', `/api/v1/rundowns/${r.id}`)).status).toBe(404);
    expect((await api(s.baseUrl, 'POST', '/api/v1/rundowns', { name: '  ' })).status).toBe(400);
  });

  it('adds items with defaults, binding hints and default layers', async () => {
    const r = await create();
    const sb = (await add(r.id, { graphicId: 'ogp.scorebug' })).body.rundown.items[0]!;
    expect(sb).toMatchObject({ channelId: 'main', layer: 10, position: 0, durationMs: null });
    expect(sb.data.homeScore).toEqual({ $bind: 'match.home.score', default: 0 });
    expect(sb.data.clock).toMatchObject({ $bind: 'match.clock' });
    const l3 = (await add(r.id, { graphicId: 'ogp.lower-third', data: { name: 'X' }, layer: 25 })).body.rundown.items[1]!;
    expect(l3).toMatchObject({ layer: 25, data: { name: 'X' } });
    // cursor is set to the first item
    expect((await api<{ rundown: Rundown }>(s.baseUrl, 'GET', `/api/v1/rundowns/${r.id}`)).body.rundown.cursorItemId).toBe(sb.id);
    expect((await add(r.id, { graphicId: 'nope' })).status).toBe(404);
    expect((await add(r.id, { graphicId: 'ogp.scorebug', layer: -1 })).status).toBe(400);
    expect((await add(r.id, { graphicId: 'ogp.scorebug', channelId: 'nope' })).status).toBe(404);
  });

  it('inserts after an item, duplicates, reorders and deletes items', async () => {
    const r = await create();
    const a = (await add(r.id, { graphicId: 'ogp.lower-third', name: 'A' })).body.rundown.items[0]!;
    await add(r.id, { graphicId: 'ogp.lower-third', name: 'C' });
    let items = (await add(r.id, { graphicId: 'ogp.lower-third', name: 'B', afterItemId: a.id })).body.rundown.items;
    expect(items.map((i) => i.name)).toEqual(['A', 'B', 'C']);
    items = (await api<{ rundown: Rundown }>(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/items/${a.id}/duplicate`)).body.rundown.items;
    expect(items.map((i) => i.name)).toEqual(['A', 'A', 'B', 'C']);
    const ids = items.map((i) => i.id).reverse();
    items = (await api<{ rundown: Rundown }>(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/reorder`, { itemIds: ids })).body.rundown.items;
    expect(items.map((i) => i.name)).toEqual(['C', 'B', 'A', 'A']);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2, 3]);
    expect((await api(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/reorder`, { itemIds: ids.slice(1) })).status).toBe(400);
    items = (await api<{ rundown: Rundown }>(s.baseUrl, 'DELETE', `/api/v1/rundowns/${r.id}/items/${items[1]!.id}`)).body.rundown.items;
    expect(items.map((i) => [i.name, i.position])).toEqual([['C', 0], ['A', 1], ['A', 2]]);
  });

  it('updates items', async () => {
    const r = await create();
    const it1 = (await add(r.id, { graphicId: 'ogp.lower-third' })).body.rundown.items[0]!;
    const res = await api<{ rundown: Rundown }>(s.baseUrl, 'PATCH', `/api/v1/rundowns/${r.id}/items/${it1.id}`, { name: 'Coach', data: { name: 'Anna' }, layer: 30, durationMs: 5000 });
    expect(res.body.rundown.items[0]).toMatchObject({ name: 'Coach', data: { name: 'Anna' }, layer: 30, durationMs: 5000 });
    expect((await api(s.baseUrl, 'PATCH', `/api/v1/rundowns/${r.id}/items/${it1.id}`, { data: [] })).status).toBe(400);
  });

  it('takes items, tags layers with their source and advances the cursor', async () => {
    const r = await create();
    const items = (await add(r.id, { graphicId: 'ogp.lower-third', data: { name: 'One' } })).body.rundown.items;
    const two = (await add(r.id, { graphicId: 'ogp.lower-third', data: { name: 'Two' } })).body.rundown.items[1]!;
    const one = items[0]!;
    const take = await ctl(r.id, one.id, 'take');
    expect(take.body).toMatchObject({ statusCode: 200, currentStep: 0, cursorItemId: two.id });
    const l = await layer(20);
    expect(l).toMatchObject({ status: 'playing', source: { rundownId: r.id, itemId: one.id }, data: { name: 'One' } });
    expect(l?.onAirSince).toBeGreaterThan(0);

    // take again on a 1-step graphic: no-op
    expect((await ctl(r.id, one.id, 'take')).body.statusMessage).toBe('already on air');
    // out
    expect((await ctl(r.id, one.id, 'out')).body.statusCode).toBe(200);
    expect((await layer(20))?.status).toBe('stopped');
    // next on an item that is not on air (other item on the layer) -> 409
    expect((await ctl(r.id, two.id, 'next')).status).toBe(409);
    // the cursor stays on the last item
    expect((await ctl(r.id, two.id, 'take')).body.cursorItemId).toBe(two.id);
    // take the cursor item via the rundown endpoint
    await api(s.baseUrl, 'PATCH', `/api/v1/rundowns/${r.id}`, { cursorItemId: one.id });
    const tc = await api<B>(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/take`);
    expect(tc.body).toMatchObject({ itemId: one.id, statusCode: 200 });
  });

  it('steps through multi-step items', async () => {
    const r = await create();
    const it1 = (await add(r.id, { graphicId: 'ogp.lineup' })).body.rundown.items[0]!;
    expect((await ctl(r.id, it1.id, 'take')).body.currentStep).toBe(0);
    expect((await ctl(r.id, it1.id, 'take')).body.currentStep).toBe(1); // take on air = next for multi-step
    expect((await ctl(r.id, it1.id, 'prev')).body.currentStep).toBe(0);
    expect((await ctl(r.id, it1.id, 'next')).body.currentStep).toBe(1);
    expect((await ctl(r.id, it1.id, 'next')).body.currentStep).toBeNull();
    expect((await layer(50))?.status).toBe('stopped');
  });

  it('cues, then takes with updated data', async () => {
    const renderer = new FakeRenderer();
    await renderer.connect(s.wsUrl, 'main');
    renderers.push(renderer);
    const r = await create();
    const it1 = (await add(r.id, { graphicId: 'ogp.lower-third', data: { name: 'Before' } })).body.rundown.items[0]!;
    await ctl(r.id, it1.id, 'cue');
    expect((await layer(20))?.status).toBe('loaded');
    await api(s.baseUrl, 'PATCH', `/api/v1/rundowns/${r.id}/items/${it1.id}`, { data: { name: 'After' } });
    renderer.commands.length = 0;
    await ctl(r.id, it1.id, 'take');
    expect(renderer.commands.map((c) => c.action)).toEqual(['updateAction', 'playAction']);
    expect(renderer.commands[0]).toMatchObject({ params: { data: { name: 'After' }, skipAnimation: true } });
    expect((await layer(20))?.data.name).toBe('After');
  });

  it('pushes live data updates of an on-air item', async () => {
    const renderer = new FakeRenderer();
    await renderer.connect(s.wsUrl, 'main');
    renderers.push(renderer);
    const r = await create();
    const it1 = (await add(r.id, { graphicId: 'ogp.lower-third', data: { name: 'A', title: 'T' } })).body.rundown.items[0]!;
    await ctl(r.id, it1.id, 'take');
    await api(s.baseUrl, 'PATCH', `/api/v1/rundowns/${r.id}/items/${it1.id}`, { data: { name: 'B', title: 'T' } });
    renderer.commands.length = 0;
    expect((await ctl(r.id, it1.id, 'update')).body.statusCode).toBe(200);
    expect(renderer.commands[0]).toMatchObject({ action: 'updateAction', params: { data: { name: 'B' } } });
  });

  it('animates the previous graphic out before loading a new one on the same layer', async () => {
    const renderer = new FakeRenderer();
    await renderer.connect(s.wsUrl, 'main');
    renderers.push(renderer);
    const r = await create();
    const items = (await add(r.id, { graphicId: 'ogp.lower-third', data: { name: 'One' } })).body.rundown.items;
    const two = (await add(r.id, { graphicId: 'ogp.lower-third', data: { name: 'Two' } })).body.rundown.items[1]!;
    await ctl(r.id, items[0]!.id, 'take');
    renderer.commands.length = 0;
    await ctl(r.id, two.id, 'take');
    expect(renderer.commands.map((c) => c.action)).toEqual(['stopAction', 'load', 'playAction']);
    renderer.commands.length = 0;
    await ctl(r.id, items[0]!.id, 'take', { transition: 'cut' });
    expect(renderer.commands.map((c) => c.action)).toEqual(['load', 'playAction']);
  });

  it('auto-outs items with a duration', async () => {
    const r = await create();
    const it1 = (await add(r.id, { graphicId: 'ogp.lower-third', durationMs: 150 })).body.rundown.items[0]!;
    await ctl(r.id, it1.id, 'take');
    expect((await layer(20))?.status).toBe('playing');
    await waitFor(async () => false, 10).catch(() => {});
    await new Promise((res) => setTimeout(res, 300));
    expect((await layer(20))?.status).toBe('stopped');
  });

  it('runs custom actions on on-air items only', async () => {
    const r = await create();
    const it1 = (await add(r.id, { graphicId: 'ogp.scorebug' })).body.rundown.items[0]!;
    expect((await api(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/items/${it1.id}/custom/goal`, { payload: { team: 'home' } })).status).toBe(409);
    await ctl(r.id, it1.id, 'take');
    expect((await api<B>(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/items/${it1.id}/custom/goal`, { payload: { team: 'home' } })).body.statusCode).toBe(200);
    expect((await ctl(r.id, it1.id, 'explode')).status).toBe(400);
  });

  it('takes all layers of a channel out', async () => {
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/take', { graphicId: 'ogp.scorebug' });
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/20/take', { graphicId: 'ogp.lower-third' });
    const r = await api<B>(s.baseUrl, 'POST', '/api/v1/channels/main/out-all');
    expect(r.body.stopped.map((x: B) => x.layer)).toEqual([10, 20]);
    expect((await layer(10))?.status).toBe('stopped');
  });

  it('broadcasts rundown changes to controllers', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(s.wsUrl);
    const msgs: B[] = [];
    await new Promise<void>((res) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', role: 'controller' })); res(); }));
    ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
    const r = await create('Broadcast');
    await waitFor(() => msgs.find((m) => m.type === 'rundown.changed' && m.rundown.id === r.id));
    await waitFor(() => msgs.find((m) => m.type === 'rundowns.changed' && m.rundowns.some((x: B) => x.id === r.id)));
    await api(s.baseUrl, 'DELETE', `/api/v1/rundowns/${r.id}`);
    await waitFor(() => msgs.find((m) => m.type === 'rundown.removed' && m.rundownId === r.id));
    ws.close();
  });
});
