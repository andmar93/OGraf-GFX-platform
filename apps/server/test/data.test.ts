import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestServer } from './helpers.ts';

type B = Record<string, any>;

describe('data hub API', () => {
  let s: Awaited<ReturnType<typeof createTestServer>>;
  beforeAll(async () => { s = await createTestServer({ seed: false }); });
  afterAll(async () => { await s.close(); });

  it('sets, gets, patches and deletes values by path', async () => {
    await api(s.baseUrl, 'PUT', '/api/v1/data/match', { home: { name: 'Home', score: 0 }, away: { name: 'Away', score: 0 } });
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/data/match/home/score')).body.value).toBe(0);
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/data/match.home.name')).body.value).toBe('Home');
    await api(s.baseUrl, 'PATCH', '/api/v1/data/match', { home: { score: 2 }, away: null });
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/data/match')).body.value).toEqual({ home: { name: 'Home', score: 2 } });
    await api(s.baseUrl, 'DELETE', '/api/v1/data/match/home');
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/data/match')).body.value).toEqual({});
  });

  it('rejects unsafe paths', async () => {
    expect((await api(s.baseUrl, 'PUT', '/api/v1/data/__proto__/x', 1)).status).toBe(400);
  });

  it('persists to the database', async () => {
    await api(s.baseUrl, 'PUT', '/api/v1/data/persisted/value', 42);
    const rows = s.services.db.query.dataRoots.findMany ? await s.services.db.query.dataRoots.findMany() : [];
    expect(rows.find((r) => r.key === 'persisted')?.value).toEqual({ value: 42 });
  });

  it('runs clocks as anchors', async () => {
    const start = await api<B>(s.baseUrl, 'POST', '/api/v1/clock/start', { path: 'match.clock', elapsedMs: 60_000, limitMs: 2_700_000, label: '1st half' });
    expect(start.body.clock).toMatchObject({ $type: 'clock', running: true, elapsedAtAnchorMs: 60_000, limitMs: 2_700_000, label: '1st half' });
    await new Promise((r) => setTimeout(r, 30));
    const stop = await api<B>(s.baseUrl, 'POST', '/api/v1/clock/stop', { path: 'match.clock' });
    expect(stop.body.clock.running).toBe(false);
    expect(stop.body.clock.elapsedAtAnchorMs).toBeGreaterThanOrEqual(60_020);
    const adj = await api<B>(s.baseUrl, 'POST', '/api/v1/clock/adjust', { path: 'match.clock', adjustMs: -20_000 });
    expect(adj.body.clock.elapsedAtAnchorMs).toBe(stop.body.clock.elapsedAtAnchorMs - 20_000);
    const reset = await api<B>(s.baseUrl, 'POST', '/api/v1/clock/reset', { path: 'match.clock' });
    expect(reset.body.clock).toMatchObject({ running: false, elapsedAtAnchorMs: 0 });
    expect((await api(s.baseUrl, 'POST', '/api/v1/clock/explode', { path: 'match.clock' })).status).toBe(400);
  });
});
