/**
 * OGraf event banner – goal, own goal, penalty, cards, substitution, VAR.
 * Plain Web Component, Shadow DOM, Web Animations API, no dependencies. 1920x1080 canvas, scaled to fit.
 */
const W = 1920;
const H = 1080;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULTS = {
  kind: 'goal', playerName: '', playerNumber: null, minute: '', teamName: '', teamColor: '#d81e3c', teamLogo: '',
  inName: '', inNumber: null, outName: '', outNumber: null, score: '', headline: '',
};

const HEADLINES = {
  goal: 'Goal', own_goal: 'Own goal', penalty_goal: 'Goal · Penalty', yellow: 'Yellow card', second_yellow: 'Second yellow',
  red: 'Red card', sub: 'Substitution', var: 'VAR', text: '',
};

const ICONS = {
  goal: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="#fff"/><path d="M32 18l10 7-4 12H26l-4-12z" fill="#0b1230"/><path d="M32 5v13M42 25l12-5M38 37l8 11M26 37l-8 11M22 25l-12-5" stroke="#0b1230" stroke-width="3"/><circle cx="32" cy="32" r="27" fill="none" stroke="#0b1230" stroke-width="2"/></svg>`,
  yellow: `<svg viewBox="0 0 64 64"><rect x="18" y="8" width="30" height="44" rx="4" fill="#ffd400" transform="rotate(10 32 32)"/></svg>`,
  red: `<svg viewBox="0 0 64 64"><rect x="18" y="8" width="30" height="44" rx="4" fill="#e5383b" transform="rotate(10 32 32)"/></svg>`,
  second_yellow: `<svg viewBox="0 0 64 64"><rect x="12" y="10" width="28" height="40" rx="4" fill="#ffd400" transform="rotate(-8 26 30)"/><rect x="26" y="12" width="28" height="40" rx="4" fill="#e5383b" transform="rotate(12 40 32)"/></svg>`,
  sub: `<svg viewBox="0 0 64 64"><path d="M22 52V18M12 28l10-12 10 12" stroke="#36d399" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 12v34M32 36l10 12 10-12" stroke="#ff6b6b" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  var: `<svg viewBox="0 0 64 64"><rect x="6" y="12" width="52" height="34" rx="4" fill="none" stroke="#fff" stroke-width="5"/><path d="M24 54h16M32 46v8" stroke="#fff" stroke-width="5"/><text x="32" y="36" text-anchor="middle" font-family="Arial" font-weight="900" font-size="15" fill="#00d1ff">VAR</text></svg>`,
};
ICONS.own_goal = ICONS.goal;
ICONS.penalty_goal = ICONS.goal;

const CSS = `
:host { display: block; position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.canvas { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; }
.banner {
  position: absolute; left: 150px; bottom: 118px; display: flex; align-items: stretch; height: 132px; opacity: 0;
  font-family: "Inter", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif; filter: drop-shadow(0 12px 28px rgba(0,0,0,.45));
}
.icon { width: 132px; display: grid; place-items: center; background: var(--team); position: relative; overflow: hidden; }
.icon::after { content: ""; position: absolute; inset: 0; background: linear-gradient(160deg, rgba(255,255,255,.18), rgba(0,0,0,.25)); }
.icon svg { width: 74px; height: 74px; position: relative; z-index: 1; filter: drop-shadow(0 4px 8px rgba(0,0,0,.35)); }
.body { display: flex; flex-direction: column; min-width: 560px; background: linear-gradient(100deg, #0b1230 0%, #121c48 70%, #18245a 100%); }
.top { display: flex; align-items: center; gap: 16px; height: 44px; padding: 0 28px; background: rgba(255,255,255,.96); color: #0b1230; }
.headline { font-size: 24px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
.minute { margin-left: auto; font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; color: #0b1230; }
.score { font-size: 22px; font-weight: 800; color: #fff; background: #0b1230; padding: 2px 10px; border-radius: 3px; font-variant-numeric: tabular-nums; }
.score:empty { display: none; }
.main { flex: 1; display: flex; align-items: center; gap: 18px; padding: 0 28px; color: #fff; }
.num { font-size: 40px; font-weight: 900; color: var(--team-light); font-variant-numeric: tabular-nums; min-width: 44px; }
.num:empty { display: none; }
.name { font-size: 48px; font-weight: 800; text-transform: uppercase; letter-spacing: .01em; white-space: nowrap; }
.team { margin-left: auto; display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: rgba(255,255,255,.7); white-space: nowrap; }
.team img { height: 40px; width: 40px; object-fit: contain; }
.team img:not([src]), .team img[src=""] { display: none; }
.subs { display: none; flex-direction: column; justify-content: center; gap: 4px; }
.subs .row { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 800; text-transform: uppercase; white-space: nowrap; }
.subs .arrow { width: 26px; text-align: center; font-size: 26px; }
.subs .in .arrow { color: #36d399; } .subs .out .arrow { color: #ff6b6b; }
.subs .n { color: var(--team-light); font-variant-numeric: tabular-nums; min-width: 40px; }
.subs .out { color: rgba(255,255,255,.75); font-size: 26px; }
.banner.is-sub .subs { display: flex; }
.banner.is-sub .single { display: none; }
.single { display: flex; align-items: center; gap: 18px; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function lighten(hex, amt = 0.45) {
  if (!HEX.test(hex)) return '#9ecbff';
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v + (255 - v) * amt);
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

export default class EventBanner extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._data = { ...DEFAULTS };
    this._visible = false;
    this._step = undefined;
    this._anims = new Set();
  }

  async load({ data } = {}) {
    this._data = { ...DEFAULTS, ...(data ?? {}) };
    this._root.innerHTML = `<style>${CSS}</style><div class="canvas"><div class="banner">
      <div class="icon"></div>
      <div class="body">
        <div class="top"><span class="headline"></span><span class="score"></span><span class="minute"></span></div>
        <div class="main">
          <div class="single"><span class="num"></span><span class="name"></span></div>
          <div class="subs">
            <div class="row in"><span class="arrow">▲</span><span class="n"></span><span class="nm"></span></div>
            <div class="row out"><span class="arrow">▼</span><span class="n"></span><span class="nm"></span></div>
          </div>
          <div class="team"><img alt=""><span class="tn"></span></div>
        </div>
      </div>
    </div></div>`;
    const q = (s) => this._root.querySelector(s);
    this._el = {
      canvas: q('.canvas'), banner: q('.banner'), icon: q('.icon'), body: q('.body'), top: q('.top'), main: q('.main'),
      headline: q('.headline'), minute: q('.minute'), score: q('.score'), num: q('.single .num'), name: q('.single .name'),
      inN: q('.in .n'), inName: q('.in .nm'), outN: q('.out .n'), outName: q('.out .nm'), logo: q('.team img'), teamName: q('.team .tn'),
    };
    this._render();
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this);
    this._fit();
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
    if (!this._visible || skipAnimation) {
      this._data = next;
      this._render();
      return { statusCode: 200 };
    }
    const { main, top, icon } = this._el;
    await Promise.all([main, top, icon].map((el) => this._run(el, [{ opacity: 0 }], { duration: 160, easing: EASE_IN })));
    this._data = next;
    this._render();
    await Promise.all([main, top, icon].map((el, i) => this._run(el, [{ opacity: 0, transform: 'translateY(8px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 240, delay: i * 40, easing: EASE_OUT })));
    return { statusCode: 200 };
  }

  async customAction({ id } = {}) {
    return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` };
  }

  // ---------------------------------------------------------------------------

  _render() {
    const d = this._data;
    const e = this._el;
    const kind = HEADLINES[d.kind] !== undefined ? d.kind : 'text';
    const color = HEX.test(d.teamColor) ? d.teamColor : DEFAULTS.teamColor;
    e.banner.style.setProperty('--team', color);
    e.banner.style.setProperty('--team-light', lighten(color));
    e.banner.classList.toggle('is-sub', kind === 'sub');
    e.icon.innerHTML = ICONS[kind] ?? '';
    e.icon.style.display = ICONS[kind] ? '' : 'none';
    e.headline.textContent = d.headline || HEADLINES[kind] || '';
    e.minute.textContent = d.minute ?? '';
    e.score.textContent = ['goal', 'own_goal', 'penalty_goal'].includes(kind) ? (d.score ?? '') : '';
    e.num.textContent = d.playerNumber ?? '';
    e.name.textContent = d.playerName ?? '';
    e.inN.textContent = d.inNumber ?? '';
    e.inName.textContent = d.inName ?? '';
    e.outN.textContent = d.outNumber ?? '';
    e.outName.textContent = d.outName ?? '';
    e.teamName.textContent = d.teamName ?? '';
    if (d.teamLogo) e.logo.src = new URL(d.teamLogo, import.meta.url).href;
    else e.logo.removeAttribute('src');
  }

  _fit() {
    const r = this.getBoundingClientRect();
    this._el.canvas.style.transform = `scale(${Math.min((r.width || W) / W, (r.height || H) / H)})`;
  }

  async _in(skip) {
    this._cancelAll();
    this._visible = true;
    const { banner, icon, body, top, main } = this._el;
    await Promise.all([
      this._run(banner, [{ opacity: 1, offset: 0 }, { opacity: 1 }], { duration: 1 }, skip),
      this._run(icon, [{ transform: 'scale(0.4) rotate(-20deg)', opacity: 0, offset: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }, skip),
      this._run(body, [{ clipPath: 'inset(0 100% 0 0)', offset: 0 }, { clipPath: 'inset(0 0 0 0)' }], { duration: 560, delay: 140, easing: EASE_OUT }, skip),
      this._run(top, [{ opacity: 0, transform: 'translateY(-10px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 320, easing: EASE_OUT }, skip),
      this._run(main, [{ opacity: 0, transform: 'translateX(-30px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 360, easing: EASE_OUT }, skip),
    ]);
  }

  async _out(skip) {
    this._step = undefined;
    if (!this._visible) return;
    this._visible = false;
    this._cancelAll();
    const { banner } = this._el;
    await this._run(banner, [{ opacity: 0, transform: 'translateX(-30px)' }], { duration: 380, easing: EASE_IN }, skip);
    if (this._visible) return;
    for (const el of Object.values(this._el)) {
      if (el === this._el.canvas || !el?.style) continue;
      for (const p of ['transform', 'clip-path', 'opacity']) el.style.removeProperty(p);
    }
    banner.style.opacity = '0';
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
          if (a.playState === 'idle') return;
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
