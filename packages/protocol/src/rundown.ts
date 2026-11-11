/**
 * Rundowns: ordered lists of graphic items an operator plays out.
 * An item = graphic + data template (may contain bindings) + target channel/layer.
 */
export interface RundownItem {
  id: string;
  rundownId: string;
  /** 0-based order in the rundown */
  position: number;
  /** Operator label; empty = derived from the data */
  name: string;
  graphicId: string;
  channelId: string;
  layer: number;
  data: Record<string, unknown>;
  /** Auto-out after this many ms on air (null = manual out) */
  durationMs: number | null;
  updatedAt: number;
}

export interface Rundown {
  id: string;
  name: string;
  /** The "next" item (what Take without an explicit item plays) */
  cursorItemId: string | null;
  items: RundownItem[];
  createdAt: number;
  updatedAt: number;
}

export interface RundownSummary {
  id: string;
  name: string;
  itemCount: number;
  updatedAt: number;
}

/** Which rundown item a layer instance came from. */
export interface LayerSource {
  rundownId: string;
  itemId: string;
}
