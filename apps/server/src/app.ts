import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { ServerConfig } from './config.ts';
import { openDatabase } from './db/client.ts';
import { HttpError } from './errors.ts';
import { GraphicsService } from './graphics/graphics.service.ts';
import { DataHub } from './data/data-hub.ts';
import { Gateway } from './renderers/gateway.ts';
import { ChannelService } from './channels/channel.service.ts';
import { RundownService } from './rundowns/rundown.service.ts';
import { rundownApi } from './control/rundown-api.ts';
import { MatchService } from './matches/match.service.ts';
import { matchApi } from './control/match-api.ts';
import { projectApi } from './control/project-api.ts';
import { registerAssets } from './assets/assets.ts';
import { ografServerApi } from './control/ograf-server-api.ts';
import { internalApi } from './control/internal-api.ts';
import type { ControlAdapter } from './control/control-adapter.ts';
import type { Services } from './services.ts';

export interface App {
  app: FastifyInstance;
  services: Services;
  close: () => Promise<void>;
}

export async function buildApp(config: ServerConfig, opts: { logger?: boolean } = {}): Promise<App> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    // Companion/automation can send many requests; log errors, not every request.
    logController: new LogController({ disableRequestLogging: config.logLevel !== 'debug' && config.logLevel !== 'trace' }),
    bodyLimit: config.maxUploadBytes,
  });

  // ---------- services ----------
  const { db, close: closeDb } = openDatabase(config.databaseFile, config.migrationsDir);
  const graphics = new GraphicsService(db, config.dataDir);
  const hub = new DataHub(db);
  let channels!: ChannelService;
  const gateway = new Gateway({ getSnapshot: (id) => channels.getState(id), listChannels: () => channels.list() });
  channels = new ChannelService(db, graphics, hub, gateway, { defaultChannel: config.defaultChannel, timeouts: config.timeouts });
  const rundowns = new RundownService(db, channels, graphics);
  const matches = new MatchService(db, hub);
  const services: Services = { config, db, graphics, hub, gateway, channels, rundowns, matches };

  channels.on('state', (st) => gateway.broadcastChannelState(st));
  channels.on('removed', ({ channelId }) => gateway.broadcastToControllers({ type: 'channel.removed', channelId }));
  hub.on('change', ({ path, value }) => gateway.broadcastDataChange(path, value));
  graphics.on('changed', () => gateway.broadcastToControllers({ type: 'graphics.changed' }));
  rundowns.on('changed', (rundown) => gateway.broadcastToControllers({ type: 'rundown.changed', rundown }));
  rundowns.on('removed', ({ rundownId }) => gateway.broadcastToControllers({ type: 'rundown.removed', rundownId }));
  rundowns.on('list', (list) => gateway.broadcastToControllers({ type: 'rundowns.changed', rundowns: list }));
  matches.on('changed', (match) => gateway.broadcastToControllers({ type: 'match.changed', match: match as unknown as Record<string, unknown> & { id: string } }));
  matches.on('removed', ({ matchId }) => gateway.broadcastToControllers({ type: 'match.removed', matchId }));
  matches.on('list', (list) => gateway.broadcastToControllers({ type: 'matches.changed', matches: list }));

  if (config.seedGraphicsDir && (config.seedMode === 'always' || (config.seedMode === 'once' && !graphics.hasAnyPackage()))) {
    await graphics.seedFrom(config.seedGraphicsDir, (msg, err) => (err ? app.log.warn({ err }, msg) : app.log.info(msg)));
  }

  // ---------- plugins ----------
  await app.register(cors, { origin: '*', methods: ['GET', 'PUT', 'POST', 'PATCH', 'HEAD', 'OPTIONS', 'DELETE'], maxAge: 3600 });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });
  app.addContentTypeParser(['application/zip', 'application/octet-stream', 'application/x-zip-compressed'], { parseAs: 'buffer', bodyLimit: config.maxUploadBytes }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number; validation?: unknown };
    const status = err instanceof HttpError ? err.status : (e.statusCode ?? 500);
    if (status >= 500) req.log.error(err);
    const body: Record<string, unknown> = { type: 'about:blank', title: e.message, status, instance: req.url };
    if (err instanceof HttpError && err.details !== undefined) body.details = err.details;
    reply.status(status).type('application/problem+json').send(body);
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).type('application/problem+json').send({ type: 'about:blank', title: 'Not found', status: 404, instance: req.url });
  });

  // ---------- APIs ----------
  const adapters: ControlAdapter[] = [ografServerApi, internalApi, rundownApi, matchApi, projectApi];
  for (const a of adapters) await a.register(app, services);

  await registerAssets(app, config.dataDir);

  app.get('/ws', { websocket: true }, (socket, req) => gateway.accept(socket, req.headers['user-agent']));

  // ---------- static ----------
  // Graphic packages are content-addressed: cache forever.
  await app.register(fastifyStatic, {
    root: graphics.packagesDir,
    prefix: '/packages/',
    decorateReply: true,
    immutable: true,
    maxAge: '365d',
    index: false,
    serve: true,
    setHeaders: (res) => res.header('Access-Control-Allow-Origin', '*'),
  });
  // Built frontends: routes are always registered and files are looked up per request. In development the
  // watch builds empty and rewrite their dist folders while the server runs, so a check at startup could miss them.
  for (const dir of [config.rendererDist, config.playerDist, config.dataAppDist, config.editorDist]) mkdirSync(dir, { recursive: true });
  // HTML entry pages must never be cached: they reference the current build's assets. (sendFile would otherwise
  // inherit the caching options of the first static registration – the immutable package store.)
  const NO_CACHE_FILE = { cacheControl: false, immutable: false, maxAge: 0, lastModified: false, etag: false } as const;
  const page = (reply: FastifyReply, dir: string, what: string) => {
    reply.header('Cache-Control', 'no-store');
    if (existsSync(join(dir, 'index.html'))) return reply.sendFile('index.html', dir, NO_CACHE_FILE);
    return reply.status(503).type('text/html').send(buildingPage(what));
  };
  const noCache = (res: FastifyReply) => res.header('Cache-Control', 'no-cache');
  await app.register(fastifyStatic, { root: config.rendererDist, prefix: '/renderer/', decorateReply: false, index: false, cacheControl: false, setHeaders: noCache });
  app.get<{ Params: { channelId: string } }>('/render/:channelId', (_req, reply) => page(reply, config.rendererDist, 'renderer'));

  await app.register(fastifyStatic, { root: config.playerDist, prefix: '/player/', decorateReply: false, index: false, cacheControl: false, setHeaders: noCache });
  app.get('/player/', (_req, reply) => page(reply, config.playerDist, 'player'));
  app.get('/player', (_req, reply) => reply.redirect('/player/'));
  app.get('/', (_req, reply) => reply.redirect('/player/'));

  await app.register(fastifyStatic, { root: config.dataAppDist, prefix: '/data/', decorateReply: false, index: false, cacheControl: false, setHeaders: noCache });
  app.get('/data/', (_req, reply) => page(reply, config.dataAppDist, 'match data tool'));
  app.get('/data', (_req, reply) => reply.redirect('/data/'));

  await app.register(fastifyStatic, { root: config.editorDist, prefix: '/editor/', decorateReply: false, index: false, cacheControl: false, setHeaders: noCache });
  app.get('/editor/', (_req, reply) => page(reply, config.editorDist, 'editor'));
  app.get('/editor', (_req, reply) => reply.redirect('/editor/'));

  if (existsSync(join(config.publicDir, 'dev.html'))) {
    await app.register(fastifyStatic, { root: config.publicDir, prefix: '/public/', decorateReply: false, index: false });
    app.get('/dev', (_req, reply) => reply.header('Cache-Control', 'no-store').sendFile('dev.html', config.publicDir, NO_CACHE_FILE));
  }
  app.addHook('onReady', async () => {
    if (!existsSync(join(config.rendererDist, 'index.html'))) app.log.warn(`renderer build not found in ${config.rendererDist} – run "pnpm build" (or "pnpm dev")`);
    if (!existsSync(join(config.playerDist, 'index.html'))) app.log.warn(`player build not found in ${config.playerDist} – run "pnpm build" (or "pnpm dev")`);
    if (!existsSync(join(config.editorDist, 'index.html'))) app.log.warn(`editor build not found in ${config.editorDist} – run "pnpm build" (or "pnpm dev")`);
    if (!existsSync(join(config.dataAppDist, 'index.html'))) app.log.warn(`data tool build not found in ${config.dataAppDist} – run "pnpm build" (or "pnpm dev")`);
  });

  return {
    app,
    services,
    close: async () => {
      rundowns.close();
      gateway.close();
      await app.close();
      closeDb();
    },
  };
}

/** Shown while a frontend is being (re)built in development; reloads itself. */
function buildingPage(what: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Building…</title>
<style>html,body{margin:0;height:100%;background:transparent;font:16px system-ui,sans-serif;color:#8b95a7;display:grid;place-items:center}</style></head>
<body><p>The ${what} is being built – this page reloads automatically.</p></body></html>`;
}
