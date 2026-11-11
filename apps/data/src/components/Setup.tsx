/**
 * Match setup: name, settings and both teams (code, colours, logo, coach, formation, squad, XI, bench).
 * Changes are saved automatically.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { live } from '../lib/live.ts';
import { parseSquad, SIDES, textOn } from '../lib/match-utils.ts';
import { toast } from '../lib/toast.ts';
import type { Match, Player, Side, Team } from '../lib/types.ts';

const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-5-1', '3-5-2', '3-4-3', '5-3-2', '5-4-1', '4-4-1-1', '3-4-1-2'];
const POSITIONS = ['', 'GK', 'DF', 'MF', 'FW'];
type Role = 'xi' | 'bench' | 'none';

const newId = () => Math.random().toString(36).slice(2, 10);

export function Setup({ match, onDelete }: { match: Match; onDelete: () => void }) {
  const [name, setName] = useState(match.name);
  const editingName = useRef(false);
  useEffect(() => {
    if (!editingName.current) setName(match.name);
  }, [match.name]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Record<string, unknown>>({});

  const save = (patch: Record<string, unknown>) => {
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = pending.current;
      pending.current = {};
      void api.update(match.id, p).then((m) => live.put(m)).catch((e: Error) => toast('error', `Save failed: ${e.message}`));
    }, 400);
  };
  useEffect(() => () => {
    // flush on unmount
    if (Object.keys(pending.current).length) void api.update(match.id, pending.current).then((m) => live.put(m));
  }, [match.id]);

  const settings = match.settings;
  const setting = (key: string, v: string) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) save({ settings: { [key]: n } });
  };

  return (
    <main className="setup">
      <section className="setup-head">
        <label>Match name<input value={name} onFocus={() => (editingName.current = true)} onBlur={() => (editingName.current = false)} onChange={(e) => { setName(e.target.value); save({ name: e.target.value }); }} /></label>
        <label>Half length (min)<input type="number" min={1} defaultValue={settings.halfLengthMin ?? 45} onChange={(e) => setting('halfLengthMin', e.target.value)} /></label>
        <label>Extra time half (min)<input type="number" min={1} defaultValue={settings.extraTimeHalfMin ?? 15} onChange={(e) => setting('extraTimeHalfMin', e.target.value)} /></label>
        <label>Shootout rounds<input type="number" min={1} defaultValue={settings.shootoutRounds ?? 5} onChange={(e) => setting('shootoutRounds', e.target.value)} /></label>
        <span className="grow" />
        <button className="danger" onClick={() => {
          if (!confirm(`Delete "${match.name}" and all its events?`)) return;
          void api.remove(match.id).then(onDelete).catch((e: Error) => toast('error', e.message));
        }}>Delete match</button>
      </section>
      <div className="teams">
        {SIDES.map((side) => <TeamEditor key={side} side={side} team={match[side]} onChange={(t) => save({ [side]: t })} />)}
      </div>
    </main>
  );
}

function TeamEditor({ side, team: initial, onChange }: { side: Side; team: Team; onChange: (t: Team) => void }) {
  const [team, setTeam] = useState<Team>(initial);
  const [paste, setPaste] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Team>) => {
    const next = { ...team, ...patch };
    setTeam(next);
    onChange(next);
  };
  const roleOf = (id: string): Role => (team.starters.includes(id) ? 'xi' : team.bench.includes(id) ? 'bench' : 'none');
  const setRole = (id: string, role: Role) => {
    const starters = team.starters.filter((x) => x !== id);
    const bench = team.bench.filter((x) => x !== id);
    if (role === 'xi') starters.push(id);
    if (role === 'bench') bench.push(id);
    update({ starters: orderBy(team.players, starters), bench: orderBy(team.players, bench) });
  };
  const setPlayer = (id: string, patch: Partial<Player>) => update({ players: team.players.map((p) => (p.id === id ? { ...p, ...patch } : patch.captain ? { ...p, captain: false } : p)) });
  const movePlayer = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= team.players.length) return;
    const players = [...team.players];
    [players[i], players[j]] = [players[j]!, players[i]!];
    update({ players, starters: orderBy(players, team.starters), bench: orderBy(players, team.bench) });
  };
  const addPlayer = () => {
    const id = newId();
    const nextNum = Math.max(0, ...team.players.map((p) => p.number ?? 0)) + 1;
    update({ players: [...team.players, { id, number: nextNum, name: '' }], ...(team.starters.length < 11 ? { starters: [...team.starters, id] } : { bench: [...team.bench, id] }) });
  };
  const removePlayer = (id: string) => update({ players: team.players.filter((p) => p.id !== id), starters: team.starters.filter((x) => x !== id), bench: team.bench.filter((x) => x !== id) });
  const importSquad = () => {
    const rows = parseSquad(paste ?? '');
    if (!rows.length) return setPaste(null);
    const players = rows.map((r) => ({ id: newId(), number: r.number, name: r.name, ...(r.position ? { position: r.position } : {}) }));
    update({ players, starters: players.slice(0, 11).map((p) => p.id), bench: players.slice(11).map((p) => p.id) });
    setPaste(null);
    toast('info', `Imported ${players.length} players (first 11 as starting XI)`);
  };
  const uploadLogo = async (file: File) => {
    try {
      update({ logo: await api.uploadImage(file) });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const xi = team.starters.length;
  return (
    <section className="team-editor" style={{ ['--team' as string]: team.color, ['--on-team' as string]: textOn(team.color) }}>
      <h2><span className="side">{side === 'home' ? 'Home' : 'Away'}</span> {team.name || '—'}</h2>
      <div className="grid">
        <label className="wide">Team name<input value={team.name} onChange={(e) => update({ name: e.target.value })} /></label>
        <label>Code<input value={team.code} maxLength={5} onChange={(e) => update({ code: e.target.value.toUpperCase() })} /></label>
        <label>Colour<input type="color" value={team.color} onChange={(e) => update({ color: e.target.value })} /></label>
        <label>2nd colour<input type="color" value={team.color2 || '#ffffff'} onChange={(e) => update({ color2: e.target.value })} /></label>
        <label className="logo">Logo
          <span className="logo-row">
            {team.logo ? <img src={team.logo} alt="" /> : <span className="no-logo">none</span>}
            <button onClick={() => fileRef.current?.click()}>Upload…</button>
            {team.logo && <button onClick={() => update({ logo: '' })}>Remove</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ''; }} />
          </span>
        </label>
        <label>Coach<input value={team.coach ?? ''} onChange={(e) => update({ coach: e.target.value })} /></label>
        <label>Formation
          <input list="formations" value={team.formation ?? ''} placeholder="4-3-3" onChange={(e) => update({ formation: e.target.value })} />
          <datalist id="formations">{FORMATIONS.map((f) => <option key={f} value={f} />)}</datalist>
        </label>
      </div>

      <div className="squad-head">
        <h3>Squad</h3>
        <span className={`count ${xi === 11 ? 'ok' : 'warn'}`}>XI: {xi}/11</span>
        <span className="count">Bench: {team.bench.length}</span>
        <span className="grow" />
        <button onClick={() => setPaste(paste === null ? '' : null)}>Paste list…</button>
        <button onClick={addPlayer}>+ Player</button>
      </div>
      {paste !== null && (
        <div className="paste">
          <textarea rows={8} autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'One player per line, e.g.\n1 Eriksson, GK\n2 Haddad, DF\n10 Nyström'} />
          <div className="row"><button onClick={() => setPaste(null)}>Cancel</button><button className="primary" onClick={importSquad}>Replace squad</button></div>
        </div>
      )}
      <table className="squad">
        <thead><tr><th>#</th><th>Name</th><th>Pos</th><th title="Captain">C</th><th>Role</th><th /></tr></thead>
        <tbody>
          {team.players.map((p, i) => {
            const role = roleOf(p.id);
            return (
              <tr key={p.id} className={`role-${role}`}>
                <td><input className="num" type="number" min={0} value={p.number ?? ''} onChange={(e) => setPlayer(p.id, { number: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                <td><input value={p.name} placeholder="Name" onChange={(e) => setPlayer(p.id, { name: e.target.value })} /></td>
                <td>
                  <select value={p.position ?? ''} onChange={(e) => setPlayer(p.id, { position: e.target.value })}>
                    {POSITIONS.map((x) => <option key={x} value={x}>{x || '–'}</option>)}
                  </select>
                </td>
                <td><input type="radio" name={`captain-${side}`} checked={!!p.captain} onChange={() => setPlayer(p.id, { captain: true })} /></td>
                <td>
                  <div className="seg small">
                    {(['xi', 'bench', 'none'] as Role[]).map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(p.id, r)}>{r === 'xi' ? 'XI' : r === 'bench' ? 'Bench' : '–'}</button>)}
                  </div>
                </td>
                <td className="tools">
                  <button className="icon" onClick={() => movePlayer(i, -1)} title="Move up">↑</button>
                  <button className="icon" onClick={() => movePlayer(i, 1)} title="Move down">↓</button>
                  <button className="icon" onClick={() => removePlayer(p.id)} title="Remove">✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {team.players.length === 0 && <p className="hint">No players yet. Paste a list or add players one by one.</p>}
      <p className="hint">Starting XI order (for the lineup graphic): goalkeeper first, then defence → attack, left to right. Use ↑↓.</p>
    </section>
  );
}

function orderBy(players: Player[], ids: string[]): string[] {
  const set = new Set(ids);
  return players.filter((p) => set.has(p.id)).map((p) => p.id);
}
