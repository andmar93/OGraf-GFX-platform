/** Shapes returned by the server's match API (see apps/server/src/matches). */
export type Side = 'home' | 'away';

export interface Player {
  id: string;
  number: number | null;
  name: string;
  position?: string;
  captain?: boolean;
}

export interface Team {
  name: string;
  code: string;
  color: string;
  color2?: string;
  logo?: string;
  coach?: string;
  formation?: string;
  players: Player[];
  starters: string[];
  bench: string[];
}

export interface MatchEvent {
  id: string;
  seq: number;
  type: string;
  at: number;
  team?: Side;
  data: Record<string, unknown>;
}

export interface PublishedEvent {
  id: string;
  kind: string;
  type: string;
  team: Side | '';
  teamCode: string;
  teamColor: string;
  minute: string;
  text: string;
  playerName: string;
  playerNumber: number | null;
}

export interface ClockValue {
  running: boolean;
  anchorServerMs: number;
  elapsedAtAnchorMs: number;
  limitMs?: number;
  label?: string;
}

export interface PublishedTeam {
  name: string;
  code: string;
  color: string;
  score: number;
  pens: number | null;
  stats: { shots: number; shotsOnTarget: number; corners: number; fouls: number; offsides: number; yellowCards: number; redCards: number };
  scorers: string[];
}

export interface Published {
  phase: string;
  periodName: string;
  period: string;
  running: boolean;
  clock: ClockValue;
  addedTime: number;
  home: PublishedTeam;
  away: PublishedTeam;
  events: { last: PublishedEvent | null; list: PublishedEvent[] };
  shootout: { active: boolean; first: Side; home: boolean[]; away: boolean[]; homeScore: number; awayScore: number; decided: boolean; winner: Side | null; nextTeam: Side | null };
  result: { finished: boolean; winner: Side | 'draw' | null };
}

export interface Match {
  id: string;
  sport: string;
  name: string;
  active: boolean;
  updatedAt: number;
  home: Team;
  away: Team;
  settings: { halfLengthMin?: number; extraTimeHalfMin?: number; shootoutRounds?: number } & Record<string, unknown>;
  events: MatchEvent[];
  published: Published;
  actions: { type: string; data?: Record<string, unknown>; label: string }[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface MatchSummary {
  id: string;
  sport: string;
  name: string;
  active: boolean;
  updatedAt: number;
}
