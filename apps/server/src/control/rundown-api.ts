/**
 * Rundown API (/api/v1/rundowns). Used by the player, and later by Companion/automation.
 */
import type { FastifyInstance } from 'fastify';
import { badRequest } from '../errors.ts';
import type { ItemAction, ItemInput } from '../rundowns/rundown.service.ts';
import type { Services } from '../services.ts';
import type { ControlAdapter } from './control-adapter.ts';

type Body = Record<string, unknown>;

function itemInput(b: Body): ItemInput {
  const out: ItemInput = {};
  if (typeof b.graphicId === 'string') out.graphicId = b.graphicId;
  if (typeof b.name === 'string') out.name = b.name;
  if (typeof b.channelId === 'string') out.channelId = b.channelId;
  if (b.layer !== undefined) out.layer = b.layer as number;
  if (b.data !== undefined) out.data = b.data as Record<string, unknown>;
  if (b.durationMs !== undefined) out.durationMs = b.durationMs as number | null;
  return out;
}

const ACTIONS: ItemAction[] = ['cue', 'take', 'next', 'prev', 'out', 'update', 'clear'];

export const rundownApi: ControlAdapter = {
  name: 'Rundown API v1',
  prefix: '/api/v1/rundowns',
  register(app: FastifyInstance, s: Services) {
    const p = this.prefix;
    type R = { Params: { rundownId: string }; Body: Body };
    type I = { Params: { rundownId: string; itemId: string }; Body: Body };

    app.get(p, async () => ({ rundowns: s.rundowns.list() }));
    app.post<{ Body: Body }>(p, async (req, reply) => reply.status(201).send({ rundown: s.rundowns.create({ name: String(req.body?.name ?? '') }) }));
    app.get<R>(`${p}/:rundownId`, async (req) => ({ rundown: s.rundowns.get(req.params.rundownId) }));
    app.patch<R>(`${p}/:rundownId`, async (req) => {
      const b = req.body ?? {};
      const patch: { name?: string; cursorItemId?: string | null } = {};
      if (typeof b.name === 'string') patch.name = b.name;
      if (b.cursorItemId === null || typeof b.cursorItemId === 'string') patch.cursorItemId = b.cursorItemId;
      return { rundown: s.rundowns.update(req.params.rundownId, patch) };
    });
    app.delete<R>(`${p}/:rundownId`, async (req) => {
      s.rundowns.delete(req.params.rundownId);
      return { ok: true };
    });
    app.post<R>(`${p}/:rundownId/duplicate`, async (req, reply) =>
      reply.status(201).send({ rundown: s.rundowns.duplicate(req.params.rundownId, typeof req.body?.name === 'string' ? req.body.name : undefined) }));

    /** Take the cursor ("next") item. */
    app.post<R>(`${p}/:rundownId/take`, async (req) =>
      s.rundowns.takeCursor(req.params.rundownId, typeof req.body?.skipAnimation === 'boolean' ? { skipAnimation: req.body.skipAnimation } : {}));

    app.post<R>(`${p}/:rundownId/reorder`, async (req) => {
      if (!Array.isArray(req.body?.itemIds)) throw badRequest('itemIds (array) is required');
      return { rundown: s.rundowns.reorder(req.params.rundownId, req.body.itemIds as string[]) };
    });

    // ---------- items ----------
    app.post<R>(`${p}/:rundownId/items`, async (req, reply) => {
      const b = req.body ?? {};
      const afterItemId = typeof b.afterItemId === 'string' ? b.afterItemId : null;
      return reply.status(201).send({ rundown: s.rundowns.addItem(req.params.rundownId, { ...itemInput(b), afterItemId }) });
    });
    app.get<I>(`${p}/:rundownId/items/:itemId`, async (req) => ({ item: s.rundowns.getItem(req.params.rundownId, req.params.itemId) }));
    app.patch<I>(`${p}/:rundownId/items/:itemId`, async (req) => ({ rundown: s.rundowns.updateItem(req.params.rundownId, req.params.itemId, itemInput(req.body ?? {})) }));
    app.delete<I>(`${p}/:rundownId/items/:itemId`, async (req) => ({ rundown: s.rundowns.deleteItem(req.params.rundownId, req.params.itemId) }));
    app.post<I>(`${p}/:rundownId/items/:itemId/duplicate`, async (req, reply) => reply.status(201).send({ rundown: s.rundowns.duplicateItem(req.params.rundownId, req.params.itemId) }));

    // ---------- item control ----------
    app.post<I & { Params: { action: string } }>(`${p}/:rundownId/items/:itemId/:action`, async (req) => {
      const action = req.params.action as ItemAction;
      if (!ACTIONS.includes(action)) throw badRequest(`action must be one of ${ACTIONS.join(', ')}`);
      const b = req.body ?? {};
      return s.rundowns.control(req.params.rundownId, req.params.itemId, action, {
        ...(typeof b.skipAnimation === 'boolean' ? { skipAnimation: b.skipAnimation } : {}),
        ...(b.advance === false ? { advance: false } : {}),
        ...(b.transition === 'cut' ? { transition: 'cut' as const } : {}),
      });
    });
    app.post<{ Params: { rundownId: string; itemId: string; actionId: string }; Body: Body }>(`${p}/:rundownId/items/:itemId/custom/:actionId`, async (req) => {
      const b = req.body ?? {};
      return s.rundowns.customAction(req.params.rundownId, req.params.itemId, req.params.actionId, b.payload ?? null,
        typeof b.skipAnimation === 'boolean' ? { skipAnimation: b.skipAnimation } : {});
    });
  },
};
