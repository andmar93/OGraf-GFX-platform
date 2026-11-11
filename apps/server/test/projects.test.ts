import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestServer } from './helpers.ts';

type B = Record<string, any>;
const doc = (o: B = {}) => ({ name: 'Score card', graphicId: 'user.score-card', fields: [], layers: [], ...o });

describe('editor projects', () => {
  let s: Awaited<ReturnType<typeof createTestServer>>;
  beforeAll(async () => { s = await createTestServer({ seed: false }); });
  afterAll(async () => { await s.close(); });

  it('creates, lists, reads, saves and deletes projects', async () => {
    const c = await api<B>(s.baseUrl, 'POST', '/api/v1/projects', { project: doc({ id: 'mine' }) });
    expect(c.status).toBe(201);
    expect(c.body.project.id).toBe('mine');
    // the same id again gets a new id
    const c2 = await api<B>(s.baseUrl, 'POST', '/api/v1/projects', { project: doc({ id: 'mine' }) });
    expect(c2.body.project.id).not.toBe('mine');
    const list = await api<B>(s.baseUrl, 'GET', '/api/v1/projects');
    expect(list.body.projects.map((p: B) => p.id)).toContain('mine');
    const u = await api<B>(s.baseUrl, 'PUT', '/api/v1/projects/mine', { project: doc({ name: 'Renamed', layers: [{ id: 'x' }] }) });
    expect(u.body.project).toMatchObject({ id: 'mine', name: 'Renamed' });
    expect((await api<B>(s.baseUrl, 'GET', '/api/v1/projects/mine')).body.project.layers).toHaveLength(1);
    expect((await api(s.baseUrl, 'DELETE', '/api/v1/projects/mine')).status).toBe(200);
    expect((await api(s.baseUrl, 'GET', '/api/v1/projects/mine')).status).toBe(404);
  });

  it('validates projects', async () => {
    expect((await api(s.baseUrl, 'POST', '/api/v1/projects', { project: { name: 'x' } })).status).toBe(400);
    expect((await api(s.baseUrl, 'POST', '/api/v1/projects', { project: doc({ graphicId: 'a/b' }) })).status).toBe(400);
    expect((await api(s.baseUrl, 'POST', '/api/v1/projects', { project: doc({ name: ' ' }) })).status).toBe(400);
    expect((await api(s.baseUrl, 'PUT', '/api/v1/projects/nope', { project: doc() })).status).toBe(404);
  });
});
