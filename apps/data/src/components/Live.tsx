/**
 * Live match screen: built for speed under stress – big buttons, few decisions, undo always one tap away.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { live } from '../lib/live.ts';
import { availability, formatClock, other, parseClock, playerLabel, SIDES, textOn } from '../lib/match-utils.ts';
import { toast } from '../lib/toast.ts';
import type { Match, MatchEvent, Player, PublishedEvent, Side } from '../lib/types.ts';

type Picker =
  | { kind: 'goal'; side: Side }
  | { kind: 'card'; side: Side; card: 'yellow' | 'red' }
  | { kind: 'sub'; side: Side; outId?: string }
  | { kind: 'var' }
  | { kind: 'pens-first' }
  | { kind: 'edit'; event: MatchEvent };

const ICON: Record<string, string> = {
  goal: '⚽', own_goal: '⚽', penalty_goal: '⚽', yellow: '🟨', second_yellow: '🟨🟥', red: '🟥', sub: '⇅', var: '📺',
  corner: '⚑', shot: '◎', shot_on_target: '◉', foul: '✋', offside: '⚐', period_start: '▶', period_end: '⏸', match_end: '⏹',
  added_time: '+', shootout_scored: '✔', shootout_missed: '✘',
};

function useServerNow(offset: number, running: boolean) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!running) {
      setNow(Date.now() + offset);
      return;
    }
    let raf = 0;
    const tick = () => {
      setNow(Date.now() + offset);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [offset, running]);
  return now;
}

export function Live({ match, timeOffset, onSetup }: { match: Match; timeOffset: number; onSetup: () => void }) {
  const p = match.published;
  const now = useServerNow(timeOffset, p.clock.running);
  const clock = formatClock(p.clock, now);
  const [picker, setPicker] = useState<Picker | null>(null);
  const runningPhase = ['H1', 'H2', 'ET1', 'ET2'].includes(p.phase);
  const inPens = p.phase === 'PEN';
  const ended = p.phase === 'END';
  const noSquads = match.home.players.length === 0 && match.away.players.length === 0;

  /** Sends an event; shows a toast with undo for important ones. */
  const send = async (type: string, team?: Side, data: Record<string, unknown> = {}, announce?: string) => {
    try {
      const m = await api.event(match.id, type, team, data);
      live.put(m);
      if (announce) toast('info', announce, 4000, { label: 'Undo', run: () => void api.undo(match.id).then((u) => live.put(u)) });
      return m;
    } catch (e) {
      toast('error', (e as Error).message);
      return undefined;
    }
  };

  const phaseAction = (a: Match['actions'][number]) => {
    if (a.type === 'period.start' && a.data?.period === 'PEN') return setPicker({ kind: 'pens-first' });
    if (a.type === 'match.end' && !confirm('End the match?')) return;
    void send(a.type, undefined, a.data ?? {});
  };

  const setClock = () => {
    const v = prompt('Set clock (mm:ss)', clock.main);
    if (v === null) return;
    const ms = parseClock(v);
    if (ms === undefined) return toast('error', 'Use mm:ss, e.g. 23:15');
    void send('clock.set', undefined, { elapsedMs: ms });
  };

  return (
    <main className="live">
      {/* ---------------- scoreboard ---------------- */}
      <section className="scoreboard">
        <TeamHead match={match} side="home" />
        <div className="center">
          <div className="score">
            <span>{p.home.score}</span><span className="colon">:</span><span>{p.away.score}</span>
          </div>
          {(inPens || p.shootout.home.length > 0) && <div className="pens">Pens {p.shootout.homeScore}–{p.shootout.awayScore}</div>}
          <div className={`clock ${p.clock.running ? 'running' : ''}`}>
            {clock.main}{clock.stoppage && <span className="stoppage"> {clock.stoppage}</span>}
          </div>
          <div className="period">{p.periodName}{p.addedTime > 0 ? ` · +${p.addedTime} min` : ''}</div>
        </div>
        <TeamHead match={match} side="away" />
      </section>

      {/* ---------------- match control ---------------- */}
      <section className="controls">
        <div className="phase-actions">
          {match.actions.map((a) => (
            <button key={`${a.type}-${a.label}`} className={`big phase ${a.type === 'match.end' ? 'secondary' : ''}`} onClick={() => phaseAction(a)}>{a.label}</button>
          ))}
          {ended && <span className="final">Match ended{p.result.winner && p.result.winner !== 'draw' ? ` – ${match[p.result.winner].name} win` : p.result.winner === 'draw' ? ' – draw' : ''}</span>}
        </div>
        {runningPhase && (
          <div className="clock-tools">
            {p.clock.running
              ? <button className="mid stop" onClick={() => void send('clock.stop')}>⏸ Stop clock</button>
              : <button className="mid go" onClick={() => void send('clock.start')}>▶ Start clock</button>}
            <button onClick={() => void send('clock.adjust', undefined, { deltaMs: -60_000 })}>−1′</button>
            <button onClick={() => void send('clock.adjust', undefined, { deltaMs: -1000 })}>−1″</button>
            <button onClick={() => void send('clock.adjust', undefined, { deltaMs: 1000 })}>+1″</button>
            <button onClick={() => void send('clock.adjust', undefined, { deltaMs: 60_000 })}>+1′</button>
            <button onClick={setClock}>Set…</button>
            <span className="sep" />
            <span className="label">Added time</span>
            <button onClick={() => void send('added_time', undefined, { minutes: Math.max(0, p.addedTime - 1) })}>−</button>
            <span className="added">+{p.addedTime}</span>
            <button onClick={() => void send('added_time', undefined, { minutes: p.addedTime + 1 })}>+</button>
          </div>
        )}
        {noSquads && <div className="hint">No squads yet – events work without players. <button className="link" onClick={onSetup}>Set up teams</button></div>}
      </section>

      {/* ---------------- team panels + log ---------------- */}
      <section className="board">
        {inPens ? (
          <Shootout match={match} onKick={(side, scored) => void send('shootout.kick', side, { scored }, `Penalty ${match[side].code} ${scored ? 'scored' : 'missed'}`)} />
        ) : (
          <TeamPanel match={match} side="home" disabled={ended || p.phase === 'pre'} send={send} open={setPicker} />
        )}
        <div className="middle">
          <button className="mid var" disabled={ended} onClick={() => setPicker({ kind: 'var' })}>📺 VAR</button>
          <EventLog match={match} onEdit={(ev) => setPicker({ kind: 'edit', event: ev })} />
        </div>
        {inPens ? <ShootoutTable match={match} /> : <TeamPanel match={match} side="away" disabled={ended || p.phase === 'pre'} send={send} open={setPicker} />}
      </section>

      {picker && <PickerDialog match={match} picker={picker} onClose={() => setPicker(null)} send={send} setPicker={setPicker} />}
    </main>
  );
}

function TeamHead({ match, side }: { match: Match; side: Side }) {
  const t = match[side];
  return (
    <div className={`team-head ${side}`} style={{ ['--team' as string]: t.color, ['--on-team' as string]: textOn(t.color) }}>
      {t.logo && <img src={t.logo} alt="" />}
      <div>
        <div className="code">{t.code}</div>
        <div className="name">{t.name}</div>
      </div>
    </div>
  );
}

function TeamPanel({ match, side, disabled, send, open }: {
  match: Match; side: Side; disabled: boolean;
  send: (type: string, team?: Side, data?: Record<string, unknown>, announce?: string) => Promise<Match | undefined>;
  open: (p: Picker) => void;
}) {
  const t = match[side];
  const st = match.published[side].stats;
  const style = { ['--team' as string]: t.color, ['--on-team' as string]: textOn(t.color) };
  const quick = (type: string, label: string, data: Record<string, unknown> = {}) => (
    <button className="stat-btn" disabled={disabled} onClick={() => void send(type, side, data, `${label} ${t.code}`)}>{label}</button>
  );
  return (
    <div className={`team-panel ${side}`} style={style}>
      <button className="huge goal" disabled={disabled} onClick={() => open({ kind: 'goal', side })}>⚽ GOAL {t.code}</button>
      <div className="row2">
        <button className="big yellow" disabled={disabled} onClick={() => open({ kind: 'card', side, card: 'yellow' })}>🟨 Yellow</button>
        <button className="big red" disabled={disabled} onClick={() => open({ kind: 'card', side, card: 'red' })}>🟥 Red</button>
      </div>
      <button className="big sub" disabled={disabled} onClick={() => open({ kind: 'sub', side })}>⇅ Substitution</button>
      <div className="row3">
        {quick('corner', 'Corner')}
        {quick('shot', 'Shot')}
        {quick('shot', 'On target', { onTarget: true })}
        {quick('foul', 'Foul')}
        {quick('offside', 'Offside')}
      </div>
      <div className="stats">
        <span>Shots <b>{st.shots}</b> ({st.shotsOnTarget})</span>
        <span>Corners <b>{st.corners}</b></span>
        <span>Fouls <b>{st.fouls}</b></span>
        <span>Offside <b>{st.offsides}</b></span>
        <span>🟨 <b>{st.yellowCards}</b> 🟥 <b>{st.redCards}</b></span>
      </div>
      {match.published[side].scorers.length > 0 && <div className="scorers">⚽ {match.published[side].scorers.join(' · ')}</div>}
    </div>
  );
}

function EventLog({ match, onEdit }: { match: Match; onEdit: (e: MatchEvent) => void }) {
  const list = match.published.events.list;
  const byId = useMemo(() => new Map(match.events.map((e) => [e.id, e])), [match.events]);
  const editable = (e: PublishedEvent) => !['period_start', 'period_end', 'match_end'].includes(e.kind);
  return (
    <div className="log">
      <h3>Events</h3>
      {list.length === 0 && <p className="hint">No events yet.</p>}
      <ul>
        {list.map((e) => (
          <li key={e.id} className={`ev ${e.kind}`} style={e.teamColor ? { ['--team' as string]: e.teamColor } : undefined}>
            <span className="min">{e.minute}</span>
            <span className="ic">{ICON[e.kind] ?? '•'}</span>
            <span className="tx">{e.text}</span>
            {editable(e) && byId.get(e.id) && <button className="small" onClick={() => onEdit(byId.get(e.id)!)}>Edit</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shootout({ match, onKick }: { match: Match; onKick: (side: Side, scored: boolean) => void }) {
  const so = match.published.shootout;
  if (so.decided) {
    return (
      <div className="team-panel shootout">
        <h3>Penalty shootout decided</h3>
        <p className="big-text">{so.winner ? `${match[so.winner].name} win ${Math.max(so.homeScore, so.awayScore)}–${Math.min(so.homeScore, so.awayScore)}` : ''}</p>
        <p className="hint">Use the phase button above to end the penalties.</p>
      </div>
    );
  }
  const side = so.nextTeam ?? 'home';
  const t = match[side];
  return (
    <div className="team-panel shootout" style={{ ['--team' as string]: t.color, ['--on-team' as string]: textOn(t.color) }}>
      <h3>Next kick: {t.name}</h3>
      <button className="huge goal" onClick={() => onKick(side, true)}>✔ SCORED</button>
      <button className="huge missed" onClick={() => onKick(side, false)}>✘ MISSED</button>
    </div>
  );
}

function ShootoutTable({ match }: { match: Match }) {
  const so = match.published.shootout;
  const rounds = Math.max(match.settings.shootoutRounds ?? 5, so.home.length, so.away.length);
  return (
    <div className="team-panel shootout-table">
      <h3>Shootout {so.homeScore}–{so.awayScore}</h3>
      {SIDES.map((side) => (
        <div key={side} className="kicks">
          <span className="code">{match[side].code}</span>
          {Array.from({ length: rounds }, (_, i) => {
            const r = so[side][i];
            return <span key={i} className={`kick ${r === undefined ? '' : r ? 'scored' : 'missed'}`}>{r === undefined ? '' : r ? '✔' : '✘'}</span>;
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- dialogs

function PlayerGrid({ title, players, onPick, selected }: { title: string; players: Player[]; onPick: (p: Player) => void; selected?: string }) {
  if (players.length === 0) return null;
  return (
    <div className="pgrid-wrap">
      <h4>{title}</h4>
      <div className="pgrid">
        {[...players].sort((a, b) => (a.number ?? 999) - (b.number ?? 999)).map((p) => (
          <button key={p.id} className={`pbtn ${selected === p.id ? 'sel' : ''}`} onClick={() => onPick(p)}>
            <span className="n">{p.number ?? '–'}</span><span className="nm">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PickerDialog({ match, picker, onClose, send, setPicker }: {
  match: Match; picker: Picker; onClose: () => void;
  send: (type: string, team?: Side, data?: Record<string, unknown>, announce?: string) => Promise<Match | undefined>;
  setPicker: (p: Picker | null) => void;
}) {
  const [goalKind, setGoalKind] = useState<'normal' | 'penalty' | 'own_goal'>('normal');
  const done = async (fn: () => Promise<unknown>) => {
    await fn();
    onClose();
  };
  let body: React.ReactNode = null;
  let title = '';

  if (picker.kind === 'goal') {
    const side = picker.side;
    const t = match[side];
    const scorerSide = goalKind === 'own_goal' ? other(side) : side;
    const av = availability(match[scorerSide], scorerSide, match.events);
    title = `Goal ${t.name}`;
    const pick = (p?: Player) => done(() => send('goal', side, { kind: goalKind, ...(p ? { playerId: p.id } : {}) },
      `Goal ${t.code}${p ? ` – ${p.name}` : ''}${goalKind === 'penalty' ? ' (pen.)' : goalKind === 'own_goal' ? ' (o.g.)' : ''}`));
    body = (
      <>
        <div className="seg">
          {(['normal', 'penalty', 'own_goal'] as const).map((k) => (
            <button key={k} className={goalKind === k ? 'on' : ''} onClick={() => setGoalKind(k)}>{k === 'normal' ? 'Goal' : k === 'penalty' ? 'Penalty' : `Own goal (by ${match[other(side)].code})`}</button>
          ))}
        </div>
        <PlayerGrid title={`Scorer – ${match[scorerSide].name}`} players={av.onPitch} onPick={pick} />
        <PlayerGrid title="Not on the pitch" players={[...av.bench, ...av.others]} onPick={pick} />
        <button className="big wide" onClick={() => void pick()}>Goal without scorer</button>
      </>
    );
  } else if (picker.kind === 'card') {
    const { side, card } = picker;
    const t = match[side];
    const av = availability(t, side, match.events);
    title = `${card === 'yellow' ? '🟨 Yellow' : '🟥 Red'} card – ${t.name}`;
    const pick = (p?: Player) => done(() => send('card', side, { card, ...(p ? { playerId: p.id } : {}) }, `${card === 'yellow' ? 'Yellow' : 'Red'} card ${t.code}${p ? ` – ${p.name}` : ''}`));
    body = (
      <>
        <PlayerGrid title="On the pitch" players={av.onPitch} onPick={pick} />
        <PlayerGrid title="Bench / staff" players={[...av.bench, ...av.others]} onPick={pick} />
        <button className="big wide" onClick={() => void pick()}>Card without player</button>
      </>
    );
  } else if (picker.kind === 'sub') {
    const { side, outId } = picker;
    const t = match[side];
    const av = availability(t, side, match.events);
    const outP = t.players.find((p) => p.id === outId);
    title = `Substitution – ${t.name}`;
    body = !outId ? (
      <>
        <p className="step">1. Player going <b>off</b></p>
        <PlayerGrid title="On the pitch" players={av.onPitch} onPick={(p) => setPicker({ kind: 'sub', side, outId: p.id })} />
        {av.onPitch.length === 0 && <p className="hint">No lineup set – add the squad in Setup.</p>}
      </>
    ) : (
      <>
        <p className="step">2. Player coming <b>on</b> for {playerLabel(outP)} <button className="small" onClick={() => setPicker({ kind: 'sub', side })}>change</button></p>
        <PlayerGrid title="Bench" players={av.bench} onPick={(p) => done(() => send('substitution', side, { outId, inId: p.id }, `Sub ${t.code}: ${p.name} for ${outP?.name ?? ''}`))} />
        <PlayerGrid title="Others in squad" players={av.others} onPick={(p) => done(() => send('substitution', side, { outId, inId: p.id }, `Sub ${t.code}: ${p.name} for ${outP?.name ?? ''}`))} />
      </>
    );
  } else if (picker.kind === 'var') {
    title = '📺 VAR';
    const reasons = [['goal', 'Goal'], ['penalty', 'Penalty'], ['red_card', 'Red card'], ['mistaken_identity', 'Mistaken identity'], ['offside', 'Offside']];
    const decisions = [['checking', 'Checking…'], ['confirmed', 'Decision stands'], ['overturned', 'Overturned']];
    body = (
      <div className="var-grid">
        {reasons.map(([r, rl]) => (
          <div key={r} className="var-row">
            <span className="vl">{rl}</span>
            {decisions.map(([d, dl]) => <button key={d} className="mid" onClick={() => void done(() => send('var', undefined, { reason: r, decision: d }, `VAR ${rl}: ${dl}`))}>{dl}</button>)}
          </div>
        ))}
      </div>
    );
  } else if (picker.kind === 'pens-first') {
    title = 'Penalty shootout – who kicks first?';
    body = (
      <div className="row2">
        {SIDES.map((s) => (
          <button key={s} className="huge" style={{ background: match[s].color, color: textOn(match[s].color) }}
            onClick={() => void done(() => send('period.start', undefined, { period: 'PEN', first: s }))}>{match[s].name}</button>
        ))}
      </div>
    );
  } else if (picker.kind === 'edit') {
    title = 'Edit event';
    body = <EditEvent match={match} event={picker.event} onDone={onClose} />;
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="dialog-head"><h2>{title}</h2><button className="close" onClick={onClose}>✕</button></div>
        {body}
      </div>
    </div>
  );
}

function EditEvent({ match, event, onDone }: { match: Match; event: MatchEvent; onDone: () => void }) {
  const pub = match.published.events.list.find((e) => e.id === event.id);
  const [team, setTeam] = useState<Side | undefined>(event.team);
  const [minute, setMinute] = useState<string>(typeof event.data.minute === 'string' ? event.data.minute : '');
  const [playerId, setPlayerId] = useState<string>((event.data.playerId as string) ?? '');
  const [kind, setKind] = useState<string>((event.data.kind as string) ?? 'normal');
  const [card, setCard] = useState<string>((event.data.card as string) ?? 'yellow');
  const playerSide: Side | undefined = team && event.type === 'goal' && kind === 'own_goal' ? other(team) : team;
  const players = playerSide ? match[playerSide].players : [];

  const save = async () => {
    const data: Record<string, unknown> = { minute: minute.trim() || null };
    if (['goal', 'card'].includes(event.type)) data.playerId = playerId || null;
    if (event.type === 'goal') data.kind = kind;
    if (event.type === 'card') data.card = card;
    try {
      live.put(await api.editEvent(match.id, event.id, { ...(team ? { team } : {}), data }));
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm('Delete this event?')) return;
    try {
      live.put(await api.deleteEvent(match.id, event.id));
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="edit-form">
      <p className="hint">{pub?.minute} {pub?.text}</p>
      {event.team && (
        <label>Team
          <div className="seg">
            {SIDES.map((s) => <button key={s} className={team === s ? 'on' : ''} onClick={() => setTeam(s)}>{match[s].name}</button>)}
          </div>
        </label>
      )}
      {event.type === 'goal' && (
        <label>Type
          <div className="seg">
            {['normal', 'penalty', 'own_goal'].map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k.replace('_', ' ')}</button>)}
          </div>
        </label>
      )}
      {event.type === 'card' && (
        <label>Card
          <div className="seg">
            {['yellow', 'red'].map((k) => <button key={k} className={card === k ? 'on' : ''} onClick={() => setCard(k)}>{k}</button>)}
          </div>
        </label>
      )}
      {['goal', 'card'].includes(event.type) && (
        <label>Player
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">— none —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
          </select>
        </label>
      )}
      <label>Minute (leave empty for automatic)
        <input value={minute} placeholder={pub?.minute ?? "e.g. 23' or 45+2'"} onChange={(e) => setMinute(e.target.value)} />
      </label>
      <div className="row2">
        <button className="big danger" onClick={() => void remove()}>Delete event</button>
        <button className="big primary" onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
