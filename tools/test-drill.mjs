// Conjugation drill logic (site/js/drill-core.js): node tools/test-drill.mjs
// Every verb of lessons 1–50 × every form: answers exist, the checker accepts each answer (kana and kanji),
// katakana / spaces are tolerated, a wrong form is detected; pool limits, form weights.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(pathToFileURL(path.join(ROOT, 'site/js/drill-core.js')).href);
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; if (fail < 30) console.log('FAIL', name, extra); } };
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const sets = raw.map(s => ({ ...s, cards: s.cards.map(c => ({ ...c, japanese: c.kanji || c.kana, reading: c.kanji ? c.kana : '' })) }));

const pool50 = D.verbPool(sets, 50), pool14 = D.verbPool(sets, 14);
ok(pool50.length > 300, 'lessons 1–50: many verbs', String(pool50.length));
ok(pool14.length > 30 && pool14.every(v => v.lesson <= 14), 'lessons 1–14: only those lessons', String(pool14.length));
ok(D.formsFor(14).join() === 'te' && D.formsFor(20).includes('nakatta') && !D.formsFor(20).includes('tara'), 'forms by lesson');
let checked = 0;
for (const v of pool50) for (const f of D.formsFor(50)) {
  const answers = D.answersOf(v, f);
  ok(answers.length > 0, `${v.japanese} ${f}: has an answer`);
  const q = { card: v, form: f, answers };
  for (const a of answers) { ok(D.checkAnswer(q, a).ok, `${v.japanese} ${f}: accepts ${a}`); checked++; }
}
console.log(`checked ${checked} answers of ${pool50.length} verbs × ${D.formsFor(50).length} forms`);
const kaku = pool50.find(v => v.japanese === '書きます');
const q = { card: kaku, form: 'te', answers: D.answersOf(kaku, 'te') };
ok(q.answers.includes('書いて') && q.answers.includes('かいて'), '書きます → 書いて / かいて', q.answers.join());
ok(D.checkAnswer(q, ' カイテ ').ok && D.checkAnswer(q, 'かいて。').ok, 'katakana, spaces, full stop tolerated');
const w = D.checkAnswer(q, 'かかない');
ok(!w.ok && w.detected === 'nai', 'wrong form detected (ない-форма)', JSON.stringify(w));
const copy = pool50.find(v => v.japanese === 'コピーします');
if (copy) ok(D.checkAnswer({ card: copy, form: 'te', answers: D.answersOf(copy, 'te') }, 'こぴいして').ok, 'katakana verb: ー typed as a vowel (romaji) accepted');
ok(!D.checkAnswer(q, '').ok && !D.checkAnswer(q, 'かきて').ok, 'empty / wrong rejected');
const iku = pool50.find(v => v.japanese === '行きます');
ok(D.answersOf(iku, 'te').includes('行って') && D.answersOf(iku, 'ta').includes('いった'), 'exception 行きます → 行って');
const kuru = pool50.find(v => v.japanese === '来ます');
ok(D.answersOf(kuru, 'nai').includes('来ない') && D.answersOf(kuru, 'nai').includes('こない'), '来ます → 来ない / こない', D.answersOf(kuru, 'nai').join());
// question making: n questions, forms only from the list, weak forms more often
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const qs = D.makeQuestions(pool50, ['te', 'nai'], 20, {}, rnd);
ok(qs.length === 20 && qs.every(x => ['te', 'nai'].includes(x.form) && x.answers.length), '20 questions from the chosen forms');
ok(new Set(qs.map(x => x.card.japanese + x.form)).size === 20, 'no repeated question');
const weak = D.makeQuestions(pool50, ['te', 'nai'], 100, { te: { n: 50, ok: 50 }, nai: { n: 50, ok: 10 } }, rnd);
const nNai = weak.filter(x => x.form === 'nai').length;
ok(nNai > weak.length * 0.65, 'weak form (ない 20%) asked much more often', `${nNai}/${weak.length}`);
ok(D.makeQuestions([], ['te'], 5).length === 0 && D.makeQuestions(pool14, [], 5).length === 0, 'empty pool / no forms → no questions');
const mine = D.verbPool([...sets, { id: 'my-x', source: 'my', cards: [{ id: 'c1', japanese: '泳ぎます', reading: 'およぎます', ukrainian: 'плавати', verbGroup: 'I' }] }], 14, true);
ok(mine.some(v => v.setId === 'my-x' || v.japanese === '泳ぎます'), 'my lessons added when chosen');

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL DRILL CHECKS PASSED`);
process.exit(fail ? 1 : 0);
