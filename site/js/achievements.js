// Achievements, study heatmap and streak freezes (#/achievements).
// Rules: ach-rules.js (pure). Streak + freezes: streak-calc.js (pure, derived from jp.days). Stats are read only from
// data the site already keeps — jp.progress, jp.kanjiWrite, jp.kanjiNotes, jp.examHistory, jp.examMistakes.clearedAt,
// jp.best, jp.days, jp.activity — plus two counters in jp.ach.counts (finished «Сьогодні» sessions, Сенсей replies).
// Stored: jp.achievements = { id: unlock time } (synced, earliest wins). Checks run after every study action
// (event kotoba:studied), on navigation and after a progress sync; a new badge shows a small pop-up.
import { $, esc, plWord, I } from './util.js';
import { state, getSets, streakData, activity, studyTime, getGoal } from './store.js';
import { goalDays } from './goal.js';
import { ACHIEVEMENTS, GROUPS, newlyUnlocked, progressOf, value, timeStats } from './ach-rules.js';
import { FREEZE } from './streak-calc.js';

export const KEYS = { unlocked: 'jp.achievements', counts: 'jp.ach.counts', kanji: 'jp.kanjiWrite', notes: 'jp.kanjiNotes', history: 'jp.examHistory', cleared: 'jp.examMistakes.clearedAt' };
const DAY = 864e5;
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) ?? d; } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: kept in memory only */ } };
let memUnlocked = null; // fallback when localStorage is blocked
const getUnlocked = () => lget(KEYS.unlocked, null) || memUnlocked || {};
const setUnlocked = v => { memUnlocked = v; lset(KEYS.unlocked, v); };

/** Counters that no other data records: 'todayDone' (finished «Сьогодні» sessions), 'sensei' (Сенсей replies),
 *  'conj' (right answers in the conjugation drill). */
export function bump(name) {
  const c = lget(KEYS.counts, {}) || {};
  c[name] = (+c[name] || 0) + 1;
  lset(KEYS.counts, c);
  checkSoon(true);
}

const isKanjiSetId = id => /^k(300|700)-\d+(-w)?$/.test(id);
const lessonNo = id => { const m = /^mnn-(\d+)$/.exec(id); return m ? +m[1] : -1; };

/** Everything the rules look at (ach-rules.js `stat` names). */
export function gatherStats(now = new Date()) {
  const P = state.progress || {};
  let words = 0, mineWords = 0;
  for (const [k, p] of Object.entries(P)) {
    const setId = k.slice(0, k.indexOf('/'));
    if (!p || p.lvl < 2 || isKanjiSetId(setId)) continue;
    words++;
    if (setId.startsWith('my-')) mineWords++;
  }
  let lessonsDone = 0, part1 = 0, part2 = 0;
  for (const s of getSets()) {
    const no = lessonNo(s.id);
    if (no < 0 || !s.cards.length) continue;
    if (!s.cards.every(c => (P[`${s.id}/${c.id}`]?.lvl || 0) >= 2)) continue;
    lessonsDone++;
    if (no <= 25) part1++; else part2++;
  }
  const kw = lget(KEYS.kanji, {}) || {};
  let kanjiWritten = 0, kanjiKnown = 0, kanjiEasy = 0;
  for (const s of Object.values(kw)) {
    if (!s || !(+s.reps > 0 || s.rating)) continue;
    kanjiWritten++;
    if (+s.interval >= DAY) kanjiKnown++;
    if (s.rating === 'easy') kanjiEasy++;
  }
  const notes = Object.values(lget(KEYS.notes, {}) || {}).filter(n => n && String(n.t || '').trim()).length;
  const hist = lget(KEYS.history, []) || [];
  let exams = 0, examBest = 0, univBest = 0, tsPerfect = 0;
  for (const h of Array.isArray(hist) ? hist : []) {
    if (!h) continue;
    exams++;
    if (h.univ) univBest = Math.max(univBest, +h.ok || 0);
    else if (+h.n >= 10) examBest = Math.max(examBest, +h.pct || 0);
    const ts = h.byType?.ts;
    if (ts && +ts.n >= 5 && +ts.ok >= +ts.n) tsPerfect = 1;
  }
  const st = streakData();
  const counts = lget(KEYS.counts, {}) || {};
  return {
    best: st.best, streak: st.streak, days: st.total, freezeUsed: st.freezeUsed, comeback: st.comeback,
    words, mineWords, lessonsDone, part1, part2, kanjiWritten, kanjiKnown, kanjiEasy, notes,
    exams, examBest, univBest, tsPerfect, mistakesCleared: (+lget(KEYS.cleared, 0) || 0) > 0 ? 1 : 0,
    records: Object.keys(state.best || {}).length, todayDone: +counts.todayDone || 0, sensei: +counts.sensei || 0, conj: +counts.conj || 0, goalDays: goalDays(studyTime(), getGoal()).length,
    ...timeStats(now),
  };
}

// ---------- checking + pop-up ----------
let timer = null, pendingEvent = false;
export function checkSoon(event = false) {
  pendingEvent ||= event;
  clearTimeout(timer);
  timer = setTimeout(() => { const e = pendingEvent; pendingEvent = false; checkNow({ event: e }); }, 400);
}
/** Unlock what is met. Returns the new ids. The first run ever unlocks quietly and shows one summary. */
export function checkNow({ event = false } = {}) {
  let stats;
  try { stats = gatherStats(); } catch (e) { console.warn('achievements:', e); return []; }
  const first = lget(KEYS.unlocked, null) == null && memUnlocked == null;
  const un = { ...getUnlocked() };
  const ids = newlyUnlocked(stats, un, { event });
  if (!ids.length) { if (first) setUnlocked(un); return []; }
  const at = Date.now();
  ids.forEach(id => (un[id] = at));
  setUnlocked(un);
  if (first && ids.length > 1) pop({ jp: '実', t: `У вас уже ${ids.length} ${plWord(ids.length, ['досягнення', 'досягнення', 'досягнень'])}`, tier: 2 }, 'Подивіться, що вже відкрито');
  else ids.slice(0, 3).forEach((id, i) => setTimeout(() => pop(ACHIEVEMENTS.find(a => a.id === id)), i * 2600));
  document.querySelectorAll('.today-ach [data-ach-n]').forEach(b => (b.textContent = summary().n)); // «Сьогодні» panel line
  document.dispatchEvent(new CustomEvent('kotoba:achievements'));
  return ids;
}
function pop(a, sub = 'Нове досягнення') {
  if (!a || typeof document === 'undefined') return;
  document.querySelector('.ach-pop')?.remove();
  const el = document.createElement('a');
  el.className = `ach-pop tier-${a.tier || 1}`;
  el.href = '#/achievements';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="ach-badge sm" lang="ja">${esc(a.jp)}</span><span><small>${esc(sub)}</small><b>${esc(a.t)}</b></span>`;
  el.onclick = () => el.remove();
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 4200);
}

export function initAchievements() {
  document.addEventListener('kotoba:studied', () => checkSoon(true));
  document.addEventListener('kotoba:progress-synced', () => checkSoon(false));
  window.addEventListener('hashchange', () => checkSoon(false));
  checkSoon(false);
}
export const summary = () => ({ n: Object.keys(getUnlocked()).filter(id => ACHIEVEMENTS.some(a => a.id === id)).length, total: ACHIEVEMENTS.length });

// ---------- heatmap ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const LEVELS = [1, 6, 21, 51]; // actions per day → colour level 1–4
export const levelOf = n => (n >= LEVELS[3] ? 4 : n >= LEVELS[2] ? 3 : n >= LEVELS[1] ? 2 : n >= LEVELS[0] ? 1 : 0);
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
const WD = ['пн', '', 'ср', '', 'пт', '', ''];

function heatmapHTML(weeks) {
  const act = activity(), days = new Set(state.days), frozen = new Set(streakData().frozen);
  const now = new Date(), todayS = ymd(now);
  const start = new Date(now); start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7); // Monday, `weeks` weeks ago
  let cells = '', months = '', nDays = 0, nAct = 0;
  for (let w = 0; w < weeks; w++) {
    const wd = new Date(start); wd.setDate(start.getDate() + w * 7);
    months += `<span>${wd.getDate() <= 7 && w < weeks - 1 ? MONTHS[wd.getMonth()] : ''}</span>`; // the week a month starts in
    for (let i = 0; i < 7; i++) {
      const d = new Date(wd); d.setDate(wd.getDate() + i);
      const s = ymd(d);
      if (s > todayS) { cells += '<i class="hm-c out"></i>'; continue; }
      const n = +act[s] || 0, studied = days.has(s);
      const lv = n ? levelOf(n) : studied ? 1 : 0;
      if (studied) nDays++;
      nAct += n;
      const label = `${d.getDate()} ${MONTHS[d.getMonth()]}: ${frozen.has(s) ? 'заморозка' : n ? `${n} ${plWord(n, ['дія', 'дії', 'дій'])}` : studied ? 'навчання' : 'без навчання'}`;
      cells += `<i class="hm-c l${lv}${frozen.has(s) ? ' fz' : ''}${s === todayS ? ' now' : ''}" title="${label}"></i>`;
    }
  }
  return `<div class="hm" style="--w:${weeks}">
      <div class="hm-months">${months}</div>
      <div class="hm-wd">${WD.map(x => `<span>${x}</span>`).join('')}</div>
      <div class="hm-grid" role="img" aria-label="Календар навчання за ${weeks} ${plWord(weeks, ['тиждень', 'тижні', 'тижнів'])}: ${nDays} ${plWord(nDays, ['день', 'дні', 'днів'])} навчання">${cells}</div>
    </div>
    <div class="hm-foot"><span class="muted small">${nDays} ${plWord(nDays, ['день', 'дні', 'днів'])} навчання${nAct ? ` · ${nAct} ${plWord(nAct, ['дія', 'дії', 'дій'])}` : ''}</span>
      <span class="hm-legend small muted">менше ${[0, 1, 2, 3, 4].map(l => `<i class="hm-c l${l}"></i>`).join('')} більше <i class="hm-c fz"></i> заморозка</span></div>`;
}

// ---------- page ----------
const TIER = ['', 'бронза', 'срібло', 'золото'];
const fmtDay = t => new Date(t).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

export function achievementsView(root) {
  checkNow({ event: false });
  const stats = gatherStats(), st = streakData(), un = getUnlocked(), sum = summary();
  const card = a => {
    const got = !!un[a.id];
    if (a.hidden && !got) return `<div class="ach-card locked secret"><span class="ach-badge" lang="ja">？</span><div><b>Таємне досягнення</b><p class="muted small">Відкриється само, коли ви його заслужите.</p></div></div>`;
    const v = Math.min(value(a, stats), a.goal), pct = Math.round(progressOf(a, stats) * 100);
    return `<div class="ach-card tier-${a.tier} ${got ? 'got' : 'locked'}">
      <span class="ach-badge" lang="ja">${esc(a.jp)}</span>
      <div class="ach-txt"><b>${esc(a.t)}</b><p class="muted small">${esc(a.d)}</p>
        ${got ? `<p class="ach-when small"><span class="ach-tier">${TIER[a.tier]}</span> · ${esc(fmtDay(un[a.id]))}</p>`
          : a.goal > 1 ? `<div class="ach-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${a.goal}" aria-valuenow="${v}" aria-label="${esc(a.t)}"><i style="width:${pct}%"></i></div><p class="muted small ach-num">${v} / ${a.goal}</p>` : ''}
      </div></div>`;
  };
  const freezes = Array.from({ length: FREEZE.max }, (_, i) => `<span class="fz-ic ${i < st.freezes ? 'on' : ''}" aria-hidden="true">❄</span>`).join('');
  root.innerHTML = `<div class="ach-page fade-in">
    <a class="back" href="#/">${I.back}<span>Головна</span></a>
    <section class="hero"><div><p class="eyebrow" lang="ja">実績</p><h1>Досягнення</h1>
      <p class="muted">Відкрито ${sum.n} з ${sum.total}</p></div></section>
    <div class="ach-top">
      <section class="panel ach-streak" aria-labelledby="ach-st">
        <h2 class="sec-title" id="ach-st">Серія</h2>
        <div class="ach-st-row"><div class="ach-st-num"><b>${st.streak}</b><span>${plWord(st.streak, ['день', 'дні', 'днів'])} поспіль</span></div>
          <div class="ach-st-side"><div>Рекорд: <b>${st.best}</b></div><div>Усього днів: <b>${st.total}</b></div></div></div>
        <div class="fz-row"><span class="fz-icons" title="Заморозки серії">${freezes}</span>
          <span class="small">${st.freezes ? `${st.freezes} ${plWord(st.freezes, ['заморозка', 'заморозки', 'заморозок'])} серії` : 'Заморозок поки немає'}</span></div>
        <p class="muted small">Кожні ${FREEZE.every} днів навчання дають заморозку (до ${FREEZE.max}). Якщо пропустите день, заморозка спрацює сама, і серія не обірветься.
          ${st.nextFreezeIn ? `Наступна через ${st.nextFreezeIn} ${plWord(st.nextFreezeIn, ['день', 'дні', 'днів'])} навчання.` : 'У вас максимум заморозок.'}</p>
      </section>
      <section class="panel ach-heat" aria-labelledby="ach-hm"><h2 class="sec-title" id="ach-hm">Календар навчання</h2><div class="hm-slot"></div>
        <p class="small"><a class="link" href="#/week/0">Підсумки тижнів</a></p></section>
    </div>
    ${GROUPS.map(([g, title, jp]) => {
      const list = ACHIEVEMENTS.filter(a => a.g === g);
      const got = list.filter(a => un[a.id]).length;
      return `<section class="ach-group"><h2 class="group-title"><span lang="ja">${jp}</span> ${title} <span class="muted small">${got} / ${list.length}</span></h2>
        <div class="ach-grid">${list.map(card).join('')}</div></section>`;
    }).join('')}
  </div>`;
  const slot = $('.hm-slot', root);
  let lastW = 0;
  const fit = () => {
    if (!slot.isConnected) return;
    const w = Math.max(10, Math.min(53, Math.floor((slot.clientWidth - 26) / 15)));
    if (w !== lastW) { lastW = w; slot.innerHTML = heatmapHTML(w); }
  };
  fit();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  ro?.observe(slot);
  const redraw = () => { if (root.isConnected && $('.ach-page', root)) achievementsView(root); };
  document.addEventListener('kotoba:achievements', redraw);
  return () => { ro?.disconnect(); document.removeEventListener('kotoba:achievements', redraw); };
}

/** Small line for the «Сьогодні» panel. */
export function todayLineHTML() {
  const s = summary(), st = streakData();
  return `<a class="today-ach" href="#/achievements"><span class="ach-badge xs" lang="ja">実</span><span>Досягнення <b data-ach-n>${s.n}</b> / ${s.total}</span>${st.freezes ? `<span class="today-fz" title="Заморозки серії">❄ ${st.freezes}</span>` : ''}<span class="today-ach-go" aria-hidden="true">›</span></a>`;
}
