// Kanji collection board (#/kanji/board[/k300|k700]): all kanji by lesson, each cell coloured by the writing
// schedule (localStorage jp.kanjiWrite, stroke-match.js status): new · learning · due · known (interval ≥ 1 day) ·
// mastered (interval ≥ MASTERED). A cell opens the kanji card. Pure part `levelOf` is tested by test-achievements.
import { $, $$, esc, I } from './util.js';
import { books, openKanji } from './kanji.js';
import { status, DAY } from './stroke-match.js';

export const MASTERED = 21 * DAY;
const LEVELS = [['new', 'нові'], ['learning', 'вчу'], ['review', 'на повторення'], ['known', 'знаю'], ['mastered', 'засвоєно (від 3 тижнів)']];
/** 'new' | 'learning' | 'review' | 'known' | 'mastered' */
export function levelOf(s, now = Date.now()) {
  const st = status(s, now);
  return st === 'known' && +s.interval >= MASTERED ? 'mastered' : st;
}
const sched = () => { try { return JSON.parse(localStorage.getItem('jp.kanjiWrite') || '{}') || {}; } catch { return {}; } };

export function kanjiBoardView(root, bookId = '') {
  const draw = () => {
    const S = sched(), now = Date.now();
    const bs = books().filter(b => b.lessons.length && (!bookId || b.id === bookId));
    const all = bs.flatMap(b => b.lessons.flatMap(l => l.kanji.map(k => ({ k, l, lv: levelOf(S[k.id], now) }))));
    const cnt = Object.fromEntries(LEVELS.map(([v]) => [v, all.filter(x => x.lv === v).length]));
    const got = all.length - cnt.new;
    root.innerHTML = `<div class="kb-page fade-in">
      <a class="back" href="#/kanji">${I.back}<span>Канджі</span></a>
      <section class="hero"><div><p class="eyebrow" lang="ja">漢字帳</p><h1>Колекція канджі</h1>
        <p class="muted">Написано ${got} з ${all.length} · засвоєно ${cnt.mastered}</p></div></section>
      <div class="seg kb-books">${[['', 'Усі'], ...books().filter(b => b.lessons.length).map(b => [b.id, b.title])].map(([v, t]) => `<a class="${v === bookId ? 'on' : ''}" href="#/kanji/board${v ? '/' + v : ''}">${esc(t)}</a>`).join('')}</div>
      <div class="kb-legend" aria-label="Позначення">${LEVELS.map(([v, t]) => `<span><i class="kb-c ${v}"></i>${t} <b>${cnt[v]}</b></span>`).join('')}</div>
      <div class="bar kb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${all.length}" aria-valuenow="${got}" aria-label="Написано канджі"><i style="width:${all.length ? (got / all.length) * 100 : 0}%"></i></div>
      ${bs.map(b => b.lessons.map(l => `<section class="kb-lesson"><h2 class="kb-lt"><a href="#/kanji/${encodeURIComponent(l.id)}">${l.no}課 <span lang="ja">${esc(l.title)}</span></a> <span class="muted small">${esc(l.titleUk || '')}</span></h2>
        <div class="kb-grid">${l.kanji.map(k => { const lv = levelOf(S[k.id], now); return `<button type="button" class="kb-c ${lv}" data-l="${esc(l.id)}" data-k="${esc(k.id)}" lang="ja" title="${esc(k.meaning)} · ${LEVELS.find(x => x[0] === lv)[1]}" aria-label="${esc(k.kanji)} — ${esc(k.meaning)}, ${LEVELS.find(x => x[0] === lv)[1]}">${esc(k.kanji)}</button>`; }).join('')}</div></section>`).join('')).join('')}
    </div>`;
    $$('.kb-grid .kb-c', root).forEach(b => (b.onclick = () => openKanji(b.dataset.l, b.dataset.k, draw)));
  };
  draw();
  const onFocus = () => { if ($('.kb-page', root)) draw(); };
  addEventListener('focus', onFocus);
  return () => removeEventListener('focus', onFocus);
}
