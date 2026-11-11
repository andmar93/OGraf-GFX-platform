/**
 * OGraf lower third – name & title.
 * Plain Web Component, Shadow DOM, Web Animations API. No dependencies.
 * Designed on a 1920x1080 canvas and scaled to the host element size.
 */
const W = 1920;
const H = 1080;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
const DEFAULTS = { name: '', title: '', accentColor: '#00d1ff', align: 'left' };

const CSS = `
:host { display: block; position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.canvas { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; }
.l3 {
  position: absolute; bottom: 118px; left: 150px;
  display: grid; grid-template-columns: 10px auto; grid-template-rows: auto auto;
  font-family: "Inter", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif;
  opacity: 0; filter: drop-shadow(0 12px 28px rgba(0, 0, 0, .45));
}
.l3.center { left: 50%; transform: translateX(-50%); }
.l3.right { left: auto; right: 150px; }
.accent {
  grid-row: 1 / span 2; width: 10px; transform-origin: 50% 100%;
  background: linear-gradient(180deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 35%, #6a3cff) 100%);
}
.name, .title { overflow: hidden; }
.name {
  background: linear-gradient(100deg, #0b1230 0%, #121c48 70%, #18245a 100%);
  padding: 18px 44px 16px 30px; min-width: 520px;
}
.name span {
  display: block; color: #fff; font-size: 54px; font-weight: 800; letter-spacing: .01em; line-height: 1.05;
  text-transform: uppercase; white-space: nowrap;
}
.title {
  background: rgba(255, 255, 255, .96); padding: 10px 44px 10px 30px; justify-self: start;
}
.title span {
  display: block; color: #0b1230; font-size: 30px; font-weight: 600; letter-spacing: .04em; line-height: 1.15;
  text-transform: uppercase; white-space: nowrap;
}
.title.empty { display: none; }
`;

export default class LowerThird extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._data = { ...DEFAULTS };
    this._visible = false;
    this._step = undefined;
    this._anims = new Set();
    this._ro = null;
  }

  async load({ data } = {}) {
    this._data = { ...DEFAULTS, ...(data ?? {}) };
    this._root.innerHTML = `<style>${CSS}</style>
      <div class="canvas"><div class="l3">
        <div class="accent"></div>
        <div class="name"><span></span></div>
        <div class="title"><span></span></div>
      </div></div>`;
    this._el = {
      canvas: this._root.querySelector('.canvas'),
      l3: this._root.querySelector('.l3'),
      accent: this._root.querySelector('.accent'),
      name: this._root.querySelector('.name'),
      nameText: this._root.querySelector('.name span'),
      title: this._root.querySelector('.title'),
      titleText: this._root.querySelector('.title span'),
    };
    this._render();
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this);
    this._fit();
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1000))]);
    return { statusCode: 200 };
  }

  async dispose() {
    this._cancelAll();
    this._ro?.disconnect();
    this._root.innerHTML = '';
    return { statusCode: 200 };
  }

  async playAction({ goto, delta, skipAnimation } = {}) {
    const target = Number.isInteger(goto) && goto >= 0 ? goto : (this._step ?? -1) + (Number.isInteger(delta) ? delta : 1);
    if (target >= 1) {
      await this._out(skipAnimation);
      return { statusCode: 200, currentStep: undefined };
    }
    this._step = 0;
    if (!this._visible) await this._in(skipAnimation);
    return { statusCode: 200, currentStep: 0 };
  }

  async stopAction({ skipAnimation } = {}) {
    await this._out(skipAnimation);
    return { statusCode: 200 };
  }

  async updateAction({ data, skipAnimation } = {}) {
    const next = { ...this._data, ...(data ?? {}) };
    const textChanged = next.name !== this._data.name || next.title !== this._data.title;
    if (!this._visible || skipAnimation || !textChanged) {
      this._data = next;
      this._render();
      return { statusCode: 200 };
    }
    const texts = [this._el.nameText, this._el.titleText];
    await Promise.all(texts.map((t) => this._run(t, [{ opacity: 0, transform: 'translateY(-8px)' }], { duration: 150, easing: EASE_IN })));
    this._data = next;
    this._render();
    await Promise.all(texts.map((t) => this._run(t, [{ opacity: 0, transform: 'translateY(10px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE_OUT })));
    return { statusCode: 200 };
  }

  async customAction({ id } = {}) {
    return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` };
  }

  // ---------------------------------------------------------------------------

  _render() {
    const d = this._data;
    this._el.l3.style.setProperty('--accent', /^#[0-9a-f]{6}$/i.test(d.accentColor) ? d.accentColor : DEFAULTS.accentColor);
    this._el.l3.classList.toggle('center', d.align === 'center');
    this._el.l3.classList.toggle('right', d.align === 'right');
    this._el.nameText.textContent = d.name ?? '';
    this._el.titleText.textContent = d.title ?? '';
    this._el.title.classList.toggle('empty', !d.title);
  }

  _fit() {
    const r = this.getBoundingClientRect();
    const w = r.width || W;
    const h = r.height || H;
    this._el.canvas.style.transform = `scale(${Math.min(w / W, h / H)})`;
  }

  async _in(skip) {
    this._cancelAll();
    this._visible = true;
    const { l3, accent, name, nameText, title, titleText } = this._el;
    const from = this._el.l3.classList.contains('right') ? '100%' : '0';
    await Promise.all([
      this._run(l3, [{ opacity: 1, offset: 0 }, { opacity: 1 }], { duration: 1 }, skip),
      this._run(accent, [{ transform: 'scaleY(0)', offset: 0 }, { transform: 'scaleY(1)' }], { duration: 300, easing: EASE_OUT }, skip),
      this._run(name, [{ clipPath: `inset(0 ${from === '0' ? '100%' : '0'} 0 ${from === '0' ? '0' : '100%'})`, offset: 0 }, { clipPath: 'inset(0 0 0 0)' }], { duration: 520, delay: 120, easing: EASE_OUT }, skip),
      this._run(nameText, [{ transform: 'translateX(-40px)', opacity: 0, offset: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: 200, easing: EASE_OUT }, skip),
      this._run(title, [{ clipPath: 'inset(0 100% 0 0)', offset: 0 }, { clipPath: 'inset(0 0 0 0)' }], { duration: 480, delay: 270, easing: EASE_OUT }, skip),
      this._run(titleText, [{ transform: 'translateX(-30px)', opacity: 0, offset: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: 330, easing: EASE_OUT }, skip),
    ]);
  }

  async _out(skip) {
    this._step = undefined;
    if (!this._visible) return;
    this._visible = false;
    this._cancelAll();
    const { l3 } = this._el;
    await this._run(l3, [{ opacity: 0, transform: `${getComputedStyle(l3).transform === 'none' ? '' : getComputedStyle(l3).transform} translateX(-30px)` }], { duration: 380, easing: EASE_IN }, skip);
    // reset parts so the next "in" starts clean
    if (this._visible) return; // a new "in" started while we were animating out
    for (const el of Object.values(this._el)) {
      if (el === this._el.canvas) continue;
      for (const prop of ['transform', 'clip-path', 'opacity']) el.style.removeProperty(prop);
    }
    l3.style.opacity = '0';
  }

  /**
   * Runs one animation and resolves when it is done.
   * - fill 'both': delayed parts hold their first keyframe instead of flashing fully visible
   * - never hangs: browsers pause animations in hidden tabs / invisible OBS sources, so a timer
   *   (delay + duration) finishes the animation if the timeline did not; hidden pages skip animation
   * - commit=true writes the end state inline and removes the animation
   */
  _run(el, keyframes, opts, skip = false, commit = true) {
    const instant = skip || document.visibilityState === 'hidden';
    const duration = instant ? 0 : opts.duration;
    const delay = instant ? 0 : (opts.delay ?? 0);
    const a = el.animate(keyframes, { ...opts, duration, delay, fill: commit ? 'both' : 'none' });
    a.__commit = commit;
    this._anims.add(a);
    const timer = new Promise((resolve) => setTimeout(resolve, delay + duration + 120));
    return Promise.race([a.finished, timer])
      .then(
        () => {
          if (a.playState === 'idle') return; // cancelled by a newer action
          if (a.playState !== 'finished') {
            try { a.finish(); } catch { /* ignore */ }
          }
          if (commit) {
            try { a.commitStyles(); } catch { /* element not rendered */ }
          }
          a.cancel();
        },
        () => {},
      )
      .finally(() => this._anims.delete(a));
  }

  /** Freezes running animations at their current visual state (so overlapping calls never jump). */
  _cancelAll() {
    for (const a of this._anims) {
      if (a.__commit) {
        try { a.commitStyles(); } catch { /* ignore */ }
      }
      a.cancel();
    }
    this._anims.clear();
  }
}
