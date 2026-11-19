// Anki export (pure text builders — tests: tools/test-anki.mjs) + the dialog «Експорт в Anki».
// Anki imports a plain-text file: one note per line, tab-separated fields, with header lines
// (#separator:tab, #html:true, #columns:…, #tags column:N, #deck:…) — File › Import in Anki 2.1.55+.
// Words:  Японською | Читання | Українською | Підказка | tags (lesson id, «my», «star», «known»)
// Kanji:  Канджі | Значення | Он | Кун | Слова (examples) | Асоціація | tags (book, lesson)
import { $, modal, toast, today } from './util.js';
import { getSets, prog } from './store.js';

const clean = s => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const html = s => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = s => clean(s).replace(/\s+/g, '_');
const header = (deck, cols, tagCol) => [`#separator:tab`, `#html:true`, `#deck:${deck}`, `#columns:${cols.join('\t')}`, `#tags column:${tagCol}`];

/** sets = [{ id, title, source, cards: [internal card] }]; progOf(setId, cardId) → { lvl, star } */
export function wordsTSV(sets, progOf = () => ({}), deck = 'Kotoba::Слова') {
  const lines = header(deck, ['Японською', 'Читання', 'Українською', 'Підказка', 'Tags'], 5);
  for (const s of sets) for (const c of s.cards) {
    const p = progOf(s.id, c.id) || {};
    const tags = [tag(s.id), s.source === 'textbook' ? '' : 'my', p.star ? 'star' : '', p.lvl >= 2 ? 'known' : ''].filter(Boolean).join(' ');
    lines.push([html(c.japanese), html(c.reading), html(c.ukrainian), html(c.hint), tags].join('\t'));
  }
  return lines.join('\n') + '\n';
}

/** lessons = [{ id, bookId, kanji: [...] }]; assocOf(kanjiId) → text or '' */
export function kanjiTSV(lessons, assocOf = () => '', deck = 'Kotoba::Канджі') {
  const lines = header(deck, ['Канджі', 'Значення', 'Он', 'Кун', 'Слова', 'Асоціація', 'Tags'], 7);
  for (const l of lessons) for (const k of l.kanji) {
    const ex = (k.examples || []).slice(0, 6).map(e => `${html(e.word)}${e.kana && e.kana !== e.word ? ` (${html(e.kana)})` : ''} — ${html(e.uk)}`).join('<br>');
    lines.push([html(k.kanji), html(k.meaning), html((k.on || []).join('、')), html((k.kun || []).join('、').replace(/-/g, '')), ex, html(assocOf(k.id)), [tag(l.bookId), tag(l.id)].join(' ')].join('\t'));
  }
  return lines.join('\n') + '\n';
}

export function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** The dialog. kanji = { books: () => books, assocOf } (loaded by the caller; may be null). */
export function openAnkiDialog(kanji = null) {
  const sets = getSets();
  const lessonNo = id => { const m = /^mnn-(\d+)$/.exec(id); return m ? +m[1] : null; };
  modal(`<h2>Експорт в Anki</h2>
    <p class="muted small">Файл .txt для Anki: «Файл → Імпортувати». Колонки й колода «Kotoba» налаштуються самі; HTML увімкнено.</p>
    <form class="anki-form">
      <label class="field"><span>Що експортувати</span><select class="input" name="what">
        <option value="all">Слова: усі уроки</option><option value="p1">Слова: Частина I (уроки 0–25)</option><option value="p2">Слова: Частина II (уроки 26–50)</option><option value="my">Слова: мої уроки</option><option value="known">Слова: лише вивчені</option><option value="star">Слова: лише позначені ★</option>
        ${kanji ? '<option value="k300">Канджі: Початковий 300</option><option value="k700">Канджі: Середній 700</option><option value="kall">Канджі: усі 1000</option>' : ''}
      </select></label>
      <div class="modal-btns"><button type="button" class="btn ghost" data-cancel>Скасувати</button><button class="btn primary">Завантажити</button></div>
    </form>`, (m, close) => {
    const f = $('form', m);
    $('[data-cancel]', m).onclick = close;
    f.onsubmit = e => {
      e.preventDefault();
      const w = f.what.value;
      let text, name, n = 0;
      if (w.startsWith('k')) {
        const lessons = kanji.books().filter(b => w === 'kall' || b.id === w).flatMap(b => b.lessons.map(l => ({ ...l, bookId: b.id })));
        n = lessons.reduce((a, l) => a + l.kanji.length, 0);
        text = kanjiTSV(lessons, kanji.assocOf);
        name = `kotoba-anki-kanji-${w === 'kall' ? 'all' : w}-${today()}.txt`;
      } else {
        let ss = sets;
        if (w === 'p1') ss = sets.filter(s => lessonNo(s.id) != null && lessonNo(s.id) <= 25);
        else if (w === 'p2') ss = sets.filter(s => lessonNo(s.id) >= 26);
        else if (w === 'my') ss = sets.filter(s => s.source !== 'textbook');
        else if (w === 'known' || w === 'star') ss = sets.map(s => ({ ...s, cards: s.cards.filter(c => (w === 'known' ? prog(s.id, c.id).lvl >= 2 : prog(s.id, c.id).star)) }));
        n = ss.reduce((a, s) => a + s.cards.length, 0);
        text = wordsTSV(ss, prog);
        name = `kotoba-anki-words-${w}-${today()}.txt`;
      }
      if (!n) { toast('Немає що експортувати'); return; }
      downloadText(name, text);
      toast(`Експортовано: ${n}. Відкрийте файл в Anki через «Імпортувати»`, { duration: 4000 });
      close();
    };
  });
}
