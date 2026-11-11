/**
 * Penalty shootout rules (IFAB, ABAB order): `rounds` kicks each (normally 5), alternating, the team
 * kicking first stays first. The shootout is decided as soon as one team cannot catch up with its
 * remaining kicks. If level after the rounds, sudden death in pairs: decided when, after both teams have
 * taken the same number of kicks, the scores differ.
 */
import type { TeamSide } from '../../types.ts';

export interface ShootoutKick {
  team: TeamSide;
  scored: boolean;
  playerId?: string;
}

export interface ShootoutStatus {
  /** Result per kick in order, for each team (true = scored) */
  home: boolean[];
  away: boolean[];
  homeScore: number;
  awayScore: number;
  decided: boolean;
  winner: TeamSide | null;
  /** Who kicks next (also meaningful when decided: who would have) */
  nextTeam: TeamSide;
  /** 1-based round of the next kick */
  round: number;
  suddenDeath: boolean;
}

export function shootoutStatus(kicks: ShootoutKick[], first: TeamSide = 'home', rounds = 5): ShootoutStatus {
  const second: TeamSide = first === 'home' ? 'away' : 'home';
  const res: Record<TeamSide, boolean[]> = { home: [], away: [] };
  for (const k of kicks) res[k.team].push(k.scored);
  const score = (s: TeamSide) => res[s].filter(Boolean).length;
  const taken = (s: TeamSide) => res[s].length;

  let decided = false;
  let winner: TeamSide | null = null;
  const hs = score('home');
  const as = score('away');
  const ht = taken('home');
  const at = taken('away');

  if (ht <= rounds && at <= rounds && Math.max(ht, at) <= rounds) {
    // regulation: can the trailing team still catch up?
    const remH = rounds - ht;
    const remA = rounds - at;
    if (hs > as + remA) { decided = true; winner = 'home'; }
    else if (as > hs + remH) { decided = true; winner = 'away'; }
  }
  if (!decided && ht === at && ht >= rounds && hs !== as) {
    // end of regulation rounds or of a sudden-death pair
    decided = true;
    winner = hs > as ? 'home' : 'away';
  }

  const nextTeam: TeamSide = taken(first) === taken(second) ? first : second;
  return {
    home: res.home,
    away: res.away,
    homeScore: hs,
    awayScore: as,
    decided,
    winner,
    nextTeam,
    round: Math.min(taken(first), taken(second)) + 1,
    suddenDeath: Math.min(ht, at) >= rounds,
  };
}
