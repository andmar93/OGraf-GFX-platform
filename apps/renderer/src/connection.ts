/**
 * WebSocket connection to the server with automatic reconnect (exponential backoff, capped).
 * Never throws; the renderer keeps showing what it has while disconnected.
 */
import type { ServerMessage } from '@ogp/protocol';

export interface ConnectionHandlers {
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  onClose(): void;
}

export class Connection {
  private ws: WebSocket | undefined;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  connected = false;

  constructor(private readonly url: string, private readonly handlers: ConnectionHandlers) {}

  start() {
    this.open();
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private open() {
    clearTimeout(this.timer);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.handlers.onOpen();
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.connected;
      this.connected = false;
      if (was) this.handlers.onClose();
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    const delay = Math.min(3000, 250 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.open(), delay);
  }
}
