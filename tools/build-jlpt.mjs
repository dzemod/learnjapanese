// Builds site/data/jlpt.json (JLPT N5–N1 words + kanji) from:
//   words: open-anki-jlpt-decks src/n5.csv … n1.csv (https://github.com/jamsinclair/open-anki-jlpt-decks, MIT),
//          based on Jonathan Waller's JLPT lists (http://www.tanos.co.uk/jlpt/, CC BY)
//   kanji: kanji-data kanji.json field jlpt_new (https://github.com/davidluzgouveia/kanji-data, MIT; levels from Waller)
//   node tools/build-jlpt.mjs <dir with n5.csv … n1.csv and kanji.json>
// Output: { source, license, w: { "5": ["会う|あう", …], … }, k: { "5": "日一…", … } } — a word that is in two lists
// keeps the easier level. Notes in brackets and ～ are removed («こす (みずを～)» → こす). Prints coverage of my lessons.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-jlpt.mjs <source dir>'); process.exit(1); }

/** Minimal CSV parser (quoted fields with commas / doubled quotes). */
function csv(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
export const cleanForm = s => String(s || '').replace(/\s*[（(][^）)]*[）)]/g, '').replace(/[～〜]/g, '').replace(/\s+/g, '').trim();

const seen = new Set(), w = {};
let dropped = 0;
for (const n of [5, 4, 3, 2, 1]) {
  const rows = csv(fs.readFileSync(path.join(SRC, `n${n}.csv`), 'utf8'));
  const head = rows.shift();
  const ie = head.indexOf('expression'), ir = head.indexOf('reading');
  w[n] = [];
  for (const r of rows) {
    const e = cleanForm(r[ie]), rd = cleanForm(r[ir]) || e;
    if (!e) { dropped++; continue; }
    const key = `${e}|${rd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    w[n].push(key);
  }
}
const KD = JSON.parse(fs.readFileSync(path.join(SRC, 'kanji.json'), 'utf8'));
const k = { 5: '', 4: '', 3: '', 2: '', 1: '' };
for (const [ch, v] of Object.entries(KD)) if (v.jlpt_new >= 1 && v.jlpt_new <= 5) k[v.jlpt_new] += ch;

const out = {
  source: 'Jonathan Waller’s JLPT lists (tanos.co.uk) via open-anki-jlpt-decks and kanji-data',
  license: 'Word lists: CC BY (J. Waller), MIT (open-anki-jlpt-decks); kanji levels: kanji-data (MIT)',
  w, k,
};
fs.writeFileSync(path.join(ROOT, 'site/data/jlpt.json'), `{"source":${JSON.stringify(out.source)},"license":${JSON.stringify(out.license)},\n"w":{\n${Object.entries(w).map(([n, l]) => `"${n}":${JSON.stringify(l)}`).join(',\n')}\n},\n"k":${JSON.stringify(k)}}\n`);
console.log('words', Object.fromEntries(Object.entries(w).map(([n, l]) => [`N${n}`, l.length])), 'dropped', dropped);
console.log('kanji', Object.fromEntries(Object.entries(k).map(([n, s]) => [`N${n}`, [...s].length])));

// coverage of my lessons + kanji books (same lookup as site/js/jlpt.js)
const J = await import(pathToFileURL(path.join(ROOT, 'site/js/jlpt.js')).href);
J.setJlptData(out);
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const lv = {};
let cards = 0, hit = 0;
for (const s of sets.filter(s => /^mnn-/.test(s.id))) for (const c of s.cards) {
  cards++;
  const n = J.wordLevel(c.kanji || c.kana, c.kanji ? c.kana : '', c.verbGroup);
  if (n) { hit++; lv[n] = (lv[n] || 0) + 1; }
}
console.log(`textbook words with a JLPT level: ${hit} of ${cards}`, lv);
const kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const kl = {};
let kn = 0;
for (const b of kb.books) for (const l of b.lessons) for (const x of l.kanji) { kn++; const n = J.kanjiLevel(x.kanji); kl[n || '-'] = (kl[n || '-'] || 0) + 1; }
console.log(`kanji books (${kn}) by level`, kl);
