/**
 * Football (soccer) plugin.
 *
 * Periods: H1, H2, extra time ET1/ET2 and a penalty shootout (PEN). The clock is driven by events:
 * period.start/end, clock.start/stop, clock.set/adjust. Scores, cards, substitutions, stats and the
 * shootout are derived from events, so undo/edit is just replaying a changed event list.
 *
 * Convention: `team` on a goal is the team the goal counts for. For an own goal, data.playerId is a
 * player of the other team.
 */
import { adjustClock, displayMinute, elapsedAt, setClock, startClock, stopClock, stoppedClock, toClockValue, type ClockState } from '../../clock.ts';
import { otherSide, SIDES, type EventInput, type MatchEvent, type MatchSetup, type Player, type SportPlugin, type TeamSide, type Validation } from '../../types.ts';
import { shootoutStatus, type ShootoutKick, type ShootoutStatus } from './shootout.ts';

export * from './shootout.ts';

export type Period = 'H1' | 'H2' | 'ET1' | 'ET2' | 'PEN';
export type Phase = 'pre' | 'H1' | 'HT' | 'H2' | 'FT' | 'ET1' | 'ETHT' | 'ET2' | 'AET' | 'PEN' | 'END';
export type GoalKind = 'normal' | 'penalty' | 'own_goal';
export type CardKind = 'yellow' | 'red';

export interface FootballSettings {
  halfLengthMin: number;
  extraTimeHalfMin: number;
  shootoutRounds: number;
}

export const DEFAULT_SETTINGS: FootballSettings = { halfLengthMin: 45, extraTimeHalfMin: 15, shootoutRounds: 5 };

export interface PlayerState {
  yellow: number;
  sentOff: boolean;
  onPitch: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  goals: number;
}

export interface TeamStats {
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  offsides: number;
  yellowCards: number;
  redCards: number;
}

/** An event as shown in logs and on air. */
export interface LoggedEvent {
  id: string;
  seq: number;
  type: string;
  /** goal / own_goal / penalty_goal / yellow / second_yellow / red / sub / var / corner / shot / ... */
  kind: string;
  team?: TeamSide;
  elapsedMs: number;
  minute: string;
  text: string;
  playerId?: string;
  inPlayerId?: string;
  outPlayerId?: string;
  assistId?: string;
}

export interface FootballState {
  phase: Phase;
  clock: ClockState;
  addedTime: number;
  score: Record<TeamSide, number>;
  players: Record<TeamSide, Record<string, PlayerState>>;
  stats: Record<TeamSide, TeamStats>;
  shootoutFirst: TeamSide;
  kicks: ShootoutKick[];
  log: LoggedEvent[];
}

export function settingsOf(setup: MatchSetup): FootballSettings {
  return { ...DEFAULT_SETTINGS, ...(setup.settings as Partial<FootballSettings>) };
}

/** Elapsed time at the start of a period and where its regulation time ends (ms). */
export function periodBounds(p: Period, s: FootballSettings): { start: number; limit: number | null } {
  const h = s.halfLengthMin * 60_000;
  const e = s.extraTimeHalfMin * 60_000;
  switch (p) {
    case 'H1': return { start: 0, limit: h };
    case 'H2': return { start: h, limit: 2 * h };
    case 'ET1': return { start: 2 * h, limit: 2 * h + e };
    case 'ET2': return { start: 2 * h + e, limit: 2 * h + 2 * e };
    case 'PEN': return { start: 2 * h + 2 * e, limit: null };
  }
}

const PERIOD_NAMES: Record<Phase, string> = {
  pre: 'Pre-match', H1: '1st half', HT: 'Half-time', H2: '2nd half', FT: 'Full-time', ET1: 'Extra time 1st half',
  ETHT: 'Extra time half-time', ET2: 'Extra time 2nd half', AET: 'After extra time', PEN: 'Penalties', END: 'Full-time',
};

/** Which phase a period start/end is allowed from, and what it leads to. */
const START_FROM: Record<Period, Phase[]> = { H1: ['pre'], H2: ['HT'], ET1: ['FT'], ET2: ['ETHT'], PEN: ['FT', 'AET'] };
const END_TO: Record<Period, Phase> = { H1: 'HT', H2: 'FT', ET1: 'ETHT', ET2: 'AET', PEN: 'END' };
const RUNNING: Phase[] = ['H1', 'H2', 'ET1', 'ET2'];

const emptyStats = (): TeamStats => ({ shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, offsides: 0, yellowCards: 0, redCards: 0 });

function findPlayer(setup: MatchSetup, side: TeamSide, id: unknown): Player | undefined {
  return typeof id === 'string' ? setup[side].players.find((p) => p.id === id) : undefined;
}

function playerLabel(p: Player | undefined): string {
  if (!p) return '';
  return p.name || (p.number !== null ? `#${p.number}` : '');
}

/** The next legal period transition (for UIs: one big contextual button). */
export function nextPeriodAction(phase: Phase): { type: 'period.start' | 'period.end' | 'match.end'; period?: Period; label: string }[] {
  switch (phase) {
    case 'pre': return [{ type: 'period.start', period: 'H1', label: 'Kick-off' }];
    case 'H1': return [{ type: 'period.end', period: 'H1', label: 'End 1st half' }];
    case 'HT': return [{ type: 'period.start', period: 'H2', label: 'Start 2nd half' }];
    case 'H2': return [{ type: 'period.end', period: 'H2', label: 'End 2nd half' }];
    case 'FT': return [
      { type: 'match.end', label: 'End match' },
      { type: 'period.start', period: 'ET1', label: 'Start extra time' },
      { type: 'period.start', period: 'PEN', label: 'Start penalties' },
    ];
    case 'ET1': return [{ type: 'period.end', period: 'ET1', label: 'End ET 1st half' }];
    case 'ETHT': return [{ type: 'period.start', period: 'ET2', label: 'Start ET 2nd half' }];
    case 'ET2': return [{ type: 'period.end', period: 'ET2', label: 'End extra time' }];
    case 'AET': return [{ type: 'match.end', label: 'End match' }, { type: 'period.start', period: 'PEN', label: 'Start penalties' }];
    case 'PEN': return [{ type: 'period.end', period: 'PEN', label: 'End penalties' }];
    case 'END': return [];
  }
}

export function shootout(state: FootballState, setup: MatchSetup): ShootoutStatus {
  return shootoutStatus(state.kicks, state.shootoutFirst, settingsOf(setup).shootoutRounds);
}

const TEAM_EVENTS = new Set(['goal', 'card', 'substitution', 'corner', 'shot', 'foul', 'offside', 'shootout.kick']);

export const football: SportPlugin<FootballState> = {
  id: 'football',
  name: 'Football',
  defaultSettings: () => ({ ...DEFAULT_SETTINGS }),
  eventTypes: [
    { type: 'period.start', label: 'Start period', team: false },
    { type: 'period.end', label: 'End period', team: false },
    { type: 'match.end', label: 'End match', team: false },
    { type: 'clock.start', label: 'Start clock', team: false },
    { type: 'clock.stop', label: 'Stop clock', team: false },
    { type: 'clock.set', label: 'Set clock', team: false },
    { type: 'clock.adjust', label: 'Adjust clock', team: false },
    { type: 'added_time', label: 'Added time', team: false },
    { type: 'goal', label: 'Goal', team: true },
    { type: 'card', label: 'Card', team: true },
    { type: 'substitution', label: 'Substitution', team: true },
    { type: 'var', label: 'VAR', team: false },
    { type: 'corner', label: 'Corner', team: true },
    { type: 'shot', label: 'Shot', team: true },
    { type: 'foul', label: 'Foul', team: true },
    { type: 'offside', label: 'Offside', team: true },
    { type: 'shootout.kick', label: 'Shootout kick', team: true },
  ],

  initialState(setup) {
    const players = {} as FootballState['players'];
    for (const side of SIDES) {
      players[side] = {};
      for (const p of setup[side].players) {
        players[side][p.id] = { yellow: 0, sentOff: false, onPitch: setup[side].starters.includes(p.id), subbedIn: false, subbedOut: false, goals: 0 };
      }
    }
    return {
      phase: 'pre',
      clock: stoppedClock(0, periodBounds('H1', settingsOf(setup)).limit),
      addedTime: 0,
      score: { home: 0, away: 0 },
      players,
      stats: { home: emptyStats(), away: emptyStats() },
      shootoutFirst: 'home',
      kicks: [],
      log: [],
    };
  },

  validate(state, e: EventInput, setup): Validation {
    const d = e.data ?? {};
    const fail = (error: string): Validation => ({ ok: false, error });
    if (!football.eventTypes.some((t) => t.type === e.type)) return fail(`unknown event type "${e.type}"`);
    if (TEAM_EVENTS.has(e.type) && e.team !== 'home' && e.team !== 'away') return fail('team (home/away) is required');
    if (state.phase === 'END' && !e.type.startsWith('clock.')) return fail('the match has ended');
    switch (e.type) {
      case 'period.start': {
        const p = d.period as Period;
        if (!(p in START_FROM)) return fail('period must be H1, H2, ET1, ET2 or PEN');
        if (!START_FROM[p].includes(state.phase)) return fail(`cannot start ${p} during ${PERIOD_NAMES[state.phase].toLowerCase()}`);
        if (p === 'PEN' && d.first !== undefined && d.first !== 'home' && d.first !== 'away') return fail('first must be home or away');
        return { ok: true };
      }
      case 'period.end': {
        const p = d.period as Period;
        if (!(p in END_TO)) return fail('period must be H1, H2, ET1, ET2 or PEN');
        if (state.phase !== p) return fail(`${p} is not in progress`);
        return { ok: true };
      }
      case 'match.end':
        return ['FT', 'AET', 'PEN'].includes(state.phase) ? { ok: true } : fail('the match can only end after full-time');
      case 'clock.start':
      case 'clock.stop':
        return RUNNING.includes(state.phase) ? { ok: true } : fail('the clock only runs during a period');
      case 'clock.set':
        return typeof d.elapsedMs === 'number' && d.elapsedMs >= 0 ? { ok: true } : fail('elapsedMs (>= 0) is required');
      case 'clock.adjust':
        return typeof d.deltaMs === 'number' ? { ok: true } : fail('deltaMs is required');
      case 'added_time':
        return typeof d.minutes === 'number' && d.minutes >= 0 && d.minutes <= 30 ? { ok: true } : fail('minutes (0–30) is required');
      case 'goal': {
        if (d.kind !== undefined && !['normal', 'penalty', 'own_goal'].includes(d.kind as string)) return fail('kind must be normal, penalty or own_goal');
        const scorerSide = d.kind === 'own_goal' ? otherSide(e.team!) : e.team!;
        if (d.playerId !== undefined && d.playerId !== null && !findPlayer(setup, scorerSide, d.playerId)) return fail(`player not found in ${scorerSide} squad`);
        if (d.assistId !== undefined && d.assistId !== null && !findPlayer(setup, e.team!, d.assistId)) return fail('assist player not found');
        return { ok: true };
      }
      case 'card':
        if (d.card !== 'yellow' && d.card !== 'red') return fail('card must be yellow or red');
        if (d.playerId !== undefined && d.playerId !== null && !findPlayer(setup, e.team!, d.playerId)) return fail('player not found');
        return { ok: true };
      case 'substitution': {
        const ps = state.players[e.team!];
        const out = ps[d.outId as string];
        const inn = ps[d.inId as string];
        if (!out || !inn) return fail('outId and inId must be players of the team');
        if (!out.onPitch) return fail('the player going off is not on the pitch');
        if (inn.onPitch) return fail('the player coming on is already on the pitch');
        if (inn.sentOff || inn.subbedOut) return fail('the player coming on is not available');
        return { ok: true };
      }
      case 'shootout.kick': {
        if (state.phase !== 'PEN') return fail('no penalty shootout in progress');
        if (typeof d.scored !== 'boolean') return fail('scored (true/false) is required');
        const st = shootoutStatus(state.kicks, state.shootoutFirst, settingsOf(setup).shootoutRounds);
        if (st.decided) return fail('the shootout is already decided');
        if (e.team !== st.nextTeam) return fail(`it is ${st.nextTeam}'s turn`);
        return { ok: true };
      }
      default:
        return { ok: true };
    }
  },

  reduce(prev, e: MatchEvent, setup) {
    const s = structuredClone(prev);
    const st = settingsOf(setup);
    const d = e.data ?? {};
    const elapsed = elapsedAt(s.clock, e.at);
    const minuteOverride = typeof d.minute === 'string' && d.minute.trim() ? d.minute.trim() : typeof d.minute === 'number' ? `${d.minute}'` : undefined;
    const minute = minuteOverride ?? displayMinute(elapsed, s.clock.limitMs);
    const team = e.team;
    const log = (kind: string, text: string, extra: Partial<LoggedEvent> = {}) =>
      s.log.push({ id: e.id, seq: e.seq, type: e.type, kind, ...(team ? { team } : {}), elapsedMs: elapsed, minute, text, ...extra });
    const teamName = (side: TeamSide | undefined) => (side ? setup[side].code || setup[side].name : '');

    switch (e.type) {
      case 'period.start': {
        const p = d.period as Period;
        const b = periodBounds(p, st);
        s.phase = p;
        s.addedTime = 0;
        if (p === 'PEN') {
          s.clock = stopClock(s.clock, e.at);
          s.shootoutFirst = d.first === 'away' ? 'away' : 'home';
          s.clock.label = PERIOD_NAMES.PEN;
        } else {
          s.clock = { running: true, anchorAt: e.at, elapsedAtAnchor: b.start, limitMs: b.limit, label: PERIOD_NAMES[p] };
        }
        log('period_start', p === 'H1' ? 'Kick-off' : `${PERIOD_NAMES[p]} started`, { elapsedMs: b.start, minute: p === 'PEN' ? '' : displayMinute(b.start, b.limit) });
        break;
      }
      case 'period.end': {
        const p = d.period as Period;
        const b = periodBounds(p, st);
        s.phase = END_TO[p];
        s.addedTime = 0;
        // breaks show the regulation end time (45:00, 90:00, ...)
        s.clock = { ...stopClock(s.clock, e.at), ...(b.limit !== null ? { elapsedAtAnchor: b.limit } : {}), label: PERIOD_NAMES[s.phase] };
        log('period_end', `${PERIOD_NAMES[p]} ended`);
        break;
      }
      case 'match.end':
        s.phase = 'END';
        s.clock = { ...stopClock(s.clock, e.at), label: PERIOD_NAMES.END };
        log('match_end', 'Full-time');
        break;
      case 'clock.start':
        s.clock = startClock(s.clock, e.at);
        break;
      case 'clock.stop':
        s.clock = stopClock(s.clock, e.at);
        break;
      case 'clock.set':
        s.clock = setClock(s.clock, e.at, d.elapsedMs as number);
        break;
      case 'clock.adjust':
        s.clock = adjustClock(s.clock, e.at, d.deltaMs as number);
        break;
      case 'added_time':
        s.addedTime = d.minutes as number;
        log('added_time', `+${s.addedTime} min added time`);
        break;
      case 'goal': {
        const kind = (d.kind as GoalKind | undefined) ?? 'normal';
        const scorerSide = kind === 'own_goal' ? otherSide(team!) : team!;
        const scorer = findPlayer(setup, scorerSide, d.playerId);
        const assist = findPlayer(setup, team!, d.assistId);
        s.score[team!] += 1;
        if (kind !== 'own_goal') {
          s.stats[team!].shots += 1;
          s.stats[team!].shotsOnTarget += 1;
        }
        if (scorer && s.players[scorerSide][scorer.id] && kind !== 'own_goal') s.players[scorerSide][scorer.id]!.goals += 1;
        const name = playerLabel(scorer);
        const suffix = kind === 'penalty' ? ' (pen.)' : kind === 'own_goal' ? ' (o.g.)' : '';
        log(kind === 'own_goal' ? 'own_goal' : kind === 'penalty' ? 'penalty_goal' : 'goal',
          `Goal ${teamName(team)}${name ? ` – ${name}${suffix}` : suffix}`,
          { ...(scorer ? { playerId: scorer.id } : {}), ...(assist ? { assistId: assist.id } : {}) });
        break;
      }
      case 'card': {
        const p = findPlayer(setup, team!, d.playerId);
        const ps = p ? s.players[team!][p.id] : undefined;
        let kind: string = d.card as CardKind;
        if (d.card === 'yellow') {
          s.stats[team!].yellowCards += 1;
          if (ps) {
            ps.yellow += 1;
            if (ps.yellow >= 2) {
              kind = 'second_yellow';
              ps.sentOff = true;
              ps.onPitch = false;
              s.stats[team!].redCards += 1;
            }
          }
        } else {
          s.stats[team!].redCards += 1;
          if (ps) {
            ps.sentOff = true;
            ps.onPitch = false;
          }
        }
        const label = kind === 'second_yellow' ? 'Second yellow – red card' : kind === 'yellow' ? 'Yellow card' : 'Red card';
        log(kind, `${label} ${teamName(team)}${p ? ` – ${playerLabel(p)}` : ''}`, p ? { playerId: p.id } : {});
        break;
      }
      case 'substitution': {
        const out = findPlayer(setup, team!, d.outId);
        const inn = findPlayer(setup, team!, d.inId);
        const po = out ? s.players[team!][out.id] : undefined;
        const pi = inn ? s.players[team!][inn.id] : undefined;
        if (po) { po.onPitch = false; po.subbedOut = true; }
        if (pi) { pi.onPitch = true; pi.subbedIn = true; }
        log('sub', `Substitution ${teamName(team)} – ${playerLabel(inn)} on, ${playerLabel(out)} off`, {
          ...(inn ? { inPlayerId: inn.id } : {}), ...(out ? { outPlayerId: out.id } : {}),
        });
        break;
      }
      case 'var': {
        const reason = typeof d.reason === 'string' ? d.reason : 'check';
        const decision = typeof d.decision === 'string' ? d.decision : 'checking';
        log('var', `VAR ${reason.replace(/_/g, ' ')} – ${decision}`);
        break;
      }
      case 'corner':
        s.stats[team!].corners += 1;
        log('corner', `Corner ${teamName(team)}`);
        break;
      case 'shot':
        s.stats[team!].shots += 1;
        if (d.onTarget === true) s.stats[team!].shotsOnTarget += 1;
        log(d.onTarget === true ? 'shot_on_target' : 'shot', `${d.onTarget === true ? 'Shot on target' : 'Shot'} ${teamName(team)}`);
        break;
      case 'foul':
        s.stats[team!].fouls += 1;
        log('foul', `Foul ${teamName(team)}`);
        break;
      case 'offside':
        s.stats[team!].offsides += 1;
        log('offside', `Offside ${teamName(team)}`);
        break;
      case 'shootout.kick': {
        const p = findPlayer(setup, team!, d.playerId);
        s.kicks.push({ team: team!, scored: d.scored === true, ...(p ? { playerId: p.id } : {}) });
        log(d.scored ? 'shootout_scored' : 'shootout_missed', `Penalty ${teamName(team)} ${d.scored ? 'scored' : 'missed'}${p ? ` – ${playerLabel(p)}` : ''}`, { minute: '', ...(p ? { playerId: p.id } : {}) });
        break;
      }
    }
    return s;
  },

  phaseActions(state) {
    return nextPeriodAction(state.phase).map((a) => ({ type: a.type, label: a.label, ...(a.period ? { data: { period: a.period } } : {}) }));
  },

  publish(state, setup) {
    const st = settingsOf(setup);
    const so = shootoutStatus(state.kicks, state.shootoutFirst, st.shootoutRounds);
    const hadShootout = state.kicks.length > 0 || state.phase === 'PEN';

    const playerTree = (side: TeamSide, id: string) => {
      const p = setup[side].players.find((x) => x.id === id);
      if (!p) return undefined;
      return { id: p.id, number: p.number, name: p.name, position: p.position ?? '', captain: !!p.captain };
    };
    const team = (side: TeamSide) => {
      const t = setup[side];
      const ps = state.players[side];
      const onPitch = t.players.filter((p) => ps[p.id]?.onPitch).map((p) => playerTree(side, p.id));
      return {
        name: t.name,
        code: t.code,
        color: t.color,
        color2: t.color2 ?? '',
        logo: t.logo ?? '',
        coach: t.coach ?? '',
        formation: t.formation ?? '',
        score: state.score[side],
        pens: hadShootout ? (side === 'home' ? so.homeScore : so.awayScore) : null,
        starters: t.starters.map((id) => playerTree(side, id)).filter(Boolean),
        substitutes: t.bench.map((id) => playerTree(side, id)).filter(Boolean),
        onPitch,
        stats: state.stats[side],
        scorers: scorersOf(state, setup, side),
      };
    };

    const enrich = (ev: LoggedEvent | undefined) => {
      if (!ev) return null;
      const side = ev.team;
      const pSide = ev.kind === 'own_goal' && side ? otherSide(side) : side;
      const p = pSide && ev.playerId ? setup[pSide].players.find((x) => x.id === ev.playerId) : undefined;
      const pin = side && ev.inPlayerId ? setup[side].players.find((x) => x.id === ev.inPlayerId) : undefined;
      const pout = side && ev.outPlayerId ? setup[side].players.find((x) => x.id === ev.outPlayerId) : undefined;
      const t = side ? setup[side] : undefined;
      return {
        id: ev.id,
        kind: ev.kind,
        type: ev.type,
        team: side ?? '',
        teamName: t?.name ?? '',
        teamCode: t?.code ?? '',
        teamColor: t?.color ?? '',
        teamLogo: t?.logo ?? '',
        minute: ev.minute,
        text: ev.text,
        playerName: p?.name ?? pin?.name ?? '',
        playerNumber: p?.number ?? pin?.number ?? null,
        inName: pin?.name ?? '',
        inNumber: pin?.number ?? null,
        outName: pout?.name ?? '',
        outNumber: pout?.number ?? null,
        score: `${state.score.home}–${state.score.away}`,
      };
    };
    const lastOf = (kinds: string[]) => enrich([...state.log].reverse().find((e) => kinds.includes(e.kind)));
    const notable = ['goal', 'own_goal', 'penalty_goal', 'yellow', 'second_yellow', 'red', 'sub', 'var'];

    return {
      sport: 'football',
      id: setup.id,
      name: setup.name,
      phase: state.phase,
      periodName: PERIOD_NAMES[state.phase],
      period: periodTag(state.phase, so, hadShootout, state.score),
      running: state.clock.running,
      clock: toClockValue(state.clock),
      addedTime: RUNNING.includes(state.phase) ? state.addedTime : 0,
      home: team('home'),
      away: team('away'),
      events: {
        last: lastOf(notable),
        lastGoal: lastOf(['goal', 'own_goal', 'penalty_goal']),
        lastCard: lastOf(['yellow', 'second_yellow', 'red']),
        lastSub: lastOf(['sub']),
        list: state.log.slice(-40).reverse().map(enrich),
      },
      shootout: {
        active: state.phase === 'PEN',
        first: state.shootoutFirst,
        home: so.home,
        away: so.away,
        homeScore: so.homeScore,
        awayScore: so.awayScore,
        decided: so.decided,
        winner: so.winner,
        nextTeam: so.decided ? null : so.nextTeam,
      },
      result: {
        finished: state.phase === 'END',
        winner: winnerOf(state, so),
      },
    };
  },
};

/** Short tag shown by the scorebug next to the clock ('' while a half is being played). */
function periodTag(phase: Phase, so: ShootoutStatus, hadShootout: boolean, _score: Record<TeamSide, number>): string {
  if (hadShootout && (phase === 'PEN' || phase === 'END')) return `PENS ${so.homeScore}–${so.awayScore}`;
  switch (phase) {
    case 'HT': return 'HT';
    case 'FT':
    case 'END': return 'FT';
    case 'ET1':
    case 'ET2': return 'ET';
    case 'ETHT': return 'ET HT';
    case 'AET': return 'AET';
    default: return '';
  }
}

function winnerOf(state: FootballState, so: ShootoutStatus): TeamSide | 'draw' | null {
  if (state.phase !== 'END' && state.phase !== 'PEN') return null;
  if (state.kicks.length > 0) return so.decided ? so.winner : null;
  if (state.score.home === state.score.away) return 'draw';
  return state.score.home > state.score.away ? 'home' : 'away';
}

/** "Haddad 23', 45+2' (pen.)" per scorer, in order of first goal. */
function scorersOf(state: FootballState, setup: MatchSetup, side: TeamSide): string[] {
  const goals = state.log.filter((e) => e.team === side && ['goal', 'own_goal', 'penalty_goal'].includes(e.kind));
  const byPlayer = new Map<string, string[]>();
  for (const g of goals) {
    const pSide = g.kind === 'own_goal' ? otherSide(side) : side;
    const p = g.playerId ? setup[pSide].players.find((x) => x.id === g.playerId) : undefined;
    const name = p ? (p.name || `#${p.number}`) : 'Unknown';
    const key = `${name}${g.kind === 'own_goal' ? ' (o.g.)' : ''}`;
    const list = byPlayer.get(key) ?? [];
    list.push(`${g.minute}${g.kind === 'penalty_goal' ? ' (pen.)' : ''}`);
    byPlayer.set(key, list);
  }
  return [...byPlayer.entries()].map(([k, mins]) => `${k} ${mins.join(', ')}`);
}
