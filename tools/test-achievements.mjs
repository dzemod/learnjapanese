// Achievements, streak freezes and kanji components (pure modules, no browser):
//   node tools/test-achievements.mjs [<KanjiVG svg dir>]
// The optional dir (e.g. the one of test-stroke-match.mjs) also checks the components of all 1000 kanji.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = p => import(pathToFileURL(path.join(ROOT, p)).href);
const S = await mod('site/js/streak-calc.js');
const R = await mod('site/js/ach-rules.js');
const P = await mod('site/js/kanji-parts.js');
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- streak + freezes ----------
const range = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(...from.split('-').map((x, j) => (j === 1 ? x - 1 : +x)))); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
ok(eq(S.streakInfo([], '2026-11-19').streak, 0), 'no days → 0');
ok(S.streakInfo(['2026-11-18'], '2026-11-19').streak === 1, 'yesterday counts while today is not over');
ok(S.streakInfo(['2026-11-19', '2026-11-18', '2026-11-18'], '2026-11-19').streak === 2, 'duplicates ignored');
ok(S.streakInfo(['2026-11-16'], '2026-11-19').streak === 0, 'a gap without a freeze ends the streak');
let st = S.streakInfo(range('2026-11-01', 7), '2026-11-07');
ok(st.streak === 7 && st.freezes === 1 && st.nextFreezeIn === 7, '7 days → 1 freeze', JSON.stringify(st));
st = S.streakInfo([...range('2026-11-01', 7), '2026-11-09'], '2026-11-09');
ok(st.streak === 8 && st.freezes === 0 && eq(st.frozen, ['2026-11-08']) && st.freezeUsed === 1, 'a missed day uses the freeze, the streak goes on', JSON.stringify(st));
st = S.streakInfo([...range('2026-11-01', 7), '2026-11-10'], '2026-11-10');
ok(st.streak === 1 && st.best === 7 && st.frozen.length === 0, 'two missed days with one freeze: streak ends', JSON.stringify(st));
st = S.streakInfo([...range('2026-10-01', 14), '2026-10-17'], '2026-10-17');
ok(st.streak === 15 && st.freezes === 0 && st.freezeUsed === 2, 'two freezes cover two missed days', JSON.stringify(st));
st = S.streakInfo(range('2026-01-01', 60), '2026-03-01');
ok(st.freezes === 2 && st.nextFreezeIn === 0, 'at most 2 freezes', JSON.stringify(st));
st = S.streakInfo(range('2026-11-01', 7), '2026-11-08');
ok(st.streak === 7 && st.freezes === 1 && !st.frozen.length, 'today not studied yet: the freeze is not used', JSON.stringify(st));
st = S.streakInfo(['2026-10-01', '2026-10-12'], '2026-10-12');
ok(st.comeback === 10 && st.total === 2, 'comeback = longest break', JSON.stringify(st));
ok(S.streakInfo(['2026-12-01', 'bad'], '2026-11-19').total === 0, 'future and invalid dates ignored');

// ---------- rules ----------
const ids = R.ACHIEVEMENTS.map(a => a.id);
ok(new Set(ids).size === ids.length, 'unique ids');
ok(R.ACHIEVEMENTS.every(a => R.GROUPS.some(g => g[0] === a.g) && a.goal > 0 && a.t && a.d && a.jp && [1, 2, 3].includes(a.tier)), 'every achievement complete');
const zero = Object.fromEntries(R.ACHIEVEMENTS.map(a => [a.stat, 0]));
ok(R.newlyUnlocked(zero, {}).length === 0, 'nothing for a new learner');
const some = { ...zero, best: 8, words: 120, night: 1 };
ok(eq(R.newlyUnlocked(some, {}).sort(), ['streak-3', 'streak-7', 'words-10', 'words-100']), 'streak 8 + 120 words', R.newlyUnlocked(some, {}).join());
ok(R.newlyUnlocked(some, {}, { event: true }).includes('owl'), 'night badge only after a study action');
ok(!R.newlyUnlocked(some, { 'streak-3': 1 }).includes('streak-3'), 'already unlocked stays out');
ok(R.progressOf(R.ACHIEVEMENTS.find(a => a.id === 'words-500'), { words: 250 }) === 0.5, 'progress 250/500');
ok(R.timeStats(new Date(2026, 0, 1, 3)).night === 1 && R.timeStats(new Date(2026, 0, 1, 6)).early === 1 && R.timeStats(new Date(2026, 0, 1, 12)).night === 0, 'time of day');
ok(eq(R.mergeUnlocked({ a: 5, b: 1 }, { a: 3 }), { a: 3, b: 1 }) && eq(R.mergeUnlocked({ a: 3 }, { a: 5, b: 1 }), { a: 3, b: 1 }), 'unlock merge: earliest wins, symmetric');

// ---------- kanji components ----------
const svg = `<svg><g id="kvg:StrokePaths_04f11"><g id="kvg:04f11" kvg:element="休"><g id="kvg:04f11-g1" kvg:element="亻"><path id="kvg:04f11-s1"/></g><g id="kvg:04f11-g2" kvg:element="木"><g id="x" kvg:element="十"></g><path/></g></g></g></svg>`;
ok(eq(P.partsFromSVG(svg, '休'), ['亻', '木']), 'components of 休 (inner groups not listed)');
ok(eq(P.partsWithMeanings(['亻', '木'], ch => (ch === '木' ? 'дерево (kanji.json)' : '')), [{ ch: '亻', uk: 'людина' }, { ch: '木', uk: 'дерево (kanji.json)' }]), 'meanings: kanji list first, then the table');
const dir = process.argv[2];
if (dir) {
  const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
  const known = new Map();
  for (const b of kj.books) for (const l of b.lessons) for (const k of l.kanji) known.set(k.kanji, k.meaning);
  let withParts = 0, files = 0;
  const unknown = new Map();
  for (const ch of known.keys()) {
    const f = path.join(dir, ch.codePointAt(0).toString(16).padStart(5, '0') + '.svg');
    if (!fs.existsSync(f)) continue;
    files++;
    const p = P.partsFromSVG(fs.readFileSync(f, 'utf8'), ch);
    if (p.length) withParts++;
    for (const x of p) if (!known.has(x) && !P.PART_UK[x]) unknown.set(x, (unknown.get(x) || 0) + 1);
  }
  console.log(`components: ${withParts}/${files} kanji have components; without a meaning: ${[...unknown].sort((a, b) => b[1] - a[1]).map(x => x.join('×')).join(' ') || 'none'}`);
  ok(files > 0 && withParts / files > 0.8, 'most kanji have components');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL ACHIEVEMENT CHECKS PASSED`);
process.exit(fail ? 1 : 0);
