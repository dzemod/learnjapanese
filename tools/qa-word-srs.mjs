// Browser QA of the word review schedule (375 + 1280 px): the lesson page shows «N слів на повторення зараз»,
// «Повторити» opens Письмо with the «Повторити» filter (only due words), answering stores due/ivl/ease, a word
// answered right is no longer due, a wrong one comes back in 10 minutes.
//   node tools/qa-word-srs.mjs   → screenshots in qa/word-srs/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/word-srs');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const L = sets.find(s => s.id === 'mnn-02');
const D = 864e5;

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const now = Date.now();
  // 3 due words (scheduled, overdue), 1 not due yet, 1 legacy known word answered 8 days ago (due)
  const prog = {
    [`mnn-02/${L.cards[0].id}`]: { c: 1, w: 0, lvl: 1, star: false, last: now - 2 * D, ivl: 20 * 36e5, ease: 2.5, due: now - D },
    [`mnn-02/${L.cards[1].id}`]: { c: 1, w: 2, lvl: 1, star: false, last: now - 3600e3, ivl: 6e5, ease: 2.1, due: now - 3000e3 },
    [`mnn-02/${L.cards[2].id}`]: { c: 2, w: 0, lvl: 2, star: false, last: now - 3 * D, ivl: 2 * D, ease: 2.5, due: now - D },
    [`mnn-02/${L.cards[3].id}`]: { c: 2, w: 0, lvl: 2, star: false, last: now, ivl: 5 * D, ease: 2.5, due: now + 5 * D },
    [`mnn-02/${L.cards[4].id}`]: { c: 3, w: 0, lvl: 2, star: false, last: now - 8 * D },
  };
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('qa')) { sessionStorage.setItem('qa', 1); localStorage.setItem('jp.progress', JSON.stringify(p)); } }, prog);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/set/mnn-02', { waitUntil: 'networkidle' });
  const row = await page.textContent('.due-row').catch(() => '');
  ok(/4\s*слова на повторення зараз/.test(row), T('lesson page: 4 words due'), row);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), T('lesson page: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `set-${width}.png`) });
  await page.click('[data-due]');
  await page.waitForFunction(() => location.hash.endsWith('/write'));
  await page.waitForTimeout(400);
  const segTxt = await page.$eval('.seg[data-name="filter"] .on', e => e.textContent).catch(() => '');
  ok(/Повторити 4/.test(segTxt), T('Письмо opens with the «Повторити» filter'), segTxt);
  // the words shown are exactly the due ones: answer each one; the first right, the rest wrong
  const dueUk = [0, 1, 2, 4].map(i => L.cards[i].ukrainian);
  const seen = [];
  // default answer side = Ukrainian: the prompt shows the Japanese word
  const dueCardsList = [0, 1, 2, 4].map(i => L.cards[i]);
  const jp = c => c.kanji || c.kana;
  for (let i = 0; i < 4; i++) {
    await page.waitForSelector('.q .answer-input:not([disabled])', { timeout: 4000 }).catch(() => {});
    const q = await page.$eval('.q', e => e.textContent).catch(() => '');
    const c = L.cards.find(x => q.includes(jp(x)) && !L.cards.some(y => y !== x && jp(y).length > jp(x).length && jp(y).includes(jp(x)) && q.includes(jp(y))));
    seen.push(c ? c.ukrainian : q.slice(0, 40));
    if (i < 2 && c) { await page.fill('.q .answer-input', c.ukrainian.split(/[,;(]/)[0].trim()); await page.click('.write-btns button[type="submit"]'); }
    else await page.click('[data-dk]');
    await page.waitForSelector('[data-next]');
    await page.click('[data-next]').catch(() => {});
    await page.waitForTimeout(250);
  }
  ok(seen.length === 4 && seen.every(u => dueUk.includes(u)) && dueCardsList.length === 4, T('only due words are asked'), seen.join(' | '));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jp.progress')));
  const after = Object.entries(stored).filter(([k]) => k.startsWith('mnn-02/'));
  const right = after.filter(([, p]) => p.due - p.last >= 19 * 36e5).length, wrong = after.filter(([, p]) => p.ivl === 6e5 && p.due - p.last === 6e5).length;
  ok(right >= 2 && wrong >= 2, T('answers stored with a schedule (right → ≥ 20 h, wrong → 10 min)'), JSON.stringify(after.map(([, p]) => [p.ivl, p.due - p.last])));
  await page.goto(BASE + '#/set/mnn-02', { waitUntil: 'networkidle' });
  const row2 = await page.textContent('.due-row').catch(() => '');
  ok(!row2 || !/4\s*слова/.test(row2), T('after the review fewer words are due'), row2);
  await page.screenshot({ path: path.join(OUT, `write-done-${width}.png`) });
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL WORD SCHEDULE UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
