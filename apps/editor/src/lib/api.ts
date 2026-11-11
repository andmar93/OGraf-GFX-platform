import type { Project } from '@ogp/editor-core';

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
  if (!res.ok) throw new ApiError(res.status, json?.title ?? `request failed (${res.status})`, json?.details);
  return json as T;
}

export interface ProjectSummary {
  id: string;
  name: string;
  graphicId: string;
  updatedAt: number;
}

const enc = encodeURIComponent;

export const api = {
  projects: () => request<{ projects: ProjectSummary[] }>('GET', '/projects').then((r) => r.projects),
  project: (id: string) => request<{ project: Project }>('GET', `/projects/${enc(id)}`).then((r) => r.project),
  createProject: (project: Project) => request<{ project: Project }>('POST', '/projects', { project }).then((r) => r.project),
  saveProject: (project: Project) => request<{ project: Project }>('PUT', `/projects/${enc(project.id)}`, { project }).then((r) => r.project),
  deleteProject: (id: string) => request<unknown>('DELETE', `/projects/${enc(id)}`),
  data: () => request<{ value: Record<string, unknown> }>('GET', '/data').then((r) => r.value ?? {}),
  serverTime: async () => {
    const t0 = Date.now();
    const r = await request<{ serverTime: number }>('GET', '/time');
    const t1 = Date.now();
    return r.serverTime - (t0 + (t1 - t0) / 2);
  },
  uploadImage: async (data: Blob, name: string): Promise<string> => {
    const form = new FormData();
    form.append('file', data, name);
    const res = await fetch('/api/v1/assets', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json.title ?? 'upload failed');
    return json.url as string;
  },
  /** Uploads an OGraf package zip to the graphics library. */
  publishZip: async (zip: Uint8Array) => {
    const res = await fetch('/api/v1/graphics', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Blob([zip as BlobPart]) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json.title ?? 'publish failed', json.details);
    return json as { packageId: string; created: boolean };
  },
};
