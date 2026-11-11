/**
 * The artboard: renders the project with the real graphic runtime (in the renderer's isolated layer frame)
 * at the playhead time, and an overlay for (multi-)selection, moving, resizing, snapping and safe areas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ancestors, defaultData, editProp, findLayer, generateModule, updateLayer, valueAt, walk, type Layer, type Project } from '@ogp/editor-core';
import { localizeClocks } from '@ogp/protocol/clock';
import { getAtPath } from '@ogp/protocol/data-paths';
import type { EditorApi } from '../App.tsx';
import { api } from '../lib/api.ts';
import { resize, safeAreas, snapLines, snapMove, type Handle, type Rect } from '../lib/geometry.ts';
import { useSize } from '../lib/hooks.ts';
import { absRectAt, normaliseSelection } from '../lib/selection.ts';
import { toast } from '../lib/toast.ts';
import type { PreviewController } from './Timeline.tsx';

interface GraphicEl extends HTMLElement {
  v_ogpEdit(o: { project?: Project; data?: Record<string, unknown>; shown?: boolean; time?: number }): void;
  v_ogpSeek(t: number): void;
  v_ogpPlayRange(t0: number, t1: number): Promise<void>;
  playAction(p: Record<string, unknown>): Promise<{ currentStep?: number }>;
  stopAction(p: Record<string, unknown>): Promise<unknown>;
}
interface LayerFrameApi {
  load(o: Record<string, unknown>): Promise<{ statusCode: number; statusMessage?: string }>;
}

type Drag =
  | { kind: 'move'; sx: number; sy: number; items: { id: string; x: number; y: number }[]; bounds: Rect }
  | { kind: 'resize'; id: string; handle: Handle; sx: number; sy: number; abs: Rect; local: { x: number; y: number } }
  | { kind: 'marquee'; sx: number; sy: number; x0: number; y0: number; additive: boolean; base: string[] };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function Canvas({ editor, controllerRef }: { editor: EditorApi; controllerRef: React.MutableRefObject<PreviewController | null> }) {
  const { project, selectedIds, time } = editor;
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
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const elRef = useRef<GraphicEl | null>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const fit = size.width > 0 ? Math.min((size.width - 48) / W, (size.height - 48) / H) : 0.4;
  const scale = zoom === 'fit' ? Math.max(0.05, fit) : zoom;

  // ---------------- data: field defaults, or live values of the bound data paths
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

  useEffect(() => {
    if (!live) return;
    const refresh = async () => {
      try {
        const [h, o] = await Promise.all([api.data(), api.serverTime()]);
        setHub(h);
        setOffset(o);
      } catch (e) {
        toast('error', (e as Error).message);
      }
    };
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [live]);

  // ---------------- graphic runtime in the layer frame
  const blobUrl = useMemo(() => URL.createObjectURL(new Blob([generateModule({ ...project, layers: [] })], { type: 'text/javascript' })), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => URL.revokeObjectURL(blobUrl), [blobUrl]);
  const latest = useRef({ project, data, time });
  latest.current = { project, data, time };

  const onFrameLoad = async (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const frame = e.currentTarget;
    const layerApi = (frame.contentWindow as (Window & { ogpLayer?: LayerFrameApi }) | null)?.ogpLayer;
    if (!layerApi) return toast('error', 'Could not start the preview frame');
    const r = await layerApi.load({ mainUrl: blobUrl, graphicId: project.graphicId, stepCount: 1, data: latest.current.data, renderCharacteristics: { resolution: { width: W, height: H }, frameRate: 50 } });
    if (r.statusCode >= 400) return toast('error', `Preview: ${r.statusMessage}`);
    elRef.current = frame.contentDocument?.body.querySelector(':scope > *') as GraphicEl | null;
    elRef.current?.v_ogpEdit({ project: latest.current.project, data: latest.current.data, shown: true, time: latest.current.time });
    setReady(true);
  };

  // project/data changes rebuild; time changes only seek
  useEffect(() => {
    if (!ready || mode !== 'edit') return;
    elRef.current?.v_ogpEdit({ project, data, shown: true, time: latest.current.time });
  }, [ready, mode, project, data]);
  useEffect(() => {
    if (!ready || mode !== 'edit') return;
    elRef.current?.v_ogpSeek(time);
  }, [ready, mode, time]);

  // ---------------- preview controller (timeline transport + In/Next/Out)
  const step = useRef<number | undefined>(undefined);
  const [stepLabel, setStepLabel] = useState('');
  useEffect(() => {
    controllerRef.current = {
      seek: (t) => {
        setMode('edit');
        elRef.current?.v_ogpSeek(t);
      },
      playRange: async (t0, t1) => {
        const el = elRef.current;
        if (!el) return;
        setMode('edit');
        await el.v_ogpPlayRange(t0, t1);
      },
      takeIn: async () => {
        const el = elRef.current;
        if (!el) return;
        setMode('preview');
        el.v_ogpEdit({ project: latest.current.project, data: latest.current.data, shown: false });
        const r = await el.playAction({});
        step.current = r.currentStep;
        setStepLabel(`step ${(r.currentStep ?? 0) + 1}`);
      },
      next: async () => {
        const el = elRef.current;
        if (!el) return;
        if (step.current === undefined) {
          setMode('preview');
          el.v_ogpEdit({ project: latest.current.project, data: latest.current.data, shown: false });
        }
        const r = await el.playAction({ delta: 1 });
        step.current = r.currentStep;
        setStepLabel(`step ${(r.currentStep ?? 0) + 1}`);
      },
      out: async () => {
        const el = elRef.current;
        if (!el) return;
        setMode('preview');
        await el.stopAction({});
        step.current = undefined;
        setStepLabel('out');
      },
      backToEdit: () => setMode('edit'),
    };
  }, [controllerRef]);
  const ctl = (fn: (c: PreviewController) => Promise<void>) => {
    const c = controllerRef.current;
    if (c) fn(c).catch((e: Error) => toast('error', e.message));
  };
  // leaving preview mode restores the edit view at the playhead
  useEffect(() => {
    if (mode === 'edit') step.current = undefined;
  }, [mode]);

  // ---------------- overlay geometry (state at the playhead)
  const boxes = useMemo(() => {
    const out: { layer: Layer; abs: Rect; rotation: number; scale: number; topLevel: boolean }[] = [];
    walk(project.layers, (l) => {
      if (l.visible === false) return;
      const anc = ancestors(project.layers, l.id);
      if (anc.some((a) => a.visible === false)) return;
      out.push({ layer: l, abs: absRectAt(project.layers, l.id, time), rotation: valueAt(l, 'rotation', time), scale: valueAt(l, 'scale', time), topLevel: anc.length === 0 });
    });
    return out;
  }, [project.layers, time]);
  const selSet = new Set(selectedIds);
  const single = selectedIds.length === 1 ? boxes.find((b) => b.layer.id === selectedIds[0]) : undefined;
  const selBoxes = boxes.filter((b) => selSet.has(b.layer.id));
  const selBounds = selBoxes.length > 1 ? boundsOf(selBoxes.map((b) => b.abs)) : null;

  const toArt = (e: { clientX: number; clientY: number }) => {
    const r = artRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
    if (mode !== 'edit') setMode('edit');
  };

  const onBoxDown = (e: React.PointerEvent, layer: Layer) => {
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      e.stopPropagation();
      editor.select(layer.id, 'toggle');
      return;
    }
    // clicking an unselected layer selects it alone; clicking a selected one keeps the multi-selection for dragging
    const ids = selSet.has(layer.id) ? selectedIds : [layer.id];
    if (!selSet.has(layer.id)) editor.select(layer.id);
    if (layer.locked) return e.stopPropagation();
    const movable = normaliseSelection(project.layers, ids).filter((id) => !findLayer(project.layers, id)?.locked);
    const items = movable.map((id) => {
      const l = findLayer(project.layers, id)!;
      return { id, x: valueAt(l, 'x', time), y: valueAt(l, 'y', time) };
    });
    const bounds = boundsOf(movable.map((id) => absRectAt(project.layers, id, time)));
    startDrag(e, { kind: 'move', sx: e.clientX, sy: e.clientY, items, bounds });
  };

  const onEmptyDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) editor.select(null);
    const p = toArt(e);
    startDrag(e, { kind: 'marquee', sx: e.clientX, sy: e.clientY, x0: p.x, y0: p.y, additive, base: additive ? selectedIds : [] });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'marquee') {
      const p = toArt(e);
      const r = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), width: Math.abs(p.x - d.x0), height: Math.abs(p.y - d.y0) };
      setMarquee(r);
      if (r.width > 2 || r.height > 2) {
        const hit = boxes.filter((b) => b.topLevel && !b.layer.locked && intersects(b.abs, r)).map((b) => b.layer.id);
        editor.selectMany([...new Set([...d.base, ...hit])]);
      }
      return;
    }
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (d.kind === 'move') {
      let mx = dx;
      let my = dy;
      let gx: number | null = null;
      let gy: number | null = null;
      if (!e.altKey) {
        const moving = new Set(d.items.map((i) => i.id));
        const others = boxes.filter((b) => !moving.has(b.layer.id) && !ancestors(project.layers, b.layer.id).some((a) => moving.has(a.id))).map((b) => b.abs);
        const s = snapMove({ ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy }, snapLines(W, H, others), 6 / scale);
        mx = s.x - d.bounds.x;
        my = s.y - d.bounds.y;
        gx = s.guideX;
        gy = s.guideY;
      }
      setGuides({ x: gx, y: gy });
      const t = time;
      editor.change((p) => ({
        ...p,
        layers: d.items.reduce((ls, it) => updateLayer(ls, it.id, (l) => editProp(editProp(l, 'x', Math.round(it.x + mx), t), 'y', Math.round(it.y + my), t)), p.layers),
      }), `drag-${d.items.map((i) => i.id).join()}`);
    } else {
      const r = resize(d.abs, d.handle, dx, dy, e.shiftKey);
      const t = time;
      const ox = r.x - d.abs.x;
      const oy = r.y - d.abs.y;
      editor.change((p) => ({
        ...p,
        layers: updateLayer(p.layers, d.id, (l) => {
          let n = { ...l, width: r.width, height: r.height } as Layer;
          if (ox) n = editProp(n, 'x', Math.round(d.local.x + ox), t);
          if (oy) n = editProp(n, 'y', Math.round(d.local.y + oy), t);
          return n;
        }),
      }), `resize-${d.id}`);
    }
  };
  const onUp = () => {
    drag.current = null;
    setGuides({ x: null, y: null });
    setMarquee(null);
  };

  const sa = safeAreas(W, H);
  return (
    <main className="canvas-area">
      <div className="canvas-tools">
        <span className={`mode ${mode}`}>{mode === 'edit' ? 'Edit' : `Preview · ${stepLabel}`}</span>
        <button className="small" onClick={() => ctl((c) => c.takeIn())} title="Play In from the start, like a take in the player">▶ In</button>
        <button className="small" onClick={() => ctl((c) => c.next())} disabled={project.timeline.steps.length < 2 && mode === 'edit'} title="Next step (like Next in the player)">⏭ Next</button>
        <button className="small" onClick={() => ctl((c) => c.out())} title="Play Out">■ Out</button>
        {mode === 'preview' && <button className="small" onClick={() => setMode('edit')}>Back to edit</button>}
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
      <div className="canvas-wrap" ref={wrapRef} onPointerDown={(e) => { if (e.target === e.currentTarget) editor.select(null); }}>
        <div className="artboard" ref={artRef} style={{ width: W * scale, height: H * scale }}>
          <iframe title="Canvas" src="/renderer/layer.html" onLoad={(e) => void onFrameLoad(e)} style={{ width: W, height: H, transform: `scale(${scale})` }} />
          <div className="overlay" onPointerDown={onEmptyDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {safe && (
              <>
                <div className="safe action" style={rectStyle(sa.action, scale)} />
                <div className="safe graphics" style={rectStyle(sa.graphics, scale)} />
              </>
            )}
            {mode === 'edit' && boxes.map(({ layer, abs, rotation, scale: s }) => (
              <div
                key={layer.id}
                className={`box ${selSet.has(layer.id) ? 'sel' : ''} ${layer.locked ? 'locked' : ''} ${layer.type}`}
                style={{ ...rectStyle(abs, scale), transform: rotation || s !== 1 ? `rotate(${rotation}deg) scale(${s})` : undefined }}
                onPointerDown={(e) => onBoxDown(e, layer)}
                title={layer.name}
              />
            ))}
            {mode === 'edit' && single && !single.layer.locked && (
              <div className="handles" style={{ ...rectStyle(single.abs, scale), transform: single.rotation ? `rotate(${single.rotation}deg)` : undefined }}>
                {HANDLES.map((hd) => (
                  <span
                    key={hd}
                    className={`handle ${hd}`}
                    onPointerDown={(e) => startDrag(e, { kind: 'resize', id: single.layer.id, handle: hd, sx: e.clientX, sy: e.clientY, abs: single.abs, local: { x: valueAt(single.layer, 'x', time), y: valueAt(single.layer, 'y', time) } })}
                  />
                ))}
              </div>
            )}
            {mode === 'edit' && selBounds && <div className="multi-bounds" style={rectStyle(selBounds, scale)} />}
            {marquee && <div className="marquee" style={rectStyle(marquee, scale)} />}
            {guides.x !== null && <div className="guide v" style={{ left: guides.x * scale }} />}
            {guides.y !== null && <div className="guide h" style={{ top: guides.y * scale }} />}
          </div>
        </div>
      </div>
      <div className="canvas-status">
        {selectedIds.length > 1
          ? `${selectedIds.length} layers selected`
          : single ? `${single.layer.name} · x ${Math.round(single.abs.x)} y ${Math.round(single.abs.y)} · ${single.abs.width}×${single.abs.height}` : `${W}×${H}`}
        <span className="grow" />
        <span className="hint">Shift/Ctrl-click or drag on empty canvas to multi-select · Alt disables snapping · arrows nudge</span>
      </div>
    </main>
  );
}

function rectStyle(r: Rect, s: number): React.CSSProperties {
  return { left: r.x * s, top: r.y * s, width: r.width * s, height: r.height * s };
}

function boundsOf(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
