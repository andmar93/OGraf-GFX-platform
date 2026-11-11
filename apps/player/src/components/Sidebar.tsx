import { useRef, useState } from 'react';
import type { RundownSummary } from '@ogp/protocol';
import { api, type GraphicDto } from '../lib/api.ts';
import { live } from '../lib/live.ts';
import { toast } from '../lib/toast.ts';

export function Sidebar(props: {
  rundownList: RundownSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  graphics: GraphicDto[];
  onAddGraphic: (g: GraphicDto) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    const name = prompt('Name of the new rundown', `Rundown ${props.rundownList.length + 1}`);
    if (!name?.trim()) return;
    try {
      const r = await api.createRundown(name);
      live.putRundown(r);
      props.onSelect(r.id);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const rename = async (id: string, name: string) => {
    setRenaming(null);
    if (!name.trim()) return;
    await api.updateRundown(id, { name }).then((r) => live.putRundown(r)).catch((e: Error) => toast('error', e.message));
  };

  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/v1/graphics', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errors = (json.details?.graphics ?? []).flatMap((g: { manifestPath: string; errors: { path: string; message: string }[] }) => g.errors.map((e) => `${g.manifestPath} ${e.path} ${e.message}`));
      toast('error', `${json.title ?? 'Upload failed'}${errors.length ? ': ' + errors.slice(0, 3).join('; ') : ''}`, 10_000);
    } else {
      toast('info', `Imported ${json.graphics.filter((g: { imported: boolean }) => g.imported).map((g: { name: string }) => g.name).join(', ')}`);
      void live.refreshGraphics();
    }
  };

  const graphics = props.graphics.filter((g) => !filter || `${g.name} ${g.id}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <nav className="sidebar">
      <section className="panel">
        <div className="panel-head">
          <h2>Rundowns</h2>
          <button className="small" onClick={create}>+ New</button>
        </div>
        <ul className="rundowns">
          {props.rundownList.map((r) => (
            <li key={r.id} className={r.id === props.activeId ? 'active' : ''} onClick={() => props.onSelect(r.id)} onDoubleClick={() => setRenaming(r.id)}>
              {renaming === r.id ? (
                <input
                  autoFocus
                  defaultValue={r.name}
                  onBlur={(e) => rename(r.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <>
                  <span className="name" title="Double-click to rename">{r.name}</span>
                  <span className="count">{r.itemCount}</span>
                  <span className="row-actions">
                    <button className="icon" title="Duplicate" onClick={(e) => { e.stopPropagation(); void api.duplicateRundown(r.id).then((d) => { live.putRundown(d); props.onSelect(d.id); }); }}>⧉</button>
                    <button className="icon" title="Delete" onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete rundown "${r.name}"? Graphics on air stay on air.`)) void api.deleteRundown(r.id).catch((err: Error) => toast('error', err.message));
                    }}>✕</button>
                  </span>
                </>
              )}
            </li>
          ))}
          {props.rundownList.length === 0 && <li className="hint">No rundowns yet</li>}
        </ul>
      </section>

      <section className="panel grow-panel">
        <div className="panel-head">
          <h2>Graphics</h2>
          <button className="small" onClick={() => fileRef.current?.click()} title="Upload an OGraf package (.zip)">⇪ Upload</button>
          <input ref={fileRef} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </div>
        <input className="filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="library">
          {graphics.map((g) => (
            <li key={g.id} title={g.description ?? g.id}>
              {g.thumbnails[0]?.url ? <img src={g.thumbnails[0].url} alt="" /> : <span className="thumb-placeholder">{g.name.slice(0, 2).toUpperCase()}</span>}
              <span className="lib-text">
                <span className="name">{g.name}</span>
                <span className="meta">{g.id}{g.stepCount > 1 || g.stepCount === -1 ? ` · ${g.stepCount === -1 ? 'dyn.' : g.stepCount} steps` : ''}</span>
              </span>
              <button className="small" onClick={() => props.onAddGraphic(g)} title="Add to rundown (after the selected item)">+ Add</button>
            </li>
          ))}
        </ul>
      </section>
    </nav>
  );
}
