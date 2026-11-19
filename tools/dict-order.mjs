// Priority order of the common JMdict words → site/data/dict/order.json { ids: [...] }.
// JMdict has no frequency rank, only "common"; this orders the common words so the basic ones come first:
//   score = rank of the rarest kanji in the first written form (KANJIDIC2 newspaper frequency, unknown = 3000);
//   words written in hiragana only = 350, katakana words = 1500; words of my lessons −300;
//   ties: more senses first (basic words have many), then shorter.
// Used by the dictionary worker (ranking ties, browse «за поширеністю») and by tools/dump-dict-batch.mjs.
// Run: node tools/dict-order.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(ROOT, 'site/data/dict');
const meta = JSON.parse(fs.readFileSync(path.join(D, 'meta.json'), 'utf8'));
const KF = new Map(JSON.parse(fs.readFileSync(path.join(D, 'kanji.json'), 'utf8')).k.map(r => [r[0], r[4] || 3000]));
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8'));
const mine = new Set();
for (const s of sets.sets || sets) for (const c of s.cards) { if (c.kanji) mine.add(c.kanji.replace(/[～〜\s]/g, '')); if (c.kana) mine.add(c.kana.replace(/[～〜\s]/g, '')); }

const KANJI = /[㐀-鿿々〆]/;
const rows = [];
for (let i = 0; i < meta.chunks; i++) {
  for (const x of JSON.parse(fs.readFileSync(path.join(D, `words-${String(i).padStart(2, '0')}.json`), 'utf8')).e) {
    if (!x[3]) continue;
    const w = (x[1] || x[2]).split('|')[0];
    const ks = [...w].filter(c => KANJI.test(c));
    let score = ks.length ? Math.max(...ks.map(c => KF.get(c) || 3000)) : /^[ぁ-ゖー]+$/.test(w) ? 350 : 1500;
    const forms = [...(x[1] ? x[1].split('|') : []), ...x[2].split('|')];
    if (forms.some(f => mine.has(f))) score -= 300;
    rows.push([x[0], score, x[4].length, w.length]);
  }
}
rows.sort((a, b) => a[1] - b[1] || b[2] - a[2] || a[3] - b[3] || (a[0] < b[0] ? -1 : 1));
fs.writeFileSync(path.join(D, 'order.json'), JSON.stringify({ about: 'Priority of the common JMdict words (tools/dict-order.mjs)', ids: rows.map(r => r[0]) }));
console.log('order.json:', rows.length, 'common words');
