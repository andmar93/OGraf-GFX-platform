/**
 * Internal HTTP API (/api/v1): everything the OGraf Server API does not cover —
 * package upload, cue/take/next/out shortcuts, data hub and clocks.
 * Later phases add rundowns, matches and the Companion API here.
 */
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound } from '../errors.ts';
import type { ClockAction } from '../data/data-hub.ts';
import type { GraphicRecord } from '../graphics/graphics.service.ts';
import type { Services } from '../services.ts';
import type { ControlAdapter } from './control-adapter.ts';

type Body = Record<string, unknown>;
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const skipOf = (b: Body | undefined) => (bool(b?.skipAnimation) !== undefined ? { skipAnimation: bool(b?.skipAnimation)! } : {});
const toDataPath = (raw: string) => decodeURIComponent(raw).replace(/\//g, '.').replace(/^\.+|\.+$/g, '');

export function graphicDto(s: Services, g: GraphicRecord) {
  return {
    id: g.graphicId,
    name: g.name,
    description: g.manifest.description,
    version: g.version,
    packageId: g.packageId,
    manifestPath: g.manifestPath,
    mainUrl: s.graphics.fileUrl(g, g.manifest.main),
    stepCount: g.manifest.stepCount ?? 1,
    customActions: g.manifest.customActions ?? [],
    schema: g.manifest.schema ?? null,
    thumbnails: (g.manifest.thumbnails ?? []).map((t) => ({ ...t, url: s.graphics.fileUrl(g, t.file) })),
    manifest: g.manifest,
    warnings: g.warnings,
    createdAt: new Date(g.createdAt).toISOString(),
  };
}

export const internalApi: ControlAdapter = {
  name: 'Internal API v1',
  prefix: '/api/v1',
  register(app: FastifyInstance, s: Services) {
    const p = this.prefix;

    app.get(`${p}/health`, async () => ({ ok: true, serverTime: Date.now(), version: '0.1.0' }));
    app.get(`${p}/time`, async () => ({ serverTime: Date.now() }));

    // ---------- graphics ----------
    app.get(`${p}/graphics`, async () => ({ graphics: s.graphics.list().map((g) => graphicDto(s, g)) }));

    app.get<{ Params: { graphicId: string } }>(`${p}/graphics/:graphicId`, async (req) => {
      const g = s.graphics.get(req.params.graphicId);
      if (!g) throw notFound(`graphic "${req.params.graphicId}"`);
      return { graphic: graphicDto(s, g) };
    });

    /** Upload a zip: multipart/form-data (field "file") or a raw application/zip body. ?force=true imports valid graphics only. */
    app.post<{ Querystring: { force?: string; name?: string } }>(`${p}/graphics`, async (req, reply) => {
      const force = req.query.force === 'true';
      let buf: Buffer;
      let name = req.query.name ?? 'upload.zip';
      if (req.isMultipart()) {
        const file = await req.file();
        if (!file) throw badRequest('no file in upload');
        buf = await file.toBuffer();
        name = file.filename || name;
      } else if (Buffer.isBuffer(req.body)) {
        buf = req.body;
      } else {
        throw badRequest('send a zip as multipart/form-data (field "file") or with Content-Type: application/zip');
      }
      const report = await s.graphics.importZip(new Uint8Array(buf), name, { force });
      return reply.status(report.created ? 201 : 200).send(report);
    });

    app.delete<{ Params: { graphicId: string }; Querystring: { force?: string } }>(`${p}/graphics/:graphicId`, async (req) => {
      if (!(await s.graphics.delete(req.params.graphicId, req.query.force === 'true'))) throw notFound(`graphic "${req.params.graphicId}"`);
      return { ok: true };
    });

    // ---------- channels ----------
    app.get(`${p}/channels`, async () => ({ channels: s.channels.list() }));
    app.post<{ Body: Body }>(`${p}/channels`, async (req, reply) => {
      const b = req.body ?? {};
      if (typeof b.name !== 'string' || !b.name.trim()) throw badRequest('name is required');
      const input: Parameters<typeof s.channels.createChannel>[0] = { name: b.name.trim() };
      if (typeof b.id === 'string') input.id = b.id;
      if (typeof b.description === 'string') input.description = b.description;
      if (num(b.frameRate)) input.frameRate = num(b.frameRate)!;
      return reply.status(201).send({ channel: s.channels.createChannel(input) });
    });
    app.get<{ Params: { channelId: string } }>(`${p}/channels/:channelId`, async (req) => {
      const c = s.channels.getState(req.params.channelId);
      if (!c) throw notFound(`channel "${req.params.channelId}"`);
      return { channel: c };
    });
    app.patch<{ Params: { channelId: string }; Body: Body }>(`${p}/channels/:channelId`, async (req) => {
      const b = req.body ?? {};
      return {
        channel: s.channels.updateChannel(req.params.channelId, {
          ...(typeof b.name === 'string' ? { name: b.name } : {}),
          ...(typeof b.description === 'string' ? { description: b.description } : {}),
          ...(num(b.frameRate) ? { frameRate: num(b.frameRate)! } : {}),
        }),
      };
    });
    app.delete<{ Params: { channelId: string } }>(`${p}/channels/:channelId`, async (req) => {
      await s.channels.deleteChannel(req.params.channelId);
      return { ok: true };
    });
    app.post<{ Params: { channelId: string } }>(`${p}/channels/:channelId/clear`, async (req) => ({ cleared: await s.channels.clear(req.params.channelId, {}) }));
    app.post<{ Params: { channelId: string }; Body: Body }>(`${p}/channels/:channelId/out-all`, async (req) => ({ stopped: await s.channels.stopAll(req.params.channelId, skipOf(req.body)) }));
    app.post<{ Params: { channelId: string } }>(`${p}/channels/:channelId/reload-renderers`, async (req) => ({ renderers: s.channels.reloadRenderers(req.params.channelId) }));

    // ---------- layer control ----------
    type LP = { Params: { channelId: string; layer: string }; Body: Body };
    const layerOf = (raw: string) => {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw badRequest('layer must be a non-negative integer');
      return n;
    };
    const L = `${p}/channels/:channelId/layers/:layer`;

    app.get<LP>(L, async (req) => {
      const l = s.channels.getLayer(req.params.channelId, layerOf(req.params.layer));
      if (!l) throw notFound(`layer ${req.params.layer}`);
      return { layer: l };
    });

    const load = (req: { params: LP['Params']; body: Body }) => {
      const b = req.body ?? {};
      if (typeof b.graphicId !== 'string') throw badRequest('graphicId is required');
      return s.channels.load(req.params.channelId, layerOf(req.params.layer), b.graphicId, b.data ?? {});
    };
    app.post<LP>(`${L}/load`, async (req) => load(req));
    /** cue = load without playing */
    app.post<LP>(`${L}/cue`, async (req) => load(req));
    /** take: optionally loads a graphic first (when graphicId is given), then plays to step 0 / next step. */
    app.post<LP>(`${L}/take`, async (req) => {
      const b = req.body ?? {};
      const layer = layerOf(req.params.layer);
      if (typeof b.graphicId === 'string') {
        const loaded = await load(req);
        if (loaded.statusCode >= 400) return loaded;
        return s.channels.play(req.params.channelId, layer, { goto: 0, ...skipOf(b) });
      }
      const current = s.channels.getLayer(req.params.channelId, layer);
      if (!current) throw notFound(`graphic instance on layer ${layer}`);
      // Taking a graphic that is not on air starts from step 0; otherwise it behaves like "next".
      return s.channels.play(req.params.channelId, layer, current.status === 'playing' ? { delta: 1, ...skipOf(b) } : { goto: 0, ...skipOf(b) });
    });
    app.post<LP>(`${L}/play`, async (req) => {
      const b = req.body ?? {};
      return s.channels.play(req.params.channelId, layerOf(req.params.layer), {
        ...skipOf(b), ...(num(b.goto) !== undefined ? { goto: num(b.goto)! } : {}), ...(num(b.delta) !== undefined ? { delta: num(b.delta)! } : {}),
      });
    });
    app.post<LP>(`${L}/next`, async (req) => s.channels.play(req.params.channelId, layerOf(req.params.layer), { delta: 1, ...skipOf(req.body) }));
    app.post<LP>(`${L}/prev`, async (req) => s.channels.play(req.params.channelId, layerOf(req.params.layer), { delta: -1, ...skipOf(req.body) }));
    app.post<LP>(`${L}/stop`, async (req) => s.channels.stop(req.params.channelId, layerOf(req.params.layer), skipOf(req.body)));
    app.post<LP>(`${L}/out`, async (req) => s.channels.stop(req.params.channelId, layerOf(req.params.layer), skipOf(req.body)));
    app.post<LP>(`${L}/update`, async (req) => {
      const b = req.body ?? {};
      return s.channels.update(req.params.channelId, layerOf(req.params.layer), b.data, { ...skipOf(b), ...(b.replace === true ? { replace: true } : {}) });
    });
    app.post<{ Params: LP['Params'] & { actionId: string }; Body: Body }>(`${L}/custom/:actionId`, async (req) => {
      const b = req.body ?? {};
      return s.channels.customAction(req.params.channelId, layerOf(req.params.layer), req.params.actionId, b.payload ?? null, skipOf(b));
    });
    app.post<LP>(`${L}/clear`, async (req) => ({ cleared: await s.channels.clear(req.params.channelId, { layer: layerOf(req.params.layer) }) }));

    // ---------- data hub ----------
    app.get(`${p}/data`, async () => ({ path: '', value: s.hub.get('') }));
    app.get<{ Params: { '*': string } }>(`${p}/data/*`, async (req) => {
      const path = toDataPath(req.params['*']);
      return { path, value: s.hub.get(path) ?? null };
    });
    app.put<{ Params: { '*': string }; Body: unknown }>(`${p}/data/*`, async (req) => {
      const path = toDataPath(req.params['*']);
      s.hub.set(path, req.body);
      return { path, value: s.hub.get(path) };
    });
    app.patch<{ Params: { '*': string }; Body: unknown }>(`${p}/data/*`, async (req) => {
      const path = toDataPath(req.params['*']);
      s.hub.patch(path, req.body);
      return { path, value: s.hub.get(path) };
    });
    app.delete<{ Params: { '*': string } }>(`${p}/data/*`, async (req) => {
      const path = toDataPath(req.params['*']);
      s.hub.delete(path);
      return { path, value: null };
    });

    /** Clocks: POST /api/v1/clock/:action  { path, elapsedMs?, adjustMs?, direction?, limitMs?, label? } */
    app.post<{ Params: { action: string }; Body: Body }>(`${p}/clock/:action`, async (req) => {
      const b = req.body ?? {};
      if (typeof b.path !== 'string') throw badRequest('path is required');
      const actions: ClockAction[] = ['start', 'stop', 'toggle', 'set', 'adjust', 'reset'];
      if (!actions.includes(req.params.action as ClockAction)) throw badRequest(`action must be one of ${actions.join(', ')}`);
      const opts: Parameters<typeof s.hub.clock>[2] = {};
      if (num(b.elapsedMs) !== undefined) opts.elapsedMs = num(b.elapsedMs)!;
      if (num(b.adjustMs) !== undefined) opts.adjustMs = num(b.adjustMs)!;
      if (num(b.limitMs) !== undefined) opts.limitMs = num(b.limitMs)!;
      if (b.direction === 'up' || b.direction === 'down') opts.direction = b.direction;
      if (typeof b.label === 'string') opts.label = b.label;
      return { path: b.path, clock: s.hub.clock(b.path, req.params.action as ClockAction, opts) };
    });
  },
};
