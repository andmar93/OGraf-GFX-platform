/**
 * WebSocket gateway: renderer and controller sessions, command dispatch with ack
 * correlation, time sync, heartbeats.
 */
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, parseClientMessage,
  type ChannelState, type CommandResult, type HelloController, type RendererCommand, type RendererConnectionInfo, type ServerMessage,
} from '@ogp/protocol';
import { Emitter } from '../events.ts';

interface BaseSession {
  id: string;
  socket: WebSocket;
  connectedAt: number;
  lastSeenAt: number;
  userAgent?: string;
}
interface RendererSession extends BaseSession {
  role: 'renderer';
  channelId: string;
  preview: boolean;
  name?: string;
  responsive: boolean;
}
interface ControllerSession extends BaseSession {
  role: 'controller';
  channels?: string[];
  data?: string[];
}
interface PendingSession extends BaseSession {
  role: 'pending';
}
type Session = RendererSession | ControllerSession | PendingSession;

export interface DispatchOutcome {
  /** Number of renderers whose result counts (output renderers, or previews if there are none). */
  rendererCount: number;
  results: CommandResult[];
}

export interface GatewayEvents extends Record<string, unknown> {
  renderersChanged: { channelId: string };
  layerError: { channelId: string; layer: number; graphicInstanceId: string; message: string; statusCode?: number };
}

const HEARTBEAT_TIMEOUT_MS = 5000;

export class Gateway extends Emitter<GatewayEvents> {
  private sessions = new Map<string, Session>();
  private pending = new Map<string, { resolve: (r: CommandResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private watchdog: ReturnType<typeof setInterval>;

  constructor(
    private readonly hooks: {
      getSnapshot: (channelId: string) => ChannelState | undefined;
      listChannels: () => ChannelState[];
    },
    private readonly now: () => number = Date.now,
  ) {
    super();
    this.watchdog = setInterval(() => this.checkHeartbeats(), 1000);
    this.watchdog.unref?.();
  }

  close() {
    clearInterval(this.watchdog);
    for (const s of this.sessions.values()) s.socket.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ statusCode: 503, statusMessage: 'server shutting down' });
    }
  }

  // ---------------- connections ----------------

  accept(socket: WebSocket, userAgent?: string) {
    const session: PendingSession = { id: randomUUID(), socket, role: 'pending', connectedAt: this.now(), lastSeenAt: this.now(), userAgent };
    this.sessions.set(session.id, session);
    socket.on('message', (raw) => this.onMessage(session.id, raw.toString()));
    socket.on('close', () => this.onClose(session.id));
    socket.on('error', () => socket.close());
  }

  private send(s: Session, msg: ServerMessage) {
    if (s.socket.readyState === 1) s.socket.send(JSON.stringify(msg));
  }

  private onMessage(sessionId: string, raw: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastSeenAt = this.now();
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.send(s, { type: 'error', message: 'invalid message' });
      return;
    }
    switch (msg.type) {
      case 'hello': {
        let next: Session;
        if (msg.role === 'renderer') {
          next = { ...s, role: 'renderer', channelId: msg.channelId, preview: msg.preview ?? false, name: msg.name, responsive: true };
        } else {
          const m = msg as HelloController;
          next = { ...s, role: 'controller', channels: m.channels, data: m.data };
        }
        if (s.role === 'renderer') this.emit('renderersChanged', { channelId: s.channelId });
        this.sessions.set(sessionId, next);
        this.send(next, { type: 'welcome', protocol: PROTOCOL_VERSION, sessionId, serverTime: this.now() });
        if (next.role === 'renderer') {
          const snap = this.hooks.getSnapshot(next.channelId);
          if (snap) this.send(next, { type: 'renderer.snapshot', channel: snap });
          else this.send(next, { type: 'error', message: `unknown channel "${next.channelId}"` });
          this.emit('renderersChanged', { channelId: next.channelId });
        } else {
          for (const ch of this.hooks.listChannels()) if (!next.channels || next.channels.includes(ch.id)) this.send(next, { type: 'channel.state', channel: ch });
        }
        break;
      }
      case 'time.ping':
        this.send(s, { type: 'time.pong', t0: msg.t0, serverTime: this.now() });
        break;
      case 'renderer.heartbeat':
        if (s.role === 'renderer' && !s.responsive) {
          s.responsive = true;
          this.emit('renderersChanged', { channelId: s.channelId });
        }
        break;
      case 'renderer.result': {
        const p = this.pending.get(`${sessionId}:${msg.reqId}`);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(`${sessionId}:${msg.reqId}`);
          p.resolve(msg.result as CommandResult);
        }
        break;
      }
      case 'renderer.layerError':
        if (s.role === 'renderer' && !s.preview) {
          this.emit('layerError', { channelId: s.channelId, layer: msg.layer, graphicInstanceId: msg.graphicInstanceId, message: msg.message, statusCode: msg.statusCode });
        }
        break;
    }
  }

  private onClose(sessionId: string) {
    const s = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    for (const [key, p] of this.pending) {
      if (key.startsWith(`${sessionId}:`)) {
        clearTimeout(p.timer);
        this.pending.delete(key);
        p.resolve({ statusCode: 503, statusMessage: 'renderer disconnected' });
      }
    }
    if (s?.role === 'renderer') this.emit('renderersChanged', { channelId: s.channelId });
  }

  private checkHeartbeats() {
    const t = this.now();
    for (const s of this.sessions.values()) {
      if (s.role !== 'renderer') continue;
      const responsive = t - s.lastSeenAt < HEARTBEAT_TIMEOUT_MS;
      if (responsive !== s.responsive) {
        s.responsive = responsive;
        this.emit('renderersChanged', { channelId: s.channelId });
      }
    }
  }

  // ---------------- renderers ----------------

  private renderersOf(channelId: string): RendererSession[] {
    return [...this.sessions.values()].filter((s): s is RendererSession => s.role === 'renderer' && s.channelId === channelId);
  }

  rendererInfo(channelId: string): RendererConnectionInfo[] {
    return this.renderersOf(channelId).map((s) => ({
      sessionId: s.id, preview: s.preview, name: s.name, userAgent: s.userAgent,
      connectedAt: s.connectedAt, lastSeenAt: s.lastSeenAt, responsive: s.responsive,
    }));
  }

  /**
   * Sends a command to every renderer of a channel. Resolves with the results of the output
   * renderers (non-preview), or of the preview renderers when no output renderer is connected.
   */
  async dispatch(channelId: string, command: RendererCommand, timeoutMs: number): Promise<DispatchOutcome> {
    const renderers = this.renderersOf(channelId);
    const outputs = renderers.filter((r) => !r.preview);
    const counted = new Set((outputs.length > 0 ? outputs : renderers).map((r) => r.id));
    const promises: Promise<CommandResult>[] = [];
    for (const r of renderers) {
      const reqId = randomUUID();
      const p = new Promise<CommandResult>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(`${r.id}:${reqId}`);
          resolve({ statusCode: 503, statusMessage: `renderer did not answer within ${timeoutMs} ms` });
        }, timeoutMs);
        this.pending.set(`${r.id}:${reqId}`, { resolve, timer });
      });
      this.send(r, { type: 'renderer.command', reqId, command });
      if (counted.has(r.id)) promises.push(p);
    }
    return { rendererCount: promises.length, results: await Promise.all(promises) };
  }

  sendSnapshot(channelId: string, snapshot: ChannelState) {
    for (const r of this.renderersOf(channelId)) this.send(r, { type: 'renderer.snapshot', channel: snapshot });
  }

  reloadRenderers(channelId: string): number {
    const list = this.renderersOf(channelId);
    for (const r of list) this.send(r, { type: 'renderer.reload' });
    return list.length;
  }

  // ---------------- controllers ----------------

  broadcastToControllers(msg: ServerMessage, filter?: (s: ControllerSession) => boolean) {
    for (const s of this.sessions.values()) if (s.role === 'controller' && (!filter || filter(s))) this.send(s, msg);
  }

  broadcastChannelState(channel: ChannelState) {
    this.broadcastToControllers({ type: 'channel.state', channel }, (s) => !s.channels || s.channels.includes(channel.id));
  }

  broadcastDataChange(path: string, value: unknown) {
    const msg: ServerMessage = { type: 'data.changed', path, value, serverTime: this.now() };
    this.broadcastToControllers(msg, (s) => !!s.data?.some((p) => p === '' || path === p || path.startsWith(p + '.') || p.startsWith(path + '.')));
  }
}
