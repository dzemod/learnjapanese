// Word editing: inline form, modal (from study modes), bulk edit table, undo toast.
import { $, $$, esc, I, toast, modal, hasKanji } from './util.js';
import {
  getSet, updateCard, addCards, deleteCard, markChecked, replaceCards, undoLast, cardHistory, syncAll,
} from './store.js';

const toForm = c => {
  const k = hasKanji(c?.japanese);
  return {
    kanji: k ? c.japanese : '', kana: k ? c.reading || '' : c?.japanese || '',
    ukrainian: c?.ukrainian || '', hint: c?.hint || '', verbGroup: c?.verbGroup || '',
  };
};
const fromForm = f => {
  const kanji = f.kanji.trim(), kana = f.kana.trim();
  return { japanese: kanji || kana, reading: kanji ? kana : '', ukrainian: f.ukrainian.trim(), hint: f.hint.trim(), verbGroup: f.verbGroup };
};
const fmtTime = t => new Date(t).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Save → toast with "Скасувати" (undo) → push to GitHub in the background. */
export function afterSave(message, refresh) {
  toast(message, {
    duration: 6000,
    action: {
      label: 'Скасувати', fn: () => {
        if (undoLast()) { toast('Зміну скасовано'); refresh?.(); syncAll(); }
      },
    },
  });
  syncAll();
}

function formHTML(card, setId, isNew) {
  const f = toForm(card);
  const hist = !isNew ? cardHistory(setId, card.id) : [];
  return `<form class="word-form" autocomplete="off" novalidate>
    ${card?.check ? `<div class="check-note"><span class="check-badge">перевірити</span> Слово розпізнано автоматично — перевірте його.</div>` : ''}
    <div class="wf-grid">
      <label class="field"><span class="field-label">Канджі <span class="muted">(порожньо, якщо немає)</span></span>
        <input class="input jp big" lang="ja" name="kanji" value="${esc(f.kanji)}" placeholder="見ます" enterkeyhint="next"></label>
      <label class="field"><span class="field-label">Кана (читання)</span>
        <input class="input jp big" lang="ja" name="kana" value="${esc(f.kana)}" placeholder="みます" enterkeyhint="next"></label>
    </div>
    <label class="field"><span class="field-label">Українською</span>
      <textarea class="input big" name="ukrainian" rows="2" placeholder="дивитися">${esc(f.ukrainian)}</textarea></label>
    <div class="wf-grid">
      <label class="field"><span class="field-label">Підказка <span class="muted">(необов’язково)</span></span>
        <input class="input jp" lang="ja" name="hint" value="${esc(f.hint)}" placeholder="[じかんに～]"></label>
      <div class="field"><span class="field-label">Група дієслова</span>
        <div class="seg vg-seg" data-vg>${[['', '—'], ['I', 'I'], ['II', 'II'], ['III', 'III']].map(([v, t]) => `<button type="button" class="${f.verbGroup === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div></div>
    </div>
    <div class="wf-error" hidden></div>
    <div class="wf-btns"><button type="button" class="btn ghost" data-cancel>Скасувати</button><button class="btn primary" type="submit">${isNew ? 'Додати слово' : 'Зберегти'}</button></div>
    ${isNew ? '' : `<div class="wf-extra">
      ${card.check ? `<button type="button" class="btn ghost sm" data-confirm>${I.check}<span>Позначити як перевірене</span></button>` : ''}
      ${hist.length ? `<button type="button" class="btn ghost sm" data-hist>${I.undo}<span>Попередні версії (${hist.length})</span></button>` : ''}
      <button type="button" class="btn ghost sm danger" data-delete>${I.trash}<span>Видалити слово</span></button>
    </div><div class="wf-history" hidden></div>`}
  </form>`;
}

/**
 * Mount an edit form into `el`.
 * opts: { setId, card (null = new word), onDone(card|null, action), onCancel, focus }
 * action: 'saved' | 'added' | 'deleted' | 'checked'
 */
export function mountWordForm(el, { setId, card = null, onDone, onCancel, focus = true }) {
  const isNew = !card;
  el.innerHTML = formHTML(card, setId, isNew);
  const form = $('form', el);
  let vg = card?.verbGroup || '';
  $('[data-vg]', form).onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    vg = b.dataset.v;
    $$('[data-vg] button', form).forEach(x => x.classList.toggle('on', x === b));
  };
  const err = msg => { const e = $('.wf-error', form); e.textContent = msg; e.hidden = !msg; };
  if (focus) setTimeout(() => form.kanji.focus({ preventScroll: true }), 50);
  // Enter in a field → next field (IME-safe: ignore while composing)
  $$('input', form).forEach((inp, i, all) => inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault(); e.stopPropagation();
      const next = [form.kana, form.ukrainian][[form.kanji, form.kana].indexOf(inp)];
      if (next) next.focus(); else form.requestSubmit();
    }
  }));
  form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel?.(); } });
  $('[data-cancel]', form).onclick = () => onCancel?.();
  form.onsubmit = e => {
    e.preventDefault();
    const data = fromForm({ kanji: form.kanji.value, kana: form.kana.value, ukrainian: form.ukrainian.value, hint: form.hint.value, verbGroup: vg });
    if (!data.japanese) return err('Введіть японське слово (канджі або кану).');
    if (!data.ukrainian) return err('Введіть переклад українською.');
    if (hasKanji(form.kana.value)) return err('У полі «Кана» мають бути лише хірагана/катакана.');
    if (isNew) {
      const [added] = addCards(setId, [data]);
      afterSave('Слово додано', () => onDone?.(null, 'undo'));
      onDone?.(added, 'added');
    } else {
      const saved = updateCard(setId, { ...card, ...data });
      afterSave('Збережено', () => onDone?.(null, 'undo'));
      onDone?.(saved, 'saved');
    }
  };
  if (isNew) return;
  $('[data-delete]', form).onclick = () => {
    if (!confirm(`Видалити слово «${card.japanese} — ${card.ukrainian}»?`)) return;
    deleteCard(setId, card.id);
    afterSave('Слово видалено', () => onDone?.(null, 'undo'));
    onDone?.(null, 'deleted');
  };
  $('[data-confirm]', form)?.addEventListener('click', () => {
    markChecked(setId, card.id);
    afterSave('Позначено як перевірене', () => onDone?.(null, 'undo'));
    onDone?.({ ...card, check: false }, 'checked');
  });
  $('[data-hist]', form)?.addEventListener('click', () => {
    const box = $('.wf-history', form);
    box.hidden = !box.hidden;
    box.innerHTML = cardHistory(setId, card.id).map((h, i) => `<div class="hist-row">
      <div><span class="jp" lang="ja">${esc(h.japanese)}</span> ${h.reading ? `<span class="reading" lang="ja">(${esc(h.reading)})</span>` : ''} — ${esc(h.ukrainian)}
      <div class="muted small">${fmtTime(h.at)}</div></div>
      <button type="button" class="btn ghost sm" data-restore="${i}">Відновити</button></div>`).join('');
    $$('[data-restore]', box).forEach(b => (b.onclick = () => {
      const h = cardHistory(setId, card.id)[+b.dataset.restore];
      const f = toForm(h);
      form.kanji.value = f.kanji; form.kana.value = f.kana; form.ukrainian.value = f.ukrainian; form.hint.value = f.hint;
      vg = f.verbGroup;
      $$('[data-vg] button', form).forEach(x => x.classList.toggle('on', x.dataset.v === vg));
      toast('Попередню версію підставлено — натисніть «Зберегти»');
    }));
  });
}

/** Edit a word in a bottom sheet (used inside study modes). onDone(updatedCard|null, action) */
export function openWordModal(setId, card, onDone) {
  modal(`<div class="modal-head"><h2>${card ? 'Редагувати слово' : 'Нове слово'}</h2></div><div class="modal-form"></div>`, (m, close) => {
    m.classList.add('sheet');
    mountWordForm($('.modal-form', m), {
      setId, card,
      onCancel: close,
      onDone: (c, action) => { if (action !== 'undo') close(); onDone?.(c, action); },
    });
  });
}

// =====================================================================
// BULK EDIT
// =====================================================================
export function bulkEditView(root, setId) {
  const set = getSet(setId);
  if (!set) { location.hash = '#/'; return; }
  let rows = set.cards.map(c => ({ ...toForm(c), id: c.id, check: c.check, section: c.section, source: c.source, orig: JSON.stringify(toForm(c)) }));
  let dirty = false;
  root.innerHTML = `<div class="bulk fade-in">
    <a class="back" href="#/set/${encodeURIComponent(set.id)}">${I.back}<span>${esc(set.title)}</span></a>
    <h1>Редагувати все</h1>
    <label class="field"><span class="field-label">Назва уроку</span><input class="input" data-title value="${esc(set.title)}"></label>
    <p class="muted small">Змінюйте слова, перетягуйте рядки за ⠿ або міняйте порядок кнопками ↑ ↓. Усе збережеться разом. Прогрес навчання не скидається.</p>
    <div class="bulk-rows"></div>
    <button class="btn ghost wide" data-addrow>${I.plus}<span>Додати слово</span></button>
    <div class="editor-foot"><span class="muted small bulk-info"></span>
      <div class="foot-pair"><a class="btn ghost" href="#/set/${encodeURIComponent(set.id)}" data-cancel>Скасувати</a><button class="btn primary" data-save>Зберегти все</button></div></div>
  </div>`;
  const list = $('.bulk-rows', root);
  const info = () => ($('.bulk-info', root).textContent = `${rows.length} слів${dirty ? ' · є незбережені зміни' : ''}`);
  const draw = () => {
    list.innerHTML = rows.map((r, i) => `<div class="brow ${r.check ? 'needs-check' : ''}" data-i="${i}" draggable="false">
      <div class="brow-side">
        <span class="drag" title="Перетягніть" aria-hidden="true">⠿</span>
        <span class="brow-num">${i + 1}</span>
        <button type="button" class="icon-btn sm" data-up ${i ? '' : 'disabled'} aria-label="Вгору">↑</button>
        <button type="button" class="icon-btn sm" data-down ${i < rows.length - 1 ? '' : 'disabled'} aria-label="Вниз">↓</button>
      </div>
      <div class="brow-fields">
        <input class="input jp" lang="ja" data-f="kanji" value="${esc(r.kanji)}" placeholder="漢字" aria-label="Канджі">
        <input class="input jp" lang="ja" data-f="kana" value="${esc(r.kana)}" placeholder="かな" aria-label="Кана">
        <input class="input uk" data-f="ukrainian" value="${esc(r.ukrainian)}" placeholder="переклад" aria-label="Українською">
        <input class="input jp" lang="ja" data-f="hint" value="${esc(r.hint)}" placeholder="підказка" aria-label="Підказка">
        <select class="select" data-f="verbGroup" aria-label="Група дієслова">${['', 'I', 'II', 'III'].map(v => `<option value="${v}" ${r.verbGroup === v ? 'selected' : ''}>${v ? 'гр. ' + v : 'гр. —'}</option>`).join('')}</select>
      </div>
      <div class="brow-acts">${r.check ? '<span class="check-badge" title="Перевірити">перевірити</span>' : ''}<button type="button" class="icon-btn" data-del aria-label="Видалити">${I.trash}</button></div>
    </div>`).join('');
    info();
  };
  draw();
  const mark = () => { dirty = true; info(); };
  list.oninput = list.onchange = e => {
    const f = e.target.dataset.f;
    if (!f) return;
    const r = rows[+e.target.closest('.brow').dataset.i];
    r[f] = e.target.value;
    mark();
  };
  const move = (i, j) => {
    if (j < 0 || j >= rows.length) return;
    const [r] = rows.splice(i, 1);
    rows.splice(j, 0, r);
    mark(); draw();
    $(`.brow[data-i="${j}"]`, list)?.classList.add('moved');
  };
  list.onclick = e => {
    const row = e.target.closest('.brow');
    if (!row) return;
    const i = +row.dataset.i;
    if (e.target.closest('[data-up]')) move(i, i - 1);
    else if (e.target.closest('[data-down]')) move(i, i + 1);
    else if (e.target.closest('[data-del]')) {
      const r = rows[i];
      if ((r.kanji || r.kana || r.ukrainian) && !confirm(`Видалити «${r.kanji || r.kana} — ${r.ukrainian}»?`)) return;
      rows.splice(i, 1); mark(); draw();
    }
  };
  // Drag & drop (mouse / pen) by the ⠿ handle
  let dragFrom = null;
  list.addEventListener('pointerdown', e => {
    const h = e.target.closest('.drag');
    if (h) h.closest('.brow').setAttribute('draggable', 'true');
  });
  list.addEventListener('dragstart', e => {
    const row = e.target.closest('.brow');
    dragFrom = +row.dataset.i;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFrom));
  });
  list.addEventListener('dragover', e => {
    if (dragFrom == null) return;
    e.preventDefault();
    $$('.brow', list).forEach(r => r.classList.remove('drop-before', 'drop-after'));
    const row = e.target.closest('.brow');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('drop', e => {
    e.preventDefault();
    const row = e.target.closest('.brow');
    if (dragFrom == null || !row) return;
    let to = +row.dataset.i + (row.classList.contains('drop-after') ? 1 : 0);
    if (to > dragFrom) to--;
    const from = dragFrom;
    dragFrom = null;
    move(from, to);
  });
  list.addEventListener('dragend', () => {
    dragFrom = null;
    $$('.brow', list).forEach(r => { r.classList.remove('dragging', 'drop-before', 'drop-after'); r.setAttribute('draggable', 'false'); });
  });
  // Touch: long-press on handle, then move finger
  let touch = null;
  list.addEventListener('touchstart', e => {
    const h = e.target.closest('.drag');
    if (!h) return;
    touch = { from: +h.closest('.brow').dataset.i };
    h.closest('.brow').classList.add('dragging');
  }, { passive: true });
  list.addEventListener('touchmove', e => {
    if (!touch) return;
    e.preventDefault();
    const t = e.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY)?.closest('.brow');
    $$('.brow', list).forEach(r => r.classList.remove('drop-before', 'drop-after'));
    if (el) { const rect = el.getBoundingClientRect(); el.classList.add(t.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after'); touch.over = el; }
  }, { passive: false });
  list.addEventListener('touchend', () => {
    if (!touch) return;
    const { from, over } = touch;
    touch = null;
    $$('.brow', list).forEach(r => r.classList.remove('dragging'));
    if (!over) return;
    let to = +over.dataset.i + (over.classList.contains('drop-after') ? 1 : 0);
    if (to > from) to--;
    move(from, to);
  });

  $('[data-addrow]', root).onclick = () => {
    rows.push({ kanji: '', kana: '', ukrainian: '', hint: '', verbGroup: '', id: null, check: false });
    mark(); draw();
    $$('.brow:last-child input', list)[0]?.focus();
  };
  $('[data-title]', root).oninput = mark;
  $('[data-cancel]', root).onclick = e => { if (dirty && !confirm('Вийти без збереження змін?')) e.preventDefault(); };
  $('[data-save]', root).onclick = () => {
    $$('.brow', list).forEach(el => el.classList.remove('invalid'));
    const keep = rows.filter(r => r.kanji.trim() || r.kana.trim() || r.ukrainian.trim());
    const bad = keep.map((r, i) => [r, i]).filter(([r]) => !(r.kanji.trim() || r.kana.trim()) || !r.ukrainian.trim() || hasKanji(r.kana));
    if (bad.length) {
      bad.forEach(([r]) => $(`.brow[data-i="${rows.indexOf(r)}"]`, list)?.classList.add('invalid'));
      $('.brow.invalid', list)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast(`Виправте ${bad.length} рядк(и): потрібні японське слово і переклад; у «Кана» — лише кана`);
    }
    const cards = keep.map(r => {
      const changed = JSON.stringify(toForm(fromForm(r))) !== r.orig;
      return { ...(r.id ? { id: r.id } : {}), ...fromForm(r), section: r.section || 'main', source: r.source || 'my', ...(changed ? {} : { check: r.check }) };
    });
    replaceCards(set.id, cards, $('[data-title]', root).value.trim() || set.title);
    dirty = false;
    afterSave(`Збережено ${cards.length} слів`, () => { if (location.hash.startsWith(`#/set/${encodeURIComponent(set.id)}`)) window.dispatchEvent(new HashChangeEvent('hashchange')); });
    location.hash = `#/set/${encodeURIComponent(set.id)}`;
  };
  const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}
