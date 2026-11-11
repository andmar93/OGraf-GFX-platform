import { useEffect, useState } from 'react';
import { api } from './lib/api.ts';
import { live, useLive } from './lib/live.ts';
import { toast } from './lib/toast.ts';
import type { Match } from './lib/types.ts';
import { Live } from './components/Live.tsx';
import { Setup } from './components/Setup.tsx';
import { Toasts } from './components/Toasts.tsx';

function useStored(key: string, initial: string | null): [string | null, (v: string | null) => void] {
  const [v, setV] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  return [v, (next) => {
    setV(next);
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    } catch {
      /* ignore */
    }
  }];
}

export function App() {
  const s = useLive();
  const [stored, setStored] = useStored('ogp.data.match', null);
  const [view, setView] = useState<'live' | 'setup'>('live');

  const id = stored && s.list.some((m) => m.id === stored) ? stored : (s.list.find((m) => m.active)?.id ?? s.list[0]?.id ?? null);
  useEffect(() => {
    if (id && !s.matches[id]) void live.load(id);
  }, [id, s.matches]);
  const match: Match | undefined = id ? s.matches[id] : undefined;

  const create = async () => {
    try {
      const m = await api.create({ home: { name: 'Home', code: 'HOM' }, away: { name: 'Away', code: 'AWY' } });
      live.put(m);
      setStored(m.id);
      setView('setup');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  // Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo (outside text fields)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!match || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault();
      void (e.shiftKey ? api.redo(match.id) : api.undo(match.id)).then((m) => live.put(m)).catch((err: Error) => toast('error', err.message));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [match]);

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">OGraf <span>Match</span></div>
        <select className="match-select" value={id ?? ''} onChange={(e) => setStored(e.target.value)}>
          {s.list.map((m) => <option key={m.id} value={m.id}>{m.active ? '● ' : ''}{m.name}</option>)}
          {s.list.length === 0 && <option value="">No matches</option>}
        </select>
        <button onClick={create}>+ New match</button>
        {match && (
          match.active
            ? <span className="pill on" title="This match feeds match.* data to the graphics">● ACTIVE – feeds graphics</span>
            : <button className="activate" onClick={() => void api.activate(match.id).then((m) => live.put(m)).catch((e: Error) => toast('error', e.message))}>Make active</button>
        )}
        <span className="grow" />
        {match && (
          <nav className="tabs">
            <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}>Live</button>
            <button className={view === 'setup' ? 'on' : ''} onClick={() => setView('setup')}>Setup</button>
          </nav>
        )}
        {match && (
          <>
            <button className="undo" disabled={!match.canUndo} onClick={() => void api.undo(match.id).then((m) => { live.put(m); toast('info', 'Undone'); }).catch((e: Error) => toast('error', e.message))}>↶ Undo</button>
            <button disabled={!match.canRedo} onClick={() => void api.redo(match.id).then((m) => live.put(m)).catch((e: Error) => toast('error', e.message))}>↷ Redo</button>
          </>
        )}
        <span className={`pill ${s.connected ? 'ok' : 'err'}`}>{s.connected ? 'connected' : 'OFFLINE'}</span>
      </header>
      {!match ? (
        <main className="empty">
          {s.loaded ? <button className="big" onClick={create}>+ Create a match</button> : 'Connecting…'}
        </main>
      ) : view === 'live' ? (
        <Live match={match} timeOffset={s.timeOffset} onSetup={() => setView('setup')} />
      ) : (
        <Setup key={match.id} match={match} onDelete={() => setStored(null)} />
      )}
      <Toasts />
    </div>
  );
}
