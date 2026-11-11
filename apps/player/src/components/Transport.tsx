import type { RundownItem } from '@ogp/protocol';
import type { PlayerActions } from '../App.tsx';
import type { GraphicDto } from '../lib/api.ts';
import type { ItemStatus } from '../lib/item-status.ts';

/** Big operator buttons. */
export function Transport(props: {
  selected: RundownItem | undefined;
  selectedLabel: string | undefined;
  status: ItemStatus | undefined;
  graphic: GraphicDto | undefined;
  canStep: boolean;
  actions: PlayerActions;
}) {
  const { actions, selected, status } = props;
  const onAir = status?.state === 'onair';
  const pendingUpdate = !!(status?.layer && selected && JSON.stringify(status.layer.dataTemplate) !== JSON.stringify(selected.data));
  return (
    <footer className="transport">
      <div className="next-up">
        <span className="muted">Selected</span>
        <span className="title">{props.selectedLabel ?? '—'}</span>
      </div>
      <button className="t cue" disabled={!selected} onClick={() => actions.cue()}>CUE<kbd>C</kbd></button>
      <button className="t take" disabled={!selected} onClick={() => actions.take()}>{onAir && props.canStep ? 'TAKE ▸ STEP' : 'TAKE'}<kbd>Space</kbd></button>
      <button className="t" onClick={() => actions.prev()}>◂ PREV<kbd>←</kbd></button>
      <button className="t" onClick={() => actions.next()}>NEXT ▸<kbd>→</kbd></button>
      <button className="t out" onClick={() => actions.out()}>OUT<kbd>O</kbd></button>
      <button className={`t update ${pendingUpdate ? 'pending' : ''}`} disabled={!status?.layer} onClick={() => actions.update(selected)} title={pendingUpdate ? 'Edited data is not on air yet' : 'Send data to the on-air graphic'}>
        UPDATE<kbd>U</kbd>
      </button>
      <span className="grow" />
      <button className="t out-all" onClick={() => actions.outAll()}>OUT ALL<kbd>⇧O</kbd></button>
    </footer>
  );
}
