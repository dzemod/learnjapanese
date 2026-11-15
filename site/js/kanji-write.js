// Kanji writing mode (#/kanji/write[/<book|lesson>[/<kanjiId>]]), modeled on Kanji Dojo:
// demonstration (coloured stroke diagram, ▶ replay) → the learner writes every stroke on a grid canvas →
// rating Ще раз / Важко / Добре / Легко sets the next review time (localStorage `jp.kanjiWrite`).
// Stroke data: KanjiVG through kanjiVG() of kanji.js (the same source as the stroke-order animation).
import { $, $$, esc, I } from './util.js';
import { books, kanjiVG } from './kanji.js';
import { kunHTML } from './modes.js';
import {
  STROKE, judgeStroke, RATINGS, nextInterval, applyRating, counts, buildQueue, fmtInterval,
} from './stroke-match.js';

const KEY = 'jp.kanjiWrite';
// Stroke colours of the diagram: red, orange, yellow, green, … (repeats after 10)
const PALETTE = ['#e5484d', '#f08c3a', '#f2c94c', '#5ec26a', '#2bb3a3', '#3b9ae1', '#6e6ae8', '#b45ce0', '#e0589c', '#9aa0a6'];
const INK = '#f5f1ea'; // red (#e5484d) and the hint grey live in style.css (.kw-wrong, .kw-hint)
// demonstration / replay timing: per-stroke duration from MIN_MS (short) to MAX_MS (long), pause between strokes
const ANIM = { MIN_MS: 350, MAX_MS: 700, PAUSE_MS: 120, WRONG_HOLD_MS: 600, WRONG_FADE_MS: 400 };
// live brush: width from speed (faster = thinner), smoothed, tapered at both ends (109-units, units/ms)
const BRUSH = { W_MAX: 4.4, W_MIN: 1.9, V_FAST: 0.45, SPEED_EMA: 0.3, WIDTH_EMA: 0.35, TAPER: 6, TAPER_MIN: 0.35 };

// ---------- schedule storage (never throws; falls back to memory) ----------
let memSched = null;
function loadSched() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); memSched = v && typeof v === 'object' ? v : {}; } catch { memSched ||= {}; }
  return memSched;
}
function saveSched(s) {
  memSched = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('Kanji schedule not saved', e); }
}

// ---------- scope ----------
function scopeOf(scope) {
  const bs = books();
  const all = [];
  for (const b of bs) for (const l of b.lessons) for (const k of l.kanji) all.push({ k, l, b });
  if (!scope) return { title: 'Усі канджі', back: '#/kanji', items: all };
  const b = bs.find(x => x.id === scope);
  if (b) return { title: b.title, back: '#/kanji', items: all.filter(x => x.b === b) };
  const items = all.filter(x => x.l.id === scope);
  if (!items.length) return null;
  return { title: `${items[0].l.no}課 · ${items[0].b.title}`, back: `#/kanji/${encodeURIComponent(scope)}`, items };
}

// ---------- KanjiVG → points ----------
let probe = null;
function samplePaths(ds) {
  if (!probe) {
    probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;left:-9999px';
    document.body.append(probe);
  }
  return ds.map(d => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    probe.append(p);
    const len = p.getTotalLength(), n = Math.max(8, Math.ceil(len / 1.5)), pts = [];
    for (let i = 0; i <= n; i++) { const q = p.getPointAtLength((len * i) / n); pts.push([q.x, q.y]); }
    p.remove();
    return { d, len, pts };
  });
}

// ---------- view ----------
export function kanjiWriteView(root, scope = '', startId = '') {
  const sc = scopeOf(scope);
  if (!sc) { root.innerHTML = `<div class="empty"><div class="empty-jp" lang="ja">無</div><p>Такого уроку немає.</p><a class="btn primary" href="#/kanji">Канджі</a></div>`; return; }
  const ids = sc.items.map(x => x.k.id);
  const byId = new Map(sc.items.map(x => [x.k.id, x]));
  let sched = loadSched();
  let skipped = [];          // «Далі» without rating → to the end of this session's queue
  let cur = null;            // current kanji session
  let timers = [], alive = true, ro = null;
  let demoToken = { stop: true }, replayToken = { stop: true }; // cancel tokens of running animations
  const later = (fn, ms) => { const t = setTimeout(() => alive && fn(), ms); timers.push(t); return t; };

  root.innerHTML = `<div class="kw fade-in">
    <div class="kw-top">
      <a class="icon-btn kw-back" href="${sc.back}" aria-label="Назад" title="Назад">${I.back}</a>
      <span class="kw-scope muted small">${esc(sc.title)}</span>
      <div class="kw-counts" aria-label="Черга">
        <span class="kw-c new" title="Нові"><i></i><b data-c="new">0</b></span>
        <span class="kw-c learning" title="Вчу"><i></i><b data-c="learning">0</b></span>
        <span class="kw-c review" title="Повторити зараз"><i></i><b data-c="review">0</b></span>
      </div>
    </div>
    <div class="kw-body"></div>
  </div>
  <div class="kw-rate" hidden role="group" aria-label="Оцінка"></div>`;
  const body = $('.kw-body', root), rateBar = $('.kw-rate', root);

  const updateCounts = () => {
    const c = counts(ids, sched);
    for (const k of ['new', 'learning', 'review']) $(`[data-c="${k}"]`, root).textContent = c[k];
  };

  function nextId() {
    const q = buildQueue(ids, sched).filter(id => !skipped.includes(id));
    if (startId && byId.has(startId)) { const s = startId; startId = ''; return s; }
    return q[0] || skipped.shift() || null;
  }

  function showDone() {
    rateBar.hidden = true; document.body.classList.remove('kw-rating');
    const next = ids.map(id => sched[id]?.due).filter(Boolean).sort((a, b) => a - b)[0];
    body.innerHTML = `<div class="kw-done empty"><div class="empty-jp" lang="ja">完</div>
      <p>Зараз немає канджі для письма.${next ? ` Наступне повторення через <b>${fmtInterval(Math.max(0, next - Date.now()))}</b>.` : ''}</p>
      <a class="btn primary" href="${sc.back}">Назад</a></div>`;
    if (next) later(() => { sched = loadSched(); updateCounts(); if (buildQueue(ids, sched).length) load(nextId()); }, Math.max(1000, Math.min(next - Date.now() + 500, 2 ** 31 - 1)));
  }

  function load(id) {
    timers.forEach(clearTimeout); timers = [];
    updateCounts();
    if (!id) return showDone();
    const { k } = byId.get(id);
    const isNew = !sched[id];
    cur = { k, isNew, strokes: null, idx: 0, mistakes: 0, user: [], live: null, wrong: null, hint: false, done: false };
    demoToken.stop = true; replayToken.stop = true;
    rateBar.hidden = true; document.body.classList.remove('kw-rating');
    const ex = k.examples || [];
    const mask = s => (isNew ? esc(s) : esc(s).split(k.kanji).join('<span class="kw-mask">◯</span>'));
    body.innerHTML = `
      <div class="kw-info ${isNew ? '' : 'recall'}">
        <div class="kw-diag" ${isNew ? '' : 'hidden'}><svg viewBox="0 0 109 109" aria-label="Порядок рисок"></svg>
          <button class="kw-diag-play" data-demo aria-label="Повторити" title="Повторити">▶</button></div>
        <div class="kw-meta">
          <div class="kw-meaning">${esc(k.meaning)}</div>
          ${k.on.length ? `<div class="kw-rd"><span class="kw-rl">Он</span>${k.on.map(r => `<span class="kw-chip" lang="ja">${esc(r)}</span>`).join('')}</div>` : ''}
          ${k.kun.length ? `<div class="kw-rd"><span class="kw-rl">Кун</span>${k.kun.map(r => `<span class="kw-chip" lang="ja">${kunHTML(r)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <details class="kw-ex">
        <summary><svg class="kw-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg><span class="kw-ex-t">Приклади (${ex.length})</span>
          ${ex[0] ? `<span class="kw-ex-first"><ruby lang="ja">${mask(ex[0].word)}<rt>${esc(ex[0].kana)}</rt></ruby> · ${esc(ex[0].uk)}</span>` : ''}</summary>
        <div class="kw-ex-list">${ex.map(e => `<div class="kw-exrow"><ruby lang="ja">${mask(e.word)}<rt>${esc(e.kana)}</rt></ruby><span>— ${esc(e.uk)}</span></div>`).join('') || '<p class="muted small">Немає прикладів.</p>'}</div>
      </details>
      <div class="kw-pad">
        <svg class="kw-svg" viewBox="0 0 109 109" aria-hidden="true"><g class="kw-grid"></g><g class="kw-hint"></g><g class="kw-ink"></g><g class="kw-fades"></g><g class="kw-wrongs"></g></svg>
        <canvas class="kw-canvas" aria-label="Поле для письма"></canvas>
        <button class="kw-btn kw-hint" data-hint aria-label="Показати штрих" title="Показати штрих">?</button>
        <button class="kw-btn kw-play" data-replay aria-label="Повторити" title="Повторити" hidden>▶</button>
        <button class="kw-btn kw-ok" data-ok aria-label="Готово" title="Готово"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></button>
      </div>
      <div class="kw-status small muted" aria-live="polite"><span data-st></span><button class="btn ghost sm" data-skip>Далі</button></div>`;
    $('[data-skip]', body).onclick = () => { skipped.push(id); load(nextId()); };
    $('[data-hint]', body).onclick = () => { if (!cur.done) { cur.hint = true; paintHint(); } };
    $('[data-ok]', body).onclick = finishEarly;
    $('[data-replay]', body).onclick = replay;
    $('[data-demo]', body).onclick = e => { e.stopPropagation(); demo(); };
    $('.kw-diag', body).onclick = skipDemo; // tap on the diagram → finished kanji at once
    setupCanvas(); paintGrid();
    status_();
    kanjiVG(k.kanji).then(d => {
      if (!alive || cur.k !== k) return;
      if (!d.paths.length) throw new Error('empty');
      cur.strokes = samplePaths(d.paths);
      drawDiagram();
      if (isNew) demo();
      paintHint(); requestLive(); status_();
    }).catch(() => {
      if (cur.k !== k) return;
      $('.kw-pad', body).innerHTML = '<div class="so-missing muted small">Дані рисок недоступні (немає з’єднання або символу немає в KanjiVG).</div>';
    });
  }

  // ----- animation helpers (Web Animations API, no timers) -----
  // stroke duration grows with its length: ~350 ms for a dot … ~700 ms for a long stroke
  const strokeMs = len => Math.round(ANIM.MIN_MS + (ANIM.MAX_MS - ANIM.MIN_MS) * Math.max(0, Math.min(1, (len - 10) / 70)));
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Draw `path` in along its length (stroke-dashoffset), ease-in-out. Resolves true when done, false if cancelled. */
  function drawIn(path, len, { delay = 0 } = {}) {
    const L = len + 1;
    path.style.strokeDasharray = `${L} ${L}`;
    if (reduceMotion()) { path.style.strokeDashoffset = 0; return Promise.resolve(true); }
    path.style.strokeDashoffset = L;
    const a = path.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: strokeMs(len), delay, easing: 'ease-in-out', fill: 'forwards' });
    return a.finished.then(() => { path.style.strokeDashoffset = 0; a.cancel(); return true; }, () => false);
  }
  /** Play strokes one after another with ANIM.PAUSE_MS between them; `onStep(i, on)` around each one. */
  async function playSequence(paths, lens, token, onStep) {
    paths.forEach((p, i) => { p.getAnimations().forEach(a => a.cancel()); p.style.strokeDasharray = `${lens[i] + 1} ${lens[i] + 1}`; p.style.strokeDashoffset = lens[i] + 1; });
    for (let i = 0; i < paths.length; i++) {
      if (token.stop) return false;
      onStep?.(i, true);
      const ok = await drawIn(paths[i], lens[i], { delay: i ? ANIM.PAUSE_MS : 0 });
      onStep?.(i, false);
      if (!ok || token.stop) return false;
    }
    return true;
  }
  const finishAll = paths => paths.forEach(p => { p.getAnimations().forEach(a => a.cancel()); p.style.strokeDashoffset = 0; p.classList.remove('cur'); });

  // ----- coloured stroke diagram (Step A) -----
  function drawDiagram() {
    const svg = $('.kw-diag svg', body);
    if (!svg) return;
    demoToken.stop = true;
    svg.innerHTML = cur.strokes.map((s, i) => `<path d="${esc(s.d)}" stroke="${PALETTE[i % PALETTE.length]}" data-i="${i}"/>`).join('');
  }
  function demo() {
    const ps = $$('.kw-diag path', body);
    if (!ps.length) return;
    demoToken.stop = true;
    const token = demoToken = { stop: false };
    return playSequence(ps, cur.strokes.map(s => s.len), token, (i, on) => ps[i].classList.toggle('cur', on));
  }
  function skipDemo() { demoToken.stop = true; finishAll($$('.kw-diag path', body)); }

  // ----- writing pad (Step B): SVG layer (grid, hint, accepted ink, red strokes, replay) + live canvas on top -----
  let cv, ctx, size = 0, svgPad, liveQueued = false;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  /** Brush widths for the points: speed-based (faster = thinner), smoothed over the last points, tapered at both ends. */
  function brushWidths(pts) {
    const n = pts.length, w = new Array(n);
    let v = 0, wPrev = BRUSH.W_MAX, acc = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[n - 1] || 0;
    for (let i = 0; i < n; i++) {
      if (i) {
        const dt = Math.max(1, (pts[i][2] || 0) - (pts[i - 1][2] || 0));
        v += BRUSH.SPEED_EMA * ((cum[i] - cum[i - 1]) / dt - v);
      }
      const raw = BRUSH.W_MAX - (BRUSH.W_MAX - BRUSH.W_MIN) * Math.min(1, v / BRUSH.V_FAST);
      wPrev += BRUSH.WIDTH_EMA * (raw - wPrev);
      const ends = Math.min(cum[i], total - cum[i]);
      acc = BRUSH.TAPER_MIN + (1 - BRUSH.TAPER_MIN) * Math.min(1, ends / BRUSH.TAPER);
      w[i] = wPrev * acc;
    }
    return w;
  }
  /** Brush segments: quadratic curves through the midpoints, each with its own width. */
  function brushSegments(pts) {
    const w = brushWidths(pts), segs = [];
    if (pts.length < 3) return [{ a: pts[0], c: null, b: [pts.at(-1)[0] + 0.01, pts.at(-1)[1]], w: w[0] }];
    let a = pts[0];
    for (let i = 1; i < pts.length - 1; i++) {
      const b = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
      segs.push({ a, c: pts[i], b, w: w[i] }); a = b;
    }
    segs.push({ a, c: null, b: pts.at(-1), w: w.at(-1) });
    return segs;
  }
  /** The brush line as SVG: consecutive segments with (almost) the same width share one <path>. */
  function brushSVG(pts, cls) {
    const g = mk('g', { class: cls }), f = n => n.toFixed(2);
    let d = '', wq = null;
    const flush = () => { if (d) g.append(mk('path', { d, 'stroke-width': wq })); d = ''; };
    for (const s of brushSegments(pts)) {
      const q = (Math.round(s.w * 4) / 4).toFixed(2);
      if (q !== wq) { flush(); wq = q; }
      d += `M${f(s.a[0])} ${f(s.a[1])}` + (s.c ? `Q${f(s.c[0])} ${f(s.c[1])} ${f(s.b[0])} ${f(s.b[1])}` : `L${f(s.b[0])} ${f(s.b[1])}`);
    }
    flush();
    return g;
  }

  function setupCanvas() {
    cv = $('.kw-canvas', body); ctx = cv.getContext('2d'); size = 0; // new canvas per kanji → always size it
    svgPad = $('.kw-svg', body);
    const fit = () => {
      const w = Math.round(cv.getBoundingClientRect().width);
      if (!w || w === size) return;
      size = w;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr);
      ctx.setTransform((w * dpr) / 109, 0, 0, (w * dpr) / 109, 0, 0);
      paintLive();
    };
    ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(cv); fit();
    const toPt = e => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * 109) / r.width, ((e.clientY - r.top) * 109) / r.height, e.timeStamp || performance.now()]; };
    const minStep = () => 109 / (cv.getBoundingClientRect().width || 109); // 1 CSS px in 109-units
    const add = (arr, p) => { const q = arr.at(-1); if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minStep()) arr.push(p); };
    cv.addEventListener('pointerdown', e => {
      if (!e.isPrimary || cur.done || !cur.strokes || e.button > 0) return;
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      const p = toPt(e), pend = cur.pending;
      if (pend) {
        clearTimeout(pend.timer);
        const last = pend.pieces.at(-1).at(-1);
        // lifted for a moment and continued near the last point → the same stroke
        if (performance.now() - pend.at <= STROKE.GRACE_MS && Math.hypot(p[0] - last[0], p[1] - last[1]) <= STROKE.JOIN_DIST) {
          cur.pending = null; cur.pieces = pend.pieces; cur.live = [p]; requestLive(); return;
        }
        cur.pending = null; evaluate(pend.pieces);
      }
      cur.pieces = []; cur.live = [p];
      requestLive();
    });
    cv.addEventListener('pointermove', e => {
      if (!cur.live || !e.isPrimary) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents?.() || [];
      for (const x of (evs.length ? evs : [e])) add(cur.live, toPt(x)); // no points lost, jitter < 1 px ignored
      requestLive();
    });
    const up = e => {
      if (!cur.live || !e.isPrimary) return;
      const pts = cur.live; cur.live = null;
      if (e.type === 'pointercancel') { cur.pieces = []; requestLive(); return; }
      add(pts, toPt(e));
      // not judged yet: the learner may continue the stroke within GRACE_MS (shown in white meanwhile)
      const pend = { pieces: [...(cur.pieces || []), pts], at: performance.now() };
      cur.pieces = null; cur.pending = pend;
      pend.timer = later(() => { if (cur.pending === pend) { cur.pending = null; evaluate(pend.pieces); } }, STROKE.GRACE_MS);
      requestLive();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('touchmove', e => e.preventDefault(), { passive: false }); // old iOS without touch-action support
  }

  /** Judge the pieces of one lift-and-continue stroke. All pieces together first; if that fails, the longest
   *  prefix of pieces that is a correct stroke is accepted and the rest is judged as the next stroke. */
  function evaluate(pieces) {
    const expected = cur.strokes.map(s => s.pts);
    const merged = pieces.flat();
    const r = judgeStroke(merged, expected, cur.idx);
    if (!r.ok && pieces.length > 1) {
      for (let n = pieces.length - 1; n >= 1; n--) {
        const head = pieces.slice(0, n).flat(), rh = judgeStroke(head, expected, cur.idx);
        if (rh.ok) { submit(head, rh); if (!cur.done) evaluate(pieces.slice(n)); return; }
      }
    }
    submit(merged, r);
  }

  function submit(pts, r) {
    cur.judged = (cur.judged || 0) + 1;
    window.__kwLast = { reason: r.reason || 'ok', ok: r.ok, idx: cur.idx, start: r.start, coverage: r.coverage, len: r.len, elen: r.elen, n: cur.judged };
    if (r.reason === 'tap') { requestLive(); return; }
    if (r.ok) {
      cur.user.push(pts); cur.idx++; cur.hint = false;
      addInk(pts, cur.idx - 1);
      if (cur.idx >= cur.strokes.length) complete();
    } else {
      cur.mistakes++;
      showWrong(pts, r.reason);
    }
    paintHint(); requestLive(); status_();
  }

  function finishEarly() {
    if (cur.done || !cur.strokes) return;
    if (cur.pending) { const p = cur.pending; clearTimeout(p.timer); cur.pending = null; evaluate(p.pieces); if (cur.done) return; }
    // «✓» before the last stroke: the missing strokes are shown and counted as mistakes
    cur.mistakes += cur.strokes.length - cur.idx;
    for (; cur.idx < cur.strokes.length; cur.idx++) { cur.user.push(null); addInk(null, cur.idx); }
    complete();
    paintHint(); requestLive(); status_();
  }

  function complete() {
    cur.done = true; cur.hint = false;
    $('[data-hint]', body).hidden = true; $('[data-ok]', body).hidden = true; $('[data-replay]', body).hidden = false;
    $('.kw-info', body).classList.remove('recall');
    $('.kw-diag', body).hidden = false;
    $$('.kw-mask', body).forEach(m => { m.textContent = cur.k.kanji; m.classList.remove('kw-mask'); });
    drawDiagram();
    showRating();
  }

  function showRating() {
    const s = sched[cur.k.id];
    rateBar.innerHTML = RATINGS.map((r, i) => `<button class="kw-r ${r.cls}" data-r="${r.key}"><small>${fmtInterval(nextInterval(s, r.key))}</small><b>${r.label}</b><kbd>${i + 1}</kbd></button>`).join('');
    rateBar.hidden = false; document.body.classList.add('kw-rating');
    $$('[data-r]', rateBar).forEach(b => (b.onclick = () => rate(b.dataset.r)));
  }
  function rate(r) {
    if (!cur?.done) return;
    sched = loadSched();
    sched[cur.k.id] = applyRating(sched[cur.k.id], r, cur.mistakes);
    saveSched(sched);
    skipped = skipped.filter(x => x !== cur.k.id);
    load(nextId());
  }

  // ▶ on the pad: the correct strokes drawn in one after another (the learner's ink is hidden meanwhile)
  async function replay() {
    if (!cur.strokes) return;
    replayToken.stop = true;
    const token = replayToken = { stop: false };
    $('.kw-replay', svgPad)?.remove();
    const g = mk('g', { class: 'kw-replay' });
    cur.strokes.forEach(s => g.append(mk('path', { d: s.d })));
    svgPad.append(g);
    svgPad.classList.add('replaying');
    await playSequence([...g.children], cur.strokes.map(s => s.len), token);
    if (replayToken !== token) return;
    g.remove(); svgPad.classList.remove('replaying');
  }

  // ----- SVG layer -----
  function paintGrid() {
    const g = $('.kw-grid', svgPad);
    for (const [v, strong] of [[109 / 4, 0], [109 / 2, 1], [(109 * 3) / 4, 0]]) {
      g.append(mk('line', { x1: v, y1: 0, x2: v, y2: 109, class: strong ? 'mid' : '' }), mk('line', { x1: 0, y1: v, x2: 109, y2: v, class: strong ? 'mid' : '' }));
    }
  }
  /** Grey outline of the expected next stroke: always for a new kanji, after «?» for a review. */
  function paintHint() {
    const g = svgPad && $('.kw-hint', svgPad);
    if (!g) return;
    const S = cur.strokes, show = S && !cur.done && cur.idx < S.length && (cur.isNew || cur.hint);
    const want = show ? S[cur.idx].d : '';
    if (g.dataset.d === want) return;
    g.dataset.d = want;
    g.replaceChildren(...(show ? [mk('path', { d: want })] : []));
  }
  /** Accepted stroke i (any kanji): the clean KanjiVG stroke is drawn in along its path while the learner's own
   *  ink (pts; null = revealed by «✓») fades out over the same time and is then removed. */
  function addInk(pts, i) {
    const s = cur.strokes[i];
    const clean = mk('path', { d: s.d, 'data-i': i, class: 'kw-clean' });
    $('.kw-ink', svgPad).append(clean);
    drawIn(clean, s.len);
    if (!pts) return;
    const ink = brushSVG(pts, 'kw-user');
    $('.kw-fades', svgPad).append(ink);
    if (reduceMotion()) { ink.remove(); return; }
    const a = ink.animate([{ opacity: 1 }, { opacity: 0 }], { duration: strokeMs(s.len), easing: 'ease-in-out', fill: 'forwards' });
    a.finished.then(() => ink.remove(), () => ink.remove());
  }
  /** Rejected stroke: the learner's line in red, held WRONG_HOLD_MS, then faded out over WRONG_FADE_MS. */
  function showWrong(pts, reason) {
    cur.wrong = { reason };
    const g = brushSVG(pts, 'kw-wrong');
    $('.kw-wrongs', svgPad).append(g);
    const gone = () => { g.remove(); if (!$('.kw-wrongs .kw-wrong', svgPad)) { cur.wrong = null; status_(); } };
    const a = g.animate([{ opacity: 0.92 }, { opacity: 0 }], { duration: ANIM.WRONG_FADE_MS, delay: ANIM.WRONG_HOLD_MS, easing: 'ease-in', fill: 'forwards' });
    a.finished.then(gone, gone);
  }

  // ----- live canvas: only the stroke being drawn (and pieces waiting in the grace period), once per frame -----
  function requestLive() {
    if (liveQueued) return;
    liveQueued = true;
    requestAnimationFrame(() => { liveQueued = false; if (alive) paintLive(); });
  }
  function paintLive() {
    if (!ctx || !size) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore();
    const lines = [...(cur.pending?.pieces || []), ...(cur.pieces || []), ...(cur.live ? [cur.live] : [])];
    if (!lines.length) return;
    ctx.save(); ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of lines) for (const sg of brushSegments(p)) {
      ctx.lineWidth = sg.w; ctx.beginPath(); ctx.moveTo(sg.a[0], sg.a[1]);
      if (sg.c) ctx.quadraticCurveTo(sg.c[0], sg.c[1], sg.b[0], sg.b[1]); else ctx.lineTo(sg.b[0], sg.b[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  function status_() {
    const el = $('[data-st]', body);
    if (!el) return;
    const n = cur.strokes?.length || cur.k.strokes;
    const why = { shape: 'не та риска', order: 'не той порядок', direction: 'не той напрямок', long: 'задовга риска' };
    el.textContent = cur.done
      ? `Готово · помилок: ${cur.mistakes}. Оцініть, наскільки легко було.`
      : `Риска ${Math.min(cur.idx + 1, n)} / ${n} · помилок: ${cur.mistakes}${cur.wrong ? ` · ${why[cur.wrong.reason] || 'помилка'}` : ''}`;
    $('[data-skip]', body).hidden = cur.done;
  }

  const onKey = e => {
    if (e.target.closest?.('input, textarea')) return;
    if (cur?.done && /^[1-4]$/.test(e.key)) rate(RATINGS[+e.key - 1].key);
    else if (e.key === '?' && !cur?.done) $('[data-hint]', body)?.click();
  };
  document.addEventListener('keydown', onKey);
  window.__kw = { // read-only hook for tools/qa-kanji-write.mjs
    get id() { return cur?.k.id; }, get idx() { return cur?.idx; }, get done() { return cur?.done; }, get mistakes() { return cur?.mistakes; },
    get strokes() { return cur?.strokes?.map(s => s.pts); }, get last() { return window.__kwLast; }, STROKE,
    get judged() { return cur?.judged || 0; }, get pending() { return !!cur?.pending; }, get wrongShown() { return !!document.querySelector('.kw-wrongs .kw-wrong'); },
    get paths() { return cur?.strokes?.map(s => s.d); },
  };

  load(nextId());
  return () => {
    alive = false; timers.forEach(clearTimeout); ro?.disconnect(); probe?.remove(); probe = null;
    document.removeEventListener('keydown', onKey); document.body.classList.remove('kw-rating');
  };
}
