// Weekly summary UI: a card on the home page (Monday–Wednesday, about last week, «✕» hides it for that week —
// localStorage jp.week.seen) and the page #/week[/<offset>] (0 = this week so far, -1 = last week, …).
// Numbers: week.js summarize(); the weakest grammar point links to its grammar page.
import { $, esc, I, plWord } from './util.js';
import { studyDays, activity, studyTime, state } from './store.js';
import { summarize, weekStart, showCard } from './week.js';
import { loadGrammar, grammarLessons } from './grammar.js';

const SEEN = 'jp.week.seen';
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const dayTxt = s => { const [, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const range = w => `${dayTxt(w.from)} – ${dayTxt(w.to)}`;
const n = (v, f) => `${v} ${plWord(v, f)}`;

export function weekData(offset) {
  const data = { days: studyDays(), time: studyTime(), activity: activity(), progress: state.progress, kanji: lget('jp.kanjiWrite', {}) || {}, history: lget('jp.examHistory', []) || [] };
  return summarize(data, weekStart(new Date(), offset));
}
const pointTitle = w => {
  const L = grammarLessons().find(l => l.lesson === w.lesson);
  const i = L ? L.points.findIndex(p => p.id === w.point) : -1;
  return i >= 0 ? { no: i + 1, title: L.points[i].title.replace(/\{([^|}]+)\|[^}]+\}/g, '$1') } : null;
};
const delta = (a, b) => (b == null ? '' : a > b ? `<span class="wk-up" title="більше, ніж тижнем раніше">▲ ${a - b}</span>` : a < b ? `<span class="wk-down" title="менше, ніж тижнем раніше">▼ ${b - a}</span>` : '');

function statsHTML(w, prev) {
  const cells = [
    [w.days + ' / 7', 'днів навчання', ''],
    [w.minutes, plWord(w.minutes, ['хвилина', 'хвилини', 'хвилин']), delta(w.minutes, prev?.minutes)],
    [w.words.reviewed, plWord(w.words.reviewed, ['слово повторено', 'слова повторено', 'слів повторено']), w.words.known ? `<small class="muted">вивчено ${w.words.known}</small>` : ''],
    [w.kanji, plWord(w.kanji, ['канджі написано', 'канджі написано', 'канджі написано']), ''],
    [w.exams.n, plWord(w.exams.n, ['екзамен', 'екзамени', 'екзаменів']), w.exams.avg != null ? `<small class="muted">у середньому ${w.exams.avg}%</small>` : ''],
  ];
  return `<div class="wk-grid">${cells.map(([v, l, x]) => `<div class="wk-cell"><b>${v}</b><span>${l}</span>${x}</div>`).join('')}</div>`;
}
function weakHTML(w) {
  if (!w.weak) return '';
  const t = pointTitle(w.weak);
  const href = `#/grammar/${w.weak.lesson}${w.weak.point ? '/' + encodeURIComponent(w.weak.point) : ''}`;
  return `<div class="wk-weak"><span class="muted small">Найчастіші помилки (${n(w.weak.n, ['раз', 'рази', 'разів'])}):</span>
    <b>Урок ${w.weak.lesson}${t ? `, пункт ${t.no} «${esc(t.title)}»` : ''}</b>
    <div class="btn-row"><a class="btn primary sm" href="${href}">Повторити граматику</a><a class="btn ghost sm" href="#/exam">Екзамен з цього уроку</a></div></div>`;
}

/** Home page: the card about last week (or nothing). */
export function mountWeekCard(slot) {
  const w = weekData(-1);
  if (!showCard(new Date(), w, lget(SEEN, ''))) { slot.innerHTML = ''; return; }
  const draw = () => {
    slot.innerHTML = `<section class="panel wk-card" aria-labelledby="wk-t"><div class="wk-head"><h2 class="sec-title" id="wk-t">Ваш тиждень <span class="muted small">${range(w)}</span></h2>
      <button type="button" class="icon-btn sm" data-wk-hide aria-label="Сховати до наступного тижня" title="Сховати">${I.close}</button></div>
      ${statsHTML(w, weekData(-2))}${weakHTML(w)}
      <a class="link small" href="#/week/-1">Детальніше</a></section>`;
    $('[data-wk-hide]', slot).onclick = () => { lset(SEEN, w.from); slot.innerHTML = ''; };
  };
  draw();
  if (w.weak) loadGrammar().then(() => { if (slot.isConnected && slot.firstChild) draw(); });
}

/** #/week[/offset] */
export async function weekView(root, offsetStr = '0') {
  const off = Math.min(0, Math.max(-52, parseInt(offsetStr, 10) || 0));
  root.innerHTML = '<div class="loading"><span class="sun pulse"></span></div>';
  await loadGrammar();
  const w = weekData(off), prev = weekData(off - 1);
  root.innerHTML = `<div class="wk-page fade-in">
    <a class="back" href="#/achievements">${I.back}<span>Досягнення</span></a>
    <section class="hero"><div><p class="eyebrow" lang="ja">週間</p><h1>${off === 0 ? 'Цей тиждень' : off === -1 ? 'Минулий тиждень' : 'Тиждень'}</h1><p class="muted">${range(w)}${off === 0 ? ' · поки що' : ''}</p></div></section>
    <div class="wk-nav"><a class="btn ghost sm" href="#/week/${off - 1}">${I.left}<span>Раніше</span></a>${off < 0 ? `<a class="btn ghost sm" href="#/week/${off + 1}"><span>Пізніше</span>${I.right}</a>` : ''}</div>
    <section class="panel">${statsHTML(w, prev)}
      ${w.days ? '' : '<p class="muted small">Цього тижня ще немає навчання.</p>'}
      ${weakHTML(w)}</section>
  </div>`;
}
