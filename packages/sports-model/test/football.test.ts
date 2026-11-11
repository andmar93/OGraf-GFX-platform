import { describe, expect, it } from 'vitest';
import {
  deriveState, displayMinute, elapsedAt, football, listSports, publishMatch, validateEvent,
  type EventInput, type MatchEvent, type MatchSetup, type Team,
} from '../src/index.ts';
import { nextPeriodAction, shootoutStatus, type FootballState } from '../src/sports/football/index.ts';

const MIN = 60_000;
const team = (code: string, n = 14): Team => {
  const players = Array.from({ length: n }, (_, i) => ({ id: `${code}${i + 1}`, number: i + 1, name: `${code} Player ${i + 1}` }));
  return { name: `${code} FC`, code, color: '#ff0000', players, starters: players.slice(0, 11).map((p) => p.id), bench: players.slice(11).map((p) => p.id) };
};
const setup = (settings: Record<string, unknown> = {}): MatchSetup => ({ id: 'm1', sport: 'football', name: 'Test', home: team('HOM'), away: team('AWY'), settings });

/** Small helper that records events like the server does (validate, then append). */
function match(s = setup()) {
  const events: MatchEvent[] = [];
  let t = 1_000_000;
  const api = {
    events,
    /** advance server time */
    wait(ms: number) { t += ms; return api; },
    add(e: EventInput) {
      const v = validateEvent(s, events, e);
      if (!v.ok) throw new Error(v.error);
      events.push({ id: `e${events.length + 1}`, seq: events.length + 1, type: e.type, at: t, ...(e.team ? { team: e.team } : {}), data: e.data ?? {} });
      return api;
    },
    try(e: EventInput) { return validateEvent(s, events, e); },
    state: () => deriveState<FootballState>(s, events),
    pub: () => publishMatch(s, events) as any,
    now: () => t,
  };
  return api;
}

describe('registry', () => {
  it('has football registered', () => {
    expect(listSports()).toContainEqual({ id: 'football', name: 'Football' });
  });
});

describe('football – score', () => {
  it('counts goals, penalties and own goals for the right team', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } })
      .wait(10 * MIN).add({ type: 'goal', team: 'home', data: { playerId: 'HOM9' } })
      .wait(5 * MIN).add({ type: 'goal', team: 'away', data: { kind: 'penalty', playerId: 'AWY10' } })
      .wait(5 * MIN).add({ type: 'goal', team: 'home', data: { kind: 'own_goal', playerId: 'AWY4' } });
    expect(m.state().score).toEqual({ home: 2, away: 1 });
    const p = m.pub();
    expect(p.home.score).toBe(2);
    expect(p.away.score).toBe(1);
    expect(p.home.scorers).toEqual(["HOM Player 9 11'", "AWY Player 4 (o.g.) 21'"]);
    expect(p.away.scorers).toEqual(["AWY Player 10 16' (pen.)"]);
    expect(p.events.lastGoal).toMatchObject({ kind: 'own_goal', team: 'home', playerName: 'AWY Player 4', minute: "21'", score: '2–1' });
  });

  it('rejects goals with a player from the wrong squad', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } });
    expect(m.try({ type: 'goal', team: 'home', data: { playerId: 'AWY9' } }).ok).toBe(false);
    expect(m.try({ type: 'goal', team: 'home', data: { kind: 'own_goal', playerId: 'HOM9' } }).ok).toBe(false);
    expect(m.try({ type: 'goal', data: {} }).ok).toBe(false); // team required
  });

  it('undo = replay without the event', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } }).wait(MIN).add({ type: 'goal', team: 'home' });
    expect(m.state().score.home).toBe(1);
    m.events.pop();
    expect(m.state().score.home).toBe(0);
  });
});

describe('football – clock and periods', () => {
  it('runs through halves with the right anchors and limits', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } });
    const t0 = m.now();
    let c = m.state().clock;
    expect(c).toMatchObject({ running: true, anchorAt: t0, elapsedAtAnchor: 0, limitMs: 45 * MIN });
    m.wait(47 * MIN); // 2 minutes stoppage
    expect(elapsedAt(m.state().clock, m.now())).toBe(47 * MIN);
    m.add({ type: 'period.end', data: { period: 'H1' } });
    c = m.state().clock;
    expect(c).toMatchObject({ running: false, elapsedAtAnchor: 45 * MIN });
    expect(m.state().phase).toBe('HT');
    m.wait(15 * MIN).add({ type: 'period.start', data: { period: 'H2' } });
    expect(m.state().clock).toMatchObject({ running: true, elapsedAtAnchor: 45 * MIN, limitMs: 90 * MIN });
    m.wait(10 * MIN);
    expect(elapsedAt(m.state().clock, m.now())).toBe(55 * MIN);
  });

  it('stops, restarts, sets and adjusts the clock', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } }).wait(10 * MIN).add({ type: 'clock.stop' });
    m.wait(5 * MIN);
    expect(elapsedAt(m.state().clock, m.now())).toBe(10 * MIN);
    m.add({ type: 'clock.start' }).wait(MIN);
    expect(elapsedAt(m.state().clock, m.now())).toBe(11 * MIN);
    m.add({ type: 'clock.adjust', data: { deltaMs: -30_000 } });
    expect(elapsedAt(m.state().clock, m.now())).toBe(10.5 * MIN);
    m.add({ type: 'clock.set', data: { elapsedMs: 20 * MIN } }).wait(MIN);
    expect(elapsedAt(m.state().clock, m.now())).toBe(21 * MIN);
  });

  it('publishes a clock value graphics can count from', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } });
    expect(m.pub().clock).toMatchObject({ $type: 'clock', running: true, anchorServerMs: m.now(), elapsedAtAnchorMs: 0, limitMs: 45 * MIN, label: '1st half' });
  });

  it('formats minutes with stoppage time', () => {
    expect(displayMinute(0, 45 * MIN)).toBe("1'");
    expect(displayMinute(22 * MIN + 10_000, 45 * MIN)).toBe("23'");
    expect(displayMinute(44 * MIN + 59_000, 45 * MIN)).toBe("45'");
    expect(displayMinute(45 * MIN + 30_000, 45 * MIN)).toBe("45+1'");
    expect(displayMinute(92 * MIN, 90 * MIN)).toBe("90+3'");
  });

  it('uses stoppage minutes for events and allows a manual minute', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } }).wait(46 * MIN + 10_000).add({ type: 'goal', team: 'away' })
      .add({ type: 'goal', team: 'away', data: { minute: "44'" } });
    expect(m.pub().events.list.map((e: any) => e.minute).slice(0, 2)).toEqual(["44'", "45+2'"]);
  });

  it('enforces period order and offers the next actions', () => {
    const m = match();
    expect(m.try({ type: 'period.start', data: { period: 'H2' } }).ok).toBe(false);
    expect(m.try({ type: 'clock.start' }).ok).toBe(false);
    expect(nextPeriodAction('pre')[0]).toMatchObject({ type: 'period.start', period: 'H1' });
    m.add({ type: 'period.start', data: { period: 'H1' } });
    expect(m.try({ type: 'period.start', data: { period: 'H1' } }).ok).toBe(false);
    m.add({ type: 'period.end', data: { period: 'H1' } }).add({ type: 'period.start', data: { period: 'H2' } }).add({ type: 'period.end', data: { period: 'H2' } });
    expect(m.state().phase).toBe('FT');
    expect(nextPeriodAction('FT').map((a) => a.label)).toEqual(['End match', 'Start extra time', 'Start penalties']);
    m.add({ type: 'match.end' });
    expect(m.try({ type: 'goal', team: 'home' }).ok).toBe(false);
    expect(m.pub().result).toEqual({ finished: true, winner: 'draw' });
  });

  it('supports extra time with custom lengths', () => {
    const m = match(setup({ halfLengthMin: 40, extraTimeHalfMin: 10 }));
    m.add({ type: 'period.start', data: { period: 'H1' } }).add({ type: 'period.end', data: { period: 'H1' } })
      .add({ type: 'period.start', data: { period: 'H2' } }).add({ type: 'period.end', data: { period: 'H2' } })
      .add({ type: 'period.start', data: { period: 'ET1' } });
    expect(m.state().clock).toMatchObject({ elapsedAtAnchor: 80 * MIN, limitMs: 90 * MIN });
    expect(m.pub().period).toBe('ET');
    m.add({ type: 'period.end', data: { period: 'ET1' } }).add({ type: 'period.start', data: { period: 'ET2' } });
    expect(m.state().clock).toMatchObject({ elapsedAtAnchor: 90 * MIN, limitMs: 100 * MIN });
    m.add({ type: 'period.end', data: { period: 'ET2' } });
    expect(m.pub().period).toBe('AET');
  });

  it('publishes added time only while a period runs', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } }).add({ type: 'added_time', data: { minutes: 3 } });
    expect(m.pub().addedTime).toBe(3);
    m.add({ type: 'period.end', data: { period: 'H1' } });
    expect(m.pub().addedTime).toBe(0);
    expect(m.pub().period).toBe('HT');
  });
});

describe('football – cards, substitutions and stats', () => {
  it('turns a second yellow into a red', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } })
      .add({ type: 'card', team: 'home', data: { card: 'yellow', playerId: 'HOM5' } })
      .add({ type: 'card', team: 'home', data: { card: 'yellow', playerId: 'HOM5' } });
    const s = m.state();
    expect(s.players.home.HOM5).toMatchObject({ yellow: 2, sentOff: true, onPitch: false });
    expect(s.stats.home).toMatchObject({ yellowCards: 2, redCards: 1 });
    expect(m.pub().events.lastCard).toMatchObject({ kind: 'second_yellow', playerName: 'HOM Player 5' });
    expect(m.pub().home.onPitch).toHaveLength(10);
  });

  it('substitutes players and validates the swap', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } }).add({ type: 'substitution', team: 'away', data: { outId: 'AWY9', inId: 'AWY12' } });
    const s = m.state();
    expect(s.players.away.AWY9).toMatchObject({ onPitch: false, subbedOut: true });
    expect(s.players.away.AWY12).toMatchObject({ onPitch: true, subbedIn: true });
    expect(m.pub().events.lastSub).toMatchObject({ inName: 'AWY Player 12', outName: 'AWY Player 9', inNumber: 12, outNumber: 9 });
    expect(m.try({ type: 'substitution', team: 'away', data: { outId: 'AWY9', inId: 'AWY13' } }).ok).toBe(false); // already off
    expect(m.try({ type: 'substitution', team: 'away', data: { outId: 'AWY1', inId: 'AWY12' } }).ok).toBe(false); // already on
    expect(m.try({ type: 'substitution', team: 'away', data: { outId: 'AWY1', inId: 'AWY9' } }).ok).toBe(false); // subbed out
  });

  it('counts stats', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } })
      .add({ type: 'shot', team: 'home' }).add({ type: 'shot', team: 'home', data: { onTarget: true } }).add({ type: 'goal', team: 'home' })
      .add({ type: 'corner', team: 'away' }).add({ type: 'foul', team: 'away' }).add({ type: 'offside', team: 'home' });
    expect(m.pub().home.stats).toMatchObject({ shots: 3, shotsOnTarget: 2, offsides: 1 });
    expect(m.pub().away.stats).toMatchObject({ corners: 1, fouls: 1 });
  });

  it('publishes lineups for graphics', () => {
    const p = match().pub();
    expect(p.home.starters).toHaveLength(11);
    expect(p.home.substitutes).toHaveLength(3);
    expect(p.home.starters[0]).toEqual({ id: 'HOM1', number: 1, name: 'HOM Player 1', position: '', captain: false });
    expect(p.home.code).toBe('HOM');
  });
});

describe('penalty shootout', () => {
  const kicks = (seq: string, first: 'home' | 'away' = 'home') => {
    // seq like "HxAoHo": team letter + o (scored) / x (missed)
    const out = [];
    for (let i = 0; i < seq.length; i += 2) out.push({ team: seq[i] === 'H' ? 'home' as const : 'away' as const, scored: seq[i + 1] === 'o' });
    return shootoutStatus(out, first);
  };

  it('alternates and tracks scores', () => {
    expect(kicks('')).toMatchObject({ nextTeam: 'home', round: 1, decided: false });
    expect(kicks('Ho')).toMatchObject({ nextTeam: 'away', homeScore: 1 });
    expect(kicks('HoAx')).toMatchObject({ nextTeam: 'home', round: 2, home: [true], away: [false] });
    expect(kicks('', 'away').nextTeam).toBe('away');
  });

  it('is decided early when a team cannot catch up', () => {
    // 3–0 after 3 each: away has 2 left -> decided
    expect(kicks('HoAxHoAxHoAx')).toMatchObject({ decided: true, winner: 'home' });
    // 3–1 after home's 4th? home 3 (4 taken: o o o x), away 1 (3 taken): away can reach 3 -> not decided
    expect(kicks('HoAxHoAoHoAxHx').decided).toBe(false);
    // home 4/4, away 1/3: away can reach 3 < 4 -> decided after home's 4th kick
    expect(kicks('HoAxHoAoHoAxHo')).toMatchObject({ decided: true, winner: 'home' });
  });

  it('goes to sudden death after a level 5 rounds', () => {
    const level = 'HoAoHoAoHoAoHoAoHxAx';
    expect(kicks(level)).toMatchObject({ decided: false, suddenDeath: true, round: 6, nextTeam: 'home' });
    expect(kicks(`${level}Ho`).decided).toBe(false); // second team still to kick
    expect(kicks(`${level}HoAo`).decided).toBe(false);
    expect(kicks(`${level}HoAoHxAo`)).toMatchObject({ decided: true, winner: 'away', homeScore: 5, awayScore: 6 });
  });

  it('runs inside a match, enforces the order and decides the winner', () => {
    const m = match().add({ type: 'period.start', data: { period: 'H1' } }).add({ type: 'period.end', data: { period: 'H1' } })
      .add({ type: 'period.start', data: { period: 'H2' } }).add({ type: 'period.end', data: { period: 'H2' } })
      .add({ type: 'period.start', data: { period: 'PEN', first: 'away' } });
    expect(m.try({ type: 'shootout.kick', team: 'home', data: { scored: true } }).ok).toBe(false); // away first
    for (let i = 0; i < 3; i++) m.add({ type: 'shootout.kick', team: 'away', data: { scored: true } }).add({ type: 'shootout.kick', team: 'home', data: { scored: false } });
    const p = m.pub();
    expect(p.shootout).toMatchObject({ homeScore: 0, awayScore: 3, decided: true, winner: 'away', nextTeam: null, home: [false, false, false] });
    expect(p.period).toBe('PENS 0–3');
    expect(p.home.pens).toBe(0);
    expect(m.try({ type: 'shootout.kick', team: 'away', data: { scored: true } }).ok).toBe(false);
    m.add({ type: 'period.end', data: { period: 'PEN' } });
    expect(m.pub().result).toEqual({ finished: true, winner: 'away' });
  });
});

describe('plugin contract', () => {
  it('rejects unknown event types', () => {
    expect(football.validate(football.initialState(setup()), { type: 'touchdown' }, setup()).ok).toBe(false);
  });
});
