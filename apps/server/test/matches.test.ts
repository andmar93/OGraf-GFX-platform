import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Rundown } from '@ogp/protocol';
import { api, createTestServer, FakeRenderer, waitFor } from './helpers.ts';

type B = Record<string, any>;

const squad = (code: string) => ({
  name: `${code} FC`, code, color: '#123456',
  players: Array.from({ length: 13 }, (_, i) => ({ id: `${code}${i + 1}`, number: i + 1, name: `${code} ${i + 1}` })),
  starters: Array.from({ length: 11 }, (_, i) => `${code}${i + 1}`),
  bench: [`${code}12`, `${code}13`],
});

describe('matches', () => {
  let s: Awaited<ReturnType<typeof createTestServer>>;
  const renderers: FakeRenderer[] = [];
  beforeAll(async () => { s = await createTestServer(); });
  afterEach(async () => { await Promise.all(renderers.splice(0).map((r) => r.close())); });
  afterAll(async () => { await s.close(); });

  const create = async (body: B = { home: squad('NBR'), away: squad('EPU') }) => (await api<{ match: B }>(s.baseUrl, 'POST', '/api/v1/matches', body)).body.match;
  const ev = (id: string, body: B) => api<{ match: B; title?: string }>(s.baseUrl, 'POST', `/api/v1/matches/${id}/events`, body);

  it('lists sports', async () => {
    const r = await api<{ sports: B[] }>(s.baseUrl, 'GET', '/api/v1/sports');
    expect(r.body.sports[0]).toMatchObject({ id: 'football', defaultSettings: { halfLengthMin: 45 } });
  });

  it('creates matches with normalised teams', async () => {
    const m = await create({ home: { name: ' Northbridge ', code: 'nbr', color: 'red', players: [{ number: '7', name: 'A' }, { name: 'B', id: 'b' }], starters: ['b', 'nope'] } });
    expect(m.name).toBe('Northbridge – Away');
    expect(m.home).toMatchObject({ name: 'Northbridge', code: 'NBR', color: '#d81e3c', starters: ['b'] });
    expect(m.home.players[0]).toMatchObject({ number: 7, name: 'A' });
    expect(m.home.players[0].id).toBeTruthy();
    expect(m.actions).toEqual([{ type: 'period.start', label: 'Kick-off', data: { period: 'H1' } }]);
    expect((await api(s.baseUrl, 'POST', '/api/v1/matches', { sport: 'curling' })).status).toBe(400);
  });

  it('records events, validates them and supports undo/redo/edit/delete', async () => {
    const m = await create();
    expect((await ev(m.id, { type: 'period.start', data: { period: 'H2' } })).status).toBe(422);
    await ev(m.id, { type: 'period.start', data: { period: 'H1' } });
    let r = await ev(m.id, { type: 'goal', team: 'home', data: { playerId: 'NBR9' } });
    expect(r.status).toBe(201);
    expect(r.body.match.published.home.score).toBe(1);
    r = await ev(m.id, { type: 'goal', team: 'away' });
    expect(r.body.match.published.away.score).toBe(1);
    expect((await ev(m.id, { type: 'goal', team: 'nobody' })).status).toBe(400);

    let u = await api<{ match: B }>(s.baseUrl, 'POST', `/api/v1/matches/${m.id}/undo`);
    expect(u.body.match.published.away.score).toBe(0);
    expect(u.body.match.canRedo).toBe(true);
    u = await api<{ match: B }>(s.baseUrl, 'POST', `/api/v1/matches/${m.id}/redo`);
    expect(u.body.match.published.away.score).toBe(1);
    expect(u.body.match.canRedo).toBe(false);

    // edit: change the scorer and the minute; invalid edits are rejected
    const goal = u.body.match.events.find((e: B) => e.type === 'goal' && e.team === 'home');
    let e = await api<{ match: B }>(s.baseUrl, 'PATCH', `/api/v1/matches/${m.id}/events/${goal.id}`, { data: { playerId: 'NBR10', minute: "12'" } });
    expect(e.body.match.published.events.lastGoal).toBeTruthy();
    expect(e.body.match.published.home.scorers).toEqual(["NBR 10 12'"]);
    expect((await api(s.baseUrl, 'PATCH', `/api/v1/matches/${m.id}/events/${goal.id}`, { data: { playerId: 'EPU1' } })).status).toBe(422);
    // switch team
    e = await api<{ match: B }>(s.baseUrl, 'PATCH', `/api/v1/matches/${m.id}/events/${goal.id}`, { team: 'away', data: { playerId: null } });
    expect(e.body.match.published.away.score).toBe(2);

    const del = await api<{ match: B }>(s.baseUrl, 'DELETE', `/api/v1/matches/${m.id}/events/${goal.id}`);
    expect(del.body.match.published.away.score).toBe(1);
    // a new event clears redo
    const after = await ev(m.id, { type: 'corner', team: 'home' });
    expect(after.body.match.canRedo).toBe(false);
  });

  it('publishes the active match to the data hub', async () => {
    const m = await create();
    await api(s.baseUrl, 'POST', `/api/v1/matches/${m.id}/activate`);
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/data/match/home/code')).body.value).toBe('NBR');
    await ev(m.id, { type: 'period.start', data: { period: 'H1' } });
    const clock = (await api<B>(s.baseUrl, 'GET', '/api/v1/data/match/clock')).body.value;
    expect(clock).toMatchObject({ $type: 'clock', running: true, limitMs: 2_700_000 });
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/matches/active')).body.match.id).toBe(m.id);
    // another match becomes active
    const m2 = await create({ home: squad('AAA'), away: squad('BBB') });
    await api(s.baseUrl, 'POST', `/api/v1/matches/${m2.id}/activate`);
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/data/match/home/code')).body.value).toBe('AAA');
    expect((await api<B>(s.baseUrl, 'GET', `/api/v1/matches/${m.id}`)).body.match.active).toBe(false);
    await api(s.baseUrl, 'POST', '/api/v1/matches/deactivate');
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/data/match')).body.value).toBeNull();
  });

  it('drives a bound scorebug on air: one goal = one partial update, no clock ticks', async () => {
    const renderer = new FakeRenderer();
    await renderer.connect(s.wsUrl, 'main');
    renderers.push(renderer);
    const m = await create();
    await api(s.baseUrl, 'POST', `/api/v1/matches/${m.id}/activate`);
    await ev(m.id, { type: 'period.start', data: { period: 'H1' } });
    const r = (await api<{ rundown: Rundown }>(s.baseUrl, 'POST', '/api/v1/rundowns', { name: 'R' })).body.rundown;
    const item = (await api<{ rundown: Rundown }>(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/items`, { graphicId: 'ogp.scorebug' })).body.rundown.items[0]!;
    await api(s.baseUrl, 'POST', `/api/v1/rundowns/${r.id}/items/${item.id}/take`, {});
    const load = renderer.commands.find((c) => c.action === 'load') as B;
    expect(load.params.data).toMatchObject({ homeCode: 'NBR', awayCode: 'EPU', homeScore: 0, clock: { running: true } });

    renderer.commands.length = 0;
    await ev(m.id, { type: 'goal', team: 'home', data: { playerId: 'NBR9' } });
    const upd = await waitFor(() => renderer.commands.find((c) => c.action === 'updateAction')) as B;
    expect(upd.params.data).toEqual({ homeScore: 1 });
    await new Promise((res) => setTimeout(res, 200));
    expect(renderer.commands.filter((c) => c.action === 'updateAction')).toHaveLength(1);

    // added time and half-time reach the scorebug
    renderer.commands.length = 0;
    await ev(m.id, { type: 'added_time', data: { minutes: 2 } });
    expect(((await waitFor(() => renderer.commands.find((c) => c.action === 'updateAction'))) as B).params.data).toEqual({ addedTime: 2 });
    renderer.commands.length = 0;
    await ev(m.id, { type: 'period.end', data: { period: 'H1' } });
    const ht = ((await waitFor(() => renderer.commands.find((c) => c.action === 'updateAction'))) as B).params.data;
    expect(ht).toMatchObject({ period: 'HT', addedTime: 0, clock: { running: false, elapsedAtAnchorMs: 2_700_000 } });
  });

  it('feeds the event banner from the last event', async () => {
    const m = await create();
    await api(s.baseUrl, 'POST', `/api/v1/matches/${m.id}/activate`);
    await ev(m.id, { type: 'period.start', data: { period: 'H1' } });
    await ev(m.id, { type: 'card', team: 'away', data: { card: 'yellow', playerId: 'EPU4' } });
    const last = (await api<B>(s.baseUrl, 'GET', '/api/v1/data/match/events/last')).body.value;
    expect(last).toMatchObject({ kind: 'yellow', teamName: 'EPU FC', playerName: 'EPU 4', playerNumber: 4, minute: "1'" });
  });

  it('keeps an automatic match name in sync with team names', async () => {
    const m = await create({ home: { name: 'A' }, away: { name: 'B' } });
    expect(m.name).toBe('A – B');
    let u = await api<{ match: B }>(s.baseUrl, 'PATCH', `/api/v1/matches/${m.id}`, { home: { name: 'Alpha' } });
    expect(u.body.match.name).toBe('Alpha – B');
    u = await api<{ match: B }>(s.baseUrl, 'PATCH', `/api/v1/matches/${m.id}`, { name: 'Cup final' });
    u = await api<{ match: B }>(s.baseUrl, 'PATCH', `/api/v1/matches/${m.id}`, { away: { name: 'Beta' } });
    expect(u.body.match.name).toBe('Cup final');
  });

  it('updates and deletes matches', async () => {
    const m = await create();
    const u = await api<{ match: B }>(s.baseUrl, 'PATCH', `/api/v1/matches/${m.id}`, { name: 'Derby', settings: { halfLengthMin: 40 }, away: { code: 'xyz' } });
    expect(u.body.match).toMatchObject({ name: 'Derby', settings: { halfLengthMin: 40, extraTimeHalfMin: 15 }, away: { code: 'XYZ', name: 'EPU FC' } });
    expect((await api(s.baseUrl, 'DELETE', `/api/v1/matches/${m.id}`)).status).toBe(200);
    expect((await api(s.baseUrl, 'GET', `/api/v1/matches/${m.id}`)).status).toBe(404);
  });

  it('uploads images for logos', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
    const res = await fetch(`${s.baseUrl}/api/v1/assets`, { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const { url } = await res.json();
    expect(url).toMatch(/^\/assets\/[0-9a-f]+\.png$/);
    expect((await fetch(s.baseUrl + url)).status).toBe(200);
    const bad = new FormData();
    bad.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
    expect((await fetch(`${s.baseUrl}/api/v1/assets`, { method: 'POST', body: bad })).status).toBe(400);
  });
});
