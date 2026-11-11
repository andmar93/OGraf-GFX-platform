import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { api, createTestServer } from './helpers.ts';

const manifest = (id: string, extra: Record<string, unknown> = {}) => strToU8(JSON.stringify({
  $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
  id, name: `Graphic ${id}`, main: 'graphic.mjs', supportsRealTime: true, supportsNonRealTime: false, ...extra,
}));
const js = strToU8('export default class extends HTMLElement {}');

async function upload(baseUrl: string, zip: Uint8Array, query = '') {
  const res = await fetch(`${baseUrl}/api/v1/graphics${query}`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: Buffer.from(zip) });
  return { status: res.status, body: await res.json() };
}

describe('graphics', () => {
  let s: Awaited<ReturnType<typeof createTestServer>>;
  beforeAll(async () => { s = await createTestServer(); });
  afterAll(async () => { await s.close(); });

  it('seeds the example graphics', async () => {
    const r = await api<{ graphics: { id: string }[] }>(s.baseUrl, 'GET', '/api/v1/graphics');
    expect(r.body.graphics.map((g) => g.id).sort()).toEqual(['ogp.event-banner', 'ogp.lineup', 'ogp.lower-third', 'ogp.scorebug']);
  });

  it('serves graphic files from the package store', async () => {
    const r = await api<{ graphic: { mainUrl: string; stepCount: number } }>(s.baseUrl, 'GET', '/api/v1/graphics/ogp.lineup');
    expect(r.body.graphic.stepCount).toBe(2);
    const file = await fetch(s.baseUrl + r.body.graphic.mainUrl);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toMatch(/javascript/);
    expect(file.headers.get('cache-control')).toMatch(/immutable/);
  });

  it('never lets browsers cache the HTML entry pages (they reference the current build)', async () => {
    for (const path of ['/render/main', '/render/main?preview=1', '/player/', '/data/', '/editor/', '/dev']) {
      const res = await fetch(s.baseUrl + path);
      expect([200, 503]).toContain(res.status);
      expect(res.headers.get('cache-control'), path).toBe('no-store');
      expect(res.headers.get('etag'), path).toBeNull();
      expect(res.headers.get('last-modified'), path).toBeNull();
    }
    // package files stay immutable
    const g = (await api<{ graphic: { mainUrl: string } }>(s.baseUrl, 'GET', '/api/v1/graphics/ogp.lineup')).body.graphic;
    expect((await fetch(s.baseUrl + g.mainUrl)).headers.get('cache-control')).toMatch(/immutable/);
  });

  it('imports a zip with a top-level folder (raw body)', async () => {
    const zip = zipSync({ 'my-graphic/a.ograf.json': manifest('test.a'), 'my-graphic/graphic.mjs': js });
    const r = await upload(s.baseUrl, zip);
    expect(r.status).toBe(201);
    expect(r.body.graphics[0]).toMatchObject({ id: 'test.a', imported: true, valid: true });
    // identical upload is idempotent
    const again = await upload(s.baseUrl, zip);
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
  });

  it('imports via multipart/form-data', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(zipSync({ 'b.ograf.json': manifest('test.b'), 'graphic.mjs': js }))]), 'b.zip');
    const res = await fetch(`${s.baseUrl}/api/v1/graphics`, { method: 'POST', body: form });
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('b.zip');
  });

  it('uses the latest upload of a graphic id', async () => {
    await upload(s.baseUrl, zipSync({ 'v.ograf.json': manifest('test.v', { version: '1' }), 'graphic.mjs': js }));
    await upload(s.baseUrl, zipSync({ 'v.ograf.json': manifest('test.v', { version: '2' }), 'graphic.mjs': strToU8('export default class extends HTMLElement { x = 2 }') }));
    const r = await api<{ graphic: { version: string } }>(s.baseUrl, 'GET', '/api/v1/graphics/test.v');
    expect(r.body.graphic.version).toBe('2');
    const list = await api<{ graphics: { id: string }[] }>(s.baseUrl, 'GET', '/api/v1/graphics');
    expect(list.body.graphics.filter((g) => g.id === 'test.v')).toHaveLength(1);
  });

  it('rejects invalid packages with readable errors', async () => {
    const bad = await upload(s.baseUrl, zipSync({ 'x.ograf.json': manifest('test.x', { foo: 1 }), 'graphic.mjs': js }));
    expect(bad.status).toBe(400);
    expect(bad.body.details.graphics[0].errors[0].message).toMatch(/unknown property "foo"/);

    const noMain = await upload(s.baseUrl, zipSync({ 'x.ograf.json': manifest('test.x') }));
    expect(noMain.status).toBe(400);

    const notZip = await upload(s.baseUrl, strToU8('hello'));
    expect(notZip.status).toBe(400);
  });

  it('imports only valid graphics with force=true', async () => {
    const zip = zipSync({
      'ok/ok.ograf.json': manifest('test.ok'), 'ok/graphic.mjs': js,
      'bad/bad.ograf.json': manifest('test.bad', { supportsRealTime: 'yes' }), 'bad/graphic.mjs': js,
    });
    expect((await upload(s.baseUrl, zip)).status).toBe(400);
    const r = await upload(s.baseUrl, zip, '?force=true');
    expect(r.status).toBe(201);
    expect(r.body.graphics.map((g: { id: string; imported: boolean }) => [g.id, g.imported])).toEqual([['test.bad', false], ['test.ok', true]]);
  });

  it('unlists on delete and removes files with force', async () => {
    const zip = zipSync({ 'd.ograf.json': manifest('test.d'), 'graphic.mjs': js });
    const up = await upload(s.baseUrl, zip);
    expect((await api(s.baseUrl, 'DELETE', '/api/v1/graphics/test.d')).status).toBe(200);
    expect((await api(s.baseUrl, 'GET', '/api/v1/graphics/test.d')).status).toBe(404);
    // files still served (on-air safety)
    expect((await fetch(`${s.baseUrl}/packages/${up.body.packageId}/graphic.mjs`)).status).toBe(200);
    expect((await api(s.baseUrl, 'DELETE', '/api/v1/graphics/test.d?force=true')).status).toBe(200);
    expect((await fetch(`${s.baseUrl}/packages/${up.body.packageId}/graphic.mjs`)).status).toBe(404);
  });
});
