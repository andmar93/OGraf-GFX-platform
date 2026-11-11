/**
 * Runs inside a layer iframe. Hosts exactly one Graphic and isolates it:
 * its DOM, CSS, globals, timers and errors live in this frame. Removing the iframe frees everything.
 */
import { GraphicHost, defineGraphicElement, importGraphicModule, type ActionResult } from '@ogp/ograf-core/host';
import type { LayerFrameApi, LayerLoadOptions, LayerMethod } from './layer-api.ts';

let host: GraphicHost | undefined;
let element: HTMLElement | undefined;
/** Pending load(): calls that arrive meanwhile (e.g. recovery play) wait for it. */
let loading: Promise<ActionResult> | undefined;

const reportError = (message: string) => {
  try {
    api.onError?.(message);
  } catch {
    /* parent gone */
  }
};

window.addEventListener('error', (e) => {
  reportError(`Uncaught error in graphic: ${e.message || String(e.error)}`);
  e.preventDefault();
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string } | undefined;
  reportError(`Unhandled promise rejection in graphic: ${r?.message ?? String(e.reason)}`);
  e.preventDefault();
});

const api: LayerFrameApi = {
  load(opts: LayerLoadOptions): Promise<ActionResult> {
    if (loading || host) return Promise.resolve({ statusCode: 409, statusMessage: 'layer frame already has a graphic' });
    loading = loadGraphic(opts);
    return loading;
  },

  async call(method: LayerMethod, params: Record<string, unknown>): Promise<ActionResult> {
    if (loading) await loading;
    if (!host) return { statusCode: 409, statusMessage: 'no graphic loaded in layer' };
    switch (method) {
      case 'playAction': return host.playAction(params);
      case 'stopAction': return host.stopAction(params);
      case 'updateAction': return host.updateAction(params as { data: unknown });
      case 'customAction': return host.customAction(params as { id: string; payload: unknown });
      default: return { statusCode: 400, statusMessage: `unknown method ${String(method)}` };
    }
  },

  async dispose(): Promise<ActionResult> {
    if (loading) await loading;
    if (!host) return { statusCode: 200 };
    const r = await host.dispose();
    element?.remove();
    return r;
  },

  state() {
    return { lifecycle: host?.lifecycle ?? 'new', currentStep: host?.currentStep ?? null };
  },
};

async function loadGraphic(opts: LayerLoadOptions): Promise<ActionResult> {
  let ctor: CustomElementConstructor;
  try {
    ctor = await importGraphicModule(new URL(opts.mainUrl, location.href).href);
  } catch (err) {
    return { statusCode: 550, statusMessage: `Failed to import graphic module: ${(err as Error).message}` };
  }
  try {
    const tag = defineGraphicElement(ctor, opts.graphicId);
    element = document.createElement(tag);
    document.body.appendChild(element);
  } catch (err) {
    return { statusCode: 550, statusMessage: `Failed to create graphic element: ${(err as Error).message}` };
  }
  host = new GraphicHost(element as unknown as ConstructorParameters<typeof GraphicHost>[0], {
    stepCount: opts.stepCount,
    timeouts: opts.timeouts,
  });
  return host.load({ data: opts.data, renderType: 'realtime', renderCharacteristics: opts.renderCharacteristics });
}

window.ogpLayer = api;
