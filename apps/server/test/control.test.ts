import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChannelState, LayerState } from '@ogp/protocol';
import { api, createTestServer, FakeRenderer, waitFor } from './helpers.ts';

type Outcome = { statusCode: number; statusMessage?: string; graphicInstanceId: string; currentStep?: number | null; rendererCount: number; dataWarnings?: unknown[] };

describe('channel control (internal API + renderer WebSocket)', () => {
  let s: Awaited<ReturnType<typeof createTestServer>>;
  const renderers: FakeRenderer[] = [];
  const connect = async (behaviour?: ConstructorParameters<typeof FakeRenderer>[0], opts?: { preview?: boolean }) => {
    const r = new FakeRenderer(behaviour);
    await r.connect(s.wsUrl, 'main', opts);
    renderers.push(r);
    return r;
  };
  const layer = async (n: number) => (await api<{ layer: LayerState }>(s.baseUrl, 'GET', `/api/v1/channels/main/layers/${n}`)).body.layer;

  beforeAll(async () => { s = await createTestServer(); });
  afterEach(async () => {
    await Promise.all(renderers.splice(0).map((r) => r.close()));
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/clear');
  });
  afterAll(async () => { await s.close(); });

  it('has a default channel "main" at 1080p', async () => {
    const r = await api<{ channels: ChannelState[] }>(s.baseUrl, 'GET', '/api/v1/channels');
    expect(r.body.channels[0]).toMatchObject({ id: 'main', width: 1920, height: 1080 });
  });

  it('stores state even when no renderer is connected', async () => {
    const r = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/20/take', { graphicId: 'ogp.lower-third', data: { name: 'Jane' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ statusCode: 200, rendererCount: 0, currentStep: 0 });
    const l = await layer(20);
    expect(l).toMatchObject({ status: 'playing', currentStep: 0, data: { name: 'Jane', title: 'Head coach' } });
  });

  it('dispatches load/play/next/update/stop/clear and returns renderer results', async () => {
    const r = await connect();
    const load = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/load', { graphicId: 'ogp.lineup' });
    expect(load.body).toMatchObject({ statusCode: 200, rendererCount: 1 });
    const id = load.body.graphicInstanceId;
    expect((await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/take')).body.currentStep).toBe(0);
    expect((await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/next')).body.currentStep).toBe(1);
    expect((await layer(50)).currentStep).toBe(1);
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/update', { data: { teamName: 'Other FC' } });
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/out', { skipAnimation: true });
    expect((await layer(50))).toMatchObject({ status: 'stopped', currentStep: null });
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/clear');
    expect((await api(s.baseUrl, 'GET', '/api/v1/channels/main/layers/50')).status).toBe(404);

    expect(r.commands.map((c) => c.action)).toEqual(['load', 'playAction', 'playAction', 'updateAction', 'stopAction', 'clear']);
    expect(r.commands.every((c) => c.graphicInstanceId === id)).toBe(true);
    expect(r.commands[1]).toMatchObject({ params: { goto: 0 } });
    expect(r.commands[2]).toMatchObject({ params: { delta: 1 } });
    expect(r.commands[3]).toMatchObject({ params: { data: { teamName: 'Other FC' } } });
    expect(r.commands[4]).toMatchObject({ params: { skipAnimation: true } });
    const loadCmd = r.commands[0];
    expect(loadCmd?.action === 'load' && loadCmd.graphic.mainUrl).toMatch(/^\/packages\/.+\/graphic\.mjs$/);
  });

  it('plays a 2-step graphic to the end on the third take', async () => {
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/take', { graphicId: 'ogp.lineup' });
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/next');
    const end = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/50/next');
    expect(end.body.currentStep).toBeNull();
    expect((await layer(50)).status).toBe('stopped');
  });

  it('sends a snapshot so a (re)connecting renderer can recover', async () => {
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/take', { graphicId: 'ogp.scorebug', data: { homeCode: 'MFF' } });
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/20/load', { graphicId: 'ogp.lower-third' });
    const r = await connect();
    const snap = await waitFor(() => r.snapshots[0]);
    expect(snap.layers.map((l) => [l.layer, l.graphic.id, l.status, l.currentStep])).toEqual([
      [10, 'ogp.scorebug', 'playing', 0],
      [20, 'ogp.lower-third', 'loaded', null],
    ]);
    expect(snap.layers[0]?.data.homeCode).toBe('MFF');
  });

  it('records graphic errors reported by the renderer', async () => {
    await connect((cmd) => (cmd.action === 'playAction' ? { statusCode: 550, statusMessage: 'playAction() threw: boom' } : undefined));
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'ogp.scorebug' });
    const r = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/take');
    expect(r.body.statusCode).toBe(550);
    expect((await layer(10)).error?.message).toMatch(/boom/);
    // the next successful load clears the error
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'ogp.scorebug' });
    expect((await layer(10)).error).toBeUndefined();
  });

  it('records asynchronous layer errors', async () => {
    const r = await connect();
    const load = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'ogp.scorebug' });
    r.send({ type: 'renderer.layerError', layer: 10, graphicInstanceId: load.body.graphicInstanceId, message: 'Uncaught error in graphic: x is undefined' });
    await waitFor(async () => false, 50).catch(() => {});
    expect((await layer(10)).error?.message).toMatch(/x is undefined/);
  });

  it('times out when a renderer does not answer', async () => {
    await connect(() => ({ statusCode: -1 })); // never replies
    const r = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'ogp.scorebug' });
    expect(r.body.statusCode).toBe(503);
  });

  it('counts output renderers, not previews', async () => {
    await connect(undefined, { preview: true });
    const preview = renderers[0]!;
    const out = await connect();
    const r = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'ogp.scorebug' });
    expect(r.body.rendererCount).toBe(1);
    expect(preview.commands).toHaveLength(1);
    expect(out.commands).toHaveLength(1);
  });

  it('pushes bound data changes to graphics as partial updates', async () => {
    const r = await connect();
    await api(s.baseUrl, 'PUT', '/api/v1/data/match', { home: { score: 0, code: 'MFF' }, away: { score: 0 } });
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/take', {
      graphicId: 'ogp.scorebug',
      data: { homeCode: { $bind: 'match.home.code' }, homeScore: { $bind: 'match.home.score' }, awayScore: { $bind: 'match.away.score' }, clock: { $bind: 'match.clock' } },
    });
    expect((await layer(10)).data).toMatchObject({ homeCode: 'MFF', homeScore: 0 });

    r.commands.length = 0;
    await api(s.baseUrl, 'PUT', '/api/v1/data/match/home/score', 1);
    const upd = await waitFor(() => r.commands.find((c) => c.action === 'updateAction'));
    expect(upd).toMatchObject({ params: { data: { homeScore: 1 } } });
    expect(Object.keys((upd as { params: { data: object } }).params.data)).toEqual(['homeScore']);

    // clock start: one update with the anchor, no ticks
    r.commands.length = 0;
    await api(s.baseUrl, 'POST', '/api/v1/clock/start', { path: 'match.clock', limitMs: 45 * 60_000 });
    const clk = await waitFor(() => r.commands.find((c) => c.action === 'updateAction'));
    expect(clk).toMatchObject({ params: { data: { clock: { $type: 'clock', running: true, limitMs: 2_700_000 } } } });
    await new Promise((res) => setTimeout(res, 300));
    expect(r.commands.filter((c) => c.action === 'updateAction')).toHaveLength(1);

    // changes to unrelated paths do not trigger updates
    r.commands.length = 0;
    await api(s.baseUrl, 'PUT', '/api/v1/data/other/value', 5);
    await new Promise((res) => setTimeout(res, 50));
    expect(r.commands).toHaveLength(0);
  });

  it('coalesces several data changes into one update', async () => {
    const r = await connect();
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/take', { graphicId: 'ogp.scorebug', data: { homeScore: { $bind: 'm.h' }, awayScore: { $bind: 'm.a' } } });
    r.commands.length = 0;
    s.services.hub.set('m.h', 2);
    s.services.hub.set('m.a', 3);
    await waitFor(() => r.commands.length > 0);
    await new Promise((res) => setTimeout(res, 30));
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).toMatchObject({ params: { data: { homeScore: 2, awayScore: 3 } } });
  });

  it('validates data and reports warnings without blocking', async () => {
    const r = await api<Outcome>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'ogp.scorebug', data: { homeScore: 'lots' } });
    expect(r.status).toBe(200);
    expect(r.body.dataWarnings?.length).toBeGreaterThan(0);
  });

  it('rejects bad requests', async () => {
    expect((await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'nope' })).status).toBe(404);
    expect((await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/x/load', { graphicId: 'ogp.scorebug' })).status).toBe(400);
    expect((await api(s.baseUrl, 'POST', '/api/v1/channels/nope/layers/1/load', { graphicId: 'ogp.scorebug' })).status).toBe(404);
    expect((await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/77/next')).status).toBe(404);
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/load', { graphicId: 'ogp.scorebug' });
    expect((await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/custom/nope', {})).status).toBe(404);
  });

  it('runs custom actions', async () => {
    const r = await connect((cmd) => (cmd.action === 'customAction' ? { statusCode: 200, result: { ok: cmd.params.payload } } : undefined));
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/take', { graphicId: 'ogp.scorebug' });
    const res = await api<Outcome & { result: unknown }>(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/custom/goal', { payload: { team: 'away' } });
    expect(res.body.result).toEqual({ ok: { team: 'away' } });
    expect(r.commands.at(-1)).toMatchObject({ action: 'customAction', params: { id: 'goal', payload: { team: 'away' } } });
  });

  it('manages channels', async () => {
    const created = await api<{ channel: ChannelState }>(s.baseUrl, 'POST', '/api/v1/channels', { name: 'Stadium screen', id: 'stadium' });
    expect(created.status).toBe(201);
    expect((await api(s.baseUrl, 'POST', '/api/v1/channels', { name: 'x', id: 'stadium' })).status).toBe(409);
    expect((await api(s.baseUrl, 'POST', '/api/v1/channels', { name: 'x', id: 'Bad Id' })).status).toBe(400);
    expect((await api(s.baseUrl, 'DELETE', '/api/v1/channels/stadium')).status).toBe(200);
  });

  it('broadcasts state to controllers', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(s.wsUrl);
    const states: ChannelState[] = [];
    await new Promise<void>((res) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', role: 'controller' })); res(); }));
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'channel.state') states.push(m.channel); });
    await waitFor(() => states.length > 0);
    await api(s.baseUrl, 'POST', '/api/v1/channels/main/layers/10/take', { graphicId: 'ogp.scorebug' });
    await waitFor(() => states.some((c) => c.layers.some((l) => l.layer === 10 && l.status === 'playing')));
    ws.close();
  });

  it('answers time pings', async () => {
    const r = await connect();
    r.send({ type: 'time.ping', t0: 123 });
    const pong = await waitFor(() => r.messages.find((m) => m.type === 'time.pong'));
    expect(pong).toMatchObject({ t0: 123 });
  });
});
