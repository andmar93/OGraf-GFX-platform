/**
 * Renderer entry: /render/:channelId[?debug=1][&preview=1][&bg=checker]
 *
 * Transparent 1920x1080 stage (scaled to the window), one iframe per layer.
 * Fetches the full channel state on every (re)connect, so a reload always recovers.
 */
import type { ServerMessage } from '@ogp/protocol';
import { PROTOCOL_VERSION } from '@ogp/protocol/constants';
import { isClockValue, localizeClocks } from '@ogp/protocol/clock';
import { ChannelRenderer } from './channel-renderer.ts';
import { Connection } from './connection.ts';
import { DebugOverlay } from './debug-overlay.ts';
import { startKeepAlive } from './keepalive.ts';
import { createIframeLayerFactory } from './iframe-layer.ts';
import { createInlineLayerFactory } from './inline-layer.ts';
import { TimeSync } from './time-sync.ts';

interface RendererStatus {
  started: number;
  channelId: string;
  connected: boolean;
  layers: number;
  errors: string[];
  message?: string;
}

const params = new URLSearchParams(location.search);
/** Keeps off-screen hosts (OBS) producing frames; see keepalive.ts */
const frames = startKeepAlive(params.get('keepalive') !== '0');
/**
 * How graphics are hosted: one iframe per layer (isolated, default in browsers) or directly in this page.
 * OBS (detected by its `window.obsstudio` API) repaints iframe content only every few seconds, so it gets
 * inline layers. Override with ?layers=iframe|inline.
 */
const isObs = typeof (window as Window & { obsstudio?: unknown }).obsstudio === 'object';
const layerMode: 'iframe' | 'inline' = params.get('layers') === 'inline' || params.get('layers') === 'iframe'
  ? (params.get('layers') as 'iframe' | 'inline')
  : isObs ? 'inline' : 'iframe';
const pathMatch = /\/render\/([^/?#]+)/.exec(location.pathname);
const channelId = decodeURIComponent(pathMatch?.[1] ?? params.get('channel') ?? 'main');
const preview = params.get('preview') === '1';
const debug = params.get('debug') === '1';
if (debug) document.documentElement.classList.add('debug');
if (params.get('bg') === 'checker') document.documentElement.classList.add('checker');

const stage = document.getElementById('stage')!;
const time = new TimeSync();
let lastMessage: string | undefined;

// ---- stage scaling: design size = channel size, scaled to the window (e.g. preview iframes) ----
function fitStage() {
  const w = renderer.channel.width;
  const h = renderer.channel.height;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  const scale = Math.min(window.innerWidth / w, window.innerHeight / h);
  stage.style.transform = Math.abs(scale - 1) < 0.001 ? '' : `scale(${scale})`;
}
window.addEventListener('resize', fitStage);

// ---- renderer ----
let overlay: DebugOverlay | undefined;
/** Status for the watchdog in index.html and for embedding pages (the player's PGM preview reads it). */
const status: RendererStatus = { started: Date.now(), channelId, connected: false, layers: 0, errors: [] };
(window as Window & { ogpRenderer?: RendererStatus }).ogpRenderer = status;
const refreshOverlay = () => {
  status.connected = conn.connected;
  status.message = lastMessage;
  status.layers = renderer.layers.size;
  status.errors = [...renderer.layers.values()].filter((e) => e.error).map((e) => `L${e.layer}: ${e.error}`);
  overlay?.update({ channelId, connected: conn.connected, preview, offset: time.offset, rtt: time.rtt, message: lastMessage, fps: frames.fps, keepAlive: params.get('keepalive') !== '0', layerMode }, renderer);
};

const renderer = new ChannelRenderer(
  layerMode === 'inline' ? createInlineLayerFactory(stage) : createIframeLayerFactory(stage),
  (data) => localizeClocks(data, time.offset),
  (layer, graphicInstanceId, message) => {
    console.error(`[layer ${layer}] ${message}`);
    conn.send({ type: 'renderer.layerError', layer, graphicInstanceId, message });
  },
  () => refreshOverlay(),
);

// ---- connection ----
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let pingTimer: ReturnType<typeof setInterval> | undefined;

const ping = () => conn.send({ type: 'time.ping', t0: Date.now() });

const conn = new Connection(wsUrl, {
  onOpen() {
    lastMessage = undefined;
    time.reset();
    conn.send({ type: 'hello', role: 'renderer', protocol: PROTOCOL_VERSION, channelId, preview, name: navigator.userAgent.includes('CasparCG') ? 'CasparCG' : undefined });
    // a quick burst for a good first estimate, then periodic re-sync
    for (let i = 0; i < 5; i++) setTimeout(ping, i * 120);
    clearInterval(pingTimer);
    pingTimer = setInterval(ping, 10_000);
    refreshOverlay();
  },
  onClose() {
    clearInterval(pingTimer);
    refreshOverlay();
  },
  onMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'time.pong': {
        const { changedBy } = time.addSample(msg.t0, msg.serverTime, Date.now());
        if (changedBy > 25) renderer.relocalizeClocks(isClockValue);
        refreshOverlay();
        break;
      }
      case 'renderer.snapshot':
        lastMessage = undefined;
        renderer.applySnapshot(msg.channel);
        fitStage();
        break;
      case 'renderer.command':
        void renderer.execute(msg.command).then((result) => conn.send({ type: 'renderer.result', reqId: msg.reqId, result }));
        break;
      case 'renderer.reload':
        location.reload();
        break;
      case 'error':
        lastMessage = msg.message;
        console.warn('[server]', msg.message);
        refreshOverlay();
        break;
      default:
        break;
    }
  },
});

// Heartbeat: lets the server detect a frozen renderer (e.g. a graphic stuck in an endless loop).
setInterval(() => conn.send({ type: 'renderer.heartbeat' }), 1000);
document.addEventListener('visibilitychange', () => refreshOverlay());

if (debug || preview) overlay = debug ? new DebugOverlay() : undefined;
// the overlay shows the measured frame rate: refresh it regularly
if (debug) setInterval(() => refreshOverlay(), 1000);
if (layerMode === 'inline') {
  // inline graphics share this window: keep the renderer alive on their errors and show them in the overlay
  window.addEventListener('error', (e) => {
    if (!(e.target instanceof Element)) {
      console.error('[graphic]', e.message);
      lastMessage = `graphic error: ${e.message}`;
      refreshOverlay();
    }
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | undefined;
    console.error('[graphic]', r?.message ?? e.reason);
  });
}
fitStage();
conn.start();
