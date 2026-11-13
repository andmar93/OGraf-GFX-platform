/**
 * Small status overlay, only shown with ?debug=1 (never on air by default).
 */
import type { ChannelRenderer } from './channel-renderer.ts';

export class DebugOverlay {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', right: '12px', top: '12px', zIndex: '2147483647', maxWidth: '520px',
      font: '12px/1.45 ui-monospace, Menlo, Consolas, monospace', color: '#e6edf3',
      background: 'rgba(10, 14, 30, .85)', border: '1px solid rgba(255,255,255,.2)', borderRadius: '6px',
      padding: '8px 10px', whiteSpace: 'pre-wrap', pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.el);
  }

  update(info: { channelId: string; connected: boolean; preview: boolean; offset: number; rtt: number; message?: string; fps?: number; keepAlive?: boolean; layerMode?: string }, renderer: ChannelRenderer) {
    const lines = [
      `channel ${info.channelId}${info.preview ? ' (preview)' : ''} — ${info.connected ? 'connected' : 'DISCONNECTED'}`,
      `time offset ${info.offset.toFixed(1)} ms, rtt ${Number.isFinite(info.rtt) ? info.rtt.toFixed(1) : '–'} ms`,
      `${info.fps ?? 0} fps · keep-alive ${info.keepAlive ? 'on' : 'off'} · ${info.layerMode ?? 'iframe'} layers · ${document.visibilityState}`,
    ];
    if (info.message) lines.push(`! ${info.message}`);
    if (document.visibilityState === 'hidden') lines.push('! page is hidden – the browser pauses animations (keep the renderer visible)');
    for (const e of [...renderer.layers.values()].sort((a, b) => a.layer - b.layer)) {
      lines.push(`L${e.layer} ${e.instance.graphic.id} ${e.status}${e.currentStep !== null ? ` step ${e.currentStep}` : ''}${e.error ? `\n   ! ${e.error}` : ''}`);
    }
    this.el.textContent = lines.join('\n');
    this.el.style.borderColor = info.connected ? 'rgba(255,255,255,.2)' : '#ff4d4f';
  }
}
