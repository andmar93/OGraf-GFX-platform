import { useState } from 'react';
import type { Layer, LayerType } from '@ogp/editor-core';
import type { EditorApi } from '../App.tsx';

const ICON: Record<LayerType, string> = { text: 'T', shape: '▭', image: '🖼', group: '▤' };

export function LayersPanel(props: {
  editor: EditorApi; onAdd: (t: LayerType) => void; onDuplicate: () => void; onDelete: () => void; onMove: (dir: 1 | -1) => void;
  onCopy: () => void; onCut: () => void; onPaste: () => void;
}) {
  const { editor } = props;
  const sel = editor.selectedId;
  return (
    <div className="panel layers-panel">
      <div className="add-row">
        <button onClick={() => props.onAdd('text')} title="Add text">T Text</button>
        <button onClick={() => props.onAdd('shape')} title="Add rectangle / ellipse">▭ Shape</button>
        <button onClick={() => props.onAdd('image')} title="Add image">🖼 Image</button>
        <button onClick={() => props.onAdd('group')} title="Add group (new layers go into a selected group)">▤ Group</button>
      </div>
      <div className="tree" onClick={() => editor.select(null)}>
        {/* top of the list = top-most layer */}
        {[...editor.project.layers].reverse().map((l) => <Row key={l.id} layer={l} depth={0} editor={editor} />)}
        {editor.project.layers.length === 0 && <p className="hint">No layers – add one above.</p>}
      </div>
      <div className="tree-tools">
        <button disabled={!sel} onClick={() => props.onMove(1)} title="Bring forward">▲</button>
        <button disabled={!sel} onClick={() => props.onMove(-1)} title="Send backward">▼</button>
        <button disabled={!sel} onClick={props.onCopy} title="Copy (Ctrl/⌘+C)">Copy</button>
        <button disabled={!sel} onClick={props.onCut} title="Cut (Ctrl/⌘+X)">Cut</button>
        <button onClick={props.onPaste} title="Paste (Ctrl/⌘+V) – layers, images or text">Paste</button>
        <button disabled={!sel} onClick={props.onDuplicate} title="Duplicate (Ctrl/⌘+D)">⧉</button>
        <button disabled={!sel} onClick={props.onDelete} title="Delete (Del)">🗑</button>
      </div>
    </div>
  );
}

function Row({ layer, depth, editor }: { layer: Layer; depth: number; editor: EditorApi }) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const selected = editor.selectedId === layer.id;
  return (
    <>
      <div
        className={`row ${selected ? 'sel' : ''} ${layer.visible ? '' : 'off'}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={(e) => { e.stopPropagation(); editor.select(layer.id); }}
        onDoubleClick={() => setRenaming(true)}
      >
        {layer.type === 'group'
          ? <button className="twist" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? '▾' : '▸'}</button>
          : <span className="twist" />}
        <span className="ic">{ICON[layer.type]}</span>
        {renaming ? (
          <input autoFocus defaultValue={layer.name} onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { setRenaming(false); if (e.target.value.trim()) editor.updateLayer(layer.id, { name: e.target.value.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); }} />
        ) : <span className="nm">{layer.name}</span>}
        {Object.keys(layer.bindings).some((k) => layer.bindings[k as keyof typeof layer.bindings]) || (layer.type === 'text' && /\{[A-Za-z_]/.test(layer.text)) ? <span className="bound" title="Uses data fields">⛓</span> : null}
        <button className="icon" title={layer.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); editor.updateLayer(layer.id, { visible: !layer.visible }); }}>{layer.visible ? '👁' : '◌'}</button>
        <button className="icon" title={layer.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); editor.updateLayer(layer.id, { locked: !layer.locked }); }}>{layer.locked ? '🔒' : '🔓'}</button>
      </div>
      {layer.type === 'group' && open && [...layer.children].reverse().map((c) => <Row key={c.id} layer={c} depth={depth + 1} editor={editor} />)}
    </>
  );
}
