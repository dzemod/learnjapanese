// Printable kanji practice sheets (#/kanji/print/<lessonId>): per kanji — the kanji, meaning, readings, stroke order
// step by step (KanjiVG via kanji.js kanjiVG — the one stroke source), then practice squares with guide lines
// (the first TRACE squares show the kanji faintly to trace). «Друкувати» = window.print(); the print CSS hides the
// site and prints only the white sheet (A4, the browser can also save it as PDF).
import { $, esc, I } from './util.js';
import { lesson as kanjiLesson, kanjiVG } from './kanji.js';

export const SQUARES = 12, TRACE = 3, STEP_MAX = 24;
const step = (paths, n) => `<svg class="kp-step" viewBox="0 0 109 109" aria-hidden="true">${paths.map((d, i) => (i < n ? `<path d="${esc(d)}"${i === n - 1 ? ' class="last"' : ''}/>` : '')).join('')}</svg>`;
const square = (ch, trace) => `<span class="kp-sq${trace ? ' trace' : ''}">${trace ? `<span lang="ja">${esc(ch)}</span>` : ''}</span>`;

export function kanjiPrintView(root, lessonId) {
  const l = kanjiLesson(lessonId);
  if (!l) { root.innerHTML = '<div class="empty"><p>Урок не знайдено.</p><a class="btn primary" href="#/kanji">Канджі</a></div>'; return; }
  document.body.classList.add('printing-sheet');
  root.innerHTML = `<div class="kp-page fade-in">
    <div class="kp-tools no-print">
      <a class="back" href="#/kanji/${encodeURIComponent(l.id)}">${I.back}<span>${l.no}課</span></a>
      <label class="check"><input type="checkbox" data-steps checked><span>Порядок рисок</span></label>
      <label class="check"><input type="checkbox" data-trace checked><span>Сірі канджі для обведення</span></label>
      <button class="btn primary" data-print disabled><span class="spinner"></span><span>Друкувати</span></button>
    </div>
    <article class="kp-sheet" aria-label="Аркуш для друку">
      <header class="kp-head"><b>${l.no}課 <span lang="ja">${esc(l.title)}</span></b><span>${esc(l.titleUk || '')}</span><span class="kp-name">Ім’я: ____________________</span></header>
      ${l.kanji.map(k => `<section class="kp-row" data-id="${esc(k.id)}">
        <div class="kp-info"><span class="kp-big" lang="ja">${esc(k.kanji)}</span>
          <div class="kp-txt"><b>${esc(k.meaning)}</b><span lang="ja">${k.on.length ? `<small>он</small> ${esc(k.on.join('、'))}` : ''}${k.kun.length ? ` <small>кун</small> ${esc(k.kun.join('、').replace(/-/g, ''))}` : ''}</span>
            <span class="kp-strokes">${k.strokes} рис.</span></div></div>
        <div class="kp-steps"></div>
        <div class="kp-squares">${Array.from({ length: SQUARES }, (_, i) => square(k.kanji, i < TRACE)).join('')}</div>
      </section>`).join('')}
      <footer class="kp-foot">Kotoba · порядок рисок: KanjiVG © Ulrich Apel, CC BY-SA 3.0</footer>
    </article></div>`;
  const btn = $('[data-print]', root);
  Promise.all(l.kanji.map(k => kanjiVG(k.kanji).then(d => {
    const box = $(`.kp-row[data-id="${CSS.escape(k.id)}"] .kp-steps`, root);
    if (box) box.innerHTML = d.paths.slice(0, STEP_MAX).map((_, i) => step(d.paths, i + 1)).join('');
  }).catch(() => {}))).then(() => { btn.disabled = false; btn.innerHTML = '<span>Друкувати</span>'; });
  btn.onclick = () => window.print();
  $('[data-steps]', root).onchange = e => $('.kp-sheet', root).classList.toggle('no-steps', !e.target.checked);
  $('[data-trace]', root).onchange = e => $('.kp-sheet', root).classList.toggle('no-trace', !e.target.checked);
  return () => document.body.classList.remove('printing-sheet');
}
