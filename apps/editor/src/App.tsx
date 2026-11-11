import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync, zipSync } from 'fflate';
import {
  cloneLayer, createLayer, createProject, exportPackage, findLayer, importPackage, insertLayer, moveLayer, normaliseProject,
  removeLayer, slugify, updateLayer, type Layer, type LayerType, type Project,
} from '@ogp/editor-core';
import { api, ApiError, type ProjectSummary } from './lib/api.ts';
import { useHistory } from './lib/history.ts';
import { toast } from './lib/toast.ts';
import { Canvas } from './components/Canvas.tsx';
import { LayersPanel } from './components/LayersPanel.tsx';
import { FieldsPanel } from './components/FieldsPanel.tsx';
import { PropertiesPanel } from './components/PropertiesPanel.tsx';
import { Toasts } from './components/Toasts.tsx';

export interface EditorApi {
  project: Project;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Applies a change; edits with the same coalesce key in quick succession are one undo step. */
  change: (fn: (p: Project) => Project, coalesceKey?: string) => void;
  updateLayer: (id: string, patch: Partial<Layer>, coalesceKey?: string) => void;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && (el as HTMLInputElement).type !== 'checkbox';
};

export function App() {
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(() => localStorage.getItem('ogp.editor.project'));
  const [loaded, setLoaded] = useState<Project | null>(null);

  const refreshList = useCallback(async () => setList(await api.projects()), []);
  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => {
    if (!openId) return setLoaded(null);
    localStorage.setItem('ogp.editor.project', openId);
    void api.project(openId).then((p) => setLoaded(normaliseProject(p))).catch(() => { setOpenId(null); localStorage.removeItem('ogp.editor.project'); });
  }, [openId]);

  const newProject = async () => {
    const name = prompt('Name of the new graphic', 'Lower third');
    if (!name?.trim()) return;
    const p = await api.createProject(createProject(name.trim()));
    await refreshList();
    setOpenId(p.id);
  };

  const importFile = async (file: File) => {
    try {
      let project: Project;
      if (file.name.toLowerCase().endsWith('.json')) {
        const json = JSON.parse(await file.text());
        project = normaliseProject(json.project ?? json.v_ogp_editor?.project ?? json);
      } else {
        const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
        project = await importPackage(files, (path, data) => api.uploadImage(new Blob([data as BlobPart]), path.split('/').pop() ?? 'image'));
      }
      const created = await api.createProject({ ...project, name: project.name });
      await refreshList();
      setOpenId(created.id);
      toast('info', `Imported "${created.name}"`);
    } catch (e) {
      toast('error', `Import failed: ${(e as Error).message}`);
    }
  };

  if (!loaded || loaded.id !== openId) {
    return (
      <div className="app">
        <header className="bar"><div className="brand">OGraf <span>Editor</span></div></header>
        <ProjectList list={list} onOpen={setOpenId} onNew={newProject} onImport={importFile} onRefresh={refreshList} />
        <Toasts />
      </div>
    );
  }
  return <Editor key={loaded.id} initial={loaded} onClose={() => { setOpenId(null); localStorage.removeItem('ogp.editor.project'); void refreshList(); }} onImport={importFile} />;
}

function ProjectList(props: { list: ProjectSummary[]; onOpen: (id: string) => void; onNew: () => void; onImport: (f: File) => void; onRefresh: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <main className="projects">
      <div className="projects-head">
        <h1>Graphics</h1>
        <span className="grow" />
        <button onClick={() => fileRef.current?.click()}>Import .zip / .json…</button>
        <input ref={fileRef} type="file" accept=".zip,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onImport(f); e.target.value = ''; }} />
        <button className="primary" onClick={props.onNew}>+ New graphic</button>
      </div>
      <ul className="project-list">
        {props.list.map((p) => (
          <li key={p.id} onClick={() => props.onOpen(p.id)}>
            <span className="name">{p.name}</span>
            <span className="meta">{p.graphicId}</span>
            <span className="meta">{new Date(p.updatedAt).toLocaleString()}</span>
            <button className="icon" title="Delete" onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete the project "${p.name}"? Published graphics stay in the library.`)) void api.deleteProject(p.id).then(props.onRefresh);
            }}>✕</button>
          </li>
        ))}
        {props.list.length === 0 && <li className="hint">No graphics yet – create one or import a package exported from the editor.</li>}
      </ul>
    </main>
  );
}

function Editor({ initial, onClose, onImport }: { initial: Project; onClose: () => void; onImport: (f: File) => void }) {
  const h = useHistory<Project>(initial);
  const project = h.state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [leftTab, setLeftTab] = useState<'layers' | 'fields'>('layers');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // autosave (debounced)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaveState('saving');
    const t = setTimeout(() => {
      api.saveProject(project).then(() => setSaveState('saved')).catch(() => setSaveState('error'));
    }, 600);
    return () => clearTimeout(t);
  }, [project]);

  const editor: EditorApi = useMemo(() => ({
    project,
    selectedId,
    select: setSelectedId,
    change: h.set,
    updateLayer: (id, patch, key) => h.set((p) => ({ ...p, layers: updateLayer(p.layers, id, patch) }), key),
  }), [project, selectedId, h.set]);

  const selected = selectedId ? findLayer(project.layers, selectedId) : undefined;

  const addLayer = (type: LayerType) => {
    const layer = createLayer(type);
    h.set((p) => {
      const sel = selectedId ? findLayer(p.layers, selectedId) : undefined;
      return { ...p, layers: sel?.type === 'group' ? insertLayer(p.layers, { ...layer, x: 20, y: 20 }, null, sel.id) : insertLayer(p.layers, layer, sel?.id ?? null) };
    });
    setSelectedId(layer.id);
  };
  const duplicate = () => {
    if (!selected) return;
    const c = cloneLayer(selected);
    h.set((p) => ({ ...p, layers: insertLayer(p.layers, c, selected.id) }));
    setSelectedId(c.id);
  };
  const remove = () => {
    if (!selected) return;
    h.set((p) => ({ ...p, layers: removeLayer(p.layers, selected.id) }));
    setSelectedId(null);
  };

  const buildZip = async (rev: number) => {
    const r = await exportPackage({ ...project, revision: rev }, async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()));
    if (r.errors.length) throw new Error(`invalid manifest: ${r.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
    return zipSync(r.files, { level: 6 });
  };

  const publish = async () => {
    setBusy(true);
    try {
      const rev = project.revision + 1;
      await api.publishZip(await buildZip(rev));
      h.set((p) => ({ ...p, revision: rev }));
      toast('info', `Published "${project.name}" (${project.graphicId}, version ${rev}) – it is in the player's graphics library.`, 6000);
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { graphics?: { errors: { path: string; message: string }[] }[] } | undefined) : undefined;
      const errs = details?.graphics?.flatMap((g) => g.errors.map((x) => `${x.path} ${x.message}`)) ?? [];
      toast('error', `Publish failed: ${(e as Error).message}${errs.length ? ` – ${errs.slice(0, 3).join('; ')}` : ''}`, 10_000);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    try {
      const zip = await buildZip(project.revision || 1);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      a.download = `${slugify(project.name) || 'graphic'}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void api.saveProject(project).then(() => { setSaveState('saved'); toast('info', 'Saved'); });
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? h.redo() : h.undo(); }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return h.redo(); }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return duplicate(); }
      if (!selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return remove(); }
      if (e.key === 'Escape') return setSelectedId(null);
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = moves[e.key];
      if (m && !selected.locked) {
        e.preventDefault();
        editor.updateLayer(selected.id, { x: selected.x + m[0], y: selected.y + m[1] }, `nudge-${selected.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="app editor">
      <header className="bar">
        <button className="ghost" onClick={onClose} title="All graphics">◂</button>
        <div className="brand">OGraf <span>Editor</span></div>
        <input className="project-name" value={project.name} onChange={(e) => h.set((p) => ({ ...p, name: e.target.value }), 'name')} />
        <span className={`save ${saveState}`}>{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Not saved!'}</span>
        <span className="grow" />
        <button disabled={!h.canUndo} onClick={h.undo} title="Undo (Ctrl/⌘+Z)">↶</button>
        <button disabled={!h.canRedo} onClick={h.redo} title="Redo (Ctrl/⌘+Shift+Z)">↷</button>
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <input ref={fileRef} type="file" accept=".zip,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        <button onClick={download} title="Download the OGraf package (.zip)">⇩ Download .zip</button>
        <button className="primary" disabled={busy} onClick={publish} title="Export and add to the graphics library (player)">{busy ? 'Publishing…' : '⇪ Publish to library'}</button>
      </header>
      <aside className="left">
        <div className="tabs">
          <button className={leftTab === 'layers' ? 'on' : ''} onClick={() => setLeftTab('layers')}>Layers</button>
          <button className={leftTab === 'fields' ? 'on' : ''} onClick={() => setLeftTab('fields')}>Data fields ({project.fields.length})</button>
        </div>
        {leftTab === 'layers'
          ? <LayersPanel editor={editor} onAdd={addLayer} onDuplicate={duplicate} onDelete={remove} onMove={(dir) => selected && h.set((p) => ({ ...p, layers: moveLayer(p.layers, selected.id, dir) }))} />
          : <FieldsPanel editor={editor} />}
      </aside>
      <Canvas editor={editor} />
      <aside className="right">
        <PropertiesPanel editor={editor} layer={selected} />
      </aside>
      <Toasts />
    </div>
  );
}

