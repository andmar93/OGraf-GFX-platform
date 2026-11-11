import type { ActionResult } from '@ogp/ograf-core/host';

export type LayerMethod = 'playAction' | 'stopAction' | 'updateAction' | 'customAction';

export interface LayerLoadOptions {
  mainUrl: string;
  graphicId: string;
  stepCount: number | undefined;
  data: Record<string, unknown>;
  renderCharacteristics: { resolution: { width: number; height: number }; frameRate: number; accessToPublicInternet?: boolean };
  timeouts?: { load?: number; action?: number; dispose?: number };
}

/** API exposed by each layer iframe (same origin) on `window.ogpLayer`. */
export interface LayerFrameApi {
  load(opts: LayerLoadOptions): Promise<ActionResult>;
  call(method: LayerMethod, params: Record<string, unknown>): Promise<ActionResult>;
  dispose(): Promise<ActionResult>;
  state(): { lifecycle: string; currentStep: number | null };
  /** Set by the parent: receives errors that happen outside of calls (timers, event handlers, ...). */
  onError?: (message: string) => void;
}

declare global {
  interface Window {
    ogpLayer?: LayerFrameApi;
  }
}
