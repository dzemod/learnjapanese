// Review schedule for words (site/js/word-srs.js): node tools/test-word-srs.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = await import(pathToFileURL(path.join(ROOT, 'site/js/word-srs.js')).href);
const { schedule, isDue, dueScore, fmtIvl, SRS, DAY } = W;
let fail = 0, pass = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };
const T0 = Date.UTC(2026, 10, 19, 9);
const H = 36e5;

// first right answer → 20 h, then ×2.5 when due
let p = { c: 0, w: 0, lvl: 0 };
let s = schedule(p, true, 'write', T0);
ok(s.ivl === SRS.FIRST && s.due === T0 + SRS.FIRST && s.ease === 2.5, 'first right answer: 20 h', JSON.stringify(s));
p = { c: 1, w: 0, lvl: 1, last: T0, ...s };
ok(!isDue(p, T0 + 19 * H) && isDue(p, T0 + 20 * H), 'due after 20 h, not before');
const again = schedule(p, true, 'write', T0 + H);
ok(again.ivl === SRS.FIRST && again.due === p.due, 'right again before due (same session): no growth');
s = schedule(p, true, 'write', T0 + 21 * H);
ok(s.ivl === Math.round(SRS.FIRST * 2.5), 'recall when due: ×2.5 (≈ 2 days)', fmtIvl(s.ivl));
const mc = schedule(p, true, 'mc', T0 + 21 * H);
ok(mc.ivl === Math.round(SRS.FIRST * 1.3), 'recognition when due: ×1.3', fmtIvl(mc.ivl));
// wrong → 10 min, ease drops, floor 1.3
s = schedule({ ...p, ivl: 30 * DAY, ease: 2.5, due: T0 }, false, 'write', T0);
ok(s.ivl === SRS.AGAIN && s.due === T0 + SRS.AGAIN && s.ease === 2.3, 'wrong: 10 min, ease 2.3', JSON.stringify(s));
ok(schedule({ ease: 1.35 }, false, 'write', T0).ease === 1.3, 'ease never below 1.3');
// after a lapse the next right answer starts again from 20 h
s = schedule({ c: 3, w: 1, lvl: 1, last: T0, ivl: SRS.AGAIN, ease: 2.3, due: T0 + SRS.AGAIN }, true, 'write', T0 + 11 * 6e4);
ok(s.ivl === SRS.FIRST && s.ease === 2.3, 'relearn: back to 20 h, lower ease kept');
// growth is capped at a year
ok(schedule({ ivl: 300 * DAY, ease: 2.5, due: T0, last: T0 - 300 * DAY, lvl: 2 }, true, 'write', T0).ivl === SRS.MAX, 'max one year');
// legacy words (answered before the schedule existed)
const legacyKnown = { c: 3, w: 0, lvl: 2, last: T0 - 8 * DAY };
ok(isDue(legacyKnown, T0) && !isDue({ ...legacyKnown, last: T0 - 6 * DAY }, T0), 'legacy known word: due after 7 days');
ok(isDue({ c: 0, w: 2, lvl: 1, last: T0 - 11 * 6e4 }, T0), 'legacy word with more mistakes: due after 10 min');
s = schedule(legacyKnown, true, 'write', T0);
ok(s.ivl === SRS.KNOWN_START, 'legacy known word continues from 7 days', fmtIvl(s.ivl));
ok(schedule({ c: 1, w: 0, lvl: 1, last: T0 - DAY }, true, 'write', T0).ivl === SRS.FIRST, 'legacy learning word starts at 20 h');
// new words are never due; order
ok(!isDue({}, T0) && !isDue({ c: 0, w: 0, lvl: 0 }, T0), 'new words are never due');
ok(dueScore({ c: 0, w: 3, due: T0, ivl: DAY }, T0) > dueScore({ c: 3, w: 0, due: T0 - DAY, ivl: DAY }, T0), 'more mistakes first');
ok(fmtIvl(10 * 6e4) === '10 хв' && fmtIvl(20 * H) === '20 год' && fmtIvl(3 * DAY) === '3 дн.' && fmtIvl(90 * DAY) === '3 міс.', 'interval text');

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed\nALL WORD SCHEDULE CHECKS PASSED`);
process.exit(fail ? 1 : 0);
