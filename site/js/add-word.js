// «До мого уроку»: adds a word or sentence to one of my lessons (Перекладач, Словник).
// Last chosen lesson: localStorage jp.translate.lastSet (shared by both tabs).
import { $, esc, modal, hasKanji } from './util.js';
import { getSets, isMine, createSet, addCards } from './store.js';
import { afterSave } from './edit.js';

/** Dictionary form → ます-form (my cards keep verbs in the ます-form). */
export function toMasu(dict, group) {
  const d = String(dict || '');
  if (group === 'III') return d.replace(/する$/, 'します').replace(/(来|く)る$/, (m, k) => (k === '来' ? '来ます' : 'きます'));
  if (group === 'II') return d.replace(/る$/, 'ます');
  const U2I = { 'う': 'い', 'く': 'き', 'ぐ': 'ぎ', 'す': 'し', 'つ': 'ち', 'ぬ': 'に', 'ぶ': 'び', 'む': 'み', 'る': 'り' };
  const last = d.slice(-1);
  return U2I[last] ? d.slice(0, -1) + U2I[last] + 'ます' : d;
}

export function addToLessonModal({ kanji = '', kana = '', ukrainian = '', verbGroup = '', title = 'Додати до мого уроку', newTitle = 'Перекладач' }) {
  const mine = getSets().filter(isMine);
  const last = (() => { try { return localStorage.getItem('jp.translate.lastSet') || ''; } catch { return ''; } })();
  modal(`<div class="modal-head"><h2>${esc(title)}</h2></div>
    <form class="tr-add">
      <label class="field"><span>Урок</span><select class="input" name="set">
        ${mine.map(s => `<option value="${esc(s.id)}" ${s.id === last ? 'selected' : ''}>${esc(s.title)} (${s.cards.length})</option>`).join('')}
        <option value="" ${!mine.length ? 'selected' : ''}>+ Новий урок…</option></select></label>
      <label class="field" data-new hidden><span>Назва нового уроку</span><input class="input" name="title" placeholder="Наприклад: ${esc(newTitle)}"></label>
      <label class="field"><span>Канджі (якщо є)</span><input class="input jp" name="kanji" lang="ja" value="${esc(kanji)}"></label>
      <label class="field"><span>Кана (читання)</span><input class="input jp" name="kana" lang="ja" value="${esc(kana)}"></label>
      <label class="field"><span>Переклад українською</span><textarea class="input" name="uk" rows="2">${esc(ukrainian)}</textarea></label>
      <p class="wf-error" hidden></p>
      <div class="modal-btns"><button type="button" class="btn ghost" data-cancel>Скасувати</button><button class="btn primary">Додати</button></div>
    </form>`, (m, close) => {
    m.classList.add('sheet');
    const f = $('form', m), err = $('.wf-error', m), nw = $('[data-new]', m);
    const sync = () => { nw.hidden = !!f.set.value; };
    sync();
    f.set.onchange = sync;
    $('[data-cancel]', m).onclick = close;
    f.onsubmit = e => {
      e.preventDefault();
      const k = f.kanji.value.trim(), kn = f.kana.value.trim(), uk = f.uk.value.trim();
      const show = msg => { err.textContent = msg; err.hidden = false; };
      if (!k && !kn) return show('Введіть японське слово або речення.');
      if (!uk) return show('Введіть переклад українською.');
      if (hasKanji(kn)) return show('У полі «Кана» мають бути лише хірагана або катакана.');
      const card = { japanese: hasKanji(k) ? k : (k || kn), reading: hasKanji(k) ? kn : '', ukrainian: uk, verbGroup, source: 'my' };
      let setId = f.set.value;
      if (setId) addCards(setId, [card]);
      else setId = createSet(f.title.value.trim() || newTitle, [card]).id;
      try { localStorage.setItem('jp.translate.lastSet', setId); } catch { /* ignore */ }
      close();
      afterSave('Додано до уроку');
    };
  });
}
