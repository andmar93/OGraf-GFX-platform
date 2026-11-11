/**
 * OGraf full-frame lineup.
 * Step 0: starting XI (list + formation on a pitch). Step 1: substitutes + coach.
 * Plain Web Component, Shadow DOM, Web Animations API, no dependencies. 1920x1080 canvas, scaled to fit.
 */
const W = 1920;
const H = 1080;
const STEPS = 2;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULTS = { teamName: '', competition: '', teamColor: '#d81e3c', logo: '', formation: '4-3-3', coach: '', starters: [], substitutes: [] };

const CSS = `
:host { display: block; position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.canvas { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; }
.frame {
  position: absolute; inset: 0; opacity: 0; color: #fff;
  font-family: "Inter", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif;
  background:
    radial-gradient(1200px 700px at 85% 15%, color-mix(in srgb, var(--team) 45%, transparent) 0%, transparent 60%),
    radial-gradient(900px 600px at 0% 100%, rgba(0, 209, 255, .18) 0%, transparent 60%),
    linear-gradient(160deg, #0e1740 0%, #070c24 100%);
}
.frame::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(115deg, rgba(255,255,255,.025) 0 2px, transparent 2px 90px); }
.header { position: absolute; left: 150px; top: 96px; right: 150px; display: flex; align-items: center; gap: 28px; z-index: 1; }
.crest { width: 112px; height: 112px; object-fit: contain; filter: drop-shadow(0 8px 18px rgba(0,0,0,.4)); }
.crest.off { display: none; }
.titles { display: flex; flex-direction: column; gap: 8px; }
.comp { font-size: 24px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; color: #00d1ff; }
.team { font-size: 72px; font-weight: 900; text-transform: uppercase; letter-spacing: .01em; line-height: 1; }
.heading { position: absolute; left: 150px; top: 262px; display: flex; align-items: center; gap: 18px; z-index: 1; }
.heading .bar { width: 10px; height: 40px; background: linear-gradient(180deg, #00d1ff, #6a3cff); }
.heading .text { font-size: 36px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.heading .sub { font-size: 30px; font-weight: 600; color: rgba(255,255,255,.6); letter-spacing: .08em; }
.page { position: absolute; left: 150px; top: 336px; right: 150px; bottom: 96px; z-index: 1; }
.list { display: grid; grid-auto-rows: 56px; gap: 6px; width: 760px; }
.row { display: grid; grid-template-columns: 78px 1fr auto; align-items: center; background: rgba(255,255,255,.06); border-left: 4px solid var(--team); }
.row .num { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 900; font-variant-numeric: tabular-nums; background: rgba(255,255,255,.08); }
.row .name { padding: 0 22px; font-size: 30px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .cap { margin-right: 18px; width: 34px; height: 34px; border-radius: 50%; background: #00d1ff; color: #06102e; font-weight: 900; font-size: 20px; display: flex; align-items: center; justify-content: center; }
.subs .list { grid-template-columns: 1fr 1fr; width: 1300px; column-gap: 18px; }
.pitch { position: absolute; right: 0; top: -40px; width: 680px; height: 720px; border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03)); border: 2px solid rgba(255,255,255,.22); overflow: hidden; }
.pitch svg.lines { position: absolute; inset: 0; width: 100%; height: 100%; }
.dot { position: absolute; width: 92px; margin-left: -46px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.dot .shirt { width: 54px; height: 54px; border-radius: 50%; background: var(--team); border: 3px solid #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 900; font-size: 24px; box-shadow: 0 6px 14px rgba(0,0,0,.35); }
.dot .label { font-size: 17px; font-weight: 700; text-transform: uppercase; text-align: center; white-space: nowrap; text-shadow: 0 2px 4px rgba(0,0,0,.6); max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.coach { margin-top: 34px; display: flex; align-items: center; gap: 18px; font-size: 30px; }
.coach .k { font-weight: 600; letter-spacing: .14em; color: #00d1ff; text-transform: uppercase; font-size: 24px; }
.coach .v { font-weight: 800; text-transform: uppercase; }
.hidden { display: none; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Splits starters into lines: [GK], then formation lines (defence -> attack). */
function formationLines(formation, count) {
  const parts = String(formation || '').split('-').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const lines = [1, ...parts];
  if (lines.reduce((a, b) => a + b, 0) !== count) return null;
  return lines;
}

export default class Lineup extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._data = { ...DEFAULTS };
    this._step = undefined;
    this._anims = new Set();
  }

  async load({ data } = {}) {
    this._data = { ...DEFAULTS, ...(data ?? {}) };
    this._root.innerHTML = `<style>${CSS}</style><div class="canvas"><div class="frame">
      <div class="header"><img class="crest off" alt=""><div class="titles"><div class="comp"></div><div class="team"></div></div></div>
      <div class="heading"><span class="bar"></span><span class="text"></span><span class="sub"></span></div>
      <div class="page xi"><div class="list"></div><div class="pitch"></div></div>
      <div class="page subs hidden"><div class="list"></div><div class="coach"><span class="k">Head coach</span><span class="v"></span></div></div>
    </div></div>`;
    const q = (s) => this._root.querySelector(s);
    this._el = {
      canvas: q('.canvas'), frame: q('.frame'), header: q('.header'), crest: q('.crest'), comp: q('.comp'), team: q('.team'),
      heading: q('.heading'), headingText: q('.heading .text'), headingSub: q('.heading .sub'),
      xi: q('.page.xi'), xiList: q('.page.xi .list'), pitch: q('.pitch'),
      subs: q('.page.subs'), subsList: q('.page.subs .list'), coach: q('.coach'), coachName: q('.coach .v'),
    };
    this._render();
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this);
    this._fit();
    await this._preloadLogo();
    return { statusCode: 200 };
  }

  async dispose() {
    this._cancelAll();
    this._ro?.disconnect();
    this._root.innerHTML = '';
    return { statusCode: 200 };
  }

  async playAction({ goto, delta, skipAnimation } = {}) {
    let target = Number.isInteger(goto) && goto >= 0 ? goto : (this._step ?? -1) + (Number.isInteger(delta) ? delta : 1);
    if (target < 0) target = 0;
    if (target >= STEPS) {
      await this._out(skipAnimation);
      return { statusCode: 200, currentStep: undefined };
    }
    const prev = this._step;
    this._step = target;
    if (prev === undefined) await this._in(target, skipAnimation);
    else if (prev !== target) await this._switch(prev, target, skipAnimation);
    return { statusCode: 200, currentStep: target };
  }

  async stopAction({ skipAnimation } = {}) {
    await this._out(skipAnimation);
    return { statusCode: 200 };
  }

  async updateAction({ data } = {}) {
    this._data = { ...this._data, ...(data ?? {}) };
    this._render();
    return { statusCode: 200 };
  }

  async customAction({ id } = {}) {
    return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` };
  }

  // ---------------------------------------------------------------------------

  _render() {
    const d = this._data;
    const e = this._el;
    e.frame.style.setProperty('--team', HEX.test(d.teamColor) ? d.teamColor : DEFAULTS.teamColor);
    e.team.textContent = d.teamName ?? '';
    e.comp.textContent = d.competition ?? '';
    if (d.logo) {
      e.crest.src = new URL(d.logo, import.meta.url).href;
      e.crest.classList.remove('off');
      e.crest.onerror = () => e.crest.classList.add('off');
    } else e.crest.classList.add('off');

    const starters = Array.isArray(d.starters) ? d.starters.slice(0, 11) : [];
    e.xiList.innerHTML = starters.map((p) => `<div class="row"><span class="num">${esc(p?.number)}</span><span class="name">${esc(p?.name)}</span>${p?.captain ? '<span class="cap">C</span>' : '<span></span>'}</div>`).join('');
    const subs = Array.isArray(d.substitutes) ? d.substitutes : [];
    e.subsList.innerHTML = subs.map((p) => `<div class="row"><span class="num">${esc(p?.number)}</span><span class="name">${esc(p?.name)}</span><span></span></div>`).join('');
    e.coachName.textContent = d.coach ?? '';
    e.coach.classList.toggle('hidden', !d.coach);
    this._renderPitch(starters);
    this._renderHeading(this._step ?? 0);
  }

  _renderHeading(step) {
    this._el.headingText.textContent = step === 1 ? 'Substitutes' : 'Starting XI';
    this._el.headingSub.textContent = step === 1 ? '' : (this._data.formation ?? '');
  }

  _renderPitch(starters) {
    const pw = 680;
    const ph = 720;
    const lines = formationLines(this._data.formation, starters.length);
    let html = `<svg class="lines" viewBox="0 0 ${pw} ${ph}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2">
      <line x1="0" y1="${ph / 2}" x2="${pw}" y2="${ph / 2}"/><circle cx="${pw / 2}" cy="${ph / 2}" r="70"/>
      <rect x="${pw / 2 - 160}" y="${ph - 120}" width="320" height="120"/><rect x="${pw / 2 - 70}" y="${ph - 46}" width="140" height="46"/>
      <rect x="${pw / 2 - 160}" y="0" width="320" height="120"/><rect x="${pw / 2 - 70}" y="0" width="140" height="46"/></svg>`;
    if (lines) {
      let i = 0;
      lines.forEach((count, li) => {
        // GK at the bottom, attack at the top
        const y = ph - 92 - li * ((ph - 150) / (lines.length - 1 || 1));
        for (let k = 0; k < count; k++) {
          const p = starters[i++];
          const x = (pw / (count + 1)) * (k + 1);
          html += `<div class="dot" style="left:${x}px;top:${Math.max(14, y - 34)}px"><div class="shirt">${esc(p?.number)}</div><div class="label">${esc(p?.name)}</div></div>`;
        }
      });
    }
    this._el.pitch.innerHTML = html;
    this._el.pitch.classList.toggle('hidden', !lines);
  }

  async _preloadLogo() {
    const img = this._el.crest;
    if (img.classList.contains('off') || img.complete) return;
    await Promise.race([new Promise((r) => { img.onload = r; img.addEventListener('error', r, { once: true }); }), new Promise((r) => setTimeout(r, 2000))]);
  }

  _fit() {
    const r = this.getBoundingClientRect();
    this._el.canvas.style.transform = `scale(${Math.min((r.width || W) / W, (r.height || H) / H)})`;
  }

  _page(step) {
    return step === 1 ? this._el.subs : this._el.xi;
  }

  _rows(step) {
    const page = this._page(step);
    return [...page.querySelectorAll('.row'), ...page.querySelectorAll('.dot'), ...(step === 1 ? [this._el.coach] : [])];
  }

  _showPage(step) {
    this._el.xi.classList.toggle('hidden', step !== 0);
    this._el.subs.classList.toggle('hidden', step !== 1);
    this._renderHeading(step);
  }

  async _in(step, skip) {
    this._cancelAll();
    this._showPage(step);
    const { frame, header, heading } = this._el;
    const anims = [
      this._run(frame, [{ opacity: 0, offset: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' }, skip),
      this._run(header, [{ opacity: 0, transform: 'translateY(-30px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 150, easing: EASE_OUT }, skip),
      this._run(heading, [{ opacity: 0, transform: 'translateX(-30px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 300, easing: EASE_OUT }, skip),
      this._run(this._el.pitch, [{ opacity: 0, transform: 'scale(.96)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 350, easing: EASE_OUT }, skip),
    ];
    this._rows(step).forEach((r, i) => anims.push(this._run(r, [{ opacity: 0, transform: 'translateX(-40px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 450, delay: 380 + i * 45, easing: EASE_OUT }, skip)));
    await Promise.all(anims);
  }

  async _switch(from, to, skip) {
    this._cancelAll();
    const leaving = [...this._rows(from), this._el.heading, ...(from === 0 ? [this._el.pitch] : [])];
    await Promise.all(leaving.map((r, i) => this._run(r, [{ opacity: 0, transform: 'translateX(30px)' }], { duration: 260, delay: Math.min(i, 10) * 15, easing: EASE_IN }, skip)));
    if (this._step !== to) return; // superseded by a newer call
    for (const r of leaving) for (const p of ['opacity', 'transform']) r.style.removeProperty(p);
    this._showPage(to);
    const entering = [this._el.heading, ...this._rows(to)];
    await Promise.all(entering.map((r, i) => this._run(r, [{ opacity: 0, transform: 'translateX(-40px)', offset: 0 }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 40, easing: EASE_OUT }, skip)));
  }

  async _out(skip) {
    const wasVisible = this._step !== undefined;
    this._step = undefined;
    if (!wasVisible) return;
    this._cancelAll();
    await this._run(this._el.frame, [{ opacity: 0 }], { duration: 550, easing: EASE_IN }, skip);
    if (this._step !== undefined) return;
    this._root.querySelectorAll('[style]').forEach((el) => {
      if (el === this._el.canvas || el.classList.contains('dot')) return;
      for (const p of ['opacity', 'transform']) el.style.removeProperty(p);
    });
    this._root.querySelectorAll('.dot').forEach((el) => { el.style.removeProperty('opacity'); el.style.removeProperty('transform'); });
    this._el.frame.style.opacity = '0';
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
