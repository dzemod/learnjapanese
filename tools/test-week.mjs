// Weekly summary (site/js/week.js): node tools/test-week.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = await import(pathToFileURL(path.join(ROOT, 'site/js/week.js')).href);
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };

const wed = new Date(2026, 10, 18, 15); // Wednesday 18 Nov 2026
const mon = W.weekStart(wed);
ok(W.ymd(mon) === '2026-11-16' && mon.getHours() === 0, 'week starts on Monday 00:00', W.ymd(mon));
ok(W.ymd(W.weekStart(new Date(2026, 10, 22, 23))) === '2026-11-16', 'Sunday belongs to the same week');
ok(W.ymd(W.weekStart(new Date(2026, 10, 23, 0, 30))) === '2026-11-23', 'Monday 00:30 starts a new week');
ok(W.ymd(W.weekStart(wed, -1)) === '2026-11-09', 'last week');
const t = (d, h = 12) => new Date(2026, 10, d, h).getTime();
const data = {
  days: ['2026-11-08', '2026-11-09', '2026-11-11', '2026-11-15', '2026-11-16'],
  time: { '2026-11-09': 10 * 6e4, '2026-11-11': 5.4 * 6e4, '2026-11-16': 30 * 6e4 },
  activity: { '2026-11-09': 30, '2026-11-15': 12, '2026-11-16': 99 },
  progress: { 'mnn-01/1': { lvl: 2, last: t(10) }, 'mnn-01/2': { lvl: 1, last: t(12) }, 'mnn-01/3': { lvl: 2, last: t(16, 1) }, 'k300-01-w/k300-001-1': { lvl: 2, last: t(10) } },
  kanji: { a: { last: t(9) }, b: { last: t(15, 23) }, c: { last: t(8) } },
  history: [
    { at: t(10), pct: 80, mistakes: [{ ref: { kind: 'g', lesson: 14, point: '14-3' } }, { ref: { kind: 'g', lesson: 14, point: '14-3' } }, { ref: { kind: 'k' } }] },
    { at: t(13), pct: 90, mistakes: [{ ref: { kind: 'g', lesson: 17, point: '17-1' } }] },
    { at: t(17), pct: 10, mistakes: [{ ref: { kind: 'g', lesson: 1, point: '1-1' } }] },
  ],
};
const s = W.summarize(data, W.weekStart(wed, -1));
ok(s.from === '2026-11-09' && s.to === '2026-11-15', 'range Mon–Sun', `${s.from} ${s.to}`);
ok(s.days === 3, 'studied days in the week (9, 11, 15)', String(s.days));
ok(s.minutes === 15, 'minutes (10 + 5.4 → 15)', String(s.minutes));
ok(s.actions === 42, 'actions', String(s.actions));
ok(s.words.reviewed === 2 && s.words.known === 1, 'words reviewed / known (kanji-lesson words excluded)', JSON.stringify(s.words));
ok(s.kanji === 2, 'kanji written in the week (Sunday 23:00 counts)', String(s.kanji));
ok(s.exams.n === 2 && s.exams.avg === 85, 'exams + average', JSON.stringify(s.exams));
ok(s.weak && s.weak.lesson === 14 && s.weak.point === '14-3' && s.weak.n === 2, 'weakest grammar point', JSON.stringify(s.weak));
const empty = W.summarize({}, W.weekStart(wed));
ok(empty.days === 0 && empty.exams.avg === null && empty.weak === null, 'empty data → zeros');
ok(W.showCard(new Date(2026, 10, 16, 9), s, '') && W.showCard(wed, s, '') && !W.showCard(new Date(2026, 10, 19), s, ''), 'card Monday–Wednesday only');
ok(!W.showCard(wed, s, '2026-11-09') && !W.showCard(wed, empty, ''), 'card hidden when dismissed or nothing studied');
console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL WEEK CHECKS PASSED`);
process.exit(fail ? 1 : 0);
