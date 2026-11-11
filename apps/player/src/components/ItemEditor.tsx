import { useEffect, useRef, useState } from 'react';
import type { ChannelState, Rundown, RundownItem } from '@ogp/protocol';
import type { PlayerActions } from '../App.tsx';
import { api, type GraphicDto } from '../lib/api.ts';
import { live } from '../lib/live.ts';
import { useDebounced, useStored } from '../lib/hooks.ts';
import type { ItemStatus } from '../lib/item-status.ts';
import type { DataPathInfo, Schema } from '../lib/gdd-form.ts';
import { toast } from '../lib/toast.ts';
import { GddForm } from './GddForm.tsx';

type Patch = Partial<Pick<RundownItem, 'name' | 'channelId' | 'layer' | 'data' | 'durationMs'>>;

export function ItemEditor(props: {
  rundown: Rundown;
  item: RundownItem;
  graphic: GraphicDto | undefined;
  channels: ChannelState[];
  data: Record<string, unknown>;
  dataPaths: DataPathInfo[];
  status: ItemStatus;
  actions: PlayerActions;
}) {
  const { rundown, item, graphic, status, actions } = props;
  const [draft, setDraft] = useState<RundownItem>(item);
  const [liveUpdate, setLiveUpdate] = useStored('ogp.player.liveUpdate', false);
  const pending = useRef<Patch>({});
  const dirty = useRef(false);

  // take server changes when we have nothing unsaved
  useEffect(() => {
    if (!dirty.current) setDraft(item);
  }, [item]);

  const [scheduleSave, flushSave] = useDebounced(() => {
    const patch = pending.current;
    pending.current = {};
    void api.updateItem(rundown.id, item.id, patch)
      .then((r) => {
        dirty.current = Object.keys(pending.current).length > 0;
        live.putRundown(r);
        if (liveUpdate && 'data' in patch && status.layer) actions.update(r.items.find((i) => i.id === item.id));
      })
      .catch((e: Error) => {
        dirty.current = false;
        toast('error', `Save failed: ${e.message}`);
      });
  }, 350);

  const change = (patch: Patch) => {
    dirty.current = true;
    pending.current = { ...pending.current, ...patch };
    setDraft((d) => ({ ...d, ...patch }));
    scheduleSave();
  };

  const pendingUpdate = !!status.layer && JSON.stringify(status.layer.dataTemplate) !== JSON.stringify(item.data);

  return (
    <section className="panel editor" onBlur={() => flushSave()}>
      <div className="panel-head">
        <h2>Item</h2>
        <span className={`badge ${status.state}`}>{status.state === 'idle' ? '' : status.state === 'onair' ? 'ON AIR' : status.state.toUpperCase()}</span>
        <span className="grow" />
        <label className="toggle" title="Send data changes to the on-air graphic immediately">
          <input type="checkbox" checked={liveUpdate} onChange={(e) => setLiveUpdate(e.target.checked)} /> Live update
        </label>
      </div>

      {!graphic && <p className="err">Graphic "{item.graphicId}" is not available (deleted?).</p>}
      {pendingUpdate && (
        <div className="pending-bar">
          Edited data is not on air yet
          <button className="small update" onClick={() => { flushSave(); setTimeout(() => actions.update(item), 50); }}>Update now (U)</button>
        </div>
      )}
      {status.error && <p className="err">⚠ {status.error}</p>}

      <div className="meta-grid">
        <label>Name<input value={draft.name} placeholder="(from data)" onChange={(e) => change({ name: e.target.value })} /></label>
        <label>Graphic<input value={graphic?.name ?? item.graphicId} disabled /></label>
        <label>Channel
          <select value={draft.channelId} onChange={(e) => change({ channelId: e.target.value })}>
            {props.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Layer<input type="number" min={0} max={999} value={draft.layer} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 999) change({ layer: n }); }} /></label>
        <label title="Take the item out automatically after this many seconds (empty = manual)">Auto-out (s)
          <input type="number" min={0} step={0.5} value={draft.durationMs ? draft.durationMs / 1000 : ''} placeholder="manual"
            onChange={(e) => change({ durationMs: e.target.value === '' || Number(e.target.value) <= 0 ? null : Math.round(Number(e.target.value) * 1000) })} />
        </label>
      </div>

      {graphic && graphic.customActions.length > 0 && (
        <div className="custom-actions">
          {graphic.customActions.map((a) => <CustomActionButton key={a.id} action={a} disabled={status.state !== 'onair'} onRun={(payload) => actions.custom(item, a.id, payload)} />)}
        </div>
      )}

      <h3>Data</h3>
      {graphic && <GddForm schema={graphic.schema as Schema | null} value={draft.data} onChange={(data) => change({ data })} liveData={props.data} />}
    </section>
  );
}

/** Button for a custom action; actions with a select/enum parameter get one button per option. */
function CustomActionButton(props: { action: GraphicDto['customActions'][number]; disabled: boolean; onRun: (payload: unknown) => void }) {
  const { action } = props;
  const schema = action.schema as Schema | null | undefined;
  const props0 = schema && typeof schema.properties === 'object' ? Object.entries(schema.properties as Record<string, Schema>) : [];
  const [key, prop] = props0.length === 1 ? props0[0]! : [undefined, undefined];
  if (key && prop && Array.isArray(prop.enum)) {
    const labels = ((prop.gddOptions as Schema | undefined)?.labels ?? {}) as Record<string, string>;
    return (
      <span className="custom-group" title={action.description}>
        <span className="muted">{action.name}</span>
        {(prop.enum as (string | number)[]).map((v) => (
          <button key={String(v)} className="small" disabled={props.disabled} onClick={() => props.onRun({ [key]: v })}>{labels[String(v)] ?? String(v)}</button>
        ))}
      </span>
    );
  }
  return <button className="small" disabled={props.disabled} title={action.description} onClick={() => props.onRun(null)}>⚡ {action.name}</button>;
}
