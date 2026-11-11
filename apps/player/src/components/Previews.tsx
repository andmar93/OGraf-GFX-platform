import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelState, RundownItem } from '@ogp/protocol';
import { localizeClocks } from '@ogp/protocol/clock';
import { resolveBindings } from '@ogp/protocol/data-paths';
import { getDefaultData } from '@ogp/ograf-core/gdd';
import type { GraphicDto } from '../lib/api.ts';
import { useSize } from '../lib/hooks.ts';

const W = 1920;
const H = 1080;

/** A 16:9 box that renders a 1920x1080 iframe scaled to fit. */
function Scaled16x9({ children }: { children: (scale: number) => React.ReactNode }) {
  const [ref, size] = useSize<HTMLDivElement>();
  return <div className="frame16x9" ref={ref}>{size.width > 0 && children(size.width / W)}</div>;
}

export function ProgramPreview({ channel }: { channel: ChannelState | undefined }) {
  return (
    <section className="preview pgm">
      <div className="preview-label"><span className="tag pgm">PGM</span>{channel?.name ?? '—'}</div>
      <Scaled16x9>
        {(scale) => channel && (
          <iframe
            key={channel.id}
            title="Program preview"
            src={`/render/${encodeURIComponent(channel.id)}?preview=1`}
            style={{ width: W, height: H, transform: `scale(${scale})` }}
          />
        )}
      </Scaled16x9>
    </section>
  );
}

interface LayerApi {
  load(opts: Record<string, unknown>): Promise<{ statusCode: number; statusMessage?: string }>;
  call(method: string, params: Record<string, unknown>): Promise<{ statusCode: number; statusMessage?: string }>;
  dispose(): Promise<unknown>;
}

/**
 * Local preview of the selected item: loads its graphic into the renderer's layer frame
 * (same isolation as on air) with bindings resolved from the live data, at the chosen step.
 */
export function ItemPreview(props: { item: RundownItem | undefined; graphic: GraphicDto | undefined; data: Record<string, unknown>; timeOffset: number }) {
  const { item, graphic } = props;
  const stepCount = graphic?.stepCount ?? 1;
  const steps = stepCount > 1 ? stepCount : 1;
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const apiRef = useRef<LayerApi | null>(null);
  const readyRef = useRef(false);

  const resolved = useMemo(() => {
    if (!item || !graphic) return undefined;
    return localizeClocks({ ...getDefaultData(graphic.schema), ...(resolveBindings(item.data, props.data) as Record<string, unknown>) }, props.timeOffset);
  }, [item, graphic, props.data, props.timeOffset]);
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  const frameKey = item && graphic ? `${item.id}|${graphic.id}|${graphic.packageId}` : 'none';
  useEffect(() => {
    setStep(0);
    setError(undefined);
    readyRef.current = false;
    apiRef.current = null;
  }, [frameKey]);

  // push data changes (debounced) once loaded
  useEffect(() => {
    if (!readyRef.current || !apiRef.current || !resolved) return;
    const t = setTimeout(() => void apiRef.current?.call('updateAction', { data: resolved, skipAnimation: true }), 120);
    return () => clearTimeout(t);
  }, [resolved]);

  useEffect(() => {
    if (readyRef.current) void apiRef.current?.call('playAction', { goto: step, skipAnimation: true });
  }, [step]);

  const onLoad = async (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const api = (e.currentTarget.contentWindow as (Window & { ogpLayer?: LayerApi }) | null)?.ogpLayer;
    if (!api || !graphic || !resolvedRef.current) return;
    apiRef.current = api;
    const r = await api.load({
      mainUrl: graphic.mainUrl, graphicId: graphic.id, stepCount: graphic.stepCount, data: resolvedRef.current,
      renderCharacteristics: { resolution: { width: W, height: H }, frameRate: 50 },
    });
    if (r.statusCode >= 400) return setError(r.statusMessage ?? `load failed (${r.statusCode})`);
    readyRef.current = true;
    const p = await api.call('playAction', { goto: 0, skipAnimation: true });
    if (p.statusCode >= 400) setError(p.statusMessage);
  };

  return (
    <section className="preview pvw">
      <div className="preview-label">
        <span className="tag pvw">PVW</span>
        {graphic?.name ?? 'No item selected'}
        <span className="grow" />
        {steps > 1 && Array.from({ length: steps }, (_, i) => (
          <button key={i} className={`step-btn ${i === step ? 'active' : ''}`} onClick={() => setStep(i)} title={`Preview step ${i + 1}`}>{i + 1}</button>
        ))}
      </div>
      <Scaled16x9>
        {(scale) => item && graphic && (
          <iframe key={frameKey} title="Item preview" src="/renderer/layer.html" onLoad={onLoad} style={{ width: W, height: H, transform: `scale(${scale})` }} />
        )}
      </Scaled16x9>
      {error && <div className="preview-error">⚠ {error}</div>}
    </section>
  );
}
