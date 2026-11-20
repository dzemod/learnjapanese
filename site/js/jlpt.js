// JLPT levels N5–N1 of words and kanji — data/jlpt.json (tools/build-jlpt.mjs; Jonathan Waller’s lists, CC BY).
// Lookup only (no DOM besides the chip HTML): loadJlpt() once, then wordLevel / kanjiLevel are synchronous (0 = not
// on any list or data not loaded yet). Words are matched by written form + reading, then by the written form alone;
// verbs of my lessons (ます-form) also by their dictionary form, な-adjectives without [な].
import { conjugate } from './conjugate.js';

export const LEVELS = [5, 4, 3, 2, 1];
let byKey = new Map(), level = new Map(), formKey = new Map(), readKey = new Map(), byKanji = new Map(), lists = { w: {}, k: {} }, loading = null, ready = false;

const hasKanji = s => /[㐀-鿿々]/.test(s);
const clean = s => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\s*[（(][^）)]*[）)]/g, '').replace(/[～〜。]/g, '').replace(/\s+/g, '').trim();

/** Fill the lookup maps from the jlpt.json object (also used by the build tool and the tests in node). */
export function setJlptData(j) {
  byKey = new Map(); level = new Map(); formKey = new Map(); readKey = new Map(); byKanji = new Map();
  lists = { w: {}, k: {} };
  for (const n of LEVELS) {
    const ws = j?.w?.[n] || [];
    lists.w[n] = ws;
    for (const key of ws) {
      // a list entry may hold alternatives: "足;脚|あし", "いい;よい|いい;よい" — every pair points to the entry
      level.set(key, n);
      const [fs, rs] = key.split('|').map(x => x.split(';'));
      fs.forEach((form, i) => {
        for (const rd of rs.length === fs.length ? [rs[i]] : rs) if (!byKey.has(`${form}|${rd}`)) byKey.set(`${form}|${rd}`, key);
        if (!formKey.has(form)) formKey.set(form, key);
      });
      for (const rd of rs) if (!readKey.has(rd)) readKey.set(rd, key);
    }
    lists.k[n] = [...(j?.k?.[n] || '')];
    for (const ch of lists.k[n]) if (!byKanji.has(ch)) byKanji.set(ch, n);
  }
  ready = true;
}
export function loadJlpt() {
  return (loading ||= fetch('data/jlpt.json').then(r => (r.ok ? r.json() : null)).then(j => setJlptData(j || {}))
    .catch(e => { console.warn('jlpt.json', e); setJlptData({}); }));
}
export const jlptReady = () => ready;
export const jlptLists = () => lists;

// Card spellings worth trying: "[お]祭り" with and without お, "2つ" / "10日" with kanji numerals (二つ, 十日).
const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function variants(f, r) {
  const out = [];
  const br = /\[([^\]]*)\]/g;
  const fk = clean(f.replace(br, '$1')), rk = clean(r.replace(br, '$1'));
  out.push([clean(f), clean(r)]);
  if (fk !== clean(f)) out.push([fk, rk]);
  const m = /^(10|[1-9])(?=\D)/.exec(clean(f));
  if (m) out.push([NUM[+m[1]] + clean(f).slice(m[1].length), clean(r)]);
  return out;
}
/** The list key a word matches ("会う|あう"), or ''. japanese/reading as in my cards (ます-form verbs).
 *  Alternatives in one card («夫／主人», «暖かい、温かい») are tried one by one, readings paired by position. */
const ALT = /[／、・]/;
export function wordKey(japanese, reading = '', verbGroup = '') {
  const fs = String(japanese || '').split(ALT), rs = String(reading || '').split(ALT);
  const tries = [];
  fs.forEach((f0, i) => {
    const r0 = rs.length === fs.length ? rs[i] : fs.length === 1 ? rs.join('') : '';
    for (const [f, r] of variants(f0, r0)) {
      if (verbGroup && /ます$/.test(f)) {
        const df = conjugate(f, verbGroup, 'dict'), dr = r ? conjugate(r, verbGroup, 'dict') : '';
        if (df) tries.push([df, dr || '']);
        if (verbGroup === 'III' && /します$/.test(f) && f.length > 3) tries.push([f.slice(0, -3), r.endsWith('します') ? r.slice(0, -3) : '']); // 結婚します → 結婚
      }
      tries.push([f, r]);
    }
  });
  for (const [a, b] of tries) {
    if (!a) continue;
    const rr = b || a;
    if (byKey.has(`${a}|${rr}`)) return byKey.get(`${a}|${rr}`);
    if (hasKanji(a) && formKey.has(a)) return formKey.get(a);
    if (!hasKanji(a) && readKey.has(a)) return readKey.get(a); // kana-only card, the list writes it with kanji (はがき → 葉書)
  }
  return '';
}
export function wordLevel(japanese, reading = '', verbGroup = '') {
  const key = wordKey(japanese, reading, verbGroup);
  return key ? level.get(key) || 0 : 0;
}
export const kanjiLevel = ch => byKanji.get(ch) || 0;
/** Small «N5» chip (empty for 0). */
export const jlptChip = n => (n ? `<span class="jlpt-chip" data-n="${n}" title="Рівень JLPT N${n}">N${n}</span>` : '');
