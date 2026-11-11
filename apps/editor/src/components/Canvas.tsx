/**
 * The artboard: renders the project with the real graphic runtime (in the renderer's isolated layer frame)
 * and an overlay for selection, moving, resizing, snapping guides and safe areas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { absolutePosition, ancestors, defaultData, generateModule, walk, type Layer, type Project } from '@ogp/editor-core';
import { localizeClocks } from '@ogp/protocol/clock';
import { getAtPath } from '@ogp/protocol/data-paths';
import type { EditorApi } from '../App.tsx';
import { api } from '../lib/api.ts';
import { resize, safeAreas, snapLines, snapMove, type Handle, type Rect } from '../lib/geometry.ts';
import { useSize } from '../lib/hooks.ts';
import { toast } from '../lib/toast.ts';

interface GraphicEl extends HTMLElement {
  v_ogpEdit(o: { project?: Project; data?: Record<string, unknown>; shown?: boolean }): void;
  playAction(p: Record<string, unknown>): Promise<unknown>;
  stopAction(p: Record<string, unknown>): Promise<unknown>;
}
interface LayerFrameApi {
  load(o: Record<string, unknown>): Promise<{ statusCode: number; statusMessage?: string }>;
}

type Drag =
  | { kind: 'move'; id: string; sx: number; sy: number; abs: Rect; parent: { x: number; y: number } }
  | { kind: 'resize'; id: string; handle: Handle; sx: number; sy: number; abs: Rect; parent: { x: number; y: number } };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function Canvas({ editor }: { editor: EditorApi }) {
  const { project, selectedId } = editor;
  const W = project.width;
  const H = project.height;
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [safe, setSafe] = useState(true);
  const [live, setLive] = useState(false);
  const [hub, setHub] = useState<Record<string, unknown>>({});
  const [offset, setOffset] = useState(0);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [ready, setReady] = useState(false);
  const elRef = useRef<GraphicEl | null>(null);
  const drag = useRef<Drag | null>(null);

  const fit = size.width > 0 ? Math.min((size.width - 48) / W, (size.height - 48) / H) : 0.4;
  const scale = zoom === 'fit' ? Math.max(0.05, fit) : zoom;

  // ---------------- data for the canvas: field defaults, or live values of the bound data paths
  const data = useMemo(() => {
    const d = defaultData(project);
    if (live) {
      for (const f of project.fields) {
        if (!f.bind) continue;
        const v = getAtPath(hub, f.bind);
        if (v !== undefined) d[f.key] = v;
      }
    }
    return localizeClocks(d, offset);
  }, [project, live, hub, offset]);

  const refreshLive = async () => {
    try {
      const [h, o] = await Promise.all([api.data(), api.serverTime()]);
      setHub(h);
      setOffset(o);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  useEffect(() => {
    if (!live) return;
    void refreshLive();
    const t = setInterval(() => void refreshLive(), 2000);
    return () => clearInterval(t);
  }, [live]);

  // ---------------- graphic runtime in the layer frame
  const blobUrl = useMemo(() => URL.createObjectURL(new Blob([generateModule({ ...project, layers: [] })], { type: 'text/javascript' })), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => URL.revokeObjectURL(blobUrl), [blobUrl]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const dataRef = useRef(data);
  dataRef.current = data;

  const onFrameLoad = async (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const frame = e.currentTarget;
    const layerApi = (frame.contentWindow as (Window & { ogpLayer?: LayerFrameApi }) | null)?.ogpLayer;
    if (!layerApi) return toast('error', 'Could not start the preview frame');
    const r = await layerApi.load({ mainUrl: blobUrl, graphicId: project.graphicId, stepCount: 1, data: dataRef.current, renderCharacteristics: { resolution: { width: W, height: H }, frameRate: 50 } });
    if (r.statusCode >= 400) return toast('error', `Preview: ${r.statusMessage}`);
    elRef.current = frame.contentDocument?.body.querySelector(':scope > *') as GraphicEl | null;
    elRef.current?.v_ogpEdit({ project: projectRef.current, data: dataRef.current, shown: true });
    setReady(true);
  };

  useEffect(() => {
    if (!ready || mode !== 'edit') return;
    elRef.current?.v_ogpEdit({ project, data, shown: true });
  }, [ready, mode, project, data]);

  const playIn = async () => {
    const el = elRef.current;
    if (!el) return;
    setMode('preview');
    el.v_ogpEdit({ project, data, shown: false });
    await el.playAction({});
  };
  const playOut = async () => {
    const el = elRef.current;
    if (!el) return;
    setMode('preview');
    await el.stopAction({});
  };

  // ---------------- overlay geometry
  const boxes = useMemo(() => {
    const out: { layer: Layer; abs: Rect; depth: number }[] = [];
    walk(project.layers, (l) => {
      if (l.visible === false) return;
      const anc = ancestors(project.layers, l.id);
      if (anc.some((a) => a.visible === false)) return;
      const p = absolutePosition(project.layers, l.id);
      out.push({ layer: l, abs: { x: p.x, y: p.y, width: l.width, height: l.height }, depth: anc.length });
    });
    return out;
  }, [project.layers]);
  const selectedBox = boxes.find((b) => b.layer.id === selectedId);

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
    if (mode !== 'edit') setMode('edit');
  };
  const onBoxDown = (e: React.PointerEvent, layer: Layer, abs: Rect) => {
    if (e.button !== 0) return;
    editor.select(layer.id);
    if (layer.locked) return e.stopPropagation();
    const parent = { x: abs.x - layer.x, y: abs.y - layer.y };
    startDrag(e, { kind: 'move', id: layer.id, sx: e.clientX, sy: e.clientY, abs, parent });
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (d.kind === 'move') {
      let x = d.abs.x + dx;
      let y = d.abs.y + dy;
      let gx: number | null = null;
      let gy: number | null = null;
      if (!e.altKey) {
        const others = boxes.filter((b) => b.layer.id !== d.id && !ancestors(project.layers, b.layer.id).some((a) => a.id === d.id)).map((b) => b.abs);
        const s = snapMove({ ...d.abs, x, y }, snapLines(W, H, others), 6 / scale);
        x = s.x; y = s.y; gx = s.guideX; gy = s.guideY;
      }
      setGuides({ x: gx, y: gy });
      editor.updateLayer(d.id, { x: Math.round(x - d.parent.x), y: Math.round(y - d.parent.y) }, `drag-${d.id}`);
    } else {
      const r = resize(d.abs, d.handle, dx, dy, e.shiftKey);
      editor.updateLayer(d.id, { x: r.x - d.parent.x, y: r.y - d.parent.y, width: r.width, height: r.height }, `resize-${d.id}`);
    }
  };
  const onUp = () => {
    drag.current = null;
    setGuides({ x: null, y: null });
  };

  const sa = safeAreas(W, H);
  return (
    <main className="canvas-area">
      <div className="canvas-tools">
        <div className="seg">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>Edit</button>
          <button className={mode === 'preview' ? 'on' : ''} onClick={() => void playIn()} title="Play the in-animation">▶ In</button>
          <button onClick={() => void playOut()} title="Play the out-animation">■ Out</button>
        </div>
        <label className="toggle"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live data</label>
        <label className="toggle"><input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} /> Safe areas</label>
        <span className="grow" />
        <select value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
          <option value="fit">Fit ({Math.round(fit * 100)}%)</option>
          <option value="0.25">25%</option>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
        </select>
      </div>
      <div className="canvas-wrap" ref={wrapRef} onPointerDown={() => editor.select(null)}>
        <div className="artboard" style={{ width: W * scale, height: H * scale }}>
          <iframe title="Canvas" src="/renderer/layer.html" onLoad={(e) => void onFrameLoad(e)} style={{ width: W, height: H, transform: `scale(${scale})` }} />
          <div className="overlay" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {safe && (
              <>
                <div className="safe action" style={rectStyle(sa.action, scale)} />
                <div className="safe graphics" style={rectStyle(sa.graphics, scale)} />
              </>
            )}
            {mode === 'edit' && boxes.map(({ layer, abs }) => (
              <div
                key={layer.id}
                className={`box ${layer.id === selectedId ? 'sel' : ''} ${layer.locked ? 'locked' : ''} ${layer.type}`}
                style={{ ...rectStyle(abs, scale), transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined }}
                onPointerDown={(e) => onBoxDown(e, layer, abs)}
                title={layer.name}
              />
            ))}
            {mode === 'edit' && selectedBox && !selectedBox.layer.locked && (
              <div className="handles" style={{ ...rectStyle(selectedBox.abs, scale), transform: selectedBox.layer.rotation ? `rotate(${selectedBox.layer.rotation}deg)` : undefined }}>
                {HANDLES.map((hd) => (
                  <span
                    key={hd}
                    className={`handle ${hd}`}
                    onPointerDown={(e) => startDrag(e, { kind: 'resize', id: selectedBox.layer.id, handle: hd, sx: e.clientX, sy: e.clientY, abs: selectedBox.abs, parent: { x: selectedBox.abs.x - selectedBox.layer.x, y: selectedBox.abs.y - selectedBox.layer.y } })}
                  />
                ))}
              </div>
            )}
            {guides.x !== null && <div className="guide v" style={{ left: guides.x * scale }} />}
            {guides.y !== null && <div className="guide h" style={{ top: guides.y * scale }} />}
          </div>
        </div>
      </div>
      <div className="canvas-status">
        {selectedBox ? `${selectedBox.layer.name} · x ${selectedBox.abs.x} y ${selectedBox.abs.y} · ${selectedBox.abs.width}×${selectedBox.abs.height}` : `${W}×${H}`}
        <span className="grow" />
        <span className="hint">Drag to move · handles resize (Shift keeps ratio) · Alt disables snapping · arrows nudge</span>
      </div>
    </main>
  );
}

function rectStyle(r: Rect, s: number): React.CSSProperties {
  return { left: r.x * s, top: r.y * s, width: r.width * s, height: r.height * s };
}
