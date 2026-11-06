// Tests of the university version (pure logic + bank sanity). Run: node tools/test-univ.mjs
import fs from 'fs';
import { buildPaper, scorePaper, availability, SECTIONS, pointsLabel, blankOk, plainText, sentenceKey } from '../site/js/univ-paper.js';

const read = f => JSON.parse(fs.readFileSync(new URL('../site/data/' + f, import.meta.url), 'utf8'));
const univ = read('exam-univ.json').lessons, bank = read('exam.json').lessons;
const G = read('grammar.json').lessons;
const points = new Set(G.flatMap(l => l.points.map(p => p.id)));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };

const ranges = [[1, 1], [1, 3], [2, 2], [5, 8], [1, 10], [8, 8], [11, 15], [1, 25], [14, 14], [26, 26], [26, 50], [34, 42], [1, 35], [1, 50], [50, 50]];
const maxL = Math.max(...univ.map(l => l.lesson));
for (let run = 0; run < 12; run++) for (const [a, b] of ranges) {
  const paper = buildPaper(univ, bank, a, b);
  const secs = paper.sections, tag = `${a}-${b}`;
  ok(secs.map(s => s.s).join('') === '1234567', `${tag}: order`);
  if (a > maxL) continue;
  ok(secs.reduce((n, s) => n + s.pts, 0) === 100, `${tag}: total ${secs.map(s => s.pts)}`);
  const seen = new Set();
  for (const s of secs) {
    ok(s.blanks <= SECTIONS.find(x => x.s === s.s).pts, `${tag} s${s.s}: too many blanks ${s.blanks}`);
    ok(Math.abs(s.per * s.blanks - s.pts) < 1e-6, `${tag} s${s.s}: points`);
    for (const it of s.items) {
      ok(it.l >= a && it.l <= b, `${tag}: ${it.id} is outside the range`);
      const key = it.pair ? it.pair : sentenceKey(it);
      ok(!seen.has(key), `${tag}: repeated ${key}`);
      seen.add(key);
    }
    if (s.example) ok(!s.items.some(i => (i.pair && i.pair === s.example.pair) || sentenceKey(i) === sentenceKey(s.example)), `${tag}: example repeated`);
  }
  // perfect answers → 100, no answers → 0
  const ans = {};
  for (const s of secs) for (const it of s.items) it.parts.filter(p => typeof p !== 'string').forEach((p, i) => { ans[`${it.id}:${i}`] = p.o ? String(p.c) : plainText(p.a[0]); });
  ok(Math.abs(scorePaper(paper, ans).total - 100) < 0.11, `${tag}: full marks gives ${scorePaper(paper, ans).total}`);
  ok(scorePaper(paper, {}).total === 0, `${tag}: empty paper`);
}

// full-size paper when the range is wide enough
const wide = buildPaper(univ, bank, 1, maxL);
wide.sections.forEach(s => console.log(`  ${s.s}. ${s.title}: ${pointsLabel(s)}  (available ${availability(univ, bank, 1, maxL)[s.s]})`));

// typed answers: kanji, kana, mixed, katakana, spaces
const blank = { a: ['{確認|かくにん}する'] };
for (const v of ['確認する', 'かくにんする', 'カクニンスル', ' 確認 する。']) ok(blankOk(blank, v), `typed: ${v}`);
for (const v of ['確認します', '', 'かくにん']) ok(!blankOk(blank, v), `typed wrong: ${v}`);
ok(blankOk({ a: ['{書|か}いて'] }, 'かいて') && blankOk({ a: ['{書|か}いて'] }, '書いて'), 'te form');
ok(blankOk({ o: ['a', 'b', 'c'], c: 1 }, '1') && !blankOk({ o: ['a', 'b', 'c'], c: 1 }, '0') && !blankOk({ o: ['a', 'b', 'c'], c: 1 }, undefined), 'choice');

// bank sanity
for (const L of univ) for (const it of L.items) {
  if (it.pt) ok(points.has(it.pt), `${it.id}: point ${it.pt}`);
  ok(it.s === 2 || it.uk, `${it.id}: translation`);
  for (const p of it.parts) {
    for (const t of typeof p === 'string' ? [p] : [...(p.a || []), ...(p.o || []), p.b || '']) ok(!/[{}|]/.test(String(t).replace(/\{[^{}|]+\|[^{}|]+\}/g, '')), `${it.id}: markup ${t}`);
    if (typeof p === 'string') continue;
    if (p.o) ok(p.o.length === 3 && p.c >= 0 && new Set(p.o).size === 3, `${it.id}: options ${p.o}`);
    else ok(p.a.length >= 1 && p.a.every(Boolean), `${it.id}: answers`);
  }
}
// labels
ok(pointsLabel({ per: 1, blanks: 23, pts: 23 }) === '(1 × 23 = 23)', 'label');
ok(pointsLabel({ per: 1.5, blanks: 4, pts: 6 }) === '(1,5 × 4 = 6)', 'label 2');
console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
