/**
 * LayerInstance implemented with one same-origin iframe per graphic instance.
 */
import type { ActionResult } from '@ogp/ograf-core/host';
import type { LayerFactory, LayerInstance } from './channel-renderer.ts';
import type { LayerFrameApi } from './layer-api.ts';

const FRAME_URL = `${import.meta.env.BASE_URL}layer.html`;
const FRAME_TIMEOUT_MS = 10_000;
const OUTER_MARGIN_MS = 2_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

export function createIframeLayerFactory(stage: HTMLElement, timeouts = { load: 10_000, action: 5_000, dispose: 3_000 }): LayerFactory {
  return (opts) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.dataset.layer = String(opts.layer);
    iframe.dataset.instance = opts.graphicInstanceId;
    iframe.style.zIndex = String(opts.layer);
    iframe.src = FRAME_URL;

    // insert in layer order (also for equal z-index stacking order)
    const after = [...stage.querySelectorAll<HTMLIFrameElement>('iframe')].find((f) => Number(f.dataset.layer) > opts.layer);
    stage.insertBefore(iframe, after ?? null);

    const frameApi = new Promise<LayerFrameApi>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('layer frame did not start')), FRAME_TIMEOUT_MS);
      iframe.addEventListener('load', () => {
        const api = iframe.contentWindow?.ogpLayer;
        clearTimeout(t);
        if (api) {
          api.onError = opts.onError;
          resolve(api);
        } else reject(new Error('layer frame has no API'));
      }, { once: true });
    });

    const ready: Promise<ActionResult> = frameApi.then(
      (api) => withTimeout(api.load({
        mainUrl: opts.graphic.mainUrl,
        graphicId: opts.graphic.id,
        stepCount: opts.graphic.stepCount,
        data: opts.data,
        renderCharacteristics: { resolution: { width: opts.channel.width, height: opts.channel.height }, frameRate: opts.channel.frameRate },
        timeouts,
      }), timeouts.load + OUTER_MARGIN_MS, { statusCode: 504, statusMessage: 'layer did not answer load()' }),
      (err: Error) => ({ statusCode: 500, statusMessage: err.message }),
    );

    let disposed = false;
    const instance: LayerInstance = {
      graphicInstanceId: opts.graphicInstanceId,
      graphic: opts.graphic,
      ready,
      async call(method, params) {
        if (disposed) return { statusCode: 410, statusMessage: 'layer disposed' };
        // Keep call order: actions only after load() has finished (also for recovery play).
        await ready;
        let api: LayerFrameApi;
        try {
          api = await frameApi;
        } catch (err) {
          return { statusCode: 500, statusMessage: (err as Error).message };
        }
        return withTimeout(api.call(method, params), timeouts.load + timeouts.action + OUTER_MARGIN_MS, { statusCode: 504, statusMessage: `layer did not answer ${method}()` });
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          const api = await withTimeout(frameApi, 500, undefined);
          if (api) await withTimeout(api.dispose(), timeouts.dispose + 500, undefined);
        } finally {
          iframe.remove();
        }
      },
    };
    return instance;
  };
}
