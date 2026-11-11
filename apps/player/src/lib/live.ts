/**
 * Live store: one controller WebSocket + initial REST fetches.
 * Immutable snapshots for React's useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';
import type { ChannelState, Rundown, RundownSummary, ServerMessage } from '@ogp/protocol';
import { setAtPath } from '@ogp/protocol/data-paths';
import { api, type GraphicDto } from './api.ts';

export interface LiveState {
  connected: boolean;
  loaded: boolean;
  channels: ChannelState[];
  graphics: GraphicDto[];
  data: Record<string, unknown>;
  rundownList: RundownSummary[];
  rundowns: Record<string, Rundown>;
  /** serverTime - localTime */
  timeOffset: number;
}

type Listener = () => void;

class LiveStore {
  private state: LiveState = { connected: false, loaded: false, channels: [], graphics: [], data: {}, rundownList: [], rundowns: {}, timeOffset: 0 };
  private listeners = new Set<Listener>();
  private ws: WebSocket | undefined;
  private retry = 0;
  private bestRtt = Number.POSITIVE_INFINITY;

  get = () => this.state;

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  start() {
    if (this.ws) return;
    this.connect();
  }

  /** Puts a rundown in the store (e.g. from an API response) without waiting for the broadcast. */
  putRundown(r: Rundown) {
    this.set({ rundowns: { ...this.state.rundowns, [r.id]: r } });
  }

  async loadRundown(id: string) {
    try {
      this.putRundown(await api.rundown(id));
    } catch {
      /* deleted meanwhile */
    }
  }

  async refreshGraphics() {
    this.set({ graphics: await api.graphics() });
  }

  private async resync() {
    const [channels, graphics, data, rundownList] = await Promise.all([api.channels(), api.graphics(), api.data(), api.rundowns()]);
    const rundowns: Record<string, Rundown> = {};
    for (const id of Object.keys(this.state.rundowns)) {
      if (rundownList.some((r) => r.id === id)) rundowns[id] = await api.rundown(id);
    }
    this.set({ channels, graphics, data, rundownList, rundowns, loaded: true });
  }

  private connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.bestRtt = Number.POSITIVE_INFINITY;
      ws.send(JSON.stringify({ type: 'hello', role: 'controller', data: [''] }));
      for (let i = 0; i < 4; i++) setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'time.ping', t0: Date.now() })), i * 150);
      this.set({ connected: true });
      void this.resync().catch(() => {});
    };
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      this.set({ connected: false });
      this.ws = undefined;
      setTimeout(() => this.connect(), Math.min(3000, 250 * 2 ** this.retry++));
    };
    ws.onerror = () => ws.close();
  }

  private onMessage(m: ServerMessage) {
    const s = this.state;
    switch (m.type) {
      case 'channel.state': {
        const i = s.channels.findIndex((c) => c.id === m.channel.id);
        const channels = i >= 0 ? s.channels.map((c, j) => (j === i ? m.channel : c)) : [...s.channels, m.channel];
        this.set({ channels });
        break;
      }
      case 'channel.removed':
        this.set({ channels: s.channels.filter((c) => c.id !== m.channelId) });
        break;
      case 'data.changed':
        this.set({ data: setAtPath(s.data, m.path, m.value ?? undefined) });
        break;
      case 'graphics.changed':
        void this.refreshGraphics();
        break;
      case 'rundown.changed':
        this.set({ rundowns: { ...s.rundowns, [m.rundown.id]: m.rundown } });
        break;
      case 'rundown.removed': {
        const rundowns = { ...s.rundowns };
        delete rundowns[m.rundownId];
        this.set({ rundowns });
        break;
      }
      case 'rundowns.changed':
        this.set({ rundownList: m.rundowns });
        break;
      case 'time.pong': {
        const now = Date.now();
        const rtt = now - m.t0;
        if (rtt <= this.bestRtt) {
          this.bestRtt = rtt;
          this.set({ timeOffset: m.serverTime - (m.t0 + rtt / 2) });
        }
        break;
      }
      default:
        break;
    }
  }
}

export const live = new LiveStore();

export function useLive(): LiveState {
  return useSyncExternalStore(live.subscribe, live.get);
}
