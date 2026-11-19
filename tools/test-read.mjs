// Reading practice logic (site/js/read-core.js) on the real exam bank: node tools/test-read.mjs
// Texts only from lessons ≤ N, in lesson order, no repeats; every tapped word of every sentence (lessons 1–50) can be
// looked up in my lessons / kanji books except particles, auxiliaries, names and numbers (coverage reported);
// story parsing; Kuromoji token conversion.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);
const R = await imp('site/js/read-core.js');
const WI = await imp('site/js/wordindex.js');
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exam.json'), 'utf8')).lessons.flatMap(l => l.items.filter(it => it.t === 'ts'));
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const upTo of [1, 5, 14, 30, 50]) {
  const t = R.textFromBank(items, upTo, 8, rnd);
  ok(t.length === 8 && t.every(s => s.l <= upTo && s.toks.length && s.uk), `lessons ≤ ${upTo}: 8 sentences`, String(t.length));
  ok(t.every((s, i) => !i || t[i - 1].l <= s.l) && new Set(t.map(s => s.id)).size === t.length, `lessons ≤ ${upTo}: book order, no repeats`);
}
ok(R.textFromBank(items, 0, 8).length === 0, 'no lessons → empty');

// word lookup coverage over every content token of every sentence
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const sets = raw.map(s => ({ ...s, cards: s.cards.map(c => ({ ...c, japanese: c.kanji || c.kana, reading: c.kanji ? c.kana : '' })) }));
const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const idx = WI.buildIndex(sets, kj.books);
let content = 0, found = 0;
const missing = new Map();
for (const it of items) {
  const s = { toks: it.k, w: it.w || [] };
  for (const tok of it.k) {
    if (!['n', 'v', 'a'].includes(tok[2]) || /^[0-9０-９一二三四五六七八九十百千万〇]+$/.test(tok[0]) || /^[ァ-ヶー・]+$/.test(tok[0])) continue;
    content++;
    let hit = null;
    for (const k of R.wordCandidates(tok, s)) { hit = WI.lookupWord(idx, k, tok[1]) || WI.lookupWord(idx, k, ''); if (hit) break; }
    if (hit) found++; else missing.set(tok[0], (missing.get(tok[0]) || 0) + 1);
  }
}
const cov = found / content;
console.log(`word lookup: ${found}/${content} content words found (${(cov * 100).toFixed(1)}%); most missed: ${[...missing].sort((a, b) => b[1] - a[1]).slice(0, 15).map(x => x.join('×')).join(' ')}`);
ok(cov > 0.8, 'most tapped content words are found in my lessons', (cov * 100).toFixed(1) + '%');

// story parsing
const st = R.parseStory('1. 毎朝 7時に 起きます。 ||| Щоранку я встаю о 7.\n**2.** «駅まで 歩きます。» ||| «Іду пішки до станції.»\nНазва без перекладу\n- 学校は 9時からです。|||Школа з 9.');
ok(st.length === 3 && st[0].ja === '毎朝 7時に 起きます。' && st[1].ja === '駅まで 歩きます。' && st[1].uk === 'Іду пішки до станції.' && st[2].uk === 'Школа з 9.', 'story lines parsed (numbering, quotes, Markdown)', JSON.stringify(st));
const toks = R.tokensFromKuromoji([{ surface_form: '起き', reading: 'オキ', pos: '動詞', basic_form: '起きる' }, { surface_form: 'ます', reading: 'マス', pos: '助動詞', basic_form: 'ます' }, { surface_form: ' ', pos: '記号' }, { surface_form: '。', reading: '。', pos: '記号', basic_form: '。' }]);
ok(JSON.stringify(toks) === JSON.stringify([['起き', 'おき', 'v', '起きる'], ['ます', 'ます', 'x', 'ます'], ['。', '。', 's', '。']]), 'Kuromoji tokens → toks (hiragana reading, class, dictionary form)', JSON.stringify(toks));
ok(R.wordCandidates(['起き', 'おき', 'v', '起きる'])[0] === '起きる', 'AI token: dictionary form first');
ok(R.wordCandidates(['行きました', 'いきました', 'v'], { w: ['行く', '駅'] }).includes('行く'), 'bank token: the sentence dictionary form with the same stem');
console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL READING CHECKS PASSED`);
process.exit(fail ? 1 : 0);
