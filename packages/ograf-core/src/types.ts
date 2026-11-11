/**
 * OGraf types. The official `ograf` npm package (EBU) is the source of truth for the
 * manifest and Web Component interface; we re-export it and add a few helpers.
 */
import type {
  GraphicsManifest,
  GraphicsManifestCustomAction,
  GraphicsAPI,
  ReturnPayload,
  PlayActionReturnPayload,
  RenderCharacteristics,
} from 'ograf';

export type {
  GraphicsManifest,
  GraphicsManifestCustomAction,
  GraphicsAPI,
  ReturnPayload,
  PlayActionReturnPayload,
  RenderCharacteristics,
};

export const OGRAF_SCHEMA_URL = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';
export const MANIFEST_SUFFIX = '.ograf.json';

/** Vendor prefix for our own fields in manifests and payloads (spec requires `v_`). */
export const VENDOR_PREFIX = 'v_ogp_';

export type ActionType = 'playAction' | 'updateAction' | 'stopAction' | 'customAction';

export interface PlayParams {
  goto?: number;
  delta?: number;
  skipAnimation?: boolean;
  [vendor: `v_${string}`]: unknown;
}
export interface StopParams {
  skipAnimation?: boolean;
  [vendor: `v_${string}`]: unknown;
}
export interface UpdateParams {
  data: unknown;
  skipAnimation?: boolean;
  [vendor: `v_${string}`]: unknown;
}
export interface CustomParams {
  id: string;
  payload: unknown;
  skipAnimation?: boolean;
  [vendor: `v_${string}`]: unknown;
}
export interface LoadParams {
  data?: unknown;
  renderType: 'realtime' | 'non-realtime';
  renderCharacteristics: RenderCharacteristics;
  [vendor: `v_${string}`]: unknown;
}

/** Normalised result of any call into a Graphic. */
export interface ActionResult {
  statusCode: number;
  statusMessage?: string;
  result?: unknown;
  /** Only for playAction: step after the action, null = start/end state. */
  currentStep?: number | null;
}

export const isSuccess = (r: { statusCode: number }) => r.statusCode >= 200 && r.statusCode < 300;
