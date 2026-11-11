/**
 * Derives the play-out status of rundown items from the live channel state.
 */
import type { ChannelState, LayerState, RundownItem } from '@ogp/protocol';

export type ItemState = 'idle' | 'cued' | 'onair' | 'out';

export interface ItemStatus {
  state: ItemState;
  layer?: LayerState;
  error?: string;
  /** Another graphic (not this item) is on air on the item's target layer. */
  layerBusy: boolean;
}

export function itemStatus(item: RundownItem, channels: ChannelState[]): ItemStatus {
  const ch = channels.find((c) => c.id === item.channelId);
  const l = ch?.layers.find((x) => x.layer === item.layer);
  if (!l || l.source?.itemId !== item.id) return { state: 'idle', layerBusy: !!l && l.status === 'playing' };
  const state: ItemState = l.status === 'playing' ? 'onair' : l.status === 'loaded' ? 'cued' : 'out';
  return { state, layer: l, error: l.error?.message, layerBusy: false };
}

/** "step 2/3", "step 4" (dynamic) or '' for single-step graphics. */
export function stepLabel(currentStep: number | null | undefined, stepCount: number | undefined): string {
  const count = stepCount ?? 1;
  if (currentStep === null || currentStep === undefined || (count >= 0 && count <= 1)) return '';
  return count > 1 ? `step ${currentStep + 1}/${count}` : `step ${currentStep + 1}`;
}

export function formatDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** The label shown for an item: its name, else non-hidden text fields, else the graphic name. */
export function itemLabel(item: RundownItem, graphicName: string | undefined, buildLabel: (data: unknown) => string): string {
  if (item.name.trim()) return item.name.trim();
  const fromData = buildLabel(item.data);
  return fromData || graphicName || item.graphicId;
}
