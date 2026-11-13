/**
 * Frame pump for off-screen browsers (OBS browser source, and similar CEF hosts).
 *
 * In off-screen rendering, a new picture may only be produced when the page's main thread commits a change.
 * Graphics that animate purely with CSS / Web Animations (compositor-only) then appear to update only every
 * few seconds, whenever something else happens to change. Touching an invisible element every animation frame
 * forces a commit per frame, so the host always gets fresh frames. The cost is negligible.
 *
 * Disable with `?keepalive=0`.
 */
export interface FrameStats {
  /** Animation frames per second measured in the renderer page */
  fps: number;
}

export function startKeepAlive(enabled: boolean): FrameStats {
  const stats: FrameStats = { fps: 0 };
  const dot = document.createElement('div');
  dot.setAttribute('aria-hidden', 'true');
  Object.assign(dot.style, {
    position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', pointerEvents: 'none', opacity: '0.001', zIndex: '0',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(dot);
  let frames = 0;
  let since = performance.now();
  let flip = false;
  const tick = (now: number) => {
    frames++;
    if (now - since >= 1000) {
      stats.fps = Math.round((frames * 1000) / (now - since));
      frames = 0;
      since = now;
    }
    if (enabled) {
      // the element has no background or content, so it never paints anything; the change only forces a commit
      flip = !flip;
      dot.style.opacity = flip ? '0.002' : '0.001';
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return stats;
}
