import { describe, expect, it } from 'vitest';
import { availability, formatClock, parseClock, parseSquad, textOn } from '../src/lib/match-utils.ts';
import type { Team } from '../src/lib/types.ts';

describe('clock helpers', () => {
  const c = { running: true, anchorServerMs: 1000, elapsedAtAnchorMs: 60_000, limitMs: 45 * 60_000 };
  it('formats from the anchor', () => {
    expect(formatClock(c, 1000 + 5_000)).toEqual({ main: '01:05', stoppage: '' });
    expect(formatClock({ ...c, running: false }, 99_999_999)).toEqual({ main: '01:00', stoppage: '' });
    expect(formatClock({ ...c, elapsedAtAnchorMs: 45 * 60_000 }, 1000 + 83_000)).toEqual({ main: '45:00', stoppage: '+1:23' });
  });
  it('parses mm:ss', () => {
    expect(parseClock('23:15')).toBe(1_395_000);
    expect(parseClock('45')).toBe(2_700_000);
    expect(parseClock('9:5')).toBe(545_000);
    expect(parseClock('1:75')).toBeUndefined();
    expect(parseClock('abc')).toBeUndefined();
  });
});

describe('availability', () => {
  const team: Team = {
    name: 'T', code: 'T', color: '#000000',
    players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, number: i + 1, name: id.toUpperCase() })),
    starters: ['a', 'b', 'c'], bench: ['d', 'e'],
  };
  it('follows substitutions and red cards', () => {
    const av = availability(team, 'home', [
      { type: 'substitution', team: 'home', data: { outId: 'a', inId: 'd' } },
      { type: 'card', team: 'home', data: { card: 'yellow', playerId: 'b' } },
      { type: 'card', team: 'home', data: { card: 'yellow', playerId: 'b' } },
      { type: 'substitution', team: 'away', data: { outId: 'c', inId: 'e' } },
    ]);
    expect(av.onPitch.map((p) => p.id)).toEqual(['c', 'd']);
    expect(av.bench.map((p) => p.id)).toEqual(['e']);
  });
});

describe('parseSquad', () => {
  it('reads common list formats', () => {
    expect(parseSquad('1 Eriksson, GK\n2. Haddad, df\n\n10) Nyström\nNo Number\n7\tBerg\tFW')).toEqual([
      { number: 1, name: 'Eriksson', position: 'GK' },
      { number: 2, name: 'Haddad', position: 'DF' },
      { number: 10, name: 'Nyström' },
      { number: null, name: 'No Number' },
      { number: 7, name: 'Berg', position: 'FW' },
    ]);
  });
});

describe('textOn', () => {
  it('picks readable text colours', () => {
    expect(textOn('#ffd400')).toBe('#0b0e14');
    expect(textOn('#0b1230')).toBe('#fff');
  });
});
