// Grammar review schedule rules (site/js/grammar-srs.js, pure part) + every grammar point that has exam items.
//   node tools/test-grammar-srs.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(path.join(ROOT, 'site/js/grammar-srs.js')).href);
const { DAY, SRS } = await import(pathToFileURL(path.join(ROOT, 'site/js/word-srs.js')).href);
let passed = 0;
const fails = [];
const ok = (c, name) => { if (c) passed++; else { fails.push(name); console.log('FAIL', name); } };

const t0 = Date.UTC(2026, 10, 20, 9);
let d = G.addTo({}, ['5-1', '5-2'], t0);
ok(Object.keys(d).length === 2 && d['5-1'].due === t0 + DAY, 'added points: first review the next day');
ok(G.dueIds(d, t0 + 1000).length === 0, 'nothing due right after adding');
ok(G.dueIds(d, t0 + DAY).length === 2, 'both due the next day');
const again = G.addTo(d, ['5-1'], t0 + 5 * DAY);
ok(again['5-1'].due === d['5-1'].due, 'adding again does not reset a point');

// right answer when due → 20 h, then ×2.5; right before due → no growth; wrong → 10 min + ease drop
let t = t0 + DAY;
d = G.applyAnswer(d, '5-1', true, t);
ok(d['5-1'].ivl === SRS.FIRST && d['5-1'].c === 1, 'first success: 20 h');
const before = d['5-1'];
d = G.applyAnswer(d, '5-1', true, t + 3600e3);
ok(d['5-1'].due === before.due && d['5-1'].c === 2, 'second right answer before due: no growth');
t = d['5-1'].due;
d = G.applyAnswer(d, '5-1', true, t);
ok(d['5-1'].ivl === Math.round(SRS.FIRST * 2.5), 'next success ×2.5');
d = G.applyAnswer(d, '5-1', false, t + 1);
ok(d['5-1'].ivl === SRS.AGAIN && d['5-1'].ease === 2.3 && d['5-1'].w === 1, 'wrong: 10 min, ease 2.3');

// exam answers of points not in the schedule
d = G.applyAnswer(d, '9-3', true, t);
ok(!d['9-3'], 'right answer of an unscheduled point: ignored');
d = G.applyAnswer(d, '9-3', false, t);
ok(d['9-3'] && d['9-3'].due === t + DAY, 'wrong answer of an unscheduled point: added, review tomorrow');
ok(G.applyAnswer(d, '', false, t) === d, 'no point id: unchanged');

// order + next due + remove
const order = G.dueIds({ a: { due: 0, ivl: DAY, c: 3, w: 0 }, b: { due: 0, ivl: DAY, c: 0, w: 2 }, c: { due: t0 + 9 * DAY, ivl: DAY } }, t0);
ok(order.join() === 'b,a', 'due order: more mistakes first, not-yet-due excluded');
ok(G.nextDue({ a: { due: 50 }, b: { due: 20 } }) === 20 && G.nextDue({}) === null, 'nextDue');
ok(!G.removeFrom(d, ['5-1'])['5-1'] && d['5-1'], 'removeFrom (pure)');

// exam bank coverage: which points can be reviewed
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exam.json'), 'utf8')).lessons;
const gram = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/grammar.json'), 'utf8')).lessons;
const has = new Set(bank.flatMap(l => l.items.filter(i => ['p', 'e', 'tr', 'v', 'ts'].includes(i.t)).map(i => i.pt)));
const pts = gram.flatMap(l => l.points.map(p => p.id));
const n = pts.filter(p => has.has(p)).length;
ok(n >= 240, `≥ 240 of ${pts.length} points have review questions (${n})`);
ok(gram.every(l => l.points.some(p => has.has(p.id))), 'every lesson has at least one reviewable point');

console.log(`${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
