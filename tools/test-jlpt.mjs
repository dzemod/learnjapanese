// JLPT lookup (site/js/jlpt.js) with the real site/data/jlpt.json: matching rules on known words, coverage of the
// textbook words and the kanji books.
//   node tools/test-jlpt.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = await import(pathToFileURL(path.join(ROOT, 'site/js/jlpt.js')).href);
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/jlpt.json'), 'utf8'));
J.setJlptData(data);
let passed = 0;
const fails = [];
const ok = (c, name) => { if (c) passed++; else { fails.push(name); console.log('FAIL', name); } };

ok(J.LEVELS.every(n => data.w[n].length > 500 && data.k[n].length >= 79), 'all five levels have words and kanji');
const all = J.LEVELS.flatMap(n => data.w[n]);
ok(new Set(all).size === all.length, 'every word on one level only');
ok(all.every(k => /^[^|～〜()（）]+\|[^|～〜()（）]+$/.test(k)), 'keys "form|reading" without notes or ～');

const cases = [
  ['会います', 'あいます', 'I', 5, 'verb ます-form → dictionary form'],
  ['食べます', 'たべます', 'II', 5, 'group II verb'],
  ['結婚します', 'けっこんします', 'III', 5, 'する-verb → noun'],
  ['2つ', 'ふたつ', '', 5, 'digits → kanji numerals'],
  ['[お]祭り', '[お]まつり', '', 4, '[お] tried with お'],
  ['足', 'あし', '', 5, 'list alternatives 足;脚'],
  ['勉強します', 'べんきょうします', 'III', 5, 'する-verb N5'],
  ['先生', 'せんせい', '', 5, 'noun'],
  ['きれい[な]', 'きれい', '', 5, 'な-adjective without [な]'],
  ['はがき', '', '', 5, 'kana-only card, list writes it with kanji'],
  ['夫／主人', 'おっと／しゅじん', '', 4, 'alternatives: first one that is on a list'],
  ['ああ', '', '', 5, 'kana word'],
  ['すみません。', '', '', 3, 'final 。 ignored'],
];
for (const [ja, rd, g, want, name] of cases) { const n = J.wordLevel(ja, rd, g); ok(n === want, `${name}: ${ja} → N${n} (want N${want})`); }
ok(J.wordLevel('ニューヨーク') === 0 && J.wordLevel('') === 0, 'names / empty: no level');
ok(J.kanjiLevel('日') === 5 && J.kanjiLevel('働') === 3 && J.kanjiLevel('x') === 0, 'kanji levels');
ok(J.jlptChip(3).includes('N3') && J.jlptChip(0) === '', 'chip HTML');

const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets.filter(s => /^mnn-/.test(s.id));
let cards = 0, hit = 0, n5 = new Set();
for (const s of sets) for (const c of s.cards) {
  cards++;
  const key = J.wordKey(c.kanji || c.kana, c.kanji ? c.kana : '', c.verbGroup);
  if (key) { hit++; if (data.w[5].includes(key)) n5.add(key); }
}
ok(hit / cards > 0.7, `textbook words with a level: ${hit} of ${cards}`);
ok(n5.size / data.w[5].length > 0.8, `N5 words covered by lessons 1–50: ${n5.size} of ${data.w[5].length}`);
const kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const ks = kb.books.flatMap(b => b.lessons.flatMap(l => l.kanji.map(k => k.kanji)));
ok(ks.filter(ch => J.kanjiLevel(ch)).length >= 990, 'kanji books: ≥ 990 of 1000 have a level');
ok([...data.k[5]].every(ch => ks.includes(ch)), 'every N5 kanji is in the kanji books');

console.log(`${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
