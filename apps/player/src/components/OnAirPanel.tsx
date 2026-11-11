import type { ChannelState, Rundown, RundownItem } from '@ogp/protocol';
import { api } from '../lib/api.ts';
import { useNow } from '../lib/hooks.ts';
import { formatDuration, stepLabel } from '../lib/item-status.ts';
import { run } from '../lib/toast.ts';

/** What is loaded on the program channel right now, with quick next/out per layer. */
export function OnAirPanel(props: { channel: ChannelState | undefined; rundowns: Record<string, Rundown>; labelOf: (item: RundownItem) => string }) {
  const now = useNow(1000);
  const ch = props.channel;
  const layers = ch?.layers ?? [];
  return (
    <section className="panel onair">
      <div className="panel-head">
        <h2>On {ch?.name ?? 'channel'}</h2>
      </div>
      {layers.length === 0 && <div className="hint">Nothing loaded</div>}
      <ul>
        {layers.map((l) => {
          const item = l.source ? props.rundowns[l.source.rundownId]?.items.find((i) => i.id === l.source!.itemId) : undefined;
          const steps = l.graphic.stepCount === -1 || (l.graphic.stepCount ?? 1) > 1;
          return (
            <li key={l.layer} className={`state-${l.status}`}>
              <span className="layer">L{l.layer}</span>
              <span className="what">
                <span className="title">{item ? props.labelOf(item) : l.graphic.name}</span>
                <span className="sub">
                  {l.status === 'playing' ? 'ON AIR' : l.status === 'loaded' ? 'CUED' : 'OUT'}
                  {l.status === 'playing' && l.onAirSince ? ` · ${formatDuration(now - l.onAirSince)}` : ''}
                  {stepLabel(l.currentStep, l.graphic.stepCount) ? ` · ${stepLabel(l.currentStep, l.graphic.stepCount)}` : ''}
                  {l.error ? <span className="err"> · ⚠ {l.error.message}</span> : null}
                </span>
              </span>
              {steps && l.status === 'playing' && <button className="small" onClick={() => void run('Next', () => api.layer(ch!.id, l.layer, 'next'))}>Next</button>}
              {l.status === 'playing'
                ? <button className="small out" onClick={() => void run('Out', () => api.layer(ch!.id, l.layer, 'out'))}>Out</button>
                : <button className="small" onClick={() => void run('Clear', () => api.layer(ch!.id, l.layer, 'clear').then(() => ({ statusCode: 200 })))}>Clear</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
