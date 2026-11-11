import type { Match, MatchSummary, Side, Team } from './types.ts';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
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
  if (!res.ok) throw new ApiError(res.status, json?.title ?? `request failed (${res.status})`);
  return json as T;
}

const m = (r: { match: Match }) => r.match;
const enc = encodeURIComponent;

export const api = {
  matches: () => request<{ matches: MatchSummary[] }>('GET', '/matches').then((r) => r.matches),
  match: (id: string) => request<{ match: Match }>('GET', `/matches/${enc(id)}`).then(m),
  create: (body: { name?: string; home?: Partial<Team>; away?: Partial<Team> }) => request<{ match: Match }>('POST', '/matches', body).then(m),
  update: (id: string, patch: { name?: string; home?: Team; away?: Team; settings?: Record<string, unknown> }) => request<{ match: Match }>('PATCH', `/matches/${enc(id)}`, patch).then(m),
  remove: (id: string) => request<unknown>('DELETE', `/matches/${enc(id)}`),
  activate: (id: string) => request<{ match: Match }>('POST', `/matches/${enc(id)}/activate`, {}).then(m),
  deactivate: () => request<unknown>('POST', '/matches/deactivate', {}),
  event: (id: string, type: string, team?: Side, data: Record<string, unknown> = {}) =>
    request<{ match: Match }>('POST', `/matches/${enc(id)}/events`, { type, ...(team ? { team } : {}), data }).then(m),
  editEvent: (id: string, eventId: string, patch: { team?: Side; data?: Record<string, unknown> }) =>
    request<{ match: Match }>('PATCH', `/matches/${enc(id)}/events/${enc(eventId)}`, patch).then(m),
  deleteEvent: (id: string, eventId: string) => request<{ match: Match }>('DELETE', `/matches/${enc(id)}/events/${enc(eventId)}`).then(m),
  undo: (id: string) => request<{ match: Match }>('POST', `/matches/${enc(id)}/undo`, {}).then(m),
  redo: (id: string) => request<{ match: Match }>('POST', `/matches/${enc(id)}/redo`, {}).then(m),
  uploadImage: async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/v1/assets', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json.title ?? 'upload failed');
    return json.url as string;
  },
};
