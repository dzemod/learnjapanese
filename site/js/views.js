import { $, $$, esc, I, speakCard, toast, modal, download, pickFile, parseText, norm, today, onSwipe, justSwiped, isTyping, hasKanji } from './util.js';
import {
  state, getSets, getSet, isMine, setStats, prog, toggleStar, createSet, addCards, deleteCard, renameSet, deleteSet, markChecked,
  mostMissed, saveOpts, backupData, restoreBackup, setsExport, localChangeCount, streak, syncAll, onSync,
} from './store.js';
import { MODES, faceHTML, metaHTML } from './modes.js';
import { mountWordForm, openWordModal, afterSave } from './edit.js';

const setUrl = id => `#/set/${encodeURIComponent(id)}`;
const pl = (n, [one, few, many]) => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`; };
const UROK = ['урок', 'уроки', 'уроків'], SLOVO = ['слово', 'слова', 'слів'];
const slov = n => { // Ukrainian plural for "слово"
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? 'слово' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'слова' : 'слів'}`;
};
const readingTxt = c => (c.reading && c.reading !== c.japanese ? `(${c.reading})` : '');
const backupNow = () => { download(`kotoba-backup-${today()}.json`, backupData()); toast('Резервну копію завантажено'); };

function syncBox(compact = false) {
  const pend = Object.keys(state.custom.pending).length;
  if (!pend) return '';
  const s = state.sync;
  return `<div class="sync-box ${s.error ? 'err' : ''}">
    <div>${s.busy ? '<span class="spinner"></span> Зберігаю в GitHub…'
      : `<b>Є незбережені в GitHub зміни (${pend === 1 ? '1 урок' : pend + ' уроки(ів)'}) — вони в цьому браузері, нічого не втрачено.</b>${s.error ? `<br><span class="small">${esc(s.error)}</span>` : ''}`}</div>
    ${s.busy ? '' : `<div class="sync-btns"><button class="btn sm primary" data-sync>${s.error ? 'Спробувати ще' : 'Зберегти в GitHub'}</button>${compact ? '' : '<button class="btn sm ghost" data-backup>Резервна копія</button>'}</div>`}
  </div>`;
}
function wireSync(root, redraw) {
  $$('[data-sync]', root).forEach(b => (b.onclick = async () => {
    const r = await syncAll();
    if (r.ok) toast('Збережено в GitHub ✓ — на всіх пристроях за ~1 хв');
    redraw();
  }));
  $$('[data-backup]', root).forEach(b => (b.onclick = backupNow));
}

// =====================================================================
// HOME
// =====================================================================
export function homeView(root) {
  const draw = () => {
    const sets = getSets();
    const st = streak();
    const changes = localChangeCount();
    const lessonNo = s => { const m = /^mnn-(\d+)$/.exec(s.id); return m ? +m[1] : 999; };
    const mine = sets.filter(isMine), book = sets.filter(s => !isMine(s)).sort((a, b) => lessonNo(a) - lessonNo(b));
    root.innerHTML = `<div class="home fade-in">
      ${state.loadError ? `<div class="alert">Не вдалося завантажити <code>data/sets.json</code>. Якщо ви відкрили файл напряму, запустіть локальний сервер: <code>npx serve site</code>.</div>` : ''}
      <section class="hero">
        <div>
          <p class="eyebrow" lang="ja">日本語の単語</p>
          <h1>Слова</h1>
          <p class="muted">${pl(sets.length, UROK)} · ${pl(sets.reduce((n, s) => n + s.cards.length, 0), SLOVO)}</p>
        </div>
        <div class="streak-card ${st ? 'on' : ''}"><span class="streak-sun"></span><div><b>${st}</b><span>днів поспіль</span></div></div>
      </section>
      <div class="home-tools">
        <label class="search">${I.search}<input type="search" placeholder="Пошук уроків і слів…" aria-label="Пошук"></label>
        <a class="btn primary" href="#/new">${I.plus}<span>Створити мій урок</span></a>
      </div>
      <div class="sync-slot">${syncBox()}</div>
      <div class="groups"></div>
      <section class="panel data-panel">
        <h2 class="sec-title">Резервна копія і дані</h2>
        <p class="muted">Прогрес і позначки ★ зберігаються лише в цьому браузері. Час від часу робіть резервну копію.</p>
        ${changes ? `<p class="note">Локальних змін, яких ще немає в <code>sets.json</code>: ${changes}.</p>` : ''}
        <div class="btn-row">
          <button class="btn ghost" data-exp>${I.download}<span>Зберегти резервну копію</span></button>
          <button class="btn ghost" data-imp>${I.upload}<span>Відновити з копії</span></button>
          <button class="btn ghost" data-claude>${I.download}<span>Експорт слів для Claude</span></button>
        </div>
      </section>
    </div>`;

    const groups = $('.groups', root);
    const card = s => {
      const x = setStats(s);
      return `<a class="set-card" href="${setUrl(s.id)}">
        <div class="set-card-top"><h3>${esc(s.title)}</h3>${state.custom.pending[s.id] ? '<span class="badge">Лише тут</span>' : ''}</div>
        <div class="muted small">${pl(x.total, SLOVO)}${x.starred ? ` · ★ ${x.starred}` : ''}</div>
        <div class="hits"></div>
        <div class="stack-bar"><i class="m" style="width:${x.total ? (x.m / x.total) * 100 : 0}%"></i><i class="l" style="width:${x.total ? (x.l / x.total) * 100 : 0}%"></i></div>
        <div class="set-card-foot"><span>вивчено ${x.pct}%</span><span>${esc(s.dateCreated || '')}</span></div>
      </a>`;
    };
    const filter = q => {
      const nq = norm(q);
      const match = s => !nq || norm(s.title).includes(nq) || s.cards.some(c => norm(`${c.japanese} ${c.reading} ${c.ukrainian}`).includes(nq));
      const b = book.filter(match), m = mine.filter(match);
      groups.innerHTML =
        [['Частина I', '第一部', b.filter(x => lessonNo(x) <= 25 || lessonNo(x) === 999)], ['Частина II', '第二部', b.filter(x => lessonNo(x) >= 26 && lessonNo(x) !== 999)]]
          .map(([t, jp, list]) => list.length ? `<h2 class="group-title"><span lang="ja">${jp}</span> ${t}</h2><div class="set-grid">${list.map(card).join('')}</div>` : '').join('') +
        `<h2 class="group-title"><span lang="ja">私の</span> Мої уроки</h2>` +
        (m.length ? `<div class="set-grid">${m.map(card).join('')}</div>`
          : `<div class="empty small-empty"><p>${nq ? 'Нічого не знайдено.' : 'Тут з’являться ваші власні уроки.'}</p>${nq ? '' : '<a class="btn primary" href="#/new">Створити мій урок</a>'}</div>`);
      if (nq) $$('.set-card', groups).forEach(el => {
        const s = sets.find(x => setUrl(x.id) === el.getAttribute('href'));
        if (norm(s.title).includes(nq)) return;
        const hits = s.cards.filter(c => norm(`${c.japanese} ${c.reading} ${c.ukrainian}`).includes(nq)).slice(0, 3);
        $('.hits', el).innerHTML = hits.map(c => `<span><span lang="ja">${esc(c.japanese)} ${esc(readingTxt(c))}</span> — ${esc(c.ukrainian)}</span>`).join('');
      });
    };
    filter('');
    $('.search input', root).oninput = e => filter(e.target.value);
    wireSync(root, draw);

    $('[data-exp]', root).onclick = backupNow;
    $('[data-claude]', root).onclick = () => { download(`kotoba-sets-${today()}.json`, setsExport()); toast('Слова експортовано — надішліть файл Claude'); };
    $('[data-imp]', root).onclick = async () => {
      const text = await pickFile();
      if (!text) return;
      try {
        const obj = JSON.parse(text);
        if (!confirm('Замінити поточний прогрес і локальні уроки цією резервною копією?')) return;
        restoreBackup(obj);
        toast('Резервну копію відновлено');
        draw();
      } catch (e) { alert('Не вдалося імпортувати: ' + e.message); }
    };
  };
  draw();
  const off = onSync(() => { const slot = $('.sync-slot', root); if (slot) { slot.innerHTML = syncBox(); wireSync(root, draw); } });
  return off;
}

// =====================================================================
// SET PAGE
// =====================================================================
export function setView(root, id, api) {
  const set = getSet(id);
  if (!set) {
    root.innerHTML = `<div class="empty"><div class="empty-jp" lang="ja">無</div><p>Такого уроку немає.</p><a class="btn primary" href="#/">Усі уроки</a></div>`;
    return;
  }
  const mine = isMine(set);
  const x = setStats(set);
  const missed = mostMissed(set);
  const redraw = () => { const y = window.scrollY; setView(root, id, api); window.scrollTo(0, y); };
  const status = () => {
    if (state.custom.pending[set.id]) return syncBox(true);
    if (set.origin === 'local') return `<div class="sync-ok">☁ Зміни збережено в GitHub — з’являться на всіх пристроях після оновлення Vercel (~1 хв)</div>`;
    return '';
  };
  const nCheck = set.cards.filter(c => c.check).length;
  root.innerHTML = `<div class="set-page fade-in">
    <a class="back" href="#/">${I.back}<span>Усі уроки</span></a>
    <div class="set-head">
      <div>
        <h1 class="set-title">${esc(set.title)}</h1>
        <p class="muted">${pl(set.cards.length, SLOVO)}${set.dateCreated ? ` · ${esc(set.dateCreated)}` : ''} · ${mine ? 'Мій урок' : 'Підручник'}</p>
      </div>
      <div class="set-actions">
        <a class="btn ghost sm" href="${setUrl(set.id)}/add" title="Імпорт: текст, фото, PDF">${I.plus}<span>Імпорт</span></a>
        <a class="btn ghost sm" href="${setUrl(set.id)}/edit">${I.edit}<span>Редагувати все</span></a>
        <button class="icon-btn" data-rename aria-label="Перейменувати" title="Перейменувати">Aa</button>
        <button class="icon-btn" data-delset aria-label="Видалити урок" title="${mine ? 'Видалити урок' : 'Сховати урок'}">${I.trash}</button>
      </div>
    </div>
    <div class="sync-slot">${status()}</div>

    ${set.cards.length ? `
    <div class="modes-grid">${Object.values(MODES).map(m => `<a class="mode-btn" href="${setUrl(set.id)}/${m.key}"><span class="mode-ic" lang="ja">${m.jp}</span><span><b>${m.name}</b><small>${m.desc}</small></span></a>`).join('')}</div>

    <div class="preview">
      <div class="flip-wrap">
        <div class="flip" tabindex="0"><div class="face front"></div><div class="face back"></div></div>
        <div class="card-tools"><button class="icon-btn star" data-star aria-label="Позначити">${I.star}</button><button class="icon-btn" data-say aria-label="Вимова">${I.speaker}</button><button class="icon-btn" data-pedit aria-label="Редагувати слово">${I.edit}</button></div>
      </div>
      <div class="preview-ctrl">
        <button class="round-btn" data-prev aria-label="Назад">${I.left}</button>
        <span class="pv-pos"></span>
        <button class="round-btn" data-next aria-label="Далі">${I.right}</button>
        <a class="icon-btn pv-expand" href="${setUrl(set.id)}/flashcards" aria-label="Відкрити картки">${I.expand}</a>
      </div>
    </div>

    <section class="panel">
      <h2 class="sec-title">Ваш прогрес</h2>
      <div class="stats3">
        <div class="stat"><b>${x.n}</b><span>Нові</span></div>
        <div class="stat l"><b>${x.l}</b><span>Вчу</span></div>
        <div class="stat m"><b>${x.m}</b><span>Вивчені</span></div>
      </div>
      <div class="stack-bar big"><i class="m" style="width:${(x.m / x.total) * 100}%"></i><i class="l" style="width:${(x.l / x.total) * 100}%"></i></div>
      ${missed.length ? `<h3 class="sub-title">Найчастіші помилки</h3>
        <ol class="missed">${missed.map(({ c, p }) => `<li><span class="jp" lang="ja">${esc(c.japanese)} <small class="reading">${esc(readingTxt(c))}</small></span><span class="uk">${esc(c.ukrainian)}</span><span class="miss-n">✕ ${p.w}</span></li>`).join('')}</ol>
        <button class="btn primary" data-difficult>Вчити важкі слова</button>`
      : `<p class="muted small">Помилок ще немає. Слова, у яких ви помиляєтеся, з’являться тут.</p>`}
    </section>` : `<div class="empty"><div class="empty-jp" lang="ja">空</div><p>У цьому уроці ще немає слів.</p></div>`}

    <section class="terms">
      <div class="terms-head">
        <h2 class="sec-title">Слова <span class="muted">(${set.cards.length})</span></h2>
        <div class="seg small" data-tf><button class="on" data-v="all">Усі</button><button data-v="star">★ Важкі</button>${nCheck ? `<button data-v="check">Перевірити <span class="count-pill">${nCheck}</span></button>` : ''}</div>
      </div>
      <div class="term-list"></div>
      <div class="add-slot"></div>
      <button class="btn ghost wide" data-addword>${I.plus}<span>Додати слово</span></button>
    </section>
  </div>`;
  wireSync(root, redraw);
  const offSync = onSync(() => { const slot = $('.sync-slot', root); if (slot) { slot.innerHTML = status(); wireSync(root, redraw); } });

  // ----- terms list -----
  let termFilter = 'all';
  let editing = null; // card id being edited inline
  const list = $('.term-list', root);
  const lvlName = ['Нове', 'Вчу', 'Вивчене'];
  const sectionName = { dialogue: '会話 · діалог', reading: '読み物 · читання' };
  const rowHTML = c => {
    const p = prog(set.id, c.id);
    return `<div class="term ${c.check ? 'needs-check' : ''}" data-id="${esc(c.id)}">
      <span class="lvl lvl${p.lvl || 0}" title="${lvlName[p.lvl || 0]}"></span>
      <div class="term-main">
        <div class="term-jp"><span class="jp" lang="ja">${esc(c.japanese)}</span>${readingTxt(c) ? `<span class="reading" lang="ja">${esc(readingTxt(c))}</span>` : ''}${metaHTML(c)}</div>
        <div class="term-uk">${esc(c.ukrainian)}</div>
      </div>
      <div class="term-acts">
        ${c.check ? `<button class="check-badge as-btn" data-act="checked" title="Позначити як перевірене">перевірити ✓</button>` : ''}
        <button class="icon-btn star ${p.star ? 'on' : ''}" data-act="star" aria-label="Позначити">${I.star}</button>
        <button class="icon-btn" data-act="say" aria-label="Вимова">${I.speaker}</button>
        <button class="icon-btn" data-act="edit" aria-label="Редагувати">${I.edit}</button>
        <button class="icon-btn" data-act="del" aria-label="Видалити">${I.trash}</button>
      </div></div>`;
  };
  const drawTerms = () => {
    const cur = getSet(id) || set;
    set.cards = cur.cards;
    const cs = termFilter === 'star' ? set.cards.filter(c => prog(set.id, c.id).star)
      : termFilter === 'check' ? set.cards.filter(c => c.check) : set.cards;
    let lastSec = 'main';
    list.innerHTML = cs.length ? cs.map(c => {
      const sec = c.section && c.section !== lastSec && sectionName[c.section] ? `<div class="term-sec">◊ ${sectionName[c.section]} ◊</div>` : '';
      if (c.section) lastSec = c.section;
      return sec + (editing === c.id ? `<div class="term editing" data-id="${esc(c.id)}"><div class="inline-form"></div></div>` : rowHTML(c));
    }).join('') : `<p class="muted center">${termFilter === 'star' ? 'Немає позначених слів — натисніть ★ на важких.' : termFilter === 'check' ? 'Усі слова перевірено ✓' : 'Немає слів.'}</p>`;
    if (editing) {
      const c = set.cards.find(k => k.id === editing);
      const slot = $(`.term.editing .inline-form`, list);
      if (c && slot) {
        mountWordForm(slot, {
          setId: set.id, card: c,
          onCancel: () => { editing = null; drawTerms(); },
          onDone: (_, action) => { if (action !== 'undo') editing = null; afterChange(); },
        });
        slot.closest('.term').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  };
  const afterChange = () => { drawTerms(); refreshPreview?.(); };
  drawTerms();
  $('[data-tf]', root).onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    termFilter = b.dataset.v;
    $$('[data-tf] button', root).forEach(el => el.classList.toggle('on', el === b));
    editing = null;
    drawTerms();
  };
  list.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const cid = b.closest('.term').dataset.id;
    const c = set.cards.find(k => k.id === cid);
    const act = b.dataset.act;
    if (act === 'star') { b.classList.toggle('on', toggleStar(set.id, cid)); refreshPreview?.(); }
    else if (act === 'say') speakCard(c);
    else if (act === 'edit') { editing = cid; drawTerms(); }
    else if (act === 'checked') { markChecked(set.id, cid); afterSave('Позначено як перевірене', afterChange); afterChange(); }
    else if (act === 'del') {
      if (confirm(`Видалити слово «${c.japanese} — ${c.ukrainian}»?`)) { deleteCard(set.id, cid); afterSave('Слово видалено', afterChange); afterChange(); }
    }
  };
  $('[data-addword]', root).onclick = () => {
    const slot = $('.add-slot', root);
    slot.innerHTML = `<div class="term editing new"><div class="inline-form"></div></div>`;
    mountWordForm($('.inline-form', slot), {
      setId: set.id, card: null,
      onCancel: () => (slot.innerHTML = ''),
      onDone: (_, action) => { if (action === 'added') { slot.innerHTML = ''; } afterChange(); if (action === 'added') $('[data-addword]', root).focus(); },
    });
    slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // ----- header actions -----
  $('[data-rename]', root).onclick = () => {
    const t = prompt('Назва уроку', set.title);
    if (t && t.trim() && t.trim() !== set.title) { renameSet(set.id, t.trim()); afterSave('Урок перейменовано', redraw); redraw(); }
  };
  $('[data-delset]', root).onclick = () => {
    const msg = mine
      ? `Видалити урок «${set.title}» назавжди (з цього пристрою і з GitHub)?`
      : `Сховати «${set.title}» на цьому пристрої?\n\nЦе урок з підручника — він залишиться в sets.json.`;
    if (confirm(msg)) { deleteSet(set.id); if (mine) syncAll(); toast(mine ? 'Урок видалено' : 'Урок сховано'); location.hash = '#/'; }
  };
  $('[data-difficult]', root)?.addEventListener('click', () => { saveOpts({ filter: 'difficult' }); location.hash = `${setUrl(set.id)}/learn`; });

  // ----- preview flashcard -----
  if (!set.cards.length) return offSync;
  let i = 0;
  const flip = $('.preview .flip', root), wrap = $('.preview .flip-wrap', root);
  const show = anim => {
    if (!set.cards.length) return;
    i = Math.min(i, set.cards.length - 1);
    const c = set.cards[i];
    flip.classList.add('no-anim'); flip.classList.remove('flipped'); void flip.offsetWidth; flip.classList.remove('no-anim');
    $('.front', flip).innerHTML = faceHTML(c, 'ja');
    $('.back', flip).innerHTML = faceHTML(c, 'uk');
    if (anim) { wrap.classList.remove('enter-l', 'enter-r'); void wrap.offsetWidth; wrap.classList.add(anim); }
    $('.pv-pos', root).textContent = `${i + 1} / ${set.cards.length}`;
    $('[data-star]', root).classList.toggle('on', prog(set.id, c.id).star);
  };
  var refreshPreview = () => show();
  const next = () => { i = (i + 1) % set.cards.length; show('enter-r'); };
  const prev = () => { i = (i - 1 + set.cards.length) % set.cards.length; show('enter-l'); };
  flip.onclick = () => { if (!justSwiped(wrap)) flip.classList.toggle('flipped'); };
  onSwipe(wrap, { left: next, right: prev });
  $('[data-next]', root).onclick = next;
  $('[data-prev]', root).onclick = prev;
  $('[data-say]', root).onclick = () => speakCard(set.cards[i]);
  $('[data-star]', root).onclick = () => { toggleStar(set.id, set.cards[i].id); show(); drawTerms(); };
  $('[data-pedit]', root).onclick = () => openWordModal(set.id, set.cards[i], () => afterChange());
  api.setKey(e => {
    if (isTyping(e)) return;
    if (e.key === ' ') { e.preventDefault(); flip.classList.toggle('flipped'); }
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  });
  show();
  return offSync;
}

// =====================================================================
// EDITOR: create my lesson / add words (text, photo OCR, PDF)
// =====================================================================
const toRow = c => {
  const k = hasKanji(c.japanese);
  return { kanji: k ? c.japanese : '', kana: k ? c.reading || '' : c.japanese, ukrainian: c.ukrainian || '', hint: c.hint || '', verbGroup: c.verbGroup || '', check: !!(c.readingAuto || c.fromOcr) };
};
const blank = () => ({ kanji: '', kana: '', ukrainian: '', hint: '', verbGroup: '', check: false });

export function editorView(root, setId, api) {
  const set = setId ? getSet(setId) : null;
  if (setId && !set) { location.hash = '#/'; return; }
  let rows = [];
  let busy = false;
  root.innerHTML = `<div class="editor fade-in">
    <a class="back" href="${set ? setUrl(set.id) : '#/'}">${I.back}<span>${set ? esc(set.title) : 'Усі уроки'}</span></a>
    <h1>${set ? `Додати слова до «${esc(set.title)}»` : 'Створити мій урок'}</h1>
    ${set ? '' : `<label class="field"><span class="field-label">Назва уроку</span><input class="input" data-title placeholder="Напр.: Урок 6 — мої слова (або залиште порожнім: ${today()})"></label>`}

    <div class="panel import-panel">
      <div class="seg tabs" role="tablist"><button class="on" data-tab="text">Текст</button><button data-tab="image">Фото / скріншот</button><button data-tab="pdf">PDF</button></div>

      <div class="tab" data-pane="text">
        <p class="muted small">Одна пара на рядок: <code>見ます - дивитися</code>, <code>みます – дивитися</code>, <code>見ます(みます) дивитися</code>, <code>みます 見ます дивитися</code> або колонки через Tab.</p>
        <textarea class="input" rows="7" data-paste lang="ja" placeholder="見ます - дивитися&#10;新聞(しんぶん) газета&#10;わたし - я"></textarea>
        <button class="btn primary" data-parse>Розпізнати текст</button>
      </div>

      <div class="tab" data-pane="image" hidden>
        <label class="drop" data-drop>
          <input type="file" accept="image/*" data-img hidden>
          <span class="drop-ic">${I.upload}</span>
          <b>Виберіть фото або скріншот</b>
          <span class="muted small">або перетягніть сюди, або вставте з буфера (Ctrl+V)</span>
        </label>
        <img class="img-preview" alt="" hidden>
      </div>

      <div class="tab" data-pane="pdf" hidden>
        <label class="drop" data-drop>
          <input type="file" accept="application/pdf,.pdf" data-pdf hidden>
          <span class="drop-ic">${I.upload}</span>
          <b>Виберіть PDF</b>
          <span class="muted small">Текстовий PDF читається напряму, скан — через розпізнавання (OCR)</span>
        </label>
        <label class="field inline-field"><span class="field-label">Сторінки</span><input class="input" data-pages placeholder="усі (напр. 1-3, 5)"></label>
      </div>

      <div class="progress" hidden><div class="bar"><i></i></div><span class="progress-label small muted"></span></div>
      <p class="hint small">💡 Для великих або нечітких файлів точніше надіслати їх у Claude Code.</p>
      <div class="import-msg"></div>
    </div>

    <div class="preview-head">
      <h2 class="sec-title">Слова <span class="muted row-count"></span></h2>
      <button class="btn ghost sm" data-gen hidden>Згенерувати читання</button>
    </div>
    <div class="ptable">
      <div class="ptable-head"><span>Кандзі</span><span>Кана</span><span>Українською</span><span></span></div>
      <div class="rows"></div>
    </div>
    <button class="btn ghost wide" data-addrow>${I.plus}<span>Додати рядок</span></button>
    <div class="editor-foot"><span class="foot-info muted small"></span><button class="btn primary" data-save>${set ? 'Додати слова' : 'Зберегти урок'}</button></div>
  </div>`;

  const rowsEl = $('.rows', root);
  const msg = $('.import-msg', root);
  const valid = () => rows.filter(r => (r.kanji.trim() || r.kana.trim()) && r.ukrainian.trim());
  const count = () => {
    $('.row-count', root).textContent = `(${valid().length})`;
    $('[data-gen]', root).hidden = !rows.some(r => r.kanji.trim() && !r.kana.trim());
  };
  const draw = () => {
    rowsEl.innerHTML = rows.length ? rows.map((r, i) => `<div class="prow" data-i="${i}">
      <input class="input jp" lang="ja" data-f="kanji" placeholder="漢字" value="${esc(r.kanji)}" aria-label="Кандзі">
      <div class="kana-cell"><input class="input jp ${r.check ? 'auto' : ''}" lang="ja" data-f="kana" placeholder="かな" value="${esc(r.kana)}" aria-label="Кана">${r.check ? '<span class="check-badge" title="Розпізнано автоматично — перевірте">перевірити</span>' : ''}</div>
      <input class="input" data-f="ukrainian" placeholder="переклад" value="${esc(r.ukrainian)}" aria-label="Українською">
      <button class="icon-btn" data-del aria-label="Видалити рядок">${I.trash}</button>
      ${r.hint || r.verbGroup ? `<div class="prow-meta">${esc([r.hint, r.verbGroup && 'гр. ' + r.verbGroup].filter(Boolean).join(' · '))}</div>` : ''}
    </div>`).join('') : `<p class="muted small center empty-rows">Тут з’явиться таблиця розпізнаних слів — її можна виправити перед збереженням.</p>`;
    count();
  };
  draw();

  rowsEl.oninput = e => {
    const f = e.target.dataset.f;
    if (!f) return;
    const row = e.target.closest('.prow'), r = rows[+row.dataset.i];
    r[f] = e.target.value;
    if (r.check) { r.check = false; $('.input.auto', row)?.classList.remove('auto'); $('.check-badge', row)?.remove(); }
    row.classList.remove('invalid');
    count();
  };
  rowsEl.onclick = e => {
    if (!e.target.closest('[data-del]')) return;
    rows.splice(+e.target.closest('.prow').dataset.i, 1);
    draw();
  };
  $('[data-addrow]', root).onclick = () => { rows.push(blank()); draw(); $$('.prow:last-child input', rowsEl)[0]?.focus(); };

  // ----- tabs -----
  $('.tabs', root).onclick = e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    $$('.tabs button', root).forEach(x => x.classList.toggle('on', x === b));
    $$('.tab', root).forEach(p => (p.hidden = p.dataset.pane !== b.dataset.tab));
  };

  // ----- progress & messages -----
  const prog_ = $('.progress', root);
  const setProgress = (p, label) => {
    prog_.hidden = false;
    $('i', prog_).style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    if (label) $('.progress-label', prog_).textContent = label;
  };
  const doneProgress = () => (prog_.hidden = true);
  const showMsg = (html, kind = '') => (msg.innerHTML = html ? `<div class="msg ${kind}">${html}</div>` : '');

  /** Take raw lines → parse → readings → append to table. */
  const ingest = async (text, sourceLabel, fromOcr = false) => {
    const { cards, bad, skipped } = parseText(text);
    if (fromOcr) cards.forEach(c => (c.fromOcr = true));
    if (!cards.length) {
      showMsg(`Не вдалося знайти жодної пари «японське — українське» ${sourceLabel}. Спробуйте чіткіше фото або вставте текст вручну.${bad.length ? `<details><summary>Розпізнаний текст (${bad.length} рядків)</summary><pre>${esc(bad.join('\n'))}</pre></details>` : ''}`, 'err');
      return;
    }
    let generated = 0, genError = '';
    try { generated = await autoReadings(cards, setProgress); }
    catch (e) { genError = 'Не вдалося згенерувати читання автоматично: ' + e.message + ' Можна ввести кану вручну.'; }
    rows = rows.filter(r => r.kanji.trim() || r.kana.trim() || r.ukrainian.trim()).concat(cards.map(toRow));
    draw();
    doneProgress();
    showMsg(`Додано <b>${slov(cards.length)}</b> ${sourceLabel}. Перевірте таблицю нижче.` +
      (fromOcr ? ' Розпізнані слова позначено «перевірити».' : '') + (generated ? ` Читання для ${generated} слів згенеровано автоматично (позначено «перевірити»).` : '') +
      (skipped.length ? `<br>Пропущено власні назви (※): ${skipped.length}.` : '') +
      (genError ? `<br>${esc(genError)}` : '') +
      (bad.length ? `<details><summary>Нерозпізнані рядки (${bad.length}) — можна скопіювати й додати вручну</summary><pre>${esc(bad.join('\n'))}</pre></details>` : ''), 'ok');
    $('.ptable', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  let importer = null;
  const getImporter = async () => (importer ||= await import('./importer.js'));
  const autoReadings = async (cards, onP) => (await getImporter()).autoReadings(cards, onP);
  const guard = async (fn) => {
    if (busy) return toast('Зачекайте — попереднє розпізнавання ще триває');
    busy = true;
    $$('.import-panel button, .import-panel input', root).forEach(b => (b.disabled = true));
    try { await fn(); }
    catch (e) { console.error(e); doneProgress(); showMsg(esc(e.message || 'Невідома помилка.'), 'err'); }
    finally { busy = false; $$('.import-panel button, .import-panel input', root).forEach(b => (b.disabled = false)); }
  };

  $('[data-parse]', root).onclick = () => guard(async () => {
    const ta = $('[data-paste]', root);
    if (!ta.value.trim()) throw new Error('Вставте текст зі словами.');
    await ingest(ta.value, 'з тексту');
    ta.value = '';
  });

  const runImage = file => guard(async () => {
    const imp = await getImporter();
    imp.checkFile(file, 'image');
    const img = $('.img-preview', root);
    img.src = URL.createObjectURL(file);
    img.hidden = false;
    const lines = await imp.ocrImage(file, setProgress);
    await ingest(lines.join('\n'), 'з зображення', true);
  });
  const runPdf = file => guard(async () => {
    const imp = await getImporter();
    imp.checkFile(file, 'pdf');
    const r = await imp.readPdf(file, $('[data-pages]', root).value, setProgress);
    await ingest(r.lines.join('\n'), r.mode === 'text' ? `з PDF (текстовий шар, ${r.pages} стор.)` : `з PDF (OCR, ${r.pages} стор.)`, r.mode !== 'text');
  });
  $('[data-img]', root).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) runImage(f); };
  $('[data-pdf]', root).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) runPdf(f); };
  $$('[data-drop]', root).forEach(d => {
    d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
    d.addEventListener('dragleave', () => d.classList.remove('over'));
    d.addEventListener('drop', e => {
      e.preventDefault(); d.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) ? runPdf(f) : runImage(f);
    });
  });
  const onPaste = e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    $('[data-tab="image"]', root).click();
    runImage(item.getAsFile());
  };
  document.addEventListener('paste', onPaste);

  $('[data-gen]', root).onclick = () => guard(async () => {
    const cards = rows.filter(r => r.kanji.trim() && !r.kana.trim()).map(r => ({ r, japanese: r.kanji.trim(), reading: '' }));
    const n = await autoReadings(cards, setProgress);
    cards.forEach(c => { if (c.reading) { c.r.kana = c.reading; c.r.check = true; } });
    doneProgress(); draw();
    showMsg(`Читання для ${n} слів згенеровано автоматично (позначено «перевірити»).`, 'ok');
  });

  // ----- save -----
  $('[data-save]', root).onclick = async () => {
    if (busy) return;
    let incomplete = 0;
    $$('.prow', rowsEl).forEach((el, i) => {
      const r = rows[i];
      const any = r.kanji.trim() || r.kana.trim() || r.ukrainian.trim();
      const bad = any && !((r.kanji.trim() || r.kana.trim()) && r.ukrainian.trim());
      el.classList.toggle('invalid', !!bad);
      if (bad) incomplete++;
    });
    if (incomplete) return toast(`${incomplete} рядк(и) без японського слова або перекладу`);
    const cards = valid().map(r => ({
      japanese: (r.kanji.trim() || r.kana.trim()), reading: r.kanji.trim() ? r.kana.trim() : '', ukrainian: r.ukrainian.trim(),
      hint: r.hint, verbGroup: r.verbGroup, check: r.check, source: 'my', section: 'main',
    }));
    const key = c => norm(c.japanese) + '|' + norm(c.ukrainian);
    const seen = new Set((set?.cards || []).map(key));
    const out = [];
    let dup = 0;
    for (const c of cards) { const k = key(c); if (seen.has(k)) { dup++; continue; } seen.add(k); out.push(c); }
    if (!out.length) return toast(dup ? 'Усі ці слова вже є в уроці' : 'Додайте хоча б одне слово');
    const btn = $('[data-save]', root);
    btn.disabled = true; btn.textContent = 'Зберігаю…';
    let target;
    if (set) { addCards(set.id, out); target = set.id; }
    else target = createSet($('[data-title]', root).value.trim(), out).id;
    const dupTxt = dup ? ` Пропущено дублікатів: ${dup}.` : '';
    const r = await syncAll();
    toast(r.ok ? `Збережено ${slov(out.length)} в GitHub ✓ — на всіх пристроях за ~1 хв.${dupTxt}` : `Збережено ${slov(out.length)} у цьому браузері.${dupTxt}`);
    location.hash = setUrl(target);
  };

  return () => document.removeEventListener('paste', onPaste);
}
