// Browser QA of the daily goal (320 / 375 / 1280 px): ring «0 / 10 хв» on a new device, goal choice kept, study time
// grows with answers, reaching the goal → toast + green ring + «Мета дня» achievement; storage blocked still works.
//   node tools/qa-goal.mjs   → screenshots in qa/goal/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/goal');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const L = sets.find(s => s.id === 'mnn-03');
const day = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

for (const [kind, width, height] of [['narrow', 320, 640], ['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const opts = { viewport: { width, height }, isMobile: kind !== 'desktop', hasTouch: kind !== 'desktop', locale: 'uk-UA' };
  let ctx = await browser.newContext(opts);
  let page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  ok((await page.textContent('[data-t="goal"]')) === '0 / 10 хв', T('new device: 0 / 10 хв'));
  await page.selectOption('[data-goal]', '5');
  ok((await page.textContent('[data-t="goal"]')) === '0 / 5 хв', T('goal changed to 5 min'));
  await page.reload({ waitUntil: 'networkidle' });
  ok((await page.textContent('[data-t="goal"]')) === '0 / 5 хв', T('goal kept after reload'));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), T('no horizontal scroll'));
  // 4 min 50 s studied, last action 40 s ago, 3 due words → answering one reaches 5 min
  await page.evaluate(([d, ids, now]) => {
    localStorage.setItem('jp.studyTime', JSON.stringify({ [d]: 290e3 }));
    localStorage.setItem('jp.studyTime.at', JSON.stringify(now - 40e3));
    const p = {};
    ids.forEach(id => (p[`mnn-03/${id}`] = { c: 1, w: 0, lvl: 1, star: false, last: now - 2 * 864e5, ivl: 72e6, ease: 2.5, due: now - 864e5 }));
    localStorage.setItem('jp.progress', JSON.stringify(p));
  }, [day(), L.cards.slice(0, 3).map(c => c.id), Date.now()]);
  await page.goto(BASE + '#/today', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-show]');
  await page.click('[data-yes]');
  await page.waitForFunction(() => /Денну мету виконано/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
  ok(/Денну мету виконано/.test(await page.textContent('#toast')), T('reaching the goal: toast'));
  const t1 = await page.evaluate(d => JSON.parse(localStorage.getItem('jp.studyTime'))[d], day());
  ok(t1 >= 300e3 && t1 <= 340e3, T('study time grew by the gap since the last answer'), String(t1));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  ok(/5 \/ 5 хв/.test(await page.textContent('[data-t="goal"]')) && await page.locator('.today-goal.done .goal-ring.done').count() === 1, T('ring full and green, «денну мету виконано»'));
  await page.screenshot({ path: path.join(OUT, `home-${width}.png`) });
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('jp.achievements') || '{}')['goal-1'], null, { timeout: 3000 }).catch(() => {});
  const un = await page.evaluate(() => JSON.parse(localStorage.getItem('jp.achievements') || '{}'));
  ok(!!un['goal-1'], T('«Мета дня» achievement unlocked'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
  // storage blocked
  ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }));
  page = await ctx.newPage();
  const e2 = [];
  page.on('pageerror', e => e2.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  ok((await page.textContent('[data-t="goal"]')) === '0 / 10 хв' && !e2.length, T('storage blocked: ring shown, no errors'), e2.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL GOAL UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
