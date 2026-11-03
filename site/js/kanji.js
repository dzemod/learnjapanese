// Kanji tab: books → lessons (課) → kanji grid + lesson words.
// Data: data/kanji.json. Each lesson is also exposed as two study sets for the normal study modes:
//   <lessonId>     — kanji cards (front = kanji, answer = meaning and/or readings)
//   <lessonId>-w   — example words of the lesson ("Слова уроку N")
// Stroke order: KanjiVG (© Ulrich Apel, CC BY-SA 3.0), fetched from the jsDelivr CDN.
import { $, $$, esc, I, toast, modal, speak, speakCard, sizeClass, hasKanji, sortGojuon, plWord } from './util.js';
import {
  saveOpts, state, prog, toggleStar, setStats, registerSetProvider, registerKanjiPayload, markKanjiPending, saveCustomNow, syncAll, onSync,
} from './store.js';
import { MODES, kunHTML } from './modes.js';

const K = { base: null, loading: null, error: false };
const BOOKS_FALLBACK = [];

export function loadKanji() {
  return (K.loading ||= fetch('data/kanji.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(j => {
      K.base = Array.isArray(j.books) ? j.books : BOOKS_FALLBACK;
      // drop local copies that are already deployed unchanged
      let changed = false;
      for (const [id, l] of Object.entries(state.custom.kanji)) {
        const b = baseLesson(id);
        if (!state.custom.pending[id] && (!b || JSON.stringify(b) === JSON.stringify(l))) { delete state.custom.kanji[id]; changed = true; }
      }
      if (changed) saveCustomNow();
    })
    .catch(e => { console.error('Could not load data/kanji.json', e); K.base = []; K.error = true; }));
}

const baseLesson = id => { for (const b of K.base || []) for (const l of b.lessons) if (l.id === id) return l; return null; };
/** Lesson with local edits applied. */
export function lesson(id) { return state.custom.kanji[id] || baseLesson(id); }
const bookOf = id => (K.base || []).find(b => b.lessons.some(l => l.id === id));
export const books = () => (K.base || []).map(b => ({ ...b, lessons: b.lessons.map(l => lesson(l.id)) }));

const lessonUrl = id => `#/kanji/${encodeURIComponent(id)}`;
const lessonTitle = (l) => `${l.no}課 · ${l.title}`;
const kunPlain = r => String(r).replace(/[-.]/, '');
const kataToHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

// ---------- virtual study sets ----------
function kanjiCard(k) {
  const a = state.opts.kanjiAns || 'both';
  const readings = [k.on.join('、'), k.kun.map(r => r.includes('-') || r.includes('.') ? r.replace(/[-.](.*)$/, '($1)') : r).join('、')].filter(Boolean).join('; ');
  const ukrainian = a === 'meaning' ? k.meaning : a === 'readings' ? readings : `${k.meaning}; ${readings}`;
  return {
    id: k.id, kind: 'kanji', japanese: k.kanji, reading: '', ukrainian, verbGroup: '', hint: '', section: 'main', source: 'textbook',
    check: !!k.check, k, say: k.kun.length ? kunPlain(k.kun[0]) : kataToHira(k.on[0] || k.kanji),
  };
}
export function lessonWords(l) {
  const seen = new Set(), out = [];
  for (const k of l.kanji) for (const e of k.examples || []) {
    const key = e.word + '|' + e.kana;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e, kanjiId: k.id });
  }
  return out;
}
const wordCard = e => ({
  id: e.id, kind: 'kword', japanese: e.word, reading: hasKanji(e.word) ? e.kana : '', ukrainian: e.uk, verbGroup: '', hint: '', section: 'main',
  source: 'textbook', check: !!e.check, e,
});
function virtualSet(id) {
  if (!K.base) return null;
  const words = id.endsWith('-w');
  const l = lesson(words ? id.slice(0, -2) : id);
  if (!l) return null;
  const book = bookOf(l.id);
  return {
    id, kind: words ? 'kword' : 'kanji', source: 'textbook', origin: 'kanji', lessonId: l.id,
    title: words ? `Слова уроку ${l.no} · ${book?.title || ''}` : `Канджі ${lessonTitle(l)} · ${book?.title || ''}`,
    backUrl: lessonUrl(l.id),
    cards: words ? lessonWords(l).map(wordCard) : l.kanji.map(kanjiCard),
    onEdit: (card, done) => (card.kind === 'kanji' ? editKanji(l.id, card.id, done) : editWord(l.id, card.id, done)),
  };
}
registerSetProvider(virtualSet);
registerKanjiPayload(id => lesson(id));
export const isKanjiSet = id => /^k\d+-\d+(-w)?$/.test(id);

// ---------- editing (local copy → GitHub via /api/save-set) ----------
let lastUndo = null;
function editableLesson(id) {
  if (!state.custom.kanji[id]) state.custom.kanji[id] = JSON.parse(JSON.stringify(baseLesson(id)));
  return state.custom.kanji[id];
}
function commit(id, before, msg, refresh) {
  lastUndo = { id, before };
  markKanjiPending(id);
  toast(msg, {
    duration: 6000,
    action: { label: 'Скасувати', fn: () => {
      if (!lastUndo || lastUndo.id !== id) return;
      state.custom.kanji[id] = lastUndo.before;
      lastUndo = null;
      markKanjiPending(id);
      toast('Зміну скасовано');
      refresh?.();
      syncAll();
    } },
  });
  syncAll();
}
const splitList = s => String(s || '').split(/[,、，;；\s]+/).map(x => x.trim()).filter(Boolean);

export function editKanji(lessonId, kanjiId, done) {
  const l = lesson(lessonId);
  const k = l.kanji.find(x => x.id === kanjiId);
  if (!k) return;
  modal(`<div class="modal-head"><h2>Редагувати канджі <span class="jp" lang="ja">${esc(k.kanji)}</span></h2></div>
    <form class="word-form kanji-form" autocomplete="off">
      ${k.check ? `<div class="check-note"><span class="check-badge">перевірити</span> Значення перекладено з англійської (${esc(k.en || '')}) — перевірте.</div>` : ''}
      <label class="field"><span class="field-label">Значення українською</span><input class="input big" name="meaning" value="${esc(k.meaning)}"></label>
      <div class="wf-grid">
        <label class="field"><span class="field-label">Он (катакана, через кому)</span><input class="input jp" lang="ja" name="on" value="${esc(k.on.join('、'))}"></label>
        <label class="field"><span class="field-label">Кун (хірагана; окурігана після «-»)</span><input class="input jp" lang="ja" name="kun" value="${esc(k.kun.join('、'))}"></label>
      </div>
      <div class="wf-grid">
        <label class="field"><span class="field-label">Кількість рисок</span><input class="input" name="strokes" type="number" min="1" max="40" value="${esc(k.strokes)}"></label>
        <label class="field"><span class="field-label">Ключ</span><input class="input jp" lang="ja" name="radical" value="${esc(k.radical || '')}"></label>
      </div>
      <div class="wf-btns"><button type="button" class="btn ghost" data-cancel>Скасувати</button><button class="btn primary">Зберегти</button></div>
      ${k.check ? `<div class="wf-extra"><button type="button" class="btn ghost sm" data-confirm>${I.check}<span>Позначити як перевірене</span></button></div>` : ''}
    </form>`, (m, close) => {
    m.classList.add('sheet');
    const f = $('form', m);
    $('[data-cancel]', m).onclick = close;
    const save = (patch, msg) => {
      const before = JSON.parse(JSON.stringify(lesson(lessonId)));
      Object.assign(editableLesson(lessonId).kanji.find(x => x.id === kanjiId), patch);
      close();
      commit(lessonId, before, msg, done);
      done?.();
    };
    $('[data-confirm]', m)?.addEventListener('click', () => save({ check: false }, 'Позначено як перевірене'));
    f.onsubmit = e => {
      e.preventDefault();
      if (!f.meaning.value.trim()) return toast('Введіть значення');
      save({
        meaning: f.meaning.value.trim(), on: splitList(f.on.value), kun: splitList(f.kun.value),
        strokes: +f.strokes.value || k.strokes, radical: f.radical.value.trim(), check: false,
      }, 'Збережено');
    };
  });
}

export function editWord(lessonId, wordId, done) {
  const l = lesson(lessonId);
  const owners = l.kanji.filter(k => (k.examples || []).some(e => e.id === wordId));
  const e = owners[0]?.examples.find(x => x.id === wordId);
  if (!e) return;
  modal(`<div class="modal-head"><h2>Редагувати слово</h2></div>
    <form class="word-form" autocomplete="off">
      ${e.check ? `<div class="check-note"><span class="check-badge">перевірити</span> Переклад зроблено з англійської (${esc(e.en || '')}) — перевірте.</div>` : ''}
      <div class="wf-grid">
        <label class="field"><span class="field-label">Слово</span><input class="input jp big" lang="ja" name="word" value="${esc(e.word)}"></label>
        <label class="field"><span class="field-label">Читання (хірагана)</span><input class="input jp big" lang="ja" name="kana" value="${esc(e.kana)}"></label>
      </div>
      <label class="field"><span class="field-label">Українською</span><textarea class="input big" name="uk" rows="2">${esc(e.uk)}</textarea></label>
      <div class="wf-btns"><button type="button" class="btn ghost" data-cancel>Скасувати</button><button class="btn primary">Зберегти</button></div>
      <div class="wf-extra">${e.check ? `<button type="button" class="btn ghost sm" data-confirm>${I.check}<span>Позначити як перевірене</span></button>` : ''}
        <button type="button" class="btn ghost sm danger" data-delete>${I.trash}<span>Видалити слово</span></button></div>
    </form>`, (m, close) => {
    m.classList.add('sheet');
    const f = $('form', m);
    $('[data-cancel]', m).onclick = close;
    const apply = (fn, msg) => {
      const before = JSON.parse(JSON.stringify(lesson(lessonId)));
      const el = editableLesson(lessonId);
      for (const k of el.kanji) k.examples = (k.examples || []).flatMap(x => (x.id === wordId ? fn(x) : [x]));
      close();
      commit(lessonId, before, msg, done);
      done?.();
    };
    $('[data-confirm]', m)?.addEventListener('click', () => apply(x => [{ ...x, check: false }], 'Позначено як перевірене'));
    $('[data-delete]', m).onclick = () => { if (confirm(`Видалити «${e.word} — ${e.uk}»?`)) apply(() => [], 'Слово видалено'); };
    f.onsubmit = ev => {
      ev.preventDefault();
      const word = f.word.value.trim(), kana = f.kana.value.trim(), uk = f.uk.value.trim();
      if (!word || !uk) return toast('Потрібні слово і переклад');
      if (hasKanji(kana)) return toast('У читанні — лише кана');
      apply(x => [{ ...x, word, kana, uk, check: false }], 'Збережено');
    };
  });
}

// ---------- stroke order (KanjiVG) ----------
const svgCache = new Map();
// Pinned release: jsDelivr throttles @master (HTTP 403); GitHub raw is the fallback.
const KVG = 'r20260714';
const KVG_URLS = [`https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@${KVG}/kanji/`, `https://raw.githubusercontent.com/KanjiVG/kanjivg/${KVG}/kanji/`];
const getText = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
const fetchSVG = hex => getText(KVG_URLS[0] + hex + '.svg').catch(() => getText(KVG_URLS[1] + hex + '.svg'));
function kanjiVG(ch) {
  const hex = ch.codePointAt(0).toString(16).padStart(5, '0');
  if (!svgCache.has(hex)) {
    svgCache.set(hex, fetchSVG(hex)
      .then(t => {
        const doc = new DOMParser().parseFromString(t, 'image/svg+xml');
        const paths = [...doc.querySelectorAll('path')].filter(p => /-s\d+$/.test(p.getAttribute('id') || '')).map(p => p.getAttribute('d'));
        const nums = [...doc.querySelectorAll('text')].map(t => ({ t: t.textContent, tr: t.getAttribute('transform') || '' }));
        return { paths, nums };
      })
      .catch(e => { svgCache.delete(hex); throw e; }));
  }
  return svgCache.get(hex);
}
/** Draw the animated stroke order into `box`. Returns a replay function. */
function strokeOrder(box, ch) {
  box.innerHTML = '<div class="so-loading"><span class="spinner"></span></div>';
  let data = null, anims = [];
  const draw = () => {
    if (!data) return;
    anims.forEach(a => a.cancel()); anims = [];
    box.innerHTML = `<svg viewBox="0 0 109 109" class="so-svg" aria-label="Порядок рисок">
      <g class="so-grid"><line x1="54.5" y1="0" x2="54.5" y2="109"/><line x1="0" y1="54.5" x2="109" y2="54.5"/></g>
      <g class="so-ghost">${data.paths.map(d => `<path d="${esc(d)}"/>`).join('')}</g>
      <g class="so-ink">${data.paths.map(d => `<path d="${esc(d)}"/>`).join('')}</g>
      <g class="so-num">${data.nums.map(n => `<text transform="${esc(n.tr)}">${esc(n.t)}</text>`).join('')}</g></svg>`;
    let t = 200;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $$('.so-ink path', box).forEach(p => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      if (reduce) return;
      const dur = Math.max(260, len * 9);
      anims.push(p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: dur, delay: t, fill: 'both', easing: 'ease-in-out' }));
      t += dur + 120;
    });
  };
  kanjiVG(ch).then(d => { data = d; if (!d.paths.length) throw new Error('empty'); draw(); })
    .catch(() => { box.innerHTML = `<div class="so-missing muted small">Порядок рисок недоступний (немає з’єднання або символу немає в KanjiVG).</div>`; });
  return draw;
}

// ---------- kanji card (bottom sheet) ----------
export function openKanji(lessonId, kanjiId, onChange) {
  let l = lesson(lessonId);
  let i = l.kanji.findIndex(k => k.id === kanjiId);
  if (i < 0) return;
  modal('<div class="kcard"></div>', (m, close) => {
    m.classList.add('sheet', 'kanji-sheet');
    const box = $('.kcard', m);
    const render = () => {
      l = lesson(lessonId);
      const k = l.kanji[i];
      const p = prog(lessonId, k.id);
      box.innerHTML = `
        <div class="kc-top">
          <span class="muted small">№ ${k.no} · ${i + 1} / ${l.kanji.length}</span>
          <div class="kc-tools">
            <button class="icon-btn star ${p.star ? 'on' : ''}" data-star aria-label="Позначити">${I.star}</button>
            <button class="icon-btn" data-say aria-label="Вимова">${I.speaker}</button>
            <button class="icon-btn" data-edit aria-label="Редагувати">${I.edit}</button>
            <button class="icon-btn" data-close aria-label="Закрити">${I.close}</button>
          </div>
        </div>
        <div class="kc-head">
          <div class="kc-big" lang="ja">${esc(k.kanji)}</div>
          <div class="kc-so"><div class="so-box"></div><button class="btn ghost sm" data-replay>${I.undo}<span>Повторити</span></button></div>
        </div>
        <div class="kc-meaning">${esc(k.meaning)} ${k.check ? `<button class="check-badge as-btn" data-edit title="Перекладено з англійської — перевірте">перевірити</button>` : ''}</div>
        <div class="kc-en muted small">англійською: ${esc(k.en || '')}</div>
        <div class="kc-facts"><span><b>${esc(k.strokes)}</b> ${plWord(+k.strokes, ['риска', 'риски', 'рисок'])}</span>${k.radical ? `<span>ключ <b lang="ja">${esc(k.radical)}</b></span>` : ''}</div>
        <div class="kc-readings">
          ${k.on.length ? `<div><span class="kb-l">он</span><span lang="ja">${esc(k.on.join('、'))}</span></div>` : ''}
          ${k.kun.length ? `<div><span class="kb-l">кун</span><span lang="ja">${k.kun.map(kunHTML).join('、')}</span></div>` : ''}
        </div>
        <h3 class="sub-title">Слова з цим канджі</h3>
        <div class="kc-ex">${(k.examples || []).map(e => `<div class="kc-exrow ${e.check ? 'needs-check' : ''}" data-ex="${esc(e.id)}">
            <span class="jp" lang="ja">${esc(e.word)}</span>${e.kana && e.kana !== e.word ? `<span class="reading" lang="ja">(${esc(e.kana)})</span>` : ''}
            <span class="uk">— ${esc(e.uk)}</span>
            <span class="kc-exacts"><button class="icon-btn sm" data-exsay aria-label="Вимова">${I.speaker}</button><button class="icon-btn sm" data-exedit aria-label="Редагувати">${I.edit}</button></span>
          </div>`).join('') || '<p class="muted small">Немає прикладів.</p>'}</div>
        <div class="kc-nav">
          <button class="round-btn" data-prev ${i ? '' : 'disabled'} aria-label="Попередній">${I.left}</button>
          <button class="round-btn" data-next ${i < l.kanji.length - 1 ? '' : 'disabled'} aria-label="Наступний">${I.right}</button>
        </div>
        <p class="kvg-note muted">Порядок рисок: KanjiVG © Ulrich Apel, CC BY-SA 3.0</p>`;
      const replay = strokeOrder($('.so-box', box), k.kanji);
      $('[data-replay]', box).onclick = replay;
      $('[data-star]', box).onclick = e => { e.currentTarget.classList.toggle('on', toggleStar(lessonId, k.id)); onChange?.(); };
      $('[data-say]', box).onclick = () => speakCard(kanjiCard(k));
      $$('[data-edit]', box).forEach(b => (b.onclick = () => editKanji(lessonId, k.id, () => { render(); onChange?.(); })));
      $('[data-close]', box).onclick = close;
      $('[data-prev]', box).onclick = () => { i--; render(); };
      $('[data-next]', box).onclick = () => { i++; render(); };
      $$('.kc-exrow', box).forEach(row => {
        const e = k.examples.find(x => x.id === row.dataset.ex);
        $('[data-exsay]', row).onclick = () => speak(e.kana || e.word);
        $('[data-exedit]', row).onclick = () => editWord(lessonId, e.id, () => { render(); onChange?.(); });
      });
    };
    render();
    const onKey = e => {
      if (document.querySelectorAll('.modal-back').length > 1) return;
      if (e.key === 'ArrowRight' && i < l.kanji.length - 1) { i++; render(); }
      else if (e.key === 'ArrowLeft' && i > 0) { i--; render(); }
    };
    document.addEventListener('keydown', onKey);
    new MutationObserver((_, obs) => { if (!m.isConnected) { document.removeEventListener('keydown', onKey); obs.disconnect(); } })
      .observe(document.body, { childList: true });
  });
}

// ---------- pages ----------
const progressBar = set => {
  const x = setStats(set);
  return `<div class="stack-bar"><i class="m" style="width:${x.total ? (x.m / x.total) * 100 : 0}%"></i><i class="l" style="width:${x.total ? (x.l / x.total) * 100 : 0}%"></i></div>`;
};
const pct = set => setStats(set).pct;
const modesGrid = id => `<div class="modes-grid">${Object.values(MODES).map(m => `<a class="mode-btn" href="#/set/${encodeURIComponent(id)}/${m.key}"><span class="mode-ic" lang="ja">${m.jp}</span><span><b>${m.name}</b><small>${m.desc}</small></span></a>`).join('')}</div>`;

export function kanjiHome(root) {
  if (K.error || !K.base?.length) {
    root.innerHTML = `<div class="empty fade-in"><div class="empty-jp" lang="ja">漢</div><p>${K.error ? 'Не вдалося завантажити <code>data/kanji.json</code>.' : 'Канджі ще не додано.'}</p></div>`;
    return;
  }
  root.innerHTML = `<div class="kanji-home fade-in">
    <section class="hero"><div><p class="eyebrow" lang="ja">漢字</p><h1>Канджі</h1>
      <p class="muted">${books().map(b => `${esc(b.title)}: ${b.lessons.reduce((n, l) => n + l.kanji.length, 0)}`).join(' · ')}</p></div></section>
    ${books().map(b => `<h2 class="group-title"><span lang="ja">${esc(b.titleJp || '')}</span> ${esc(b.title)}</h2>
      ${b.lessons.length ? '' : '<p class="muted small">Уроки цієї книжки ще не додано.</p>'}
      <div class="set-grid">${b.lessons.map(l => {
        const ks = virtualSet(l.id), ws = virtualSet(l.id + '-w');
        return `<a class="set-card klesson-card" href="${lessonUrl(l.id)}">
          <div class="set-card-top"><h3>${l.no}課 <span lang="ja">${esc(l.title)}</span></h3>${state.custom.pending[l.id] ? '<span class="badge">Лише тут</span>' : ''}</div>
          <div class="muted small">${esc(l.titleUk || '')}${l.range ? ` · №${esc(l.range)}` : ''}</div>
          <div class="kl-preview" lang="ja">${l.kanji.slice(0, 12).map(k => esc(k.kanji)).join('')}${l.kanji.length > 12 ? '…' : ''}</div>
          <div class="kl-row"><span>канджі ${l.kanji.length}</span><span>${pct(ks)}%</span></div>${progressBar(ks)}
          <div class="kl-row"><span>слова ${ws.cards.length}</span><span>${pct(ws)}%</span></div>${progressBar(ws)}
        </a>`;
      }).join('')}</div>`).join('')}
  </div>`;
}

export function kanjiLessonView(root, id, openId) {
  const l = lesson(id);
  if (!l) { root.innerHTML = `<div class="empty"><div class="empty-jp" lang="ja">無</div><p>Такого уроку немає.</p><a class="btn primary" href="#/kanji">Канджі</a></div>`; return; }
  const book = bookOf(id);
  const draw = () => {
    const ks = virtualSet(id), ws = virtualSet(id + '-w');
    const lv = ['Нове', 'Вчу', 'Вивчене'];
    const sync = state.custom.pending[id] ? `<div class="sync-box ${state.sync.error ? 'err' : ''}"><div>${state.sync.busy ? '<span class="spinner"></span> Зберігаю в GitHub…' : `<b>Зміни ще не збережено в GitHub — вони в цьому браузері.</b>${state.sync.error ? `<br><span class="small">${esc(state.sync.error)}</span>` : ''}`}</div>${state.sync.busy ? '' : '<div class="sync-btns"><button class="btn sm primary" data-sync>Зберегти в GitHub</button></div>'}</div>` : '';
    root.innerHTML = `<div class="kanji-lesson fade-in">
      <a class="back" href="#/kanji">${I.back}<span>${esc(book?.title || 'Канджі')}</span></a>
      <div class="set-head"><div>
        <h1 class="set-title">${l.no}課 <span lang="ja">${esc(l.title)}</span></h1>
        <p class="muted">${esc(l.titleUk || '')}${l.range ? ` · №${esc(l.range)}` : ''} · ${l.kanji.length} канджі · ${ws.cards.length} слів</p>
      </div></div>
      <div class="sync-slot">${sync}</div>

      <section class="panel">
        <h2 class="sec-title">Канджі <span class="muted">(${l.kanji.length})</span><span class="sec-pct">${pct(ks)}%</span></h2>
        ${progressBar(ks)}
        <div class="kgrid">${l.kanji.map(k => {
          const p = prog(id, k.id);
          return `<button class="kcell lvl-b${p.lvl || 0}" data-k="${esc(k.id)}" title="${esc(k.meaning)}">
            <span class="kcell-k" lang="ja">${esc(k.kanji)}</span><span class="kcell-m ${sizeClass(k.meaning)}">${esc(k.meaning)}</span>
            ${p.star ? '<i class="kcell-star">★</i>' : ''}${k.check ? '<i class="kcell-check" title="перевірити"></i>' : ''}<i class="kcell-lvl" title="${lv[p.lvl || 0]}"></i>
          </button>`;
        }).join('')}</div>
        <h3 class="sub-title">Вчити канджі</h3>
        ${modesGrid(id)}
      </section>

      <section class="panel">
        <h2 class="sec-title">Слова уроку ${l.no} <span class="muted">(${ws.cards.length})</span><span class="sec-pct">${pct(ws)}%</span></h2>
        ${progressBar(ws)}
        ${modesGrid(id + '-w')}
        <div class="terms-head"><span></span><div class="seg small" data-order><button class="${state.opts.termOrder !== 'gojuon' ? 'on' : ''}" data-v="book">Як у підручнику</button><button class="${state.opts.termOrder === 'gojuon' ? 'on' : ''}" data-v="gojuon" lang="ja">あいうえお</button></div></div>
        <div class="term-list">${(state.opts.termOrder === 'gojuon' ? sortGojuon(ws.cards) : ws.cards).map(c => {
          const p = prog(ws.id, c.id);
          return `<div class="term ${c.check ? 'needs-check' : ''}" data-id="${esc(c.id)}">
            <span class="lvl lvl${p.lvl || 0}"></span>
            <div class="term-main"><div class="term-jp"><span class="jp" lang="ja">${esc(c.japanese)}</span>${c.reading ? `<span class="reading" lang="ja">(${esc(c.reading)})</span>` : ''}</div><div class="term-uk">${esc(c.ukrainian)}</div></div>
            <div class="term-acts">
              ${c.check ? '<button class="check-badge as-btn" data-act="edit" title="Перекладено з англійської — перевірте">перевірити</button>' : ''}
              <button class="icon-btn star ${p.star ? 'on' : ''}" data-act="star" aria-label="Позначити">${I.star}</button>
              <button class="icon-btn" data-act="say" aria-label="Вимова">${I.speaker}</button>
              <button class="icon-btn" data-act="edit" aria-label="Редагувати">${I.edit}</button>
            </div></div>`;
        }).join('')}</div>
      </section>
    </div>`;
    $('[data-sync]', root)?.addEventListener('click', async () => { const r = await syncAll(); if (r.ok) toast('Збережено в GitHub ✓'); draw(); });
    $('[data-order]', root).onclick = e => { const b = e.target.closest('button'); if (b) { saveOpts({ termOrder: b.dataset.v }); redraw(); } };
    $('.kgrid', root).onclick = e => {
      const b = e.target.closest('[data-k]');
      if (b) openKanji(id, b.dataset.k, redraw);
    };
    $('.term-list', root).onclick = e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const cid = b.closest('.term').dataset.id, c = ws.cards.find(x => x.id === cid);
      if (b.dataset.act === 'star') b.classList.toggle('on', toggleStar(ws.id, cid));
      else if (b.dataset.act === 'say') speakCard(c);
      else editWord(id, cid, redraw);
    };
  };
  const redraw = () => { const y = window.scrollY; draw(); window.scrollTo(0, y); };
  draw();
  if (openId) setTimeout(() => openKanji(id, openId, redraw), 50);
  return onSync(() => { if (!document.querySelector('.modal-back')) redraw(); });
}
