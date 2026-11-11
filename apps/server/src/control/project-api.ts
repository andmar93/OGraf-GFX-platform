/**
 * Editor projects (/api/v1/projects). The editor exports and publishes graphics itself (as a zip through
 * /api/v1/graphics); the server only stores the editable projects.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { editorProjects } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import type { Services } from '../services.ts';
import type { ControlAdapter } from './control-adapter.ts';

type Doc = Record<string, unknown> & { id?: string; name?: string; graphicId?: string };
const MAX_DOC_BYTES = 5 * 1024 * 1024;

function check(doc: unknown): Doc {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw badRequest('project must be an object');
  const d = doc as Doc;
  if (!Array.isArray(d.layers) || !Array.isArray(d.fields)) throw badRequest('project needs layers and fields arrays');
  if (typeof d.name !== 'string' || !d.name.trim()) throw badRequest('project name is required');
  if (typeof d.graphicId !== 'string' || !d.graphicId.trim() || d.graphicId.includes('/')) throw badRequest('graphicId is required (no "/")');
  if (JSON.stringify(d).length > MAX_DOC_BYTES) throw badRequest('project is too large');
  return d;
}

export const projectApi: ControlAdapter = {
  name: 'Editor projects API v1',
  prefix: '/api/v1/projects',
  register(app: FastifyInstance, s: Services) {
    const p = this.prefix;
    const db = s.db;
    type P = { Params: { id: string }; Body: { project?: unknown } };

    app.get(p, async () => ({
      projects: db.select({ id: editorProjects.id, name: editorProjects.name, graphicId: editorProjects.graphicId, updatedAt: editorProjects.updatedAt })
        .from(editorProjects).orderBy(desc(editorProjects.updatedAt)).all(),
    }));

    app.post<{ Body: { project?: unknown } }>(p, async (req, reply) => {
      const doc = check(req.body?.project);
      const id = typeof doc.id === 'string' && doc.id && !db.select().from(editorProjects).where(eq(editorProjects.id, doc.id)).get() ? doc.id : randomUUID();
      const now = Date.now();
      const stored = { ...doc, id };
      db.insert(editorProjects).values({ id, name: doc.name!.trim(), graphicId: doc.graphicId!, doc: stored, createdAt: now, updatedAt: now }).run();
      return reply.status(201).send({ project: stored, updatedAt: now });
    });

    app.get<P>(`${p}/:id`, async (req) => {
      const row = db.select().from(editorProjects).where(eq(editorProjects.id, req.params.id)).get();
      if (!row) throw notFound(`project "${req.params.id}"`);
      return { project: row.doc, updatedAt: row.updatedAt };
    });

    app.put<P>(`${p}/:id`, async (req) => {
      const row = db.select().from(editorProjects).where(eq(editorProjects.id, req.params.id)).get();
      if (!row) throw notFound(`project "${req.params.id}"`);
      const doc = { ...check(req.body?.project), id: req.params.id };
      const now = Date.now();
      db.update(editorProjects).set({ name: doc.name!.trim(), graphicId: doc.graphicId!, doc, updatedAt: now }).where(eq(editorProjects.id, req.params.id)).run();
      return { project: doc, updatedAt: now };
    });

    app.delete<P>(`${p}/:id`, async (req) => {
      const r = db.delete(editorProjects).where(eq(editorProjects.id, req.params.id)).run();
      if (r.changes === 0) throw notFound(`project "${req.params.id}"`);
      return { ok: true };
    });
  },
};
