/**
 * REST client for the server (/api/v1). Throws ApiError with the RFC 7807 problem details.
 */
import type { ChannelState, Rundown, RundownSummary } from '@ogp/protocol';

export interface GraphicDto {
  id: string;
  name: string;
  description?: string;
  version: string | null;
  packageId: string;
  mainUrl: string;
  stepCount: number;
  customActions: { id: string; name: string; description?: string; schema?: unknown }[];
  schema: Record<string, unknown> | null;
  thumbnails: { file: string; url?: string; resolution?: { width: number; height: number } }[];
  manifest: Record<string, unknown>;
}

export interface CommandOutcome {
  statusCode: number;
  statusMessage?: string;
  currentStep?: number | null;
  graphicInstanceId?: string;
  rendererCount?: number;
  cursorItemId?: string | null;
  dataWarnings?: { path: string; message: string }[];
  result?: unknown;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, json?.title ?? `${method} ${path} failed (${res.status})`, json?.details);
  return json as T;
}

const enc = encodeURIComponent;

export const api = {
  graphics: () => request<{ graphics: GraphicDto[] }>('GET', '/graphics').then((r) => r.graphics),
  channels: () => request<{ channels: ChannelState[] }>('GET', '/channels').then((r) => r.channels),
  data: () => request<{ value: Record<string, unknown> }>('GET', '/data').then((r) => r.value ?? {}),
  outAll: (channelId: string) => request<{ stopped: unknown[] }>('POST', `/channels/${enc(channelId)}/out-all`, {}),
  clearChannel: (channelId: string) => request<unknown>('POST', `/channels/${enc(channelId)}/clear`, {}),
  layer: (channelId: string, layer: number, action: 'next' | 'prev' | 'out' | 'clear') =>
    request<CommandOutcome>('POST', `/channels/${enc(channelId)}/layers/${layer}/${action}`, {}),

  rundowns: () => request<{ rundowns: RundownSummary[] }>('GET', '/rundowns').then((r) => r.rundowns),
  rundown: (id: string) => request<{ rundown: Rundown }>('GET', `/rundowns/${enc(id)}`).then((r) => r.rundown),
  createRundown: (name: string) => request<{ rundown: Rundown }>('POST', '/rundowns', { name }).then((r) => r.rundown),
  updateRundown: (id: string, patch: { name?: string; cursorItemId?: string | null }) =>
    request<{ rundown: Rundown }>('PATCH', `/rundowns/${enc(id)}`, patch).then((r) => r.rundown),
  deleteRundown: (id: string) => request<unknown>('DELETE', `/rundowns/${enc(id)}`),
  duplicateRundown: (id: string) => request<{ rundown: Rundown }>('POST', `/rundowns/${enc(id)}/duplicate`, {}).then((r) => r.rundown),
  reorder: (id: string, itemIds: string[]) => request<{ rundown: Rundown }>('POST', `/rundowns/${enc(id)}/reorder`, { itemIds }).then((r) => r.rundown),

  addItem: (id: string, body: { graphicId: string; afterItemId?: string | null; channelId?: string }) =>
    request<{ rundown: Rundown }>('POST', `/rundowns/${enc(id)}/items`, body).then((r) => r.rundown),
  updateItem: (id: string, itemId: string, patch: Record<string, unknown>) =>
    request<{ rundown: Rundown }>('PATCH', `/rundowns/${enc(id)}/items/${enc(itemId)}`, patch).then((r) => r.rundown),
  deleteItem: (id: string, itemId: string) => request<{ rundown: Rundown }>('DELETE', `/rundowns/${enc(id)}/items/${enc(itemId)}`).then((r) => r.rundown),
  duplicateItem: (id: string, itemId: string) =>
    request<{ rundown: Rundown }>('POST', `/rundowns/${enc(id)}/items/${enc(itemId)}/duplicate`, {}).then((r) => r.rundown),
  itemAction: (id: string, itemId: string, action: 'cue' | 'take' | 'next' | 'prev' | 'out' | 'update' | 'clear', body: Record<string, unknown> = {}) =>
    request<CommandOutcome>('POST', `/rundowns/${enc(id)}/items/${enc(itemId)}/${action}`, body),
  itemCustom: (id: string, itemId: string, actionId: string, payload: unknown) =>
    request<CommandOutcome>('POST', `/rundowns/${enc(id)}/items/${enc(itemId)}/custom/${enc(actionId)}`, { payload }),
};
