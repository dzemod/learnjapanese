// Index of my Ukrainian word data (lesson sets + kanji-book words + single kanji) for the Перекладач tab.
// Verbs are stored in the ます-form → their dictionary form is indexed too (行きます → 行く), so the analyser
// can look up the dictionary form Kuromoji returns. Pure module (no DOM) — also used by tools/test-analyzer.mjs.
import { conjugate } from './conjugate.js';

const KANJI = /[㐀-鿿々〆]/;
const hira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
/** Card text → lookup key: no ～, [な], (…), spaces. */
export const cleanKey = s => String(s || '').replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）|［[^］]*］/g, '').replace(/[～〜~\s　・]/g, '').trim();

/**
 * sets: [{ id, title, source, cards: [{ id, japanese, reading, ukrainian, verbGroup }] }]  (internal card format)
 * kanjiBooks: data/kanji.json books (optional)
 */
export function buildIndex(sets, kanjiBooks = []) {
  const map = new Map(); // key → [entry]
  const kanji = new Map(); // single kanji → { meaning, on, kun, lessonId, id }
  let order = 0;
  const add = (key, e) => {
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.some(x => x.uk === e.uk && x.japanese === e.japanese)) list.push(e);
    map.set(key, list);
  };
  const ordered = [...sets].sort((a, b) => (a.source === 'textbook' ? 0 : 1) - (b.source === 'textbook' ? 0 : 1));
  for (const s of ordered) {
    for (const c of s.cards || []) {
      if (!c.japanese || !c.ukrainian) continue;
      const jp = cleanKey(c.japanese), rd = cleanKey(c.reading);
      const e = { uk: c.ukrainian, japanese: jp, reading: KANJI.test(jp) ? hira(rd) : '', setId: s.id, cardId: c.id, setTitle: s.title, source: s.source, group: c.verbGroup || '', rank: order++ };
      add(jp, e);
      if (rd) add(hira(rd), { ...e, viaKana: true });
      if (c.verbGroup && /ます$/.test(jp)) {
        const d = conjugate(jp, c.verbGroup, 'dict');
        const dk = rd ? conjugate(rd, c.verbGroup, 'dict') : null;
        if (d) add(d, { ...e, dict: d, dictKana: dk ? hira(dk) : '' });
        if (dk) add(hira(dk), { ...e, dict: d, dictKana: hira(dk), viaKana: true });
      }
    }
  }
  for (const b of kanjiBooks || []) for (const l of b.lessons || []) for (const k of l.kanji || []) {
    if (!kanji.has(k.kanji)) kanji.set(k.kanji, { meaning: k.meaning, on: k.on || [], kun: k.kun || [], lessonId: l.id, id: k.id, book: b.id });
    for (const w of k.examples || []) {
      const jp = cleanKey(w.word), rd = hira(cleanKey(w.kana));
      if (!jp || !w.uk) continue;
      const e = { uk: w.uk, japanese: jp, reading: KANJI.test(jp) ? rd : '', setId: l.id + '-w', cardId: w.id, setTitle: `${b.id === 'k300' ? 'Канджі 300' : 'Канджі 700'}, урок ${l.no}`, source: 'kanji', href: `#/kanji/${l.id}/${k.id}`, rank: order++ + 1e6 };
      add(jp, e);
      if (rd && rd !== jp) add(rd, { ...e, viaKana: true });
    }
  }
  return { map, kanji };
}

/**
 * Look up a dictionary form. Kanji spellings match exactly; a kana-only form also matches words
 * written with kanji whose reading is that kana (homophones are returned as alternatives).
 */
export function lookupWord(idx, base, baseKana, { strict = false } = {}) {
  const b = cleanKey(base), k = hira(cleanKey(baseKana));
  let list = (idx.map.get(b) || []).filter(e => !e.viaKana || !KANJI.test(b));
  let exact = list.length > 0;
  if (!list.length && k && !KANJI.test(b)) list = idx.map.get(k) || [];
  if (!list.length && k && KANJI.test(b) && !strict) {
    // e.g. my card is written in kana (わかります) while the text has kanji (分かる)
    list = (idx.map.get(k) || []).filter(e => !KANJI.test(e.japanese));
  }
  if (!list.length) return null;
  list = [...list].sort((x, y) => x.rank - y.rank);
  const best = list[0];
  return {
    uk: best.uk, reading: best.dictKana || best.reading, exact, japanese: best.dict || best.japanese, src: best.setTitle,
    href: best.href || `#/set/${encodeURIComponent(best.setId)}`, source: best.source,
    alts: list.slice(1, 4).filter(a => a.uk !== best.uk).map(a => ({ uk: a.uk, japanese: a.japanese, src: a.setTitle, href: a.href || `#/set/${encodeURIComponent(a.setId)}` })),
  };
}

/** Meanings of the single kanji in a word (from the kanji books). */
export const kanjiParts = (idx, word) => [...String(word || '')].filter(ch => KANJI.test(ch)).map(ch => ({ ch, ...(idx.kanji.get(ch) || {}) }));
