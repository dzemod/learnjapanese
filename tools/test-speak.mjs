// Speaking practice scoring (site/js/speak-core.js): node tools/test-speak.mjs
// Typical recognizer outputs for real bank sentences: exact (kanji), kana only, other kanji, a missing word, extra
// words, numbers as digits, nothing. Every sentence of the bank scores «good» against its own text and its own kana.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(pathToFileURL(path.join(ROOT, 'site/js/speak-core.js')).href);
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; if (fail < 20) console.log('FAIL', name, extra); } };
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exam.json'), 'utf8')).lessons.flatMap(l => l.items.filter(it => it.t === 'ts'));
const find = s => items.find(it => it.k.map(t => t[0]).join('').replace(/\s/g, '') === s);

const q = find('日曜日に奈良へ行きます。');
ok(!!q, 'bank sentence found');
let r = S.scoreSpeech(q.k, '日曜日に奈良へ行きます');
ok(r.verdict === 'good' && r.score === 1, 'exact (kanji, no 。)', JSON.stringify(r));
r = S.scoreSpeech(q.k, 'にちようびに なら へ いきます');
ok(r.verdict === 'good' && r.via === 'kana', 'kana only', JSON.stringify(r));
r = S.scoreSpeech(q.k, '日曜日に奈良に行きます');
ok(r.verdict === 'good' && r.tokMarks[3] === 0, 'へ heard as に: still good, the particle marked', JSON.stringify(r));
r = S.scoreSpeech(q.k, '日曜日に行きます');
ok(r.verdict !== 'good' && r.tokMarks[2] === 0 && r.tokMarks[0] === 1, 'missing 奈良へ: not good, 奈良 marked missed', JSON.stringify(r));
r = S.scoreSpeech(q.k, 'えーと日曜日に奈良へ行きますよねそうですね');
ok(r.score < 1 && r.verdict !== 'retry', 'extra words lower the score', JSON.stringify(r));
r = S.scoreSpeech(q.k, '');
ok(r.score === 0 && r.verdict === 'retry', 'nothing said → retry');
r = S.scoreSpeech(q.k, '今日は雨です');
ok(r.verdict === 'retry', 'another sentence → retry', JSON.stringify(r));
const num = items.find(it => it.k.some(t => t[0] === '9' || t[0] === '９') && it.k.some(t => /時/.test(t[0])));
if (num) { const said = num.k.map(t => t[0]).join(''); ok(S.scoreSpeech(num.k, said.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0))).verdict === 'good', 'numbers as digits', said); }
// every sentence vs itself (surface) and its kana
let bad = 0;
for (const it of items) {
  const surface = it.k.map(t => t[0]).join(''), kana = it.k.map(t => t[1] || t[0]).join('');
  if (S.scoreSpeech(it.k, surface).verdict !== 'good' || S.scoreSpeech(it.k, kana).verdict !== 'good') { bad++; if (bad < 5) console.log('  self-check:', it.id, surface); }
}
ok(bad === 0, `all ${items.length} bank sentences accept their own text and kana`, `${bad} failed`);
console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL SPEAKING CHECKS PASSED`);
process.exit(fail ? 1 : 0);
