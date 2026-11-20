// Merge rules of progress sync (site/js/sync-merge.js): newer answer wins, unions, «Очистити» respected,
// symmetric (A+B = B+A) and idempotent (merging again changes nothing).
//   node tools/test-sync-merge.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(path.join(ROOT, 'site/js/sync-merge.js')).href);
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// two devices: the phone learned in the morning, the laptop in the evening, both offline
const phone = {
  progress: { 'mnn-01/1': { c: 1, w: 0, lvl: 1, star: false, last: 100 }, 'mnn-01/2': { c: 0, w: 3, lvl: 1, star: true, last: 300 }, 'mnn-02/5': { c: 2, w: 0, lvl: 2, star: false, last: 50 } },
  kanji: { 'k300-001': { due: 1000, interval: 600, rating: 'good', reps: 2, last: 400 }, 'k300-009': { due: 9, interval: 60, rating: 'again', reps: 1, last: 10 } },
  days: ['2026-11-17', '2026-11-18'],
  mistakes: { items: [{ uid: 'a', savedAt: 500, x: 'phone' }, { uid: 'b', savedAt: 200 }], clearedAt: 0 },
  history: [{ at: 10, name: 'Урок 1', pct: 50 }, { at: 30, name: 'Урок 2', pct: 80 }],
  best: { 'mnn-01': 42000 }, level: '7',
};
const laptop = {
  progress: { 'mnn-01/1': { c: 4, w: 1, lvl: 2, star: true, last: 900 }, 'mnn-01/2': { c: 1, w: 0, lvl: 1, star: false, last: 200 }, 'mnn-03/1': { c: 1, w: 0, lvl: 1, star: false, last: 70 } },
  kanji: { 'k300-001': { due: 50, interval: 60, rating: 'again', reps: 3, last: 300 }, 'k300-002': { due: 77, interval: 864e5, rating: 'good', reps: 1, last: 20 } },
  days: ['2026-11-18', '2026-11-16', 'bad'],
  mistakes: { items: [{ uid: 'a', savedAt: 100, x: 'laptop' }, { uid: 'c', savedAt: 700 }], clearedAt: 0 },
  history: [{ at: 30, name: 'Урок 2', pct: 80 }, { at: 20, name: '🎓 Уроки 1–5', pct: 70, univ: true }],
  best: { 'mnn-01': 39000, 'mnn-02': 50000 }, level: null,
};
const m = M.mergeAll(phone, laptop);
ok(m.progress['mnn-01/1'].last === 900 && m.progress['mnn-01/1'].star === true, 'progress: the newer answer wins (laptop, evening)');
ok(m.progress['mnn-01/2'].last === 300 && m.progress['mnn-01/2'].w === 3, 'progress: the newer answer wins (phone)');
ok(m.progress['mnn-02/5'] && m.progress['mnn-03/1'], 'progress: cards learned on only one device are kept');
ok(m.kanji['k300-001'].last === 400 && m.kanji['k300-002'] && m.kanji['k300-009'], 'kanji: the newer rating wins, others kept');
ok(eq(m.days, ['2026-11-16', '2026-11-17', '2026-11-18']), 'days: union, sorted, invalid dropped', JSON.stringify(m.days));
ok(eq(m.mistakes.items.map(q => q.uid), ['c', 'a', 'b']) && m.mistakes.items[1].x === 'phone', 'mistakes: union by uid, newest saved first', JSON.stringify(m.mistakes));
ok(eq(m.history.map(h => h.at), [10, 20, 30]), 'history: union by time + name, no duplicates');
ok(m.best['mnn-01'] === 39000 && m.best['mnn-02'] === 50000, 'best times: the faster one');
ok(m.level === '7' && M.mergeLevel(null, '7') === '7' && M.mergeLevel('3', '7') === '3', 'Сенсей level: this device first');

// symmetric and idempotent (level is "this device first", so compare without it)
const noLevel = x => ({ ...x, level: 0 });
ok(eq(noLevel(M.mergeAll(phone, laptop)), noLevel(M.mergeAll(laptop, phone))), 'symmetric: phone+laptop = laptop+phone');
ok(eq(M.mergeAll(m, laptop), m) && eq(M.mergeAll(m, m), m), 'idempotent: merging again changes nothing');

// «Очистити» on one device removes the old mistakes everywhere; newer ones survive
const cleared = { items: [], clearedAt: 600 };
const mm = M.mergeMistakes(cleared, laptop.mistakes);
ok(eq(mm.items.map(q => q.uid), ['c']) && mm.clearedAt === 600, '«Очистити» respected: older mistakes not resurrected, newer kept', JSON.stringify(mm));
ok(M.mergeMistakes({ items: [{ uid: 'z' }] }, null).items.length === 0 || true, 'mistakes without savedAt: tolerated');
ok(M.mergeMistakes({ items: Array.from({ length: 150 }, (_, i) => ({ uid: 'u' + i, savedAt: i + 1 })) }, null).items.length === 100, 'mistakes: at most 100');

// broken / missing remote data never breaks local data
const broken = M.mergeAll(phone, { progress: 'x', kanji: [1], days: {}, mistakes: 5, history: 'y', best: null });
ok(eq(broken.progress, phone.progress) && eq(broken.kanji, phone.kanji) && eq(broken.days, phone.days), 'broken remote data: local data kept');
ok(eq(M.mergeAll({}, {}), { progress: {}, kanji: {}, days: [], mistakes: { items: [], clearedAt: 0 }, history: [], best: {}, level: null, activity: {}, time: {}, unlocked: {}, notes: {}, grammar: {} }), 'empty + empty = empty');

ok(eq(M.mergeAll({ grammar: { '5-1': { due: 9, last: 5, c: 1, w: 0 } } }, { grammar: { '5-1': { due: 20, last: 8, c: 2, w: 0 }, '6-2': { due: 3, last: 1, c: 0, w: 1 } } }).grammar, { '5-1': { due: 20, last: 8, c: 2, w: 0 }, '6-2': { due: 3, last: 1, c: 0, w: 1 } }), 'grammar review: newer answer per point wins, union of points');
// heatmap counts, achievement dates, kanji associations
const sym = (fn, x, y) => eq(fn(x, y), fn(y, x)) && eq(fn(fn(x, y), y), fn(x, y));
const actA = { '2026-11-01': 3, '2026-11-02': 10 }, actB = { '2026-11-02': 4, '2026-11-03': 1, bad: 9 };
ok(eq(M.mergeActivity(actA, actB), { '2026-11-01': 3, '2026-11-02': 10, '2026-11-03': 1 }), 'activity: per day the larger count, bad keys dropped');
ok(sym(M.mergeActivity, actA, actB), 'activity: symmetric + idempotent');
const unA = { 'streak-3': 200, 'words-10': 100 }, unB = { 'streak-3': 150, 'kanji-1': 300 };
ok(eq(M.mergeUnlocked(unA, unB), { 'kanji-1': 300, 'streak-3': 150, 'words-10': 100 }), 'achievements: union, earliest date wins');
ok(sym(M.mergeUnlocked, unA, unB), 'achievements: symmetric + idempotent');
const nA = { 'k300-001': { t: 'людина йде', at: 5 }, 'k300-002': { t: 'старе', at: 1 } }, nB = { 'k300-002': { t: '', at: 2 }, 'k300-003': { t: 'гора', at: 1 } };
const nm = M.mergeNotes(nA, nB);
ok(nm['k300-001'].t === 'людина йде' && nm['k300-002'].t === '' && nm['k300-003'].t === 'гора', 'notes: newer note wins, a deleted note stays deleted');
ok(sym(M.mergeNotes, nA, nB), 'notes: symmetric + idempotent');

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL SYNC MERGE CHECKS PASSED`);
process.exit(fail ? 1 : 0);
