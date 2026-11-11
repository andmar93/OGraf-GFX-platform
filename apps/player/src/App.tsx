import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Rundown, RundownItem } from '@ogp/protocol';
import { buildLabel } from '@ogp/ograf-core/gdd';
import { hasStepControls } from '@ogp/ograf-core/steps';
import { resolveBindings } from '@ogp/protocol/data-paths';
import { api, type GraphicDto } from './lib/api.ts';
import { live, useLive } from './lib/live.ts';
import { itemLabel, itemStatus } from './lib/item-status.ts';
import { flattenDataPaths } from './lib/gdd-form.ts';
import { isTypingTarget, shortcutFor, type ShortcutAction } from './lib/shortcuts.ts';
import { useStored } from './lib/hooks.ts';
import { run, toast } from './lib/toast.ts';
import { Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { RundownList } from './components/RundownList.tsx';
import { ItemEditor } from './components/ItemEditor.tsx';
import { ProgramPreview, ItemPreview } from './components/Previews.tsx';
import { OnAirPanel } from './components/OnAirPanel.tsx';
import { Transport } from './components/Transport.tsx';
import { ShortcutHelp } from './components/ShortcutHelp.tsx';
import { Toasts } from './components/Toasts.tsx';

export interface PlayerActions {
  select(itemId: string | null): void;
  take(item?: RundownItem): void;
  cue(item?: RundownItem): void;
  next(): void;
  prev(): void;
  out(): void;
  update(item?: RundownItem): void;
  outAll(): void;
  clearAll(): void;
  custom(item: RundownItem, actionId: string, payload: unknown): void;
}

export function App() {
  const s = useLive();
  const [rundownId, setRundownId] = useStored<string | null>('ogp.player.rundown', null);
  const [autoAdvance, setAutoAdvance] = useStored('ogp.player.autoAdvance', true);
  const [programChannel, setProgramChannel] = useStored<string>('ogp.player.programChannel', 'main');
  const [lastTaken, setLastTaken] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // pick a rundown: stored one if it still exists, else the first; load it into the store
  const activeId = rundownId && s.rundownList.some((r) => r.id === rundownId) ? rundownId : (s.rundownList[0]?.id ?? null);
  useEffect(() => {
    if (activeId && !s.rundowns[activeId]) void live.loadRundown(activeId);
  }, [activeId, s.rundowns]);
  const rundown: Rundown | undefined = activeId ? s.rundowns[activeId] : undefined;

  const graphicsById = useMemo(() => new Map<string, GraphicDto>(s.graphics.map((g) => [g.id, g])), [s.graphics]);
  const selected = rundown?.items.find((i) => i.id === rundown.cursorItemId);
  const dataPaths = useMemo(() => flattenDataPaths(s.data), [s.data]);
  const channel = s.channels.find((c) => c.id === programChannel) ?? s.channels[0];

  const labelOf = useCallback((item: RundownItem) => {
    const g = graphicsById.get(item.graphicId);
    // label from the resolved data, so bound fields show their live values (e.g. "NBR – EPU")
    return itemLabel(item, g?.name, (d) => buildLabel(g?.schema, resolveBindings(d, s.data), 2));
  }, [graphicsById, s.data]);

  // ---------------- actions ----------------

  const select = useCallback((itemId: string | null) => {
    if (!rundown || rundown.cursorItemId === itemId) return;
    live.putRundown({ ...rundown, cursorItemId: itemId });
    void api.updateRundown(rundown.id, { cursorItemId: itemId }).catch((e: Error) => toast('error', e.message));
  }, [rundown]);

  /** Item that next/prev/out act on: the selected item if it is loaded, else the last taken item. */
  const focusItem = useCallback((): RundownItem | undefined => {
    if (!rundown) return undefined;
    if (selected && itemStatus(selected, s.channels).state !== 'idle') return selected;
    const last = rundown.items.find((i) => i.id === lastTaken);
    if (last && itemStatus(last, s.channels).state !== 'idle') return last;
    return undefined;
  }, [rundown, selected, lastTaken, s.channels]);

  const actions: PlayerActions = useMemo(() => ({
    select,
    take(item = selected) {
      if (!rundown || !item) return;
      setLastTaken(item.id);
      void run(`Take "${labelOf(item)}"`, () => api.itemAction(rundown.id, item.id, 'take', { advance: autoAdvance }));
    },
    cue(item = selected) {
      if (!rundown || !item) return;
      void run(`Cue "${labelOf(item)}"`, () => api.itemAction(rundown.id, item.id, 'cue'));
    },
    next() {
      const item = focusItem();
      if (!rundown || !item) return toast('info', 'Nothing on air to step');
      void run('Next', () => api.itemAction(rundown.id, item.id, 'next'));
    },
    prev() {
      const item = focusItem();
      if (!rundown || !item) return toast('info', 'Nothing on air to step');
      void run('Previous', () => api.itemAction(rundown.id, item.id, 'prev'));
    },
    out() {
      const item = focusItem();
      if (!rundown || !item) return toast('info', 'Nothing on air to take out');
      void run(`Out "${labelOf(item)}"`, () => api.itemAction(rundown.id, item.id, 'out'));
    },
    update(item = focusItem()) {
      if (!rundown || !item) return toast('info', 'Item is not on air');
      void run(`Update "${labelOf(item)}"`, () => api.itemAction(rundown.id, item.id, 'update'));
    },
    outAll() {
      if (!channel) return;
      void run('Out all', () => api.outAll(channel.id).then(() => ({ statusCode: 200 })));
    },
    clearAll() {
      if (!channel || !confirm(`Clear everything on "${channel.name}" immediately (no animation)?`)) return;
      void run('Clear', () => api.clearChannel(channel.id).then(() => ({ statusCode: 200 })));
    },
    custom(item, actionId, payload) {
      if (!rundown) return;
      void run(`${actionId}`, () => api.itemCustom(rundown.id, item.id, actionId, payload));
    },
  }), [rundown, selected, autoAdvance, focusItem, labelOf, channel, select]);

  // ---------------- keyboard ----------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a dialog is open, keys never reach the play-out actions (Esc must not take anything out).
      if (helpOpen) {
        if (e.key === 'Escape' || e.key === '?' || e.key === 'Enter') {
          e.preventDefault();
          setHelpOpen(false);
        }
        return;
      }
      if (isTypingTarget(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const action: ShortcutAction | undefined = shortcutFor(e);
      if (!action) return;
      if (e.repeat && !['selectUp', 'selectDown'].includes(action)) return;
      e.preventDefault();
      const items = rundown?.items ?? [];
      const idx = selected ? items.findIndex((i) => i.id === selected.id) : -1;
      switch (action) {
        case 'take': return actions.take();
        case 'cue': return actions.cue();
        case 'next': return actions.next();
        case 'prev': return actions.prev();
        case 'out': return actions.out();
        case 'update': return actions.update(selected && itemStatus(selected, s.channels).state !== 'idle' ? selected : undefined);
        case 'outAll': return actions.outAll();
        case 'clearAll': return actions.clearAll();
        case 'selectUp': return items.length && select(items[Math.max(0, idx - 1)]!.id);
        case 'selectDown': return items.length && select(items[Math.min(items.length - 1, idx + 1)]!.id);
        case 'moveUp':
        case 'moveDown': {
          if (!rundown || idx < 0) return;
          const to = action === 'moveUp' ? idx - 1 : idx + 1;
          if (to < 0 || to >= items.length) return;
          const ids = items.map((i) => i.id);
          [ids[idx], ids[to]] = [ids[to]!, ids[idx]!];
          return void api.reorder(rundown.id, ids).then((r) => live.putRundown(r)).catch((err: Error) => toast('error', err.message));
        }
        case 'duplicate':
          if (rundown && selected) void api.duplicateItem(rundown.id, selected.id).then((r) => live.putRundown(r)).catch((err: Error) => toast('error', err.message));
          return;
        case 'delete':
          if (rundown && selected && confirm(`Delete "${labelOf(selected)}"?`)) {
            void api.deleteItem(rundown.id, selected.id).then((r) => live.putRundown(r)).catch((err: Error) => toast('error', err.message));
          }
          return;
        case 'help': return setHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, rundown, selected, select, labelOf, s.channels, helpOpen]);

  // follow the selected item's channel in the program preview
  useEffect(() => {
    if (selected && selected.channelId !== programChannel && s.channels.some((c) => c.id === selected.channelId)) setProgramChannel(selected.channelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.channelId]);

  const selectedGraphic = selected ? graphicsById.get(selected.graphicId) : undefined;
  const selectedStatus = selected ? itemStatus(selected, s.channels) : undefined;

  return (
    <div className="app">
      <Header connected={s.connected} channels={s.channels} programChannel={channel?.id} onProgramChannel={setProgramChannel} onHelp={() => setHelpOpen(true)} />
      <Sidebar
        rundownList={s.rundownList}
        activeId={activeId}
        onSelect={setRundownId}
        graphics={s.graphics}
        onAddGraphic={(g) => {
          if (!rundown) return toast('info', 'Create a rundown first');
          void api.addItem(rundown.id, { graphicId: g.id, afterItemId: selected?.id ?? null })
            .then((r) => {
              live.putRundown(r);
              const added = r.items.find((i) => !rundown.items.some((o) => o.id === i.id));
              if (added) select(added.id);
            })
            .catch((e: Error) => toast('error', e.message));
        }}
      />
      <main className="center">
        <div className="previews">
          <ProgramPreview channel={channel} />
          <ItemPreview item={selected} graphic={selectedGraphic} data={s.data} timeOffset={s.timeOffset} />
        </div>
        {rundown ? (
          <RundownList
            rundown={rundown}
            channels={s.channels}
            graphicsById={graphicsById}
            labelOf={labelOf}
            lastTaken={lastTaken}
            autoAdvance={autoAdvance}
            onAutoAdvance={setAutoAdvance}
            actions={actions}
          />
        ) : (
          <div className="empty-state">{s.loaded ? 'Create a rundown in the sidebar to get started.' : 'Connecting…'}</div>
        )}
      </main>
      <aside className="right">
        <OnAirPanel channel={channel} rundowns={s.rundowns} graphics={s.graphics} labelOf={labelOf} />
        {rundown && selected ? (
          <ItemEditor
            key={selected.id}
            rundown={rundown}
            item={selected}
            graphic={selectedGraphic}
            channels={s.channels}
            data={s.data}
            dataPaths={dataPaths}
            status={selectedStatus!}
            actions={actions}
          />
        ) : (
          <div className="panel empty-state small">Select an item to edit it.</div>
        )}
      </aside>
      <Transport
        selected={selected}
        selectedLabel={selected ? labelOf(selected) : undefined}
        status={selectedStatus}
        graphic={selectedGraphic}
        canStep={!!selectedStatus?.layer && hasStepControls(selectedStatus.layer.graphic.stepCount)}
        actions={actions}
      />
      <datalist id="ogp-data-paths">
        {dataPaths.map((p) => <option key={p.path} value={p.path}>{p.preview}</option>)}
      </datalist>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      <Toasts />
    </div>
  );
}
