// Kanji writing mode (#/kanji/write[/<book|lesson>[/<kanjiId>]]), modeled on Kanji Dojo:
// demonstration (coloured stroke diagram, ▶ replay) → the learner writes every stroke on a grid canvas →
// rating Ще раз / Важко / Добре / Легко sets the next review time (localStorage `jp.kanjiWrite`).
// Stroke data: KanjiVG through kanjiVG() of kanji.js (the same source as the stroke-order animation).
import { $, $$, esc, I } from './util.js';
import { books, kanjiVG } from './kanji.js';
import { kunHTML } from './modes.js';
import {
  STROKE, WRONG_MS, judgeStroke, RATINGS, nextInterval, applyRating, counts, buildQueue, fmtInterval,
} from './stroke-match.js';

const KEY = 'jp.kanjiWrite';
// Stroke colours of the diagram: red, orange, yellow, green, … (repeats after 10)
const PALETTE = ['#e5484d', '#f08c3a', '#f2c94c', '#5ec26a', '#2bb3a3', '#3b9ae1', '#6e6ae8', '#b45ce0', '#e0589c', '#9aa0a6'];
const INK = '#f5f1ea', RED = '#e5484d', HINT = 'rgba(245, 241, 234, .28)';
const STROKE_W = 3.2; // ink width in 109-units

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
    cur = { k, isNew, strokes: null, idx: 0, mistakes: 0, user: [], live: null, wrong: null, hint: false, done: false, replay: null };
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
        <canvas class="kw-canvas" aria-label="Поле для письма"></canvas>
        <button class="kw-btn kw-hint" data-hint aria-label="Показати штрих" title="Показати штрих">?</button>
        <button class="kw-btn kw-play" data-replay aria-label="Повторити" title="Повторити" hidden>▶</button>
        <button class="kw-btn kw-ok" data-ok aria-label="Готово" title="Готово"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></button>
      </div>
      <div class="kw-status small muted" aria-live="polite"><span data-st></span><button class="btn ghost sm" data-skip>Далі</button></div>`;
    $('[data-skip]', body).onclick = () => { skipped.push(id); load(nextId()); };
    $('[data-hint]', body).onclick = () => { if (!cur.done) { cur.hint = true; draw(); } };
    $('[data-ok]', body).onclick = finishEarly;
    $('[data-replay]', body).onclick = replay;
    $('[data-demo]', body).onclick = demo;
    setupCanvas();
    status_();
    kanjiVG(k.kanji).then(d => {
      if (!alive || cur.k !== k) return;
      if (!d.paths.length) throw new Error('empty');
      cur.strokes = samplePaths(d.paths);
      drawDiagram();
      if (isNew) demo();
      draw(); status_();
    }).catch(() => {
      if (cur.k !== k) return;
      $('.kw-pad', body).innerHTML = '<div class="so-missing muted small">Дані рисок недоступні (немає з’єднання або символу немає в KanjiVG).</div>';
    });
  }

  // ----- coloured stroke diagram (Step A) -----
  function drawDiagram() {
    const svg = $('.kw-diag svg', body);
    if (!svg) return;
    svg.innerHTML = cur.strokes.map((s, i) => `<path d="${esc(s.d)}" stroke="${PALETTE[i % PALETTE.length]}" data-i="${i}"/>`).join('');
  }
  async function demo() {
    const ps = $$('.kw-diag path', body);
    if (!ps.length) return;
    const k = cur.k, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ps.forEach(p => { p.getAnimations().forEach(a => a.cancel()); p.classList.remove('cur'); p.style.strokeDasharray = cur.strokes[+p.dataset.i].len + 1; p.style.strokeDashoffset = reduce ? 0 : cur.strokes[+p.dataset.i].len + 1; });
    if (reduce) return;
    for (const p of ps) {
      if (!alive || cur.k !== k) return;
      const len = cur.strokes[+p.dataset.i].len + 1;
      p.classList.add('cur');
      const a = p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: Math.max(220, len * 7), easing: 'ease-in-out', fill: 'forwards' });
      try { await a.finished; } catch { return; }
      p.style.strokeDashoffset = 0; a.cancel();
      p.classList.remove('cur');
    }
  }

  // ----- canvas (Step B) -----
  let cv, ctx, size = 0;
  function setupCanvas() {
    cv = $('.kw-canvas', body); ctx = cv.getContext('2d'); size = 0; // new canvas per kanji → always size it
    const fit = () => {
      const w = Math.round(cv.getBoundingClientRect().width);
      if (!w || w === size) return;
      size = w;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr);
      ctx.setTransform((w * dpr) / 109, 0, 0, (w * dpr) / 109, 0, 0);
      draw();
    };
    ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(cv); fit();
    const toPt = e => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * 109) / r.width, ((e.clientY - r.top) * 109) / r.height]; };
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
          cur.pending = null; cur.pieces = pend.pieces; cur.live = [p]; draw(); return;
        }
        cur.pending = null; evaluate(pend.pieces);
      }
      cur.pieces = []; cur.live = [p];
      draw();
    });
    cv.addEventListener('pointermove', e => {
      if (!cur.live || !e.isPrimary) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents?.() || [e];
      for (const x of (evs.length ? evs : [e])) cur.live.push(toPt(x));
      draw();
    });
    const up = e => {
      if (!cur.live || !e.isPrimary) return;
      const pts = cur.live; cur.live = null;
      if (e.type === 'pointercancel') { cur.pieces = []; draw(); return; }
      pts.push(toPt(e));
      // not judged yet: the learner may continue the stroke within GRACE_MS (shown in white meanwhile)
      const pend = { pieces: [...(cur.pieces || []), pts], at: performance.now() };
      cur.pieces = null; cur.pending = pend;
      pend.timer = later(() => { if (cur.pending === pend) { cur.pending = null; evaluate(pend.pieces); } }, STROKE.GRACE_MS);
      draw();
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
    let r = judgeStroke(merged, expected, cur.idx);
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
    if (r.reason === 'tap') { draw(); return; }
    if (r.ok) {
      cur.user.push(pts); cur.idx++; cur.hint = false;
      if (cur.idx >= cur.strokes.length) complete();
    } else {
      cur.mistakes++;
      cur.wrong = { pts, reason: r.reason, at: performance.now() };
      const w = cur.wrong;
      later(() => { if (cur.wrong === w) { cur.wrong = null; draw(); } }, WRONG_MS);
    }
    draw(); status_();
  }

  function finishEarly() {
    if (cur.done || !cur.strokes) return;
    if (cur.pending) { const p = cur.pending; clearTimeout(p.timer); cur.pending = null; evaluate(p.pieces); if (cur.done) return; }
    // «✓» before the last stroke: the missing strokes are shown and counted as mistakes
    const left = cur.strokes.length - cur.idx;
    cur.mistakes += left;
    for (; cur.idx < cur.strokes.length; cur.idx++) cur.user.push(null);
    complete();
    draw(); status_();
  }

  function complete() {
    cur.done = true; cur.wrong = null; cur.hint = false;
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

  function replay() {
    if (!cur.strokes) return;
    const k = cur.k, t0 = performance.now(), per = cur.strokes.map(s => Math.max(220, s.len * 7));
    const total = per.reduce((a, b) => a + b, 0);
    cur.replay = { t: 0 };
    const step = () => {
      if (!alive || cur.k !== k || !cur.replay) return;
      cur.replay.t = performance.now() - t0;
      draw();
      if (cur.replay.t < total) requestAnimationFrame(step); else { cur.replay = null; draw(); }
    };
    cur.replay.per = per;
    requestAnimationFrame(step);
  }

  function line(pts, color, w = STROKE_W, alpha = 1) {
    if (!pts?.length) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke(); ctx.restore();
  }
  function pathStroke(s, color, w = STROKE_W, frac = 1) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (frac < 1) { ctx.setLineDash([s.len + 1, s.len + 1]); ctx.lineDashOffset = (s.len + 1) * (1 - frac); }
    ctx.stroke(new Path2D(s.d)); ctx.restore();
  }
  function grid() {
    ctx.save(); ctx.lineWidth = 0.35;
    for (const [v, strong] of [[109 / 4, 0], [109 / 2, 1], [(109 * 3) / 4, 0]]) {
      ctx.strokeStyle = strong ? 'rgba(220, 200, 205, .55)' : 'rgba(220, 200, 205, .28)';
      ctx.setLineDash(strong ? [2.4, 1.6] : [1.6, 1.6]);
      ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, 109); ctx.moveTo(0, v); ctx.lineTo(109, v); ctx.stroke();
    }
    ctx.restore();
  }
  function draw() {
    if (!ctx || !size) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore();
    grid();
    const S = cur.strokes;
    if (cur.replay && S) {
      let t = cur.replay.t;
      S.forEach((s, i) => { const f = Math.max(0, Math.min(1, t / cur.replay.per[i])); t -= cur.replay.per[i]; if (f > 0) pathStroke(s, INK, STROKE_W, f); });
      return;
    }
    if (S && !cur.done && cur.idx < S.length && (cur.isNew || cur.hint)) pathStroke(S[cur.idx], HINT, STROKE_W + 0.6);
    cur.user.forEach((p, i) => (p ? line(p, INK) : S && pathStroke(S[i], INK)));
    if (cur.wrong) line(cur.wrong.pts, RED, STROKE_W, 0.9);
    cur.pending?.pieces.forEach(p => line(p, INK));
    cur.pieces?.forEach(p => line(p, INK));
    if (cur.live) line(cur.live, INK);
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
    get judged() { return cur?.judged || 0; }, get pending() { return !!cur?.pending; }, get wrongShown() { return !!cur?.wrong; },
  };

  load(nextId());
  return () => {
    alive = false; timers.forEach(clearTimeout); ro?.disconnect(); probe?.remove(); probe = null;
    document.removeEventListener('keydown', onKey); document.body.classList.remove('kw-rating');
  };
}
