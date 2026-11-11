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
import { createIframeLayerFactory } from './iframe-layer.ts';
import { TimeSync } from './time-sync.ts';

const params = new URLSearchParams(location.search);
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
const refreshOverlay = () => overlay?.update({ channelId, connected: conn.connected, preview, offset: time.offset, rtt: time.rtt, message: lastMessage }, renderer);

const renderer = new ChannelRenderer(
  createIframeLayerFactory(stage),
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
fitStage();
conn.start();
