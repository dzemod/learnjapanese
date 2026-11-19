// Kanji associations: «Асоціація» block of the kanji card, hint in the writing mode and in «Сьогодні».
//   • Складники — the kanji's components from KanjiVG (kanji-parts.js) with their Ukrainian meaning;
//   • Моя асоціація — the learner's own note (localStorage jp.kanjiNotes { kanjiId: { t, at } }, synced; an emptied
//     note is kept as t: "" so the deletion reaches other devices);
//   • «Сенсей підкаже» — two short association ideas from the AI (the shared Puter client chat() of ai-helper.js, only
//     on click); «Взяти» copies one into the note editor, nothing is saved without «Зберегти».
//   • Готова асоціація — a ready-made one from site/data/kanji-assoc.json ({ kanji: { id: { t, check } } }, written for
//     this site, not from the book → «перевірити»), shown while the learner has no own note; «Взяти собі» → editor.
import { $, $$, esc, toast } from './util.js';
import { chat, TRANSLIT } from './ai-helper.js';
import { partsWithMeanings } from './kanji-parts.js';
import { checkSoon } from './achievements.js';

export const NOTES_KEY = 'jp.kanjiNotes';
export const NOTE_MAX = 300;
export const MSG_SIGNIN = 'Щоб Сенсей підказав асоціацію, увійдіть у безкоштовний акаунт Puter';
const lget = () => { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}') || {}; } catch { return mem; } };
let mem = {};
const lset = v => { mem = v; try { localStorage.setItem(NOTES_KEY, JSON.stringify(v)); } catch { /* memory only */ } };
export const getNote = id => String(lget()[id]?.t || '');

// ready-made associations (loaded once with the kanji data, see kanji.js loadKanji)
let defaults = null, defaultsLoad = null;
export function loadDefaults() {
  return (defaultsLoad ||= fetch('data/kanji-assoc.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : { kanji: {} }))
    .then(j => { defaults = j && typeof j.kanji === 'object' ? j.kanji : {}; })
    .catch(() => { defaults = {}; defaultsLoad = null; }));
}
/** { t, check } or null */
export const defaultAssoc = id => (defaults && defaults[id]?.t ? defaults[id] : null);
export function setNote(id, text) {
  const all = lget();
  const t = String(text || '').trim().slice(0, NOTE_MAX);
  if (!t && !all[id]) return;
  all[id] = { t, at: Date.now() };
  lset(all);
  checkSoon(false); // «Асоціації» achievements
}

export const ASSOC_SYSTEM = `You help a Ukrainian-speaking learner remember a kanji. Write in Ukrainian.
Give exactly two different association ideas, each one short, vivid story (one or two sentences, at most 200 characters) that links the kanji's shape — its components — to its meaning. Name every component you use in Ukrainian with the component in brackets, e.g. «жінка (女)». You may add a hook for one reading only if it is natural.
Format: two lines, the first starts with "1. ", the second with "2. ". Nothing else: no title, no Markdown, no explanations, no questions.
${TRANSLIT}`;

/** The request text for one kanji (also used by tests). */
export function assocPrompt(k, parts) {
  const comp = parts.length ? parts.map(p => (p.uk ? `${p.ch} (${p.uk})` : p.ch)).join(', ') : 'невідомі';
  return `Канджі: ${k.kanji}\nЗначення: ${k.meaning}${k.en ? ` (англійською: ${k.en})` : ''}\nОн: ${(k.on || []).join('、') || '—'}\nКун: ${(k.kun || []).join('、') || '—'}\nСкладники: ${comp}`;
}
/** "1. …\n2. …" → ['…', '…'] (falls back to the whole text). */
export function parseIdeas(text) {
  const lines = String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  const num = lines.map(s => /^(?:\d+[.)]|[-•])\s*(.+)$/.exec(s)).filter(Boolean).map(m => m[1].replace(/\*\*/g, '').trim());
  return (num.length ? num : [lines.join(' ')]).filter(Boolean).slice(0, 3).map(s => s.slice(0, 400));
}

const partsHTML = parts => (parts.length
  ? `<div class="as-parts" aria-label="Складники">${parts.map((p, i) => `${i ? '<span class="as-plus" aria-hidden="true">+</span>' : ''}<span class="as-part"><b lang="ja">${esc(p.ch)}</b>${p.uk ? `<small>${esc(p.uk)}</small>` : ''}</span>`).join('')}</div>`
  : '');

/**
 * The block of the kanji card. box = empty element; k = kanji; getParts() → Promise<[ch]> (KanjiVG);
 * meaningOf(ch) → Ukrainian meaning of a kanji from kanji.json or ''.
 */
export function mountAssoc(box, k, { getParts, meaningOf = () => '' }) {
  let parts = [], editing = false, ideas = null, busy = false, err = '';
  const draw = () => {
    const note = getNote(k.id), def = defaultAssoc(k.id);
    box.innerHTML = `<h3 class="sub-title">Асоціація</h3>
      ${partsHTML(parts)}
      ${editing ? `<label class="field as-edit"><span class="muted small">Моя асоціація (до ${NOTE_MAX} символів)</span>
          <textarea class="input" rows="3" maxlength="${NOTE_MAX}" placeholder="Наприклад: людина (亻) сперлася на дерево (木) — відпочиває">${esc(note)}</textarea></label>
          <div class="btn-row"><button type="button" class="btn primary sm" data-as-save>Зберегти</button><button type="button" class="btn ghost sm" data-as-cancel>Скасувати</button></div>`
        : note ? `<div class="as-note"><p>${esc(note)}</p><button type="button" class="icon-btn sm" data-as-edit aria-label="Змінити асоціацію" title="Змінити">✎</button></div>`
          : def ? `<div class="as-note as-default"><p class="as-def-l small">Готова асоціація ${def.check ? '<span class="check-badge" title="Написано для сайту, не з підручника — перевірте">перевірити</span>' : ''}</p><p>${esc(def.t)}</p></div>`
          : `<p class="muted small as-empty">Придумайте коротку історію зі складників — так канджі запам’ятовується швидше.</p>`}
      <div class="btn-row as-btns">${!editing && !note && def ? '<button type="button" class="btn ghost sm" data-as-own>Взяти собі</button>' : ''}${!editing && !note ? '<button type="button" class="btn ghost sm" data-as-edit>Написати свою</button>' : ''}
        <button type="button" class="btn ghost sm" data-as-ai ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span> Сенсей думає…' : '<span lang="ja">先生</span> Сенсей підкаже'}</button></div>
      ${err ? `<p class="ask-err small" role="alert">${esc(err)}</p>` : ''}
      ${ideas ? `<div class="as-ideas"><p class="muted small">Ідеї Сенсея (ШІ, можуть бути неточними):</p>${ideas.map((t, i) => `<div class="as-idea"><p>${esc(t)}</p><button type="button" class="btn ghost sm" data-as-take="${i}">Взяти</button></div>`).join('')}</div>` : ''}`;
    $$('[data-as-edit]', box).forEach(b => (b.onclick = () => { editing = true; draw(); $('textarea', box)?.focus(); }));
    $('[data-as-cancel]', box)?.addEventListener('click', () => { editing = false; draw(); });
    $('[data-as-own]', box)?.addEventListener('click', () => { editing = true; draw(); const ta = $('textarea', box); ta.value = def.t.slice(0, NOTE_MAX); ta.focus(); });
    $('[data-as-save]', box)?.addEventListener('click', () => {
      const t = $('textarea', box).value;
      setNote(k.id, t);
      editing = false; draw();
      toast(t.trim() ? 'Асоціацію збережено' : 'Асоціацію видалено');
    });
    $$('[data-as-take]', box).forEach(b => (b.onclick = () => {
      const t = ideas[+b.dataset.asTake];
      editing = true; draw();
      const ta = $('textarea', box);
      ta.value = t.slice(0, NOTE_MAX); ta.focus();
    }));
    $('[data-as-ai]', box)?.addEventListener('click', ask);
  };
  async function ask() {
    if (busy) return;
    busy = true; err = ''; draw();
    const r = await chat([{ role: 'system', content: ASSOC_SYSTEM }, { role: 'user', content: assocPrompt(k, parts) }], { signin: MSG_SIGNIN, maxTokens: 600, timeoutMs: 60000 });
    busy = false;
    if (r.answer) ideas = parseIdeas(r.answer); else err = r.error;
    if (box.isConnected) draw();
  }
  draw();
  if (!defaults) loadDefaults().then(() => { if (box.isConnected && !editing) draw(); });
  Promise.resolve().then(getParts).then(list => { parts = partsWithMeanings(list || [], meaningOf); if (box.isConnected) draw(); }).catch(() => {});
}

/** Writing mode / «Сьогодні»: a collapsed hint with the learner's note (the kanji itself masked while recalling). */
export function noteHintHTML(k, mask = false) {
  const own = getNote(k.id), note = own || defaultAssoc(k.id)?.t || '';
  if (!note) return '';
  const t = mask ? esc(note).split(esc(k.kanji)).join('<span class="kw-mask">◯</span>') : esc(note);
  return `<details class="as-hint"><summary>${own ? 'Моя асоціація' : 'Асоціація'}</summary><p>${t}</p></details>`;
}
