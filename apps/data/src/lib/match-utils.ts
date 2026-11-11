/** Pure helpers for the data tool (tested). */
import type { ClockValue, Player, Side, Team } from './types.ts';

export const SIDES: Side[] = ['home', 'away'];
export const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

export function clockMs(c: ClockValue | undefined, serverNow: number): number {
  if (!c) return 0;
  return Math.max(0, c.elapsedAtAnchorMs + (c.running ? Math.max(0, serverNow - c.anchorServerMs) : 0));
}

/** "23:41", or "45:00" + "+1:23" stoppage when past the limit. */
export function formatClock(c: ClockValue | undefined, serverNow: number): { main: string; stoppage: string } {
  const ms = clockMs(c, serverNow);
  const fmt = (v: number) => {
    const t = Math.floor(v / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  if (c?.limitMs !== undefined && ms > c.limitMs) return { main: fmt(c.limitMs), stoppage: `+${fmt(ms - c.limitMs).replace(/^0/, '')}` };
  return { main: fmt(ms), stoppage: '' };
}

/** Parses "mm:ss", "mm" or "m:ss" into ms (undefined when invalid). */
export function parseClock(input: string): number | undefined {
  const m = /^\s*(\d{1,3})(?::(\d{1,2}))?\s*$/.exec(input);
  if (!m) return undefined;
  const sec = m[2] === undefined ? 0 : Number(m[2]);
  if (sec > 59) return undefined;
  return (Number(m[1]) * 60 + sec) * 1000;
}

export interface PlayerAvailability {
  onPitch: Player[];
  bench: Player[];
  /** players not in the matchday squad lists */
  others: Player[];
}

/**
 * Who is on the pitch, derived from the lineup and the substitution/red-card events so far.
 * (The server derives the same; this is for the pickers.)
 */
export function availability(team: Team, side: Side, events: { type: string; team?: Side; data: Record<string, unknown> }[]): PlayerAvailability {
  const on = new Set(team.starters);
  const off = new Set<string>();
  const yellows = new Map<string, number>();
  for (const e of events) {
    if (e.team !== side) continue;
    if (e.type === 'substitution') {
      const out = e.data.outId as string;
      const inn = e.data.inId as string;
      on.delete(out);
      off.add(out);
      on.add(inn);
    } else if (e.type === 'card') {
      const id = e.data.playerId as string | undefined;
      if (!id) continue;
      const n = (yellows.get(id) ?? 0) + (e.data.card === 'yellow' ? 1 : 0);
      yellows.set(id, n);
      if (e.data.card === 'red' || n >= 2) {
        on.delete(id);
        off.add(id);
      }
    }
  }
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const onPitch = [...on].map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const bench = team.bench.filter((id) => !on.has(id) && !off.has(id)).map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const used = new Set([...on, ...team.bench, ...off]);
  const others = team.players.filter((p) => !used.has(p.id));
  return { onPitch, bench, others };
}

/** Parses a pasted squad list: one player per line, "7 Name", "7. Name, MF", "Name". */
export function parseSquad(text: string): { number: number | null; name: string; position?: string }[] {
  const out: { number: number | null; name: string; position?: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{1,3})[\s.)\-:,\t]+(.+)$/.exec(line);
    let number: number | null = null;
    let rest = line;
    if (m) {
      number = Number(m[1]);
      rest = m[2]!.trim();
    }
    const parts = rest.split(/[,;\t]/).map((s) => s.trim()).filter(Boolean);
    const name = parts[0] ?? '';
    const pos = parts[1]?.toUpperCase();
    if (!name) continue;
    out.push({ number, name, ...(pos && ['GK', 'DF', 'MF', 'FW'].includes(pos) ? { position: pos } : {}) });
  }
  return out;
}

export function playerLabel(p: Player | undefined): string {
  if (!p) return 'Unknown';
  return `${p.number ?? '–'} ${p.name || ''}`.trim();
}

/** Readable text colour (black/white) for a background colour. */
export function textOn(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#0b0e14' : '#fff';
}
