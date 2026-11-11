/**
 * Matches: setup + event log in SQLite; state derived with @ogp/sports-model.
 * The active match is published to the data hub under `match` (what graphics bind to).
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull, max } from 'drizzle-orm';
import {
  getSport, listSports, phaseActions, publishMatch, validateEvent,
  type EventInput, type MatchEvent, type MatchSetup, type Player, type Team, type TeamSide,
} from '@ogp/sports-model';
import type { Db } from '../db/client.ts';
import { matchEvents, matches } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { Emitter } from '../events.ts';
import type { DataHub } from '../data/data-hub.ts';

export interface MatchSummary {
  id: string;
  sport: string;
  name: string;
  active: boolean;
  updatedAt: number;
}

export interface MatchDto extends MatchSummary {
  home: Team;
  away: Team;
  settings: Record<string, unknown>;
  events: MatchEvent[];
  /** The data published to graphics (match.*) */
  published: Record<string, unknown>;
  actions: { type: string; data?: Record<string, unknown>; label: string }[];
  canUndo: boolean;
  canRedo: boolean;
}

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;

/** Normalises a team from user input (ids are generated where missing, lineups filtered to known players). */
export function normaliseTeam(input: unknown, fallback: Team): Team {
  if (!isObj(input)) return fallback;
  const t: Team = { ...fallback };
  if (typeof input.name === 'string') t.name = input.name.trim();
  if (typeof input.code === 'string') t.code = input.code.trim().toUpperCase().slice(0, 5);
  if (typeof input.color === 'string') t.color = HEX.test(input.color) ? input.color.toLowerCase() : t.color;
  if (typeof input.color2 === 'string') t.color2 = HEX.test(input.color2) ? input.color2.toLowerCase() : '';
  for (const k of ['logo', 'coach', 'formation'] as const) if (typeof input[k] === 'string') t[k] = (input[k] as string).trim();
  if (Array.isArray(input.players)) {
    const seen = new Set<string>();
    t.players = input.players.filter(isObj).map((p): Player => {
      let id = typeof p.id === 'string' && p.id ? p.id : randomUUID().slice(0, 8);
      while (seen.has(id)) id = randomUUID().slice(0, 8);
      seen.add(id);
      const num = typeof p.number === 'number' && Number.isFinite(p.number) ? Math.round(p.number) : typeof p.number === 'string' && p.number.trim() !== '' && !Number.isNaN(Number(p.number)) ? Math.round(Number(p.number)) : null;
      const out: Player = { id, number: num, name: typeof p.name === 'string' ? p.name.trim() : '' };
      if (typeof p.position === 'string' && p.position) out.position = p.position;
      if (p.captain === true) out.captain = true;
      return out;
    });
  }
  const ids = new Set(t.players.map((p) => p.id));
  const pick = (v: unknown, prev: string[]) => (Array.isArray(v) ? v : prev).filter((x): x is string => typeof x === 'string' && ids.has(x));
  t.starters = [...new Set(pick(input.starters, t.starters))];
  t.bench = [...new Set(pick(input.bench, t.bench))].filter((id) => !t.starters.includes(id));
  return t;
}

const emptyTeam = (name: string, code: string, color: string): Team => ({ name, code, color, players: [], starters: [], bench: [] });

export class MatchService extends Emitter<{ changed: MatchDto; removed: { matchId: string }; list: MatchSummary[] }> {
  constructor(private readonly db: Db, private readonly hub: DataHub) {
    super();
    const active = db.select().from(matches).where(eq(matches.active, true)).get();
    if (active) this.publish(active.id);
  }

  sports() {
    return listSports().map((s) => ({ ...s, defaultSettings: getSport(s.id).defaultSettings(), eventTypes: getSport(s.id).eventTypes }));
  }

  list(): MatchSummary[] {
    return this.db.select().from(matches).orderBy(desc(matches.updatedAt)).all()
      .map((m) => ({ id: m.id, sport: m.sport, name: m.name, active: m.active, updatedAt: m.updatedAt }));
  }

  private row(id: string) {
    const m = this.db.select().from(matches).where(eq(matches.id, id)).get();
    if (!m) throw notFound(`match "${id}"`);
    return m;
  }

  private setupOf(row: typeof matches.$inferSelect): MatchSetup {
    const s = row.setup as { home: Team; away: Team; settings: Rec };
    return { id: row.id, sport: row.sport, name: row.name, home: s.home, away: s.away, settings: s.settings ?? {} };
  }

  private events(matchId: string): MatchEvent[] {
    return this.db.select().from(matchEvents).where(and(eq(matchEvents.matchId, matchId), isNull(matchEvents.deletedAt))).orderBy(asc(matchEvents.seq)).all()
      .map((e) => ({ id: e.id, seq: e.seq, type: e.type, at: e.at, ...(e.team ? { team: e.team as TeamSide } : {}), data: e.data as Rec }));
  }

  get(id: string): MatchDto {
    const row = this.row(id);
    const setup = this.setupOf(row);
    const events = this.events(id);
    const deleted = this.db.select({ id: matchEvents.id }).from(matchEvents).where(and(eq(matchEvents.matchId, id), isNotNull(matchEvents.deletedAt))).get();
    return {
      id, sport: row.sport, name: row.name, active: row.active, updatedAt: row.updatedAt,
      home: setup.home, away: setup.away, settings: setup.settings,
      events,
      published: publishMatch(setup, events),
      actions: phaseActions(setup, events),
      canUndo: events.length > 0,
      canRedo: !!deleted,
    };
  }

  create(input: { name?: string; sport?: string; home?: unknown; away?: unknown; settings?: unknown }): MatchDto {
    const sport = input.sport ?? 'football';
    let plugin;
    try {
      plugin = getSport(sport);
    } catch {
      throw badRequest(`unknown sport "${sport}"`);
    }
    const id = randomUUID();
    const now = Date.now();
    const home = normaliseTeam(input.home, emptyTeam('Home', 'HOM', '#d81e3c'));
    const away = normaliseTeam(input.away, emptyTeam('Away', 'AWY', '#1e6bd8'));
    const settings = { ...plugin.defaultSettings(), ...(isObj(input.settings) ? input.settings : {}) };
    const name = input.name?.trim() || `${home.name} – ${away.name}`;
    this.db.insert(matches).values({ id, sport, name, setup: { home, away, settings }, active: false, createdAt: now, updatedAt: now }).run();
    return this.changed(id);
  }

  update(id: string, patch: { name?: unknown; home?: unknown; away?: unknown; settings?: unknown }): MatchDto {
    const row = this.row(id);
    const setup = this.setupOf(row);
    const next = {
      home: patch.home !== undefined ? normaliseTeam(patch.home, setup.home) : setup.home,
      away: patch.away !== undefined ? normaliseTeam(patch.away, setup.away) : setup.away,
      settings: isObj(patch.settings) ? { ...setup.settings, ...patch.settings } : setup.settings,
    };
    // An automatic name ("Home – Away") follows team renames; a custom name is kept.
    const autoName = row.name === `${setup.home.name} – ${setup.away.name}`;
    const name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : autoName ? `${next.home.name} – ${next.away.name}` : row.name;
    this.db.update(matches).set({ name, setup: next, updatedAt: Date.now() }).where(eq(matches.id, id)).run();
    return this.changed(id);
  }

  delete(id: string): void {
    const row = this.row(id);
    this.db.delete(matches).where(eq(matches.id, id)).run();
    if (row.active) this.hub.delete('match');
    this.emit('removed', { matchId: id });
    this.emit('list', this.list());
  }

  /** Makes this the active match (published as `match.*`); null deactivates all. */
  activate(id: string | null): MatchDto | null {
    if (id) this.row(id);
    this.db.transaction((tx) => {
      tx.update(matches).set({ active: false }).where(eq(matches.active, true)).run();
      if (id) tx.update(matches).set({ active: true, updatedAt: Date.now() }).where(eq(matches.id, id)).run();
    });
    if (!id) {
      this.hub.delete('match');
      this.emit('list', this.list());
      return null;
    }
    return this.changed(id);
  }

  // ---------------- events ----------------

  addEvent(id: string, input: EventInput, at = Date.now()): MatchDto {
    const row = this.row(id);
    const setup = this.setupOf(row);
    const events = this.events(id);
    const clean: EventInput = { type: String(input.type ?? ''), data: isObj(input.data) ? input.data : {} };
    if (input.team !== undefined) clean.team = input.team;
    const v = validateEvent(setup, events, clean);
    if (!v.ok) throw new HttpError(422, v.error);
    const maxSeq = this.db.select({ v: max(matchEvents.seq) }).from(matchEvents).where(eq(matchEvents.matchId, id)).get()?.v ?? 0;
    this.db.transaction((tx) => {
      // a new event invalidates redo
      tx.delete(matchEvents).where(and(eq(matchEvents.matchId, id), isNotNull(matchEvents.deletedAt))).run();
      tx.insert(matchEvents).values({
        id: randomUUID(), matchId: id, seq: maxSeq + 1, type: clean.type, team: clean.team ?? null, data: clean.data ?? {},
        at, deletedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
      }).run();
      tx.update(matches).set({ updatedAt: Date.now() }).where(eq(matches.id, id)).run();
    });
    return this.changed(id);
  }

  /** Edits an event (team/data); it is re-validated against the events before it. */
  updateEvent(id: string, eventId: string, patch: { team?: unknown; data?: unknown }): MatchDto {
    const setup = this.setupOf(this.row(id));
    const events = this.events(id);
    const idx = events.findIndex((e) => e.id === eventId);
    if (idx < 0) throw notFound(`event "${eventId}"`);
    const ev = events[idx]!;
    const edited: EventInput = { type: ev.type, data: isObj(patch.data) ? { ...ev.data, ...patch.data } : ev.data };
    const team = patch.team !== undefined ? patch.team : ev.team;
    if (team === 'home' || team === 'away') edited.team = team;
    const v = validateEvent(setup, events.slice(0, idx), edited);
    if (!v.ok) throw new HttpError(422, v.error);
    for (const [k, val] of Object.entries(edited.data ?? {})) if (val === null) delete edited.data![k];
    this.db.update(matchEvents).set({ team: edited.team ?? null, data: edited.data ?? {}, updatedAt: Date.now() }).where(eq(matchEvents.id, eventId)).run();
    this.touch(id);
    return this.changed(id);
  }

  deleteEvent(id: string, eventId: string): MatchDto {
    this.row(id);
    const r = this.db.update(matchEvents).set({ deletedAt: Date.now() }).where(and(eq(matchEvents.id, eventId), eq(matchEvents.matchId, id), isNull(matchEvents.deletedAt))).run();
    if (r.changes === 0) throw notFound(`event "${eventId}"`);
    this.touch(id);
    return this.changed(id);
  }

  undo(id: string): MatchDto {
    const last = this.events(id).at(-1);
    if (!last) throw new HttpError(409, 'nothing to undo');
    return this.deleteEvent(id, last.id);
  }

  redo(id: string): MatchDto {
    this.row(id);
    const ev = this.db.select().from(matchEvents).where(and(eq(matchEvents.matchId, id), isNotNull(matchEvents.deletedAt))).orderBy(desc(matchEvents.deletedAt), desc(matchEvents.seq)).get();
    if (!ev) throw new HttpError(409, 'nothing to redo');
    this.db.update(matchEvents).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(matchEvents.id, ev.id)).run();
    this.touch(id);
    return this.changed(id);
  }

  // ---------------- internals ----------------

  private touch(id: string) {
    this.db.update(matches).set({ updatedAt: Date.now() }).where(eq(matches.id, id)).run();
  }

  private publish(id: string) {
    const row = this.row(id);
    this.hub.set('match', publishMatch(this.setupOf(row), this.events(id)));
  }

  private changed(id: string): MatchDto {
    const dto = this.get(id);
    if (dto.active) this.hub.set('match', dto.published);
    this.emit('changed', dto);
    this.emit('list', this.list());
    return dto;
  }
}
