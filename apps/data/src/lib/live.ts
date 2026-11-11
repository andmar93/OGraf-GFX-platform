/**
 * Live store for the data tool: one controller WebSocket (match.* messages + time sync).
 */
import { useSyncExternalStore } from 'react';
import type { ServerMessage } from '@ogp/protocol';
import { api } from './api.ts';
import type { Match, MatchSummary } from './types.ts';

export interface LiveState {
  connected: boolean;
  loaded: boolean;
  list: MatchSummary[];
  matches: Record<string, Match>;
  timeOffset: number;
}

class Store {
  private state: LiveState = { connected: false, loaded: false, list: [], matches: {}, timeOffset: 0 };
  private listeners = new Set<() => void>();
  private retry = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  private started = false;

  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  put(match: Match) {
    this.set({ matches: { ...this.state.matches, [match.id]: match } });
  }

  async load(id: string) {
    try {
      this.put(await api.match(id));
    } catch {
      /* deleted */
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      this.retry = 0;
      this.bestRtt = Number.POSITIVE_INFINITY;
      ws.send(JSON.stringify({ type: 'hello', role: 'controller', channels: [] }));
      for (let i = 0; i < 5; i++) setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'time.ping', t0: Date.now() })), i * 150);
      this.set({ connected: true });
      void api.matches().then(async (list) => {
        const matches: Record<string, Match> = {};
        for (const id of Object.keys(this.state.matches)) if (list.some((m) => m.id === id)) matches[id] = await api.match(id);
        this.set({ list, matches, loaded: true });
      });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'match.changed':
          this.put(msg.match as unknown as Match);
          break;
        case 'match.removed': {
          const matches = { ...this.state.matches };
          delete matches[msg.matchId];
          this.set({ matches });
          break;
        }
        case 'matches.changed':
          this.set({ list: msg.matches });
          break;
        case 'time.pong': {
          const rtt = Date.now() - msg.t0;
          if (rtt <= this.bestRtt) {
            this.bestRtt = rtt;
            this.set({ timeOffset: msg.serverTime - (msg.t0 + rtt / 2) });
          }
          break;
        }
        default:
          break;
      }
    };
    ws.onclose = () => {
      this.set({ connected: false });
      setTimeout(() => this.connect(), Math.min(3000, 250 * 2 ** this.retry++));
    };
    ws.onerror = () => ws.close();
  }
}

export const live = new Store();
export const useLive = () => useSyncExternalStore(live.subscribe, live.get);
