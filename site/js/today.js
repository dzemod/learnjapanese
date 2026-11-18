// «Сьогодні» (home page panel + #/today session): what is due today, built only from data the site already stores —
//   words: progress jp.progress (lvl 0 new / 1 learning / 2 known, c/w counts, last answer time) → wordsDue();
//   kanji: the writing schedule jp.kanjiWrite (kanji-write.js, stroke-match.js status 'review' = due now);
//   exam:  saved mistakes jp.examMistakes («Додати до помилок»);
//   streak: the study-day log jp.days (store.js studyDays / streak).
// «Почати сесію» = a ≈ 15-minute mix in this order: due words (flashcards, recorded like the study modes), due kanji
// (recall → reveal with stroke order → the writing mode's ratings, same schedule), then the exam mistakes in the
// Exam's own runner. The session plan is kept in sessionStorage (jp.today.session), so a reload continues it.
import { $, $$, esc, I, plWord, speakCard } from './util.js';
import { getSets, prog, record, streak, markStudied, studiedToday } from './store.js';
import { loadKanji, books as kanjiBooks, kanjiVG } from './kanji.js';
import { RATINGS, applyRating, nextInterval, fmtInterval, status as kStatus, DAY } from './stroke-match.js';
import { startMistakesExam, savedMistakeList } from './exam.js';
import { kunHTML } from './modes.js';

// ---------- what is due ----------
export const RULES = {
  LEARNING_AFTER: 20 * 36e5, // a learning word (lvl 1) is due again the next day (20 h after its last answer)
  KNOWN_AFTER: 7 * DAY,      // a known word (lvl 2) is due a week after its last answer
  WRONG_AFTER: 10 * 6e4,     // a word answered wrong more often than right: due again after 10 minutes
};
export const BUDGET = { totalSec: 15 * 60, wordSec: 20, kanjiSec: 40, examSec: 45, wordCap: 0.5, kanjiCap: 0.35 };
const KW_KEY = 'jp.kanjiWrite';
const SESSION_KEY = 'jp.today.session';
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };
const sget = k => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
const sset = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } };

/** A word is due when it was studied before and its time has come (see RULES). Most overdue / most missed first. */
export function wordsDue(now = Date.now()) {
  const out = [];
  for (const s of getSets()) for (const c of s.cards) {
    const p = prog(s.id, c.id);
    if (!p.last || !(p.lvl >= 1 || p.w > 0)) continue;
    const age = now - p.last;
    const due = (p.w > p.c && age >= RULES.WRONG_AFTER) || (p.lvl === 1 && age >= RULES.LEARNING_AFTER) || (p.lvl >= 2 && age >= RULES.KNOWN_AFTER);
    if (due) out.push({ setId: s.id, cardId: c.id, score: (p.w - p.c) * 1e6 + age / 6e4 });
  }
  return out.sort((a, b) => b.score - a.score);
}
/** Kanji due for writing now (the writing mode's schedule), oldest due first. Needs kanji.json (loadKanji). */
export function kanjiDue(now = Date.now()) {
  const sched = lget(KW_KEY, {}) || {};
  const known = new Map();
  for (const b of kanjiBooks()) for (const l of b.lessons) for (const k of l.kanji) known.set(k.id, l.id);
  return Object.keys(sched).filter(id => known.has(id) && kStatus(sched[id], now) === 'review').sort((a, b) => sched[a].due - sched[b].due)
    .map(id => ({ id, lessonId: known.get(id) }));
}
export const examMistakes = () => { try { const l = savedMistakeList(); return Array.isArray(l) ? l : []; } catch { return []; } };

/** The session: due words, then kanji, then exam mistakes, within ≈ 15 minutes (BUDGET); leftover time → more words. */
export function planSession(words, kanji, mistakes, B = BUDGET) {
  let left = B.totalSec;
  const take = (n, cost, cap) => { const k = Math.max(0, Math.min(n, Math.floor(Math.min(cap, left) / cost))); left -= k * cost; return k; };
  let w = take(words.length, B.wordSec, B.totalSec * B.wordCap);
  const k = take(kanji.length, B.kanjiSec, B.totalSec * B.kanjiCap);
  const e = take(mistakes.length, B.examSec, Infinity);
  w += take(words.length - w, B.wordSec, Infinity); // time left over → more words
  return { words: words.slice(0, w).map(x => [x.setId, x.cardId]), kanji: kanji.slice(0, k).map(x => [x.lessonId, x.id]), exam: e, minutes: Math.round((B.totalSec - left) / 60) };
}

// ---------- the home page panel ----------
const n = (v, forms) => `${v} ${plWord(v, forms)}`;
export function todayPanel(slot) {
  const draw = (kanjiN, kanjiReady) => {
    const words = wordsDue(), mist = examMistakes(), st = streak();
    const any = words.length + kanjiN + mist.length;
    slot.innerHTML = `<section class="panel today" aria-labelledby="today-title">
      <div class="today-head"><h2 class="sec-title" id="today-title">Сьогодні</h2>
        <span class="today-streak ${studiedToday() ? 'on' : ''}" title="Дні поспіль, коли ви щось вивчили"><span class="streak-dot ${studiedToday() ? 'on' : ''}"></span><b data-t="streak">${st}</b> ${plWord(st, ['день', 'дні', 'днів'])} поспіль</span></div>
      <div class="today-grid">
        <a class="today-cell" href="#/" data-t-words><b data-t="words">${words.length}</b><span>${plWord(words.length, ['слово', 'слова', 'слів'])} на повторення</span></a>
        <a class="today-cell" href="#/kanji/write"><b data-t="kanji">${kanjiReady ? kanjiN : '…'}</b><span>${plWord(kanjiN, ['канджі', 'канджі', 'канджі'])} для письма</span></a>
        <a class="today-cell" href="#/exam"><b data-t="exam">${mist.length}</b><span>${plWord(mist.length, ['помилка', 'помилки', 'помилок'])} з екзамену</span></a>
      </div>
      ${any ? `<a class="btn primary today-start" href="#/today" data-start-today>Почати сесію <small>≈ 15 хв</small></a>` : `<p class="muted small today-empty">${studiedToday() ? 'На сьогодні все повторено. 🎉' : 'Поки нічого не треба повторювати: вивчіть кілька слів уроку або напишіть канджі — і вони з’являться тут.'}</p>`}
    </section>`;
  };
  draw(0, false);
  loadKanji().then(() => { if (slot.isConnected) { let k = 0; try { k = kanjiDue().length; } catch { k = 0; } draw(k, true); } });
}

// ---------- the session (#/today) ----------
function cardOf(setId, cardId) { const s = getSets().find(x => x.id === setId); return s && s.cards.find(c => c.id === cardId); }
function kanjiOf(lessonId, id) { for (const b of kanjiBooks()) for (const l of b.lessons) if (l.id === lessonId) return l.kanji.find(k => k.id === id); return null; }

export async function todaySessionView(root) {
  root.innerHTML = '<div class="loading"><span class="sun pulse"></span></div>';
  await loadKanji();
  let S = sget(SESSION_KEY);
  if (!S || !S.plan) {
    const plan = planSession(wordsDue(), kanjiDue(), examMistakes());
    S = { plan, i: 0, known: 0, at: Date.now() };
    sset(SESSION_KEY, S);
  }
  const items = [...S.plan.words.map(w => ({ t: 'w', w })), ...S.plan.kanji.map(k => ({ t: 'k', k })), ...(S.plan.exam ? [{ t: 'e', n: S.plan.exam }] : [])];
  const total = items.length;
  const save = () => sset(SESSION_KEY, S);

  function frame(inner) {
    const pct = total ? Math.round((Math.min(S.i, total) / total) * 100) : 100;
    root.innerHTML = `<div class="today-run fade-in">
      <div class="today-top"><a class="icon-btn" href="#/" aria-label="Завершити сесію" title="Завершити">${I.back}</a>
        <div class="bar today-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${Math.min(S.i, total)}" aria-label="Прогрес сесії"><i style="width:${pct}%"></i></div>
        <span class="muted small today-count">${Math.min(S.i + 1, total)} / ${total}</span></div>
      ${inner}</div>`;
  }
  const next = () => { S.i++; save(); draw(); };

  function draw() {
    if (!total) {
      frame(`<div class="empty"><div class="empty-jp" lang="ja">完</div><p>Сьогодні нічого не треба повторювати.</p><a class="btn primary" href="#/">На головну</a></div>`);
      sset(SESSION_KEY, null);
      return;
    }
    if (S.i >= total) {
      frame(`<div class="empty today-done"><div class="empty-jp" lang="ja">完</div><p>Сесію завершено: ${n(S.plan.words.length, ['слово', 'слова', 'слів'])}, ${n(S.plan.kanji.length, ['канджі', 'канджі', 'канджі'])}${S.plan.exam ? `, ${n(S.plan.exam, ['помилка', 'помилки', 'помилок'])} з екзамену` : ''}.</p><a class="btn primary" href="#/">На головну</a></div>`);
      sset(SESSION_KEY, null);
      return;
    }
    const it = items[S.i];
    if (it.t === 'w') return drawWord(...it.w);
    if (it.t === 'k') return drawKanji(...it.k);
    return drawExam(it.n);
  }

  // word: Ukrainian → «Показати» → Japanese with reading → Знав(ла) / Не знав(ла) (recorded like a study mode)
  function drawWord(setId, cardId) {
    const c = cardOf(setId, cardId);
    if (!c) return next();
    frame(`<section class="panel today-card"><p class="eyebrow">Слово · повторення</p>
      <div class="today-q">${esc(c.ukrainian)}${c.hint ? ` <span class="muted small">${esc(c.hint)}</span>` : ''}</div>
      <div class="today-a" hidden><div class="today-jp" lang="ja">${esc(c.japanese)}</div>${c.reading ? `<div class="muted" lang="ja">${esc(c.reading)}</div>` : ''}
        <button type="button" class="icon-btn" data-say aria-label="Прослухати">${I.speaker}</button></div>
      <div class="btn-row today-btns"><button type="button" class="btn primary wide" data-show>Показати</button></div></section>`);
    $('[data-show]', root).onclick = () => {
      $('.today-a', root).hidden = false;
      $('.today-btns', root).innerHTML = '<button type="button" class="btn ghost" data-no>Не знав(ла)</button><button type="button" class="btn primary" data-yes>Знав(ла)</button>';
      $('[data-say]', root).onclick = () => speakCard(c);
      $('[data-no]', root).onclick = () => { record(setId, cardId, false, 'write'); next(); };
      $('[data-yes]', root).onclick = () => { record(setId, cardId, true, 'write'); S.known++; next(); };
      $('[data-yes]', root).focus();
    };
  }
  // kanji: meaning + readings → write it (paper / air) → «Показати» (kanji + stroke order) → the writing mode's ratings
  function drawKanji(lessonId, id) {
    const k = kanjiOf(lessonId, id);
    if (!k) return next();
    frame(`<section class="panel today-card"><p class="eyebrow">Канджі · письмо</p>
      <div class="today-q">${esc(k.meaning)}</div>
      <div class="kw-rd">${k.on.length ? `<span class="kw-rl">Он</span>${k.on.map(r => `<span class="kw-chip" lang="ja">${esc(r)}</span>`).join('')}` : ''}${k.kun.length ? ` <span class="kw-rl">Кун</span>${k.kun.map(r => `<span class="kw-chip" lang="ja">${kunHTML(r)}</span>`).join('')}` : ''}</div>
      <p class="muted small">Напишіть канджі на папері або пальцем у повітрі, потім перевірте. <a href="#/kanji/write/${encodeURIComponent(lessonId)}/${encodeURIComponent(id)}">Писати на екрані</a></p>
      <div class="today-a" hidden><div class="today-kanji" lang="ja">${esc(k.kanji)}</div><svg class="today-kvg" viewBox="0 0 109 109" aria-label="Порядок рисок"></svg></div>
      <div class="btn-row today-btns"><button type="button" class="btn primary wide" data-show>Показати</button></div></section>`);
    $('[data-show]', root).onclick = () => {
      $('.today-a', root).hidden = false;
      kanjiVG(k.kanji).then(d => { const svg = $('.today-kvg', root); if (svg) svg.innerHTML = d.paths.map(p => `<path d="${esc(p)}"/>`).join(''); }).catch(() => {});
      const sched = lget(KW_KEY, {}) || {};
      $('.today-btns', root).innerHTML = `<div class="today-rate">${RATINGS.map(r => `<button type="button" class="kw-r ${r.cls}" data-r="${r.key}"><small>${fmtInterval(nextInterval(sched[id], r.key))}</small><b>${r.label}</b></button>`).join('')}</div>`;
      $$('[data-r]', root).forEach(b => (b.onclick = () => {
        const s = lget(KW_KEY, {}) || {};
        s[id] = applyRating(s[id], b.dataset.r, b.dataset.r === 'again' ? 1 : 0);
        lset(KW_KEY, s);
        markStudied();
        next();
      }));
    };
  }
  // exam mistakes: handed to the Exam's own runner (all question types); the session ends there
  function drawExam(count) {
    frame(`<section class="panel today-card"><p class="eyebrow">Екзамен · мої помилки</p>
      <p>Залишилося ${n(count, ['питання', 'питання', 'питань'])} з ваших збережених помилок. Вони відкриються в екзамені — з поясненнями після кожної відповіді.</p>
      <div class="btn-row"><button type="button" class="btn ghost" data-skip>Пропустити</button><button type="button" class="btn primary" data-exam>Відкрити екзамен</button></div></section>`);
    $('[data-skip]', root).onclick = next;
    $('[data-exam]', root).onclick = () => { const list = examMistakes().slice(0, count); S.i = total; save(); sset(SESSION_KEY, null); startMistakesExam(list); };
  }
  draw();
}
