import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import type { CommandResult, RendererCommand, ServerMessage, ChannelState } from '@ogp/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const here = import.meta.dirname;

export async function createTestServer(opts: { seed?: boolean; timeouts?: { loadMs: number; actionMs: number } } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ogp-test-'));
  const config = loadConfig({
    dataDir,
    databaseFile: ':memory:',
    migrationsDir: resolve(here, '..', 'drizzle'),
    rendererDist: resolve(here, '..', '..', 'renderer', 'dist'),
    publicDir: resolve(here, '..', 'public'),
    seedGraphicsDir: opts.seed === false ? undefined : resolve(here, '..', '..', '..', 'graphics'),
    seedMode: 'once',
    logLevel: 'silent',
    timeouts: opts.timeouts ?? { loadMs: 1000, actionMs: 500 },
  });
  const built = await buildApp(config, { logger: false });
  await built.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = built.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    ...built,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async close() {
      await built.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export type Behaviour = (cmd: RendererCommand) => CommandResult | Promise<CommandResult> | undefined;

/** A scripted renderer client speaking the real WebSocket protocol. */
export class FakeRenderer {
  readonly commands: RendererCommand[] = [];
  readonly snapshots: ChannelState[] = [];
  readonly messages: ServerMessage[] = [];
  private ws!: WebSocket;
  private step = new Map<number, number | null>();

  constructor(private behaviour?: Behaviour) {}

  /** Default behaviour: succeeds and tracks steps like a 1-step graphic would. */
  private defaultResult(cmd: RendererCommand): CommandResult {
    if (cmd.action === 'playAction') {
      const cur = this.step.get(cmd.layer) ?? -1;
      const target = cmd.params.goto ?? (cur ?? -1) + (cmd.params.delta ?? 1);
      return { statusCode: 200, currentStep: target };
    }
    return { statusCode: 200 };
  }

  connect(wsUrl: string, channelId: string, opts: { preview?: boolean } = {}): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
      this.ws.on('error', reject);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ type: 'hello', role: 'renderer', channelId, preview: opts.preview })));
      this.ws.on('message', async (raw) => {
        const msg = JSON.parse(raw.toString()) as ServerMessage;
        this.messages.push(msg);
        if (msg.type === 'welcome') resolve();
        if (msg.type === 'renderer.snapshot') this.snapshots.push(msg.channel);
        if (msg.type === 'renderer.command') {
          this.commands.push(msg.command);
          const r = (await this.behaviour?.(msg.command)) ?? this.defaultResult(msg.command);
          if (msg.command.action === 'playAction' && r.currentStep !== undefined) this.step.set(msg.command.layer, r.currentStep ?? null);
          if (r.statusCode !== -1) this.ws.send(JSON.stringify({ type: 'renderer.result', reqId: msg.reqId, result: r }));
        }
      });
    });
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

export async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

export async function api<T = Record<string, unknown>>(baseUrl: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}
