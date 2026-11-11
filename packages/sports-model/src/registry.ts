import type { EventInput, MatchEvent, MatchSetup, SportPlugin, Validation } from './types.ts';

const sports = new Map<string, SportPlugin>();

export function registerSport(plugin: SportPlugin<any>): void {
  sports.set(plugin.id, plugin as SportPlugin);
}

export function getSport(id: string): SportPlugin {
  const s = sports.get(id);
  if (!s) throw new Error(`unknown sport "${id}"`);
  return s;
}

export function listSports(): { id: string; name: string }[] {
  return [...sports.values()].map((s) => ({ id: s.id, name: s.name }));
}

/** Replays all events and returns the derived state. */
export function deriveState<S = unknown>(setup: MatchSetup, events: MatchEvent[]): S {
  const sport = getSport(setup.sport);
  let state = sport.initialState(setup);
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) state = sport.reduce(state, e, setup);
  return state as S;
}

export function validateEvent(setup: MatchSetup, events: MatchEvent[], input: EventInput): Validation {
  const sport = getSport(setup.sport);
  return sport.validate(deriveState(setup, events), input, setup);
}

export function publishMatch(setup: MatchSetup, events: MatchEvent[]): Record<string, unknown> {
  const sport = getSport(setup.sport);
  return sport.publish(deriveState(setup, events), setup);
}

export function phaseActions(setup: MatchSetup, events: MatchEvent[]): { type: string; data?: Record<string, unknown>; label: string }[] {
  return getSport(setup.sport).phaseActions(deriveState(setup, events));
}
