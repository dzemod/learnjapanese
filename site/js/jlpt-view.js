// «JLPT» page (#/jlpt): progress towards each level N5–N1 from data the site already has —
//   words: the level lists (jlpt.js) matched with the cards of my lessons; known = lvl 2, learning = answered,
//          «у ваших уроках» = in a lesson but not studied yet, the rest is not in my lessons (links to the dictionary);
//   kanji: the level lists matched with the kanji books; status from the writing schedule jp.kanjiWrite
//          (kanji-board.js levelOf: mastered = interval ≥ 3 weeks).
import { $$, esc, I } from './util.js';
import { getSets, prog } from './store.js';
import { loadKanji, books as kanjiBooks } from './kanji.js';
import { levelOf } from './kanji-board.js';
import { loadJlpt, jlptLists, wordKey, LEVELS } from './jlpt.js';

export const LEVEL_NAMES = { 5: 'початковий', 4: 'базовий', 3: 'середній', 2: 'вище середнього', 1: 'просунутий' };
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const RANK = { none: 0, lesson: 1, learning: 2, known: 3 };

/** { n: { words: { total, known, learning, lesson, missing: [key] }, kanji: { total, mastered, written, book, missing: [ch] } } } */
export function jlptProgress() {
  const L = jlptLists();
  // best status of every list word among my cards
  const st = new Map();
  for (const s of getSets()) for (const c of s.cards) {
    const key = wordKey(c.japanese, c.reading, c.verbGroup);
    if (!key) continue;
    const p = prog(s.id, c.id);
    const v = p.lvl >= 2 ? 'known' : p.lvl >= 1 || p.c + p.w > 0 ? 'learning' : 'lesson';
    if (RANK[v] > RANK[st.get(key) || 'none']) st.set(key, v);
  }
  const kid = new Map();
  for (const b of kanjiBooks()) for (const l of b.lessons) for (const k of l.kanji) if (!kid.has(k.kanji)) kid.set(k.kanji, k.id);
  const sched = lget('jp.kanjiWrite', {}) || {};
  const out = {};
  for (const n of LEVELS) {
    const w = { total: 0, known: 0, learning: 0, lesson: 0, missing: [] };
    for (const key of L.w[n] || []) { w.total++; const v = st.get(key); if (v) w[v]++; else w.missing.push(key); }
    const k = { total: 0, mastered: 0, written: 0, book: 0, missing: [] };
    for (const ch of L.k[n] || []) {
      k.total++;
      const id = kid.get(ch);
      if (!id) { k.missing.push(ch); continue; }
      const lv = sched[id] ? levelOf(sched[id]) : 'new';
      if (lv === 'mastered') k.mastered++; else if (lv !== 'new') k.written++; else k.book++;
    }
    out[n] = { words: w, kanji: k };
  }
  return out;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const bar = (parts, total) => `<div class="jl-bar" role="img" aria-label="${parts.map(([v, , t]) => `${t}: ${v}`).join(', ')} з ${total}">${parts.map(([v, cls]) => (v ? `<i class="${cls}" style="width:${(v / total) * 100}%"></i>` : '')).join('')}</div>`;

export async function jlptView(root) {
  root.innerHTML = '<div class="loading"><span class="sun pulse"></span></div>';
  await Promise.all([loadJlpt(), loadKanji()]);
  const P = jlptProgress();
  root.innerHTML = `<div class="jlpt fade-in">
    <a class="back" href="#/">${I.back}<span>Головна</span></a>
    <section class="hero"><div><p class="eyebrow" lang="ja">日本語能力試験</p><h1>Шлях до JLPT</h1>
      <p class="muted">Скільки слів і канджі кожного рівня ви вже знаєте — з ваших уроків і книжок канджі.</p></div></section>
    <div class="jl-legend small"><span><i class="k"></i>знаю / засвоєно</span><span><i class="l"></i>вчу / пишу</span><span><i class="b"></i>є у ваших уроках, ще не вчили</span><span><i></i>немає в уроках</span></div>
    ${LEVELS.map(n => {
      const { words: w, kanji: k } = P[n];
      return `<section class="panel jl-level" id="n${n}"><div class="jl-head"><span class="jlpt-chip big" data-n="${n}">N${n}</span><div><h2>${LEVEL_NAMES[n][0].toUpperCase() + LEVEL_NAMES[n].slice(1)} рівень</h2>
        <p class="muted small">${w.total} слів · ${k.total} канджі</p></div><b class="jl-pct" title="Слова, які ви знаєте">${pct(w.known, w.total)}%</b></div>
        <div class="jl-row"><div class="jl-lbl"><b>Слова</b><span class="muted small">знаю ${w.known} · вчу ${w.learning} · в уроках ще ${w.lesson} · поза уроками ${w.missing.length}</span></div>
          ${bar([[w.known, 'k', 'знаю'], [w.learning, 'l', 'вчу'], [w.lesson, 'b', 'в уроках']], w.total)}</div>
        <div class="jl-row"><div class="jl-lbl"><b>Канджі</b><span class="muted small">засвоєно ${k.mastered} · пишу ${k.written} · у книжках ще ${k.book} · поза книжками ${k.missing.length}</span></div>
          ${bar([[k.mastered, 'k', 'засвоєно'], [k.written, 'l', 'пишу'], [k.book, 'b', 'у книжках']], k.total)}</div>
        ${w.missing.length ? `<details class="jl-more"><summary>Слова N${n}, яких немає у ваших уроках (${w.missing.length})</summary><div class="jl-chips" data-words="${n}"></div></details>` : ''}
        ${k.missing.length ? `<details class="jl-more"><summary>Канджі N${n} поза книжками (${k.missing.length})</summary><div class="jl-chips" lang="ja">${k.missing.map(ch => `<a class="chip" href="#/dict/k/${encodeURIComponent(ch)}">${esc(ch)}</a>`).join('')}</div></details>` : ''}
      </section>`;
    }).join('')}
    <p class="muted small">Офіційних списків JLPT немає з 2010 року; рівні — за списками Джонатана Воллера (tanos.co.uk, CC BY) через open-anki-jlpt-decks (MIT) і kanji-data (MIT). Це орієнтир, а не гарантія складу іспиту.</p>
  </div>`;
  // long word lists are drawn only when opened (N1 has ≈ 2 700 words)
  $$('details.jl-more', root).forEach(d => d.addEventListener('toggle', () => {
    const box = d.querySelector('[data-words]');
    if (!d.open || !box || box.childElementCount) return;
    const n = +box.dataset.words;
    box.innerHTML = P[n].words.missing.map(key => { const [f, r] = key.split('|'); return `<a class="chip" lang="ja" href="#/dict/q/${encodeURIComponent(f)}" title="${esc(r)}">${esc(f)}${r !== f ? `<small>${esc(r)}</small>` : ''}</a>`; }).join('');
  }));
}
