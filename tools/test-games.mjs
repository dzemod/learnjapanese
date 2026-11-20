// Logic test of the mini-games (site/js/games-core.js) with the real sets.json + exam.json:
// pools for every lesson range, options always contain exactly one right answer, scoring rules.
//   node tools/test-games.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(path.join(ROOT, 'site/js/games-core.js')).href);
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets
  .map(s => ({ ...s, cards: s.cards.map(c => ({ id: c.id, japanese: c.kanji || c.kana, reading: c.kanji ? c.kana : '', ukrainian: c.ukrainian })) }));
const exam = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exam.json'), 'utf8')).lessons;

let passed = 0;
const fails = [];
const ok = (c, name) => { if (c) passed++; else { fails.push(name); console.log('FAIL', name); } };

// ranges
ok(JSON.stringify(G.parseRange('3-7')) === '{"from":3,"to":7}', 'parseRange 3-7');
ok(JSON.stringify(G.parseRange('9-2')) === '{"from":2,"to":9}', 'parseRange swaps');
ok(G.parseRange('abc') === null && G.parseRange('') === null, 'parseRange rejects junk');
ok(G.parseRange('1-99').to === 50, 'parseRange clamps to 50');
ok(G.lastStudiedLesson({ 'mnn-07/mnn-07-3': {}, 'mnn-12/x': {}, 'k300-01/k300-001': {} }) === 12, 'lastStudiedLesson');
ok(G.lastStudiedLesson({}) === 0, 'lastStudiedLesson empty');
ok(G.cleanUk('чекати [じかんに～]') === 'чекати', 'cleanUk drops hints');

// every single lesson has enough words and particle sentences
for (let n = 1; n <= 50; n++) {
  const w = G.wordPool(sets, n, n), p = G.particlePool(exam, n, n);
  ok(w.length >= 8, `lesson ${n}: ≥ 8 words (${w.length})`);
  ok(p.length >= 12, `lesson ${n}: ≥ 12 particle sentences (${p.length})`);
  ok(new Set(w.map(x => x.uk.toLowerCase())).size === w.length, `lesson ${n}: meanings unique`);
  ok(w.every(x => x.uk.length <= G.MAX_UK && x.ja.length <= G.MAX_JA && x.lesson === n), `lesson ${n}: words fit tiles`);
  for (const x of w) {
    const o = G.wordOptions(x, w);
    if (!(o.length === 4 && o.filter(y => y.uk.toLowerCase() === x.uk.toLowerCase()).length === 1)) { ok(false, `lesson ${n}: options of ${x.ja}`); break; }
  }
  for (const it of p) {
    const o = G.particleOptions(it);
    if (!(o.length === 4 && new Set(o).size === 4 && o.filter(q => G.particleRight(it, q)).length === 1 && o.every(q => G.PARTICLES.includes(q)))) { ok(false, `lesson ${n}: particle options of ${it.id} ${o}`); break; }
  }
}
ok(G.wordPool(sets, 0, 50).length > 1500, 'all lessons: large pool');
ok(G.particlePool(exam, 1, 1).every(i => i.l === 1), 'lesson 1 particles only from lesson 1');

// scoring
ok(G.comboMult(0) === 1 && G.comboMult(2) === 1 && G.comboMult(3) === 2 && G.comboMult(99) === 5, 'combo multiplier');
ok(G.rainFall(0) === 9000 && G.rainFall(10) < G.rainFall(5) && G.rainFall(200) === 3200, 'rain speeds up, floor 3.2 s');
ok(G.memoryScore(6, 6, 20) === 560 && G.memoryScore(6, 40, 300) === 50, 'memory score');
const s = G.shuffled([1, 2, 3, 4, 5]);
ok(s.length === 5 && [...s].sort().join() === '1,2,3,4,5', 'shuffled keeps items');

console.log(`${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
