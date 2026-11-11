/**
 * OGraf scorebug – football.
 *
 * The match clock is never ticked by the server. `data.clock` is an anchor:
 *   { $type: 'clock', running, anchorServerMs, anchorLocalMs?, elapsedAtAnchorMs, direction?, limitMs? }
 * elapsed = elapsedAtAnchorMs + (running ? Date.now() - anchor : 0)
 * The renderer adds `anchorLocalMs` (server time converted to this machine's clock).
 */
const W = 1920;
const H = 1080;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
const DEFAULTS = {
  homeCode: 'HOM', awayCode: 'AWY', homeScore: 0, awayScore: 0,
  homeColor: '#d81e3c', awayColor: '#1e6bd8', homeLogo: '', awayLogo: '',
  period: '', addedTime: 0, showClock: true, clock: null,
};

const CSS = `
:host { display: block; position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.canvas { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; }
.bug {
  position: absolute; left: 96px; top: 54px; display: flex; align-items: stretch; height: 52px;
  font-family: "Inter", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif;
  filter: drop-shadow(0 8px 20px rgba(0, 0, 0, .45)); opacity: 0;
}
.main { display: flex; align-items: stretch; background: linear-gradient(180deg, #121c48 0%, #0b1230 100%); border-radius: 4px 0 0 4px; overflow: hidden; }
.team { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 0 18px; min-width: 120px; }
.team.away { flex-direction: row-reverse; }
.strip { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: var(--c); }
.logo { width: 30px; height: 30px; object-fit: contain; display: none; }
.logo.on { display: block; }
.code { color: #fff; font-weight: 800; font-size: 26px; letter-spacing: .06em; }
.score {
  display: flex; align-items: center; gap: 0; background: #f4f6fb; color: #0b1230;
  font-weight: 900; font-size: 30px; font-variant-numeric: tabular-nums;
}
.score .n { display: inline-block; min-width: 46px; text-align: center; }
.score .sep { width: 2px; height: 26px; background: rgba(11, 18, 48, .18); }
.clockbox {
  display: flex; align-items: center; justify-content: center; min-width: 118px; padding: 0 16px;
  background: linear-gradient(135deg, #00d1ff 0%, #4a6bff 100%); color: #06102e;
  font-weight: 800; font-size: 28px; font-variant-numeric: tabular-nums; letter-spacing: .02em; border-radius: 0 4px 4px 0;
}
.clockbox.hidden { display: none; }
.main.noclock { border-radius: 4px; }
.tags { position: absolute; left: 100%; top: 0; display: flex; height: 52px; }
.tag { display: none; align-items: center; padding: 0 14px; margin-left: 6px; font-weight: 800; font-size: 22px; border-radius: 4px; }
.tag.on { display: flex; }
.period { background: #f4f6fb; color: #0b1230; letter-spacing: .08em; }
.added { background: #0b1230; color: #00d1ff; font-variant-numeric: tabular-nums; }
.goal {
  position: absolute; top: 100%; margin-top: 6px; height: 40px; display: flex; align-items: center; gap: 12px;
  padding: 0 18px; background: var(--c); color: #fff; font-weight: 900; font-size: 22px; letter-spacing: .3em;
  border-radius: 4px; opacity: 0; white-space: nowrap;
}
`;

const HEX = /^#[0-9a-f]{6}$/i;

function clockElapsed(c, now) {
  if (!c || typeof c !== 'object') return 0;
  const anchor = typeof c.anchorLocalMs === 'number' ? c.anchorLocalMs : c.anchorServerMs;
  const base = Number(c.elapsedAtAnchorMs) || 0;
  return Math.max(0, base + (c.running && typeof anchor === 'number' ? Math.max(0, now - anchor) : 0));
}

function fmt(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default class Scorebug extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._data = { ...DEFAULTS };
    this._visible = false;
    this._step = undefined;
    this._anims = new Set();
    this._raf = 0;
    this._lastClockText = '';
  }

  async load({ data } = {}) {
    this._data = { ...DEFAULTS, ...(data ?? {}) };
    this._root.innerHTML = `<style>${CSS}</style>
      <div class="canvas"><div class="bug">
        <div class="main">
          <div class="team home"><span class="strip"></span><img class="logo" alt=""><span class="code"></span></div>
          <div class="score"><span class="n home"></span><span class="sep"></span><span class="n away"></span></div>
          <div class="team away"><span class="strip"></span><img class="logo" alt=""><span class="code"></span></div>
        </div>
        <div class="clockbox"><span class="time">00:00</span></div>
        <div class="tags"><div class="tag period"></div><div class="tag added"></div></div>
        <div class="goal"><span>GOAL</span><span class="goalteam"></span></div>
      </div></div>`;
    const q = (s) => this._root.querySelector(s);
    this._el = {
      canvas: q('.canvas'), bug: q('.bug'), main: q('.main'),
      home: q('.team.home'), away: q('.team.away'),
      homeCode: q('.team.home .code'), awayCode: q('.team.away .code'),
      homeLogo: q('.team.home .logo'), awayLogo: q('.team.away .logo'),
      homeScore: q('.n.home'), awayScore: q('.n.away'),
      clockbox: q('.clockbox'), time: q('.time'),
      period: q('.period'), added: q('.added'), goal: q('.goal'), goalTeam: q('.goalteam'),
    };
    this._render();
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this);
    this._fit();
    this._startClock();
    return { statusCode: 200 };
  }

  async dispose() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
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
    const prev = this._data;
    this._data = { ...prev, ...(data ?? {}) };
    this._render();
    if (this._visible && !skipAnimation) {
      const pops = [];
      if (this._data.homeScore !== prev.homeScore) pops.push(this._pop(this._el.homeScore));
      if (this._data.awayScore !== prev.awayScore) pops.push(this._pop(this._el.awayScore));
      await Promise.all(pops);
    }
    return { statusCode: 200 };
  }

  async customAction({ id, payload, skipAnimation } = {}) {
    if (id !== 'goal') return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` };
    const team = payload?.team === 'away' ? 'away' : 'home';
    if (!this._visible || skipAnimation) return { statusCode: 200 };
    const d = this._data;
    const { goal, goalTeam } = this._el;
    goal.style.setProperty('--c', HEX.test(team === 'home' ? d.homeColor : d.awayColor) ? (team === 'home' ? d.homeColor : d.awayColor) : '#00d1ff');
    goal.style.left = team === 'home' ? '0px' : `${this._el.main.offsetWidth - 220}px`;
    goalTeam.textContent = team === 'home' ? d.homeCode : d.awayCode;
    await this._run(goal, [
      { opacity: 0, transform: 'translateY(-12px)', clipPath: 'inset(0 100% 0 0)', offset: 0 },
      { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)', offset: 0.12 },
      { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)', offset: 0.88 },
      { opacity: 0, transform: 'translateY(-6px)', clipPath: 'inset(0 0 0 100%)', offset: 1 },
    ], { duration: 3200, easing: 'linear' }, false, false);
    return { statusCode: 200 };
  }

  // ---------------------------------------------------------------------------

  _render() {
    const d = this._data;
    const e = this._el;
    e.home.style.setProperty('--c', HEX.test(d.homeColor) ? d.homeColor : DEFAULTS.homeColor);
    e.away.style.setProperty('--c', HEX.test(d.awayColor) ? d.awayColor : DEFAULTS.awayColor);
    e.homeCode.textContent = String(d.homeCode ?? '').toUpperCase();
    e.awayCode.textContent = String(d.awayCode ?? '').toUpperCase();
    e.homeScore.textContent = String(d.homeScore ?? 0);
    e.awayScore.textContent = String(d.awayScore ?? 0);
    this._setLogo(e.homeLogo, d.homeLogo);
    this._setLogo(e.awayLogo, d.awayLogo);
    const showClock = d.showClock !== false;
    e.clockbox.classList.toggle('hidden', !showClock);
    e.main.classList.toggle('noclock', !showClock);
    e.period.textContent = d.period ?? '';
    e.period.classList.toggle('on', !!d.period);
    this._renderClock(true);
  }

  _setLogo(img, src) {
    if (!src) {
      img.classList.remove('on');
      img.removeAttribute('src');
      return;
    }
    const url = new URL(src, import.meta.url).href;
    if (img.getAttribute('src') !== url) {
      img.onerror = () => img.classList.remove('on');
      img.onload = () => img.classList.add('on');
      img.setAttribute('src', url);
    }
  }

  _renderClock(force = false) {
    const d = this._data;
    const c = d.clock;
    let text = '00:00';
    let stoppage = '';
    if (c && typeof c === 'object') {
      const elapsed = clockElapsed(c, Date.now());
      if (c.direction === 'down') {
        text = fmt(Math.max(0, (Number(c.limitMs) || 0) - elapsed));
      } else if (typeof c.limitMs === 'number' && elapsed > c.limitMs) {
        // Regulation time is up: freeze at the limit and count stoppage time separately.
        text = fmt(c.limitMs);
        stoppage = `+${fmt(elapsed - c.limitMs).replace(/^0/, '')}`;
      } else {
        text = fmt(elapsed);
      }
    }
    const added = Number(d.addedTime) > 0 ? `+${d.addedTime}` : '';
    const tag = stoppage || added;
    if (force || text !== this._lastClockText) {
      this._lastClockText = text;
      this._el.time.textContent = text;
    }
    if (this._el.added.textContent !== tag) this._el.added.textContent = tag;
    this._el.added.classList.toggle('on', !!tag && d.showClock !== false);
  }

  _startClock() {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      if (this._data.clock?.running) this._renderClock();
    };
    this._raf = requestAnimationFrame(tick);
  }

  _fit() {
    const r = this.getBoundingClientRect();
    this._el.canvas.style.transform = `scale(${Math.min((r.width || W) / W, (r.height || H) / H)})`;
  }

  async _in(skip) {
    this._cancelAll();
    this._visible = true;
    const { bug, main, clockbox, homeScore, awayScore } = this._el;
    bug.style.opacity = '1';
    await Promise.all([
      this._run(main, [{ clipPath: 'inset(0 100% 0 0)', offset: 0 }, { clipPath: 'inset(0 0 0 0)' }], { duration: 520, easing: EASE_OUT }, skip),
      this._run(clockbox, [{ transform: 'translateX(-30px)', opacity: 0, offset: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 280, easing: EASE_OUT }, skip),
      this._run(homeScore, [{ opacity: 0, offset: 0 }, { opacity: 1 }], { duration: 300, delay: 300 }, skip),
      this._run(awayScore, [{ opacity: 0, offset: 0 }, { opacity: 1 }], { duration: 300, delay: 360 }, skip),
    ]);
  }

  async _out(skip) {
    this._step = undefined;
    if (!this._visible) return;
    this._visible = false;
    this._cancelAll();
    const { bug } = this._el;
    await this._run(bug, [{ opacity: 0, transform: 'translateY(-14px)' }], { duration: 420, easing: EASE_IN }, skip);
    if (this._visible) return;
    for (const el of [this._el.main, this._el.clockbox, this._el.homeScore, this._el.awayScore, bug]) {
      for (const p of ['transform', 'clip-path', 'opacity']) el.style.removeProperty(p);
    }
    bug.style.opacity = '0';
  }

  _pop(el) {
    return this._run(el, [
      { transform: 'scale(1)', color: '#0b1230', offset: 0 },
      { transform: 'scale(1.45)', color: '#00a8d6', offset: 0.3 },
      { transform: 'scale(1)', color: '#0b1230', offset: 1 },
    ], { duration: 650, easing: EASE_OUT }, false, false);
  }

  /** Runs an animation. With commit=true the end state is written inline and the animation removed. */
  _run(el, keyframes, opts, skip = false, commit = true) {
    const a = el.animate(keyframes, { ...opts, fill: commit ? 'forwards' : 'none', duration: skip ? 0 : opts.duration, delay: skip ? 0 : (opts.delay ?? 0) });
    a.__commit = commit;
    this._anims.add(a);
    return a.finished.then(
      () => {
        if (commit) {
          try { a.commitStyles(); } catch { /* not rendered */ }
        }
        a.cancel();
      },
      () => {},
    ).finally(() => this._anims.delete(a));
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
