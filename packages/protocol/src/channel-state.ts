/**
 * Authoritative channel state, owned by the server.
 * Naming follows the OGraf Server API: a Channel is a "Renderer", a layer is a "RenderTarget"
 * (identified by { layer: number }), and a loaded graphic is a "GraphicInstance".
 */
import type { LayerSource } from './rundown.ts';

export type LayerStatus =
  /** load() done (cued), nothing visible */
  | 'loaded'
  /** playAction() done, visible at currentStep */
  | 'playing'
  /** stopAction() done or played to end, invisible but still loaded */
  | 'stopped';

export interface GraphicRef {
  /** OGraf manifest id */
  id: string;
  version?: string;
  name: string;
  packageId: string;
  /** Absolute URL path to the main module, e.g. /packages/<pkg>/lower-third/graphic.mjs */
  mainUrl: string;
  stepCount?: number;
  supportsRealTime: boolean;
  supportsNonRealTime: boolean;
}

export interface LayerState {
  layer: number;
  graphicInstanceId: string;
  graphic: GraphicRef;
  /** Data as given by the operator; may contain { $bind } bindings. */
  dataTemplate: Record<string, unknown>;
  /** Resolved data, last sent to renderers. */
  data: Record<string, unknown>;
  status: LayerStatus;
  /** null = start/end state */
  currentStep: number | null;
  /** Set when the instance was loaded from a rundown item. */
  source?: LayerSource;
  /** Server time when the instance went on air (last play from the start state). */
  onAirSince?: number;
  /** Last error reported for this instance (graphic threw, timed out, ...). */
  error?: { message: string; statusCode?: number; at: number };
  updatedAt: number;
}

export interface ChannelInfo {
  id: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  frameRate: number;
}

export interface RendererConnectionInfo {
  sessionId: string;
  preview: boolean;
  name?: string;
  userAgent?: string;
  connectedAt: number;
  lastSeenAt: number;
  responsive: boolean;
}

export interface ChannelState extends ChannelInfo {
  layers: LayerState[];
  /** Increments on every state change. */
  revision: number;
  renderers: RendererConnectionInfo[];
}
