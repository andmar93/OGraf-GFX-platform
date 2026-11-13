/**
 * LayerInstance that runs the graphic directly in the renderer page (no iframe).
 *
 * Used for off-screen hosts such as the OBS browser source, where content inside iframes is only repainted
 * every few seconds. Each layer is a positioned box with its own shadow root, so page CSS and graphic CSS do not
 * mix. What an iframe gives on top – separate globals and per-layer error attribution – is not available here:
 * uncaught errors of graphics are logged and shown in the debug overlay (see main.ts).
 */
import { GraphicHost, defineGraphicElement, importGraphicModule, type ActionResult } from '@ogp/ograf-core/host';
import type { LayerFactory, LayerInstance } from './channel-renderer.ts';

const BOX_CSS = ':host { all: initial; } .g { position: absolute; inset: 0; width: 100%; height: 100%; }';

export function createInlineLayerFactory(stage: HTMLElement, timeouts = { load: 10_000, action: 5_000, dispose: 3_000 }): LayerFactory {
  return (opts) => {
    const box = document.createElement('div');
    box.dataset.layer = String(opts.layer);
    box.dataset.instance = opts.graphicInstanceId;
    Object.assign(box.style, { position: 'absolute', inset: '0', overflow: 'hidden', zIndex: String(opts.layer) } satisfies Partial<CSSStyleDeclaration>);
    const after = [...stage.querySelectorAll<HTMLElement>(':scope > [data-layer]')].find((f) => Number(f.dataset.layer) > opts.layer);
    stage.insertBefore(box, after ?? null);
    const root = box.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BOX_CSS;
    root.appendChild(style);

    let host: GraphicHost | undefined;
    const ready: Promise<ActionResult> = (async () => {
      let ctor: CustomElementConstructor;
      try {
        ctor = await importGraphicModule(new URL(opts.graphic.mainUrl, location.href).href);
      } catch (err) {
        return { statusCode: 550, statusMessage: `Failed to import graphic module: ${(err as Error).message}` };
      }
      let element: HTMLElement;
      try {
        element = document.createElement(defineGraphicElement(ctor, opts.graphic.id));
        element.className = 'g';
        root.appendChild(element);
      } catch (err) {
        return { statusCode: 550, statusMessage: `Failed to create graphic element: ${(err as Error).message}` };
      }
      host = new GraphicHost(element as unknown as ConstructorParameters<typeof GraphicHost>[0], { stepCount: opts.graphic.stepCount, timeouts });
      return host.load({
        data: opts.data,
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: opts.channel.width, height: opts.channel.height }, frameRate: opts.channel.frameRate },
      });
    })();

    let disposed = false;
    const instance: LayerInstance = {
      graphicInstanceId: opts.graphicInstanceId,
      graphic: opts.graphic,
      ready,
      async call(method, params) {
        if (disposed) return { statusCode: 410, statusMessage: 'layer disposed' };
        await ready;
        if (!host) return { statusCode: 409, statusMessage: 'no graphic loaded in layer' };
        switch (method) {
          case 'playAction': return host.playAction(params);
          case 'stopAction': return host.stopAction(params);
          case 'updateAction': return host.updateAction(params as { data: unknown });
          case 'customAction': return host.customAction(params as { id: string; payload: unknown });
          default: return { statusCode: 400, statusMessage: `unknown method ${String(method)}` };
        }
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          await Promise.race([ready, new Promise((r) => setTimeout(r, 500))]);
          if (host) await Promise.race([host.dispose(), new Promise((r) => setTimeout(r, timeouts.dispose + 500))]);
        } catch {
          /* the graphic failed while disposing – remove it anyway */
        } finally {
          box.remove();
        }
      },
    };
    return instance;
  };
}
