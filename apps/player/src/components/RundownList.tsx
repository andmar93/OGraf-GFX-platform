import { useState } from 'react';
import type { ChannelState, Rundown, RundownItem } from '@ogp/protocol';
import type { PlayerActions } from '../App.tsx';
import { api, type GraphicDto } from '../lib/api.ts';
import { live } from '../lib/live.ts';
import { useNow } from '../lib/hooks.ts';
import { formatDuration, itemStatus, stepLabel } from '../lib/item-status.ts';
import { toast } from '../lib/toast.ts';

const STATE_LABEL = { idle: '', cued: 'CUED', onair: 'ON AIR', out: 'OUT' } as const;

export function RundownList(props: {
  rundown: Rundown;
  channels: ChannelState[];
  graphicsById: Map<string, GraphicDto>;
  labelOf: (item: RundownItem) => string;
  lastTaken: string | null;
  autoAdvance: boolean;
  onAutoAdvance: (v: boolean) => void;
  actions: PlayerActions;
}) {
  const { rundown } = props;
  const now = useNow(1000);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const multiChannel = props.channels.length > 1;

  const drop = (toIdx: number) => {
    if (!dragId) return;
    const ids = rundown.items.map((i) => i.id).filter((id) => id !== dragId);
    const from = rundown.items.findIndex((i) => i.id === dragId);
    ids.splice(toIdx > from ? toIdx - 1 : toIdx, 0, dragId);
    setDragId(null);
    setDropIdx(null);
    if (ids.join() === rundown.items.map((i) => i.id).join()) return;
    live.putRundown({ ...rundown, items: ids.map((id, position) => ({ ...rundown.items.find((i) => i.id === id)!, position })) });
    void api.reorder(rundown.id, ids).then((r) => live.putRundown(r)).catch((e: Error) => toast('error', e.message));
  };

  return (
    <section className="panel rundown">
      <div className="panel-head">
        <h2>{rundown.name}</h2>
        <span className="muted">{rundown.items.length} item{rundown.items.length === 1 ? '' : 's'}</span>
        <span className="grow" />
        <label className="toggle" title="After Take, select the next item">
          <input type="checkbox" checked={props.autoAdvance} onChange={(e) => props.onAutoAdvance(e.target.checked)} /> Auto-advance
        </label>
      </div>
      <div className="items" role="listbox" aria-label="Rundown items" onDragOver={(e) => e.preventDefault()} onDrop={() => dropIdx !== null && drop(dropIdx)}>
        {rundown.items.map((item, idx) => {
          const st = itemStatus(item, props.channels);
          const g = props.graphicsById.get(item.graphicId);
          const selected = rundown.cursorItemId === item.id;
          const onAirFor = st.state === 'onair' && st.layer?.onAirSince ? formatDuration(now - st.layer.onAirSince) : '';
          return (
            <div
              key={item.id}
              role="option"
              aria-selected={selected}
              className={[
                'item', `state-${st.state}`, selected ? 'selected' : '', st.error ? 'has-error' : '',
                dragId === item.id ? 'dragging' : '', dropIdx === idx ? 'drop-before' : '', dropIdx === idx + 1 && idx === rundown.items.length - 1 ? 'drop-after' : '',
                !g ? 'missing' : '',
              ].join(' ')}
              draggable
              onDragStart={(e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => { setDragId(null); setDropIdx(null); }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDropIdx(e.clientY < r.top + r.height / 2 ? idx : idx + 1);
              }}
              onClick={() => props.actions.select(item.id)}
              onDoubleClick={() => props.actions.take(item)}
              title="Click to select, double-click to take, drag to reorder"
            >
              <span className="grip">⋮⋮</span>
              <span className="idx">{idx + 1}</span>
              <span className={`badge ${st.state}`}>{STATE_LABEL[st.state] || (st.layerBusy ? 'layer busy' : '')}</span>
              <span className="label">
                <span className="title">{props.labelOf(item)}</span>
                <span className="sub">
                  {g?.name ?? `missing graphic: ${item.graphicId}`}
                  {st.error && <span className="err"> · ⚠ {st.error}</span>}
                </span>
              </span>
              <span className="step">{st.layer ? stepLabel(st.layer.currentStep, st.layer.graphic.stepCount) : ''}</span>
              <span className="target">{multiChannel ? `${item.channelId} · ` : ''}L{item.layer}</span>
              <span className="duration">{onAirFor || (item.durationMs ? `⏱ ${formatDuration(item.durationMs)}` : '')}</span>
              {props.lastTaken === item.id && st.state === 'onair' && <span className="focus-dot" title="Last taken (Next/Out act on it)">●</span>}
            </div>
          );
        })}
        {rundown.items.length === 0 && <div className="empty-state small">Add graphics from the library on the left.</div>}
      </div>
    </section>
  );
}
