/**
 * OGraf Server API adapter (https://github.com/ebu/ograf, v1/specification/open-api/server-api.yaml).
 * Mapping: Renderer = channel, RenderTarget = { layer: number }, GraphicInstance = loaded graphic on a layer.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ChannelState } from '@ogp/protocol';
import { badRequest, HttpError, notFound } from '../errors.ts';
import type { CommandOutcome } from '../channels/channel.service.ts';
import type { GraphicRecord } from '../graphics/graphics.service.ts';
import type { Services } from '../services.ts';
import type { ControlAdapter } from './control-adapter.ts';

type Body = Record<string, unknown>;
const RENDER_TARGET_SCHEMA = {
  type: 'object',
  properties: { layer: { type: 'integer', minimum: 0, maximum: 999, label: 'Layer', description: 'Layer number; higher layers are drawn on top' } },
  required: ['layer'],
};

function parseRenderTarget(v: unknown): { layer: number } {
  let t = v;
  if (typeof t === 'string') {
    try { t = JSON.parse(t); } catch { throw badRequest('renderTarget must be a JSON object, e.g. {"layer":10}'); }
  }
  const layer = (t as { layer?: unknown } | undefined)?.layer;
  if (typeof layer !== 'number' || !Number.isInteger(layer) || layer < 0) throw badRequest('renderTarget.layer must be a non-negative integer');
  return { layer };
}

function listInfo(g: GraphicRecord) {
  const info: Body = { id: g.graphicId, name: g.name };
  if (g.manifest.description) info.description = g.manifest.description;
  if (g.manifest.thumbnails) info.thumbnails = g.manifest.thumbnails;
  return info;
}

/** Maps a command outcome to the OGraf response conventions (550 = error from within the GraphicInstance). */
function send(reply: FastifyReply, outcome: CommandOutcome) {
  const { statusCode, statusMessage, graphicInstanceId } = outcome;
  if (statusCode === 550 || statusCode === 504 || statusCode === 501) {
    return reply.status(550).type('application/problem+json').send({ type: 'about:blank', title: 'Error in GraphicInstance', status: 550, detail: statusMessage ?? '', graphicInstanceId });
  }
  if (statusCode === 503) {
    return reply.status(500).type('application/problem+json').send({ type: 'about:blank', title: 'Renderer error', status: 500, detail: statusMessage ?? '' });
  }
  const body: Body = { graphicInstanceId, statusCode };
  if (statusMessage) body.statusMessage = statusMessage;
  if (outcome.result !== undefined) body.result = outcome.result;
  if (outcome.currentStep !== undefined) body.currentStep = outcome.currentStep;
  body.v_ogp_rendererCount = outcome.rendererCount;
  if (outcome.dataWarnings) body.v_ogp_dataWarnings = outcome.dataWarnings;
  return reply.send(body);
}

export const ografServerApi: ControlAdapter = {
  name: 'OGraf Server API v1',
  prefix: '/ograf/v1',
  register(app: FastifyInstance, s: Services) {
    const p = this.prefix;

    const rendererStatus = (ch: ChannelState) => {
      const outputs = ch.renderers.filter((r) => !r.preview);
      if (outputs.length === 0) return { status: 'WARNING', message: 'No output renderer connected' };
      if (outputs.every((r) => !r.responsive)) return { status: 'ERROR', message: 'Renderer is not responding' };
      if (ch.layers.some((l) => l.error)) return { status: 'WARNING', message: 'A graphic reported an error' };
      return { status: 'OK', message: `${outputs.length} renderer(s) connected` };
    };
    const targetInfo = (ch: ChannelState, layer: number) => {
      const l = ch.layers.find((x) => x.layer === layer);
      const rec = l ? s.graphics.get(l.graphic.id) : undefined;
      return {
        renderTarget: { layer },
        name: `Layer ${layer}`,
        graphicInstances: l ? [{ graphicInstanceId: l.graphicInstanceId, graphic: rec ? listInfo(rec) : { id: l.graphic.id, name: l.graphic.name } }] : [],
      };
    };
    const rendererInfo = (ch: ChannelState) => {
      const info: Body = {
        id: ch.id,
        name: ch.name,
        customActions: [],
        renderCharacteristics: { resolution: { width: ch.width, height: ch.height }, frameRate: ch.frameRate },
        renderTargetSchema: RENDER_TARGET_SCHEMA,
        status: rendererStatus(ch),
        renderTargets: ch.layers.map((l) => targetInfo(ch, l.layer)),
      };
      if (ch.description) info.description = ch.description;
      return info;
    };
    const channel = (id: string) => {
      const st = s.channels.getState(id);
      if (!st) throw notFound(`renderer "${id}"`);
      return st;
    };

    app.get(p, async () => ({
      name: 'OGraf GFX Platform',
      description: 'Broadcast graphics server (OGraf v1)',
      version: '0.1.0',
    }));
    app.get(`${p}/`, async () => ({ name: 'OGraf GFX Platform', description: 'Broadcast graphics server (OGraf v1)', version: '0.1.0' }));

    // ---------- graphics ----------
    app.get(`${p}/graphics`, async () => ({ graphics: s.graphics.list().map(listInfo) }));

    app.get<{ Params: { graphicId: string } }>(`${p}/graphics/:graphicId`, async (req) => {
      const g = s.graphics.get(req.params.graphicId);
      if (!g) throw notFound(`graphic "${req.params.graphicId}"`);
      return { graphic: g.manifest, metadata: { createdAt: new Date(g.createdAt).toISOString() } };
    });

    app.delete<{ Params: { graphicId: string }; Querystring: { force?: string } }>(`${p}/graphics/:graphicId`, async (req) => {
      const ok = await s.graphics.delete(req.params.graphicId, req.query.force === 'true');
      if (!ok) throw notFound(`graphic "${req.params.graphicId}"`);
      return {};
    });

    app.get<{ Params: { graphicId: string }; Querystring: { file?: string } }>(`${p}/graphics/:graphicId/thumbnail`, async (req, reply) => {
      const g = s.graphics.get(req.params.graphicId);
      if (!g) throw notFound(`graphic "${req.params.graphicId}"`);
      const file = req.query.file;
      if (!file) throw badRequest('query parameter "file" is required');
      if (!(g.manifest.thumbnails ?? []).some((t) => t.file === file)) throw notFound(`thumbnail "${file}"`);
      const url = s.graphics.fileUrl(g, file);
      if (!url) throw badRequest('invalid thumbnail reference');
      return reply.redirect(url, 302);
    });

    // ---------- renderers ----------
    app.get(`${p}/renderers`, async () => ({
      renderers: s.channels.list().map((c) => (c.description ? { id: c.id, name: c.name, description: c.description } : { id: c.id, name: c.name })),
    }));

    app.get<{ Params: { rendererId: string } }>(`${p}/renderers/:rendererId`, async (req) => ({ renderer: rendererInfo(channel(req.params.rendererId)) }));

    app.get<{ Params: { rendererId: string }; Querystring: { renderTarget?: string } }>(`${p}/renderers/:rendererId/target`, async (req) => {
      const ch = channel(req.params.rendererId);
      const { layer } = parseRenderTarget(req.query.renderTarget);
      return targetInfo(ch, layer);
    });

    app.post<{ Params: { rendererId: string; customActionId: string } }>(`${p}/renderers/:rendererId/customActions/:customActionId`, async (req) => {
      channel(req.params.rendererId);
      throw notFound(`renderer custom action "${req.params.customActionId}"`);
    });

    // ---------- graphic instances ----------
    app.put<{ Params: { rendererId: string }; Body: { filters?: Body[] } }>(`${p}/renderers/:rendererId/target/graphicInstance/clear`, async (req) => {
      const ch = channel(req.params.rendererId);
      const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
      const cleared: { renderTarget: { layer: number }; graphicInstanceId: string }[] = [];
      const run = async (f: Body) => {
        const filter: { layer?: number; graphicId?: string; graphicInstanceId?: string } = {};
        if (f.renderTarget !== undefined) filter.layer = parseRenderTarget(f.renderTarget).layer;
        if (typeof f.graphicId === 'string') filter.graphicId = f.graphicId;
        if (typeof f.graphicInstanceId === 'string') filter.graphicInstanceId = f.graphicInstanceId;
        for (const c of await s.channels.clear(ch.id, filter)) cleared.push({ renderTarget: { layer: c.layer }, graphicInstanceId: c.graphicInstanceId });
      };
      if (filters.length === 0) await run({});
      else for (const f of filters) await run(f);
      return { graphicInstances: cleared };
    });

    app.post<{ Params: { rendererId: string }; Body: Body }>(`${p}/renderers/:rendererId/target/graphicInstance/load`, async (req, reply) => {
      const ch = channel(req.params.rendererId);
      const { layer } = parseRenderTarget(req.body?.renderTarget);
      if (typeof req.body?.graphicId !== 'string') throw badRequest('graphicId is required');
      const params = (req.body.params ?? {}) as { data?: unknown };
      return send(reply, await s.channels.load(ch.id, layer, req.body.graphicId, params.data ?? {}));
    });

    const instanceRoute = (action: 'playAction' | 'stopAction' | 'updateAction') =>
      app.post<{ Params: { rendererId: string }; Body: Body }>(`${p}/renderers/:rendererId/target/graphicInstance/${action}`, async (req, reply) => {
        const ch = channel(req.params.rendererId);
        const { layer } = parseRenderTarget(req.body?.renderTarget);
        const id = typeof req.body?.graphicInstanceId === 'string' ? req.body.graphicInstanceId : undefined;
        if (!id) throw badRequest('graphicInstanceId is required');
        const params = (req.body.params ?? {}) as Body;
        const skip = typeof params.skipAnimation === 'boolean' ? { skipAnimation: params.skipAnimation } : {};
        if (action === 'playAction') {
          return send(reply, await s.channels.play(ch.id, layer, {
            ...skip,
            ...(typeof params.goto === 'number' ? { goto: params.goto } : {}),
            ...(typeof params.delta === 'number' ? { delta: params.delta } : {}),
          }, id));
        }
        if (action === 'stopAction') return send(reply, await s.channels.stop(ch.id, layer, skip, id));
        if (!('data' in params)) throw badRequest('params.data is required');
        return send(reply, await s.channels.update(ch.id, layer, params.data, skip, id));
      });
    instanceRoute('playAction');
    instanceRoute('stopAction');
    instanceRoute('updateAction');

    app.post<{ Params: { rendererId: string; customActionId: string }; Body: Body }>(`${p}/renderers/:rendererId/target/graphicInstance/customActions/:customActionId`, async (req, reply) => {
      const ch = channel(req.params.rendererId);
      const { layer } = parseRenderTarget(req.body?.renderTarget);
      const id = typeof req.body?.graphicInstanceId === 'string' ? req.body.graphicInstanceId : undefined;
      if (!id) throw badRequest('graphicInstanceId is required');
      const params = (req.body.params ?? {}) as Body;
      if (!('payload' in params)) throw new HttpError(400, 'params.payload is required');
      const skip = typeof params.skipAnimation === 'boolean' ? { skipAnimation: params.skipAnimation } : {};
      return send(reply, await s.channels.customAction(ch.id, layer, req.params.customActionId, params.payload, skip, id));
    });
  },
};
