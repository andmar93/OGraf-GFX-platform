/**
 * GraphicHost wraps one OGraf Graphic (Web Component instance) and makes every call safe:
 *  - never throws (sync throws, rejections, missing methods and timeouts become ActionResults)
 *  - normalises `undefined` returns to { statusCode: 200 } as required by the spec
 *  - tracks lifecycle and the current step (for state reporting and recovery)
 *  - does NOT serialise calls: the spec requires Graphics to accept overlapping calls,
 *    which keeps "out" responsive while an "in" animation is still running.
 * The only exception: action methods wait for load() to have resolved (spec: Renderer MUST wait for load).
 */
import { resolveTargetStep } from '../steps.ts';
import type { ActionResult, CustomParams, LoadParams, PlayParams, StopParams, UpdateParams } from '../types.ts';

export type HostLifecycle = 'new' | 'loading' | 'loaded' | 'playing' | 'stopped' | 'error' | 'disposed';

export interface GraphicHostOptions {
  stepCount?: number;
  timeouts?: Partial<Record<'load' | 'action' | 'dispose', number>>;
  /** Called for every failed call (non-2xx, throw, timeout). */
  onError?: (method: string, result: ActionResult) => void;
}

/** Minimal shape of a Graphic element; everything is optional because we cannot trust it. */
export type GraphicLike = Partial<Record<'load' | 'dispose' | 'playAction' | 'stopAction' | 'updateAction' | 'customAction' | 'goToTime' | 'setActionsSchedule', (params: unknown) => unknown>>;

export const DEFAULT_TIMEOUTS = { load: 10_000, action: 5_000, dispose: 3_000 };
export const STATUS_TIMEOUT = 504;
export const STATUS_NOT_IMPLEMENTED = 501;
/** Status used by the OGraf Server API for "error thrown from within the GraphicInstance". */
export const STATUS_GRAPHIC_ERROR = 550;

export function normaliseResult(value: unknown): ActionResult {
  if (value === undefined || value === null) return { statusCode: 200 };
  if (typeof value === 'object' && typeof (value as { statusCode?: unknown }).statusCode === 'number') {
    const v = value as Record<string, unknown>;
    const out: ActionResult = { statusCode: v.statusCode as number };
    if (typeof v.statusMessage === 'string') out.statusMessage = v.statusMessage;
    if ('result' in v) out.result = v.result;
    if ('currentStep' in v) out.currentStep = typeof v.currentStep === 'number' ? v.currentStep : null;
    return out;
  }
  return { statusCode: 200, result: value };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'object' && err && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

export class GraphicHost {
  readonly graphic: GraphicLike;
  readonly stepCount: number | undefined;
  private readonly timeouts: typeof DEFAULT_TIMEOUTS;
  private readonly onError?: GraphicHostOptions['onError'];
  private loadPromise: Promise<ActionResult> | undefined;

  lifecycle: HostLifecycle = 'new';
  /** Current step, `null` in start/end state. */
  currentStep: number | null = null;
  lastError: { method: string; result: ActionResult } | undefined;

  constructor(graphic: GraphicLike, opts: GraphicHostOptions = {}) {
    this.graphic = graphic;
    this.stepCount = opts.stepCount;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
    this.onError = opts.onError;
  }

  /** Calls a method on the graphic with error and timeout isolation. */
  async call(method: keyof GraphicLike, params: unknown, timeoutMs: number): Promise<ActionResult> {
    const fn = this.graphic[method];
    if (typeof fn !== 'function') {
      return this.fail(method, { statusCode: STATUS_NOT_IMPLEMENTED, statusMessage: `Graphic does not implement ${method}()` });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const invoked = Promise.resolve().then(() => fn.call(this.graphic, params));
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${method}() timed out after ${timeoutMs} ms`), { timeout: true })), timeoutMs);
      });
      const result = normaliseResult(await Promise.race([invoked, timeout]));
      if (result.statusCode >= 400) return this.fail(method, result);
      return result;
    } catch (err) {
      const isTimeout = typeof err === 'object' && err !== null && (err as { timeout?: boolean }).timeout === true;
      return this.fail(method, {
        statusCode: isTimeout ? STATUS_TIMEOUT : STATUS_GRAPHIC_ERROR,
        statusMessage: isTimeout ? describeError(err) : `${method}() threw: ${describeError(err)}`,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private fail(method: string, result: ActionResult): ActionResult {
    this.lastError = { method, result };
    try {
      this.onError?.(method, result);
    } catch {
      /* listener errors must never propagate */
    }
    return result;
  }

  load(params: LoadParams): Promise<ActionResult> {
    this.lifecycle = 'loading';
    this.currentStep = null;
    this.loadPromise = this.call('load', params, this.timeouts.load).then((r) => {
      this.lifecycle = r.statusCode < 400 ? 'loaded' : 'error';
      return r;
    });
    return this.loadPromise;
  }

  /** Resolves once load() has finished; returns the load result when it failed. */
  private async ready(): Promise<ActionResult | undefined> {
    if (!this.loadPromise) return { statusCode: 409, statusMessage: 'Graphic is not loaded' };
    const r = await this.loadPromise;
    if (r.statusCode >= 400) return { statusCode: 409, statusMessage: `Graphic failed to load: ${r.statusMessage ?? r.statusCode}` };
    if (this.lifecycle === 'disposed') return { statusCode: 410, statusMessage: 'Graphic has been disposed' };
    return undefined;
  }

  async playAction(params: PlayParams = {}): Promise<ActionResult> {
    const notReady = await this.ready();
    if (notReady) return notReady;
    const expected = resolveTargetStep(this.currentStep, this.stepCount, params);
    const r = await this.call('playAction', params, this.timeouts.action);
    if (r.statusCode < 400) {
      // The graphic is authoritative for its step (needed for stepCount -1); fall back to the spec calculation.
      const step = r.currentStep !== undefined ? r.currentStep : (expected ?? null);
      this.currentStep = step;
      this.lifecycle = step === null && (this.stepCount ?? 1) !== 0 ? 'stopped' : 'playing';
      r.currentStep = step;
    }
    return r;
  }

  async stopAction(params: StopParams = {}): Promise<ActionResult> {
    const notReady = await this.ready();
    if (notReady) return notReady;
    const r = await this.call('stopAction', params, this.timeouts.action);
    if (r.statusCode < 400) {
      this.currentStep = null;
      this.lifecycle = 'stopped';
    }
    return r;
  }

  async updateAction(params: UpdateParams): Promise<ActionResult> {
    const notReady = await this.ready();
    if (notReady) return notReady;
    return this.call('updateAction', params, this.timeouts.action);
  }

  async customAction(params: CustomParams): Promise<ActionResult> {
    const notReady = await this.ready();
    if (notReady) return notReady;
    return this.call('customAction', params, this.timeouts.action);
  }

  async goToTime(params: { timestamp: number }): Promise<ActionResult> {
    const notReady = await this.ready();
    if (notReady) return notReady;
    return this.call('goToTime', params, this.timeouts.action);
  }

  async setActionsSchedule(params: { schedule: unknown[] }): Promise<ActionResult> {
    const notReady = await this.ready();
    if (notReady) return notReady;
    return this.call('setActionsSchedule', params, this.timeouts.action);
  }

  async dispose(): Promise<ActionResult> {
    if (this.lifecycle === 'disposed') return { statusCode: 200 };
    const r = await this.call('dispose', {}, this.timeouts.dispose);
    this.lifecycle = 'disposed';
    this.currentStep = null;
    return r;
  }
}
