/**
 * Match API (/api/v1/matches) used by the data tool (and later Companion).
 */
import type { FastifyInstance } from 'fastify';
import type { TeamSide } from '@ogp/sports-model';
import { badRequest } from '../errors.ts';
import type { Services } from '../services.ts';
import type { ControlAdapter } from './control-adapter.ts';

type Body = Record<string, unknown>;

export const matchApi: ControlAdapter = {
  name: 'Match API v1',
  prefix: '/api/v1/matches',
  register(app: FastifyInstance, s: Services) {
    const p = this.prefix;
    type M = { Params: { matchId: string }; Body: Body };
    type E = { Params: { matchId: string; eventId: string }; Body: Body };

    app.get('/api/v1/sports', async () => ({ sports: s.matches.sports() }));
    app.get(p, async () => ({ matches: s.matches.list() }));
    app.post<{ Body: Body }>(p, async (req, reply) => {
      const b = req.body ?? {};
      return reply.status(201).send({ match: s.matches.create({ name: b.name as string | undefined, sport: b.sport as string | undefined, home: b.home, away: b.away, settings: b.settings }) });
    });
    /** The active match (or null). */
    app.get(`${p}/active`, async () => {
      const a = s.matches.list().find((m) => m.active);
      return { match: a ? s.matches.get(a.id) : null };
    });
    app.post(`${p}/deactivate`, async () => {
      s.matches.activate(null);
      return { ok: true };
    });
    app.get<M>(`${p}/:matchId`, async (req) => ({ match: s.matches.get(req.params.matchId) }));
    app.patch<M>(`${p}/:matchId`, async (req) => {
      const b = req.body ?? {};
      return { match: s.matches.update(req.params.matchId, { name: b.name, home: b.home, away: b.away, settings: b.settings }) };
    });
    app.delete<M>(`${p}/:matchId`, async (req) => {
      s.matches.delete(req.params.matchId);
      return { ok: true };
    });
    app.post<M>(`${p}/:matchId/activate`, async (req) => ({ match: s.matches.activate(req.params.matchId) }));

    app.post<M>(`${p}/:matchId/events`, async (req, reply) => {
      const b = req.body ?? {};
      if (typeof b.type !== 'string') throw badRequest('type is required');
      const team = b.team === 'home' || b.team === 'away' ? (b.team as TeamSide) : undefined;
      if (b.team !== undefined && !team) throw badRequest('team must be home or away');
      return reply.status(201).send({ match: s.matches.addEvent(req.params.matchId, { type: b.type, ...(team ? { team } : {}), data: (b.data ?? {}) as Body }) });
    });
    app.patch<E>(`${p}/:matchId/events/:eventId`, async (req) => {
      const b = req.body ?? {};
      return { match: s.matches.updateEvent(req.params.matchId, req.params.eventId, { team: b.team, data: b.data }) };
    });
    app.delete<E>(`${p}/:matchId/events/:eventId`, async (req) => ({ match: s.matches.deleteEvent(req.params.matchId, req.params.eventId) }));
    app.post<M>(`${p}/:matchId/undo`, async (req) => ({ match: s.matches.undo(req.params.matchId) }));
    app.post<M>(`${p}/:matchId/redo`, async (req) => ({ match: s.matches.redo(req.params.matchId) }));
  },
};
