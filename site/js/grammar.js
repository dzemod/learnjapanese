// Grammar tab: explanations from "IV. Граматика" + 文型 / 例文 with Ukrainian translations.
// Data: data/grammar.json → { lessons: [{ lesson, points: [{ id, title, blocks: [...] }] }] }
// Blocks: { h } subheading · { p } paragraph · { note } note · { ex, uk, src? } example · { table: [[...]] }
// Japanese text uses furigana markup {漢字|かんじ}, shown as 漢字(かんじ).
import { $, $$, esc, I, furi, furiPlain, furiSay, speak, norm } from './util.js';

const G = { data: null, loading: null, error: false };
export function loadGrammar() {
  return (G.loading ||= fetch('data/grammar.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(j => { G.data = Array.isArray(j.lessons) ? j.lessons : []; })
    .catch(e => { console.error('Could not load data/grammar.json', e); G.data = []; G.error = true; }));
}
const byNo = n => G.data.find(l => l.lesson === n);
const pointsTxt = n => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? 'пункт' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'пункти' : 'пунктів'}`; };

function blockHTML(b) {
  if (b.h) return `<h4 class="g-h">${furi(b.h)}</h4>`;
  if (b.p) return `<p class="g-p">${furi(b.p)}</p>`;
  if (b.note) return `<p class="g-note">${furi(b.note)}</p>`;
  if (b.table) return `<div class="g-table-wrap"><table class="g-table">${b.table.map((r, i) => `<tr>${r.map(c => (i === 0 && b.head !== false ? `<th>${furi(c)}</th>` : `<td>${furi(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`;
  if (b.ex != null) return `<div class="g-ex">
      ${b.src ? `<span class="g-src" lang="ja">${esc(b.src)}</span>` : ''}
      <div class="g-ex-body"><div class="g-ja" lang="ja">${furi(b.ex)}</div>${b.uk ? `<div class="g-uk">${furi(b.uk)}${b.check ? ' <span class="check-badge" title="Переклад зроблено не з книжки (у перекладі інше речення) — перевірте">перевірити</span>' : ''}</div>` : ''}</div>
      <button class="icon-btn sm" data-say="${esc(furiSay(b.ex))}" aria-label="Вимова">${I.speaker}</button>
    </div>`;
  return '';
}
const pointText = pt => [pt.title, ...pt.blocks.flatMap(b => [b.h, b.p, b.note, b.ex, b.uk, ...(b.table || []).flat()])].filter(Boolean).map(furiPlain).join(' ');

function wireSay(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-say]');
    if (b) { e.preventDefault(); speak(b.dataset.say); }
  });
}

export async function grammarHome(root) {
  await loadGrammar();
  const groups = [['Частина I', '第一部', 1, 25], ['Частина II', '第二部', 26, 50]];
  const total = G.data.reduce((n, l) => n + l.points.length, 0);
  root.innerHTML = `<div class="grammar-home fade-in">
    <section class="hero"><div><p class="eyebrow" lang="ja">文法</p><h1>Граматика</h1>
      <p class="muted">${G.data.length} уроків · ${pointsTxt(total)}</p></div></section>
    ${G.error ? '<div class="alert">Не вдалося завантажити <code>data/grammar.json</code>.</div>' : ''}
    <div class="home-tools"><label class="search">${I.search}<input type="search" placeholder="Пошук у граматиці: は, です, дієслово…" aria-label="Пошук у граматиці"></label></div>
    <div class="g-results"></div>
    <div class="g-lessons">${groups.map(([t, jp, a, b]) => `<h2 class="group-title"><span lang="ja">${jp}</span> ${t}</h2>
      <div class="g-grid">${Array.from({ length: b - a + 1 }, (_, i) => a + i).map(n => {
        const l = byNo(n);
        return l ? `<a class="g-tile" href="#/grammar/${n}"><b>Урок ${n}</b><span class="muted small">${pointsTxt(l.points.length)}</span><span class="g-tile-t" lang="ja">${furi(l.points[0]?.title || '')}</span></a>`
          : `<div class="g-tile off"><b>Урок ${n}</b><span class="muted small">ще не додано</span></div>`;
      }).join('')}</div>`).join('')}</div>
  </div>`;
  const res = $('.g-results', root), lessons = $('.g-lessons', root);
  $('.search input', root).oninput = e => {
    const q = norm(e.target.value);
    lessons.hidden = !!q;
    if (!q) { res.innerHTML = ''; return; }
    const hits = [];
    for (const l of G.data) for (const pt of l.points) {
      const txt = pointText(pt);
      const at = norm(txt).indexOf(q);
      if (at >= 0) hits.push({ l, pt, snip: txt });
    }
    res.innerHTML = hits.length ? `<p class="muted small">Знайдено: ${hits.length}</p><div class="g-hits">${hits.slice(0, 80).map(({ l, pt }) => `<a class="g-hit" href="#/grammar/${l.lesson}/${encodeURIComponent(pt.id)}"><span class="g-hit-l">Урок ${l.lesson}</span><span class="g-hit-t" lang="ja">${furi(pt.title)}</span></a>`).join('')}</div>`
      : '<p class="muted center">Нічого не знайдено.</p>';
  };
}

export async function grammarLesson(root, n, pointId) {
  await loadGrammar();
  const l = byNo(n);
  const prev = G.data.filter(x => x.lesson < n).at(-1), next = G.data.find(x => x.lesson > n);
  const wordsId = `mnn-${String(n).padStart(2, '0')}`;
  if (!l) {
    root.innerHTML = `<div class="empty fade-in"><div class="empty-jp" lang="ja">文</div><p>Граматику уроку ${n} ще не додано.</p><a class="btn primary" href="#/grammar">Уся граматика</a></div>`;
    return;
  }
  root.innerHTML = `<div class="grammar-lesson fade-in">
    <a class="back" href="#/grammar">${I.back}<span>Уся граматика</span></a>
    <div class="set-head"><div><p class="eyebrow" lang="ja">第${n}課</p><h1 class="set-title">Урок ${n} — граматика</h1>
      <p class="muted">${pointsTxt(l.points.length)} · IV. Граматика, 文型 і 例文</p></div>
      <div class="set-actions"><a class="btn ghost sm" href="#/set/${wordsId}"><span lang="ja">言葉</span><span>Слова уроку</span></a>
      <button class="btn ghost sm" data-toggle>Згорнути все</button></div></div>
    <div class="g-cards">${l.points.map((pt, i) => `<details class="g-card" id="g-${esc(pt.id)}" open>
      <summary><span class="g-num">${i + 1}</span><span class="g-title" lang="ja">${furi(pt.title)}</span><span class="g-chev" aria-hidden="true"></span></summary>
      <div class="g-body">${pt.blocks.map(blockHTML).join('')}</div></details>`).join('')}</div>
    <div class="g-pager">${prev ? `<a class="btn ghost" href="#/grammar/${prev.lesson}">${I.left}<span>Урок ${prev.lesson}</span></a>` : '<span></span>'}
      ${next ? `<a class="btn ghost" href="#/grammar/${next.lesson}"><span>Урок ${next.lesson}</span>${I.right}</a>` : '<span></span>'}</div>
  </div>`;
  wireSay(root);
  const tg = $('[data-toggle]', root);
  tg.onclick = () => {
    const anyOpen = $$('.g-card', root).some(d => d.open);
    $$('.g-card', root).forEach(d => (d.open = !anyOpen));
    tg.textContent = anyOpen ? 'Розгорнути все' : 'Згорнути все';
  };
  if (pointId) {
    const el = document.getElementById('g-' + pointId);
    if (el) { el.open = true; el.classList.add('hl'); setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
  }
}
