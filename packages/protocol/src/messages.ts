/**
 * WebSocket protocol between server, renderers and controllers (single endpoint: /ws).
 * Action names mirror the OGraf Graphics / Server API: load, playAction, updateAction,
 * stopAction, customAction, clear (= dispose + remove).
 */
import { z } from 'zod';
import type { ChannelState, GraphicRef } from './channel-state.ts';
import type { Rundown, RundownSummary } from './rundown.ts';

import { PROTOCOL_VERSION } from './constants.ts';

export { PROTOCOL_VERSION };

export type RendererCommand =
  | { action: 'load'; layer: number; graphicInstanceId: string; graphic: GraphicRef; params: { data: Record<string, unknown> } }
  | { action: 'playAction'; layer: number; graphicInstanceId: string; params: { goto?: number; delta?: number; skipAnimation?: boolean } }
  | { action: 'stopAction'; layer: number; graphicInstanceId: string; params: { skipAnimation?: boolean } }
  | { action: 'updateAction'; layer: number; graphicInstanceId: string; params: { data: Record<string, unknown>; skipAnimation?: boolean } }
  | { action: 'customAction'; layer: number; graphicInstanceId: string; params: { id: string; payload: unknown; skipAnimation?: boolean } }
  | { action: 'clear'; layer: number; graphicInstanceId: string };

export interface CommandResult {
  statusCode: number;
  statusMessage?: string;
  result?: unknown;
  currentStep?: number | null;
}

// ---------------- client -> server ----------------

export const helloRendererSchema = z.object({
  type: z.literal('hello'),
  role: z.literal('renderer'),
  protocol: z.number().int().optional(),
  channelId: z.string().min(1),
  preview: z.boolean().optional(),
  name: z.string().optional(),
});

export const helloControllerSchema = z.object({
  type: z.literal('hello'),
  role: z.literal('controller'),
  protocol: z.number().int().optional(),
  /** Channels to receive state for; omit for all. */
  channels: z.array(z.string()).optional(),
  /** Data paths to receive changes for; omit for none. Use "" for everything. */
  data: z.array(z.string()).optional(),
});

export const timePingSchema = z.object({ type: z.literal('time.ping'), t0: z.number() });

export const commandResultSchema = z.object({
  type: z.literal('renderer.result'),
  reqId: z.string(),
  result: z.object({
    statusCode: z.number(),
    statusMessage: z.string().optional(),
    result: z.unknown().optional(),
    currentStep: z.number().nullable().optional(),
  }),
});

export const layerErrorSchema = z.object({
  type: z.literal('renderer.layerError'),
  layer: z.number().int(),
  graphicInstanceId: z.string(),
  message: z.string(),
  statusCode: z.number().optional(),
});

export const heartbeatSchema = z.object({ type: z.literal('renderer.heartbeat') });

export type HelloRenderer = z.infer<typeof helloRendererSchema>;
export type HelloController = z.infer<typeof helloControllerSchema>;
export type ClientMessage =
  | HelloRenderer
  | HelloController
  | z.infer<typeof timePingSchema>
  | z.infer<typeof commandResultSchema>
  | z.infer<typeof layerErrorSchema>
  | z.infer<typeof heartbeatSchema>;

/** Parses and validates a raw client message; returns undefined when invalid. */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const type = (json as { type?: unknown })?.type;
  if (type === 'hello') {
    const role = (json as { role?: unknown }).role;
    const r = (role === 'renderer' ? helloRendererSchema : helloControllerSchema).safeParse(json);
    return r.success ? r.data : undefined;
  }
  const schema = { 'time.ping': timePingSchema, 'renderer.result': commandResultSchema, 'renderer.layerError': layerErrorSchema, 'renderer.heartbeat': heartbeatSchema }[type as string];
  if (!schema) return undefined;
  const r = schema.safeParse(json);
  return r.success ? (r.data as ClientMessage) : undefined;
}

// ---------------- server -> client ----------------

export type ServerMessage =
  | { type: 'welcome'; protocol: number; sessionId: string; serverTime: number }
  | { type: 'error'; message: string }
  | { type: 'time.pong'; t0: number; serverTime: number }
  /** Full state for a renderer to (re)build from. */
  | { type: 'renderer.snapshot'; channel: ChannelState }
  | { type: 'renderer.command'; reqId: string; command: RendererCommand }
  /** Ask renderers to reload the page (e.g. after a renderer update). */
  | { type: 'renderer.reload' }
  /** Controller updates */
  | { type: 'channel.state'; channel: ChannelState }
  | { type: 'channel.removed'; channelId: string }
  | { type: 'data.changed'; path: string; value: unknown; serverTime: number }
  | { type: 'graphics.changed' }
  | { type: 'rundown.changed'; rundown: Rundown }
  | { type: 'rundown.removed'; rundownId: string }
  | { type: 'rundowns.changed'; rundowns: RundownSummary[] }
  /** Full match (setup, events, published data); shape defined by the server's match API */
  | { type: 'match.changed'; match: Record<string, unknown> & { id: string } }
  | { type: 'match.removed'; matchId: string }
  | { type: 'matches.changed'; matches: { id: string; sport: string; name: string; active: boolean; updatedAt: number }[] };
