/**
 * Sport-agnostic match model.
 *
 * A match is its setup (teams, settings) plus an append-only list of events. The match state is never
 * stored: it is derived by replaying the events through the sport's reducer. Undo/edit are therefore
 * exact (remove/change an event and replay), and the result is deterministic.
 */
export type TeamSide = 'home' | 'away';
export const SIDES: TeamSide[] = ['home', 'away'];
export const otherSide = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home');

export interface Player {
  id: string;
  number: number | null;
  name: string;
  /** Sport-specific, e.g. GK/DF/MF/FW */
  position?: string;
  captain?: boolean;
}

export interface Team {
  name: string;
  /** Short code, e.g. "NBR" */
  code: string;
  color: string;
  color2?: string;
  logo?: string;
  coach?: string;
  formation?: string;
  players: Player[];
  /** Player ids of the starting lineup, in display order */
  starters: string[];
  /** Player ids on the bench */
  bench: string[];
}

export interface MatchSetup {
  id: string;
  sport: string;
  name: string;
  home: Team;
  away: Team;
  /** Sport-specific settings (period lengths, ...) */
  settings: Record<string, unknown>;
}

/** A recorded event. `at` is server epoch ms when it happened (drives the clock). */
export interface MatchEvent {
  id: string;
  seq: number;
  type: string;
  at: number;
  team?: TeamSide;
  data: Record<string, unknown>;
}

export interface EventInput {
  type: string;
  team?: TeamSide;
  data?: Record<string, unknown>;
}

/** Result of validating an event against the current state. */
export type Validation = { ok: true } | { ok: false; error: string };

/**
 * A sport plugin. Adding a sport = implementing this interface and registering it;
 * the core, server and generic UI need no changes.
 */
export interface SportPlugin<State = unknown> {
  id: string;
  name: string;
  /** Default settings for new matches */
  defaultSettings(): Record<string, unknown>;
  /** Event types this sport understands (for docs/UI) */
  eventTypes: { type: string; label: string; team: boolean }[];
  initialState(setup: MatchSetup): State;
  /** Rejects events that make no sense in the current state (e.g. starting the 2nd half twice). */
  validate(state: State, event: EventInput, setup: MatchSetup): Validation;
  reduce(state: State, event: MatchEvent, setup: MatchSetup): State;
  /** Data tree published to the data hub (what graphics bind to, under `match.*`). */
  publish(state: State, setup: MatchSetup): Record<string, unknown>;
  /** Next legal period/phase transitions, for generic UIs (one big contextual button). */
  phaseActions(state: State): { type: string; data?: Record<string, unknown>; label: string }[];
}
