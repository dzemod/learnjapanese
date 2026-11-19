// Anki export (site/js/anki.js wordsTSV / kanjiTSV) on the real data: node tools/test-anki.mjs
// Header lines Anki needs, one line per note, the right number of fields, no tab/newline inside a field, HTML escaped,
// tags, every word and every kanji exported. anki.js imports util/store (browser modules) — the builders are pure,
// so they are loaded from the source text.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'site/js/anki.js'), 'utf8');
const pure = src.slice(src.indexOf('const clean'), src.indexOf('export function downloadText')).replace(/export function/g, 'function');
const { wordsTSV, kanjiTSV } = new Function(`${pure}; return { wordsTSV, kanjiTSV };`)();
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const sets = raw.map(s => ({ ...s, cards: s.cards.map(c => ({ ...c, japanese: c.kanji || c.kana, reading: c.kanji ? c.kana : '' })) }));
const nWords = sets.reduce((a, s) => a + s.cards.length, 0);
const w = wordsTSV(sets, (s, c) => (c === sets[1].cards[0].id && s === sets[1].id ? { lvl: 2, star: true } : {}));
const wl = w.trimEnd().split('\n');
ok(wl[0] === '#separator:tab' && wl[1] === '#html:true' && /^#deck:Kotoba::/.test(wl[2]) && /^#columns:/.test(wl[3]) && wl[4] === '#tags column:5', 'word header lines');
const wn = wl.filter(l => !l.startsWith('#'));
ok(wn.length === nWords, `one line per word (${nWords})`, String(wn.length));
ok(wn.every(l => l.split('\t').length === 5), 'every word line has 5 fields');
ok(wn.some(l => / star known$/.test(l) || /\tmnn-\d+ star known$/.test(l)), 'tags star + known');
ok(wn.every(l => /\t(mnn-\d+|my-\S+)( |$)/.test(l) || /\tk\d/.test(l) || l.split('\t')[4]), 'every word tagged with its lesson');
const tricky = wordsTSV([{ id: 'my-x', source: 'my', cards: [{ id: 'a', japanese: 'A<b>\tB', reading: 'r\nr', ukrainian: 'x & y', hint: '' }] }]).trimEnd().split('\n').pop();
ok(tricky === 'A&lt;b&gt; B\tr r\tx &amp; y\t\tmy-x my', 'tabs/newlines removed, HTML escaped', JSON.stringify(tricky));

const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const assoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji-assoc.json'), 'utf8')).kanji;
const lessons = kj.books.flatMap(b => b.lessons.map(l => ({ ...l, bookId: b.id })));
const k = kanjiTSV(lessons, id => assoc[id]?.t || '').trimEnd().split('\n');
const kn = k.filter(l => !l.startsWith('#'));
ok(kn.length === 1000 && kn.every(l => l.split('\t').length === 7), '1000 kanji lines, 7 fields', String(kn.length));
const hito = kn.find(l => l.startsWith('人\t'));
ok(hito && /ジン、ニン/.test(hito) && /日本人 \(にほんじん\) — японець/.test(hito) && /\tk300 k300-01$/.test(hito) && /Людина \(人\)/.test(hito), '人: readings, examples, association, tags', hito?.slice(0, 200));
ok(!kn.some(l => /\t[^\t]*-[ぁ-ゖ]/.test(l.split('\t')[3] || '')), 'kun readings without the okurigana dash');
console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL ANKI CHECKS PASSED`);
process.exit(fail ? 1 : 0);
