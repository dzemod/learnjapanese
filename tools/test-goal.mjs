// Daily goal (site/js/goal.js): node tools/test-goal.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(path.join(ROOT, 'site/js/goal.js')).href);
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };
const t = 1_800_000_000_000;
ok(G.timeFor(0, t) === G.FIRST, 'first action: 20 s');
ok(G.timeFor(t - 45e3, t) === 45e3, 'answer 45 s after the previous one: 45 s');
ok(G.timeFor(t - 3 * 6e4, t) === G.FIRST, 'after a break > 2 min: 20 s only');
ok(G.timeFor(t + 5e3, t) === G.FIRST, 'clock went back: 20 s');
let time = 0, prev = 0;
for (let i = 0; i < 30; i++) { const now = t + i * 30e3; time += G.timeFor(prev, now); prev = now; }
ok(time === 20e3 + 29 * 30e3, '30 answers every 30 s ≈ 14.8 min', String(time / 6e4));
ok(G.goalDays({ '2026-11-01': 11 * 6e4, '2026-11-02': 9 * 6e4, '2026-11-03': 10 * 6e4 }, 10).join() === '2026-11-01,2026-11-03', 'days with the goal reached');
ok(/gr-fg/.test(G.ringSVG(0.5)) && /done/.test(G.ringSVG(1.2)) && !/done/.test(G.ringSVG(0.99)), 'ring SVG');
console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL GOAL CHECKS PASSED`);
process.exit(fail ? 1 : 0);
