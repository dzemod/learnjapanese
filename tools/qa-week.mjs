// Browser QA of the weekly summary (375 + 1280 px), with the page clock set to Tuesday 17 Nov 2026:
// home card about last week (numbers, weakest grammar point with its title and link), «✕» hides it for that week,
// #/week/-1 page with navigation, #/week/0, no card on Thursday, no horizontal scroll, no page errors.
//   node tools/qa-week.mjs   → screenshots in qa/week/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/week');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const t = (d, h = 12) => new Date(2026, 10, d, h).getTime();
const seed = {
  'jp.days': ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-03'],
  'jp.studyTime': { '2026-11-09': 12 * 6e4, '2026-11-10': 9 * 6e4, '2026-11-03': 5 * 6e4 },
  'jp.activity': { '2026-11-09': 40, '2026-11-10': 25 },
  'jp.progress': { 'mnn-01/1': { c: 2, w: 0, lvl: 2, star: false, last: t(10) } },
  'jp.examHistory': [{ at: t(12), name: 'Уроки 14–15', n: 20, ok: 15, pct: 75, mistakes: [{ type: 'v', weak: 'て-форма', ref: { kind: 'g', lesson: 14, point: '14-3' } }, { type: 'v', weak: 'て-форма', ref: { kind: 'g', lesson: 14, point: '14-3' } }] }],
};

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  await ctx.addInitScript(s => { if (!sessionStorage.getItem('qa')) { sessionStorage.setItem('qa', 1); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); } }, seed);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(2026, 10, 17, 10)); // Tuesday
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.wk-card', { timeout: 5000 }).catch(() => {});
  const card = await page.textContent('.wk-card').catch(() => '');
  ok(/9 листопада – 15 листопада/.test(card), T('card: last week range'), card.slice(0, 80));
  ok(/3 \/ 7/.test(card) && /21\s*хвилина/.test(card) && /1\s*екзамен/.test(card), T('card: days, minutes, exams'), card.replace(/\s+/g, ' ').slice(0, 220));
  await page.waitForFunction(() => /пункт \d+ «/.test(document.querySelector('.wk-weak')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  ok(/Урок 14, пункт \d+ «/.test(await page.textContent('.wk-weak').catch(() => '')), T('weakest grammar point with its title'));
  ok((await page.getAttribute('.wk-weak a.btn.primary', 'href')) === '#/grammar/14/14-3', T('«Повторити граматику» links to the point'));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), T('home: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `home-${width}.png`) });
  await page.click('.wk-card a.link');
  await page.waitForSelector('.wk-page');
  ok(/Минулий тиждень/.test(await page.textContent('.wk-page h1')), T('#/week/-1 page'));
  await page.screenshot({ path: path.join(OUT, `page-${width}.png`), fullPage: true });
  await page.click('.wk-nav a:has-text("Раніше")');
  await page.waitForFunction(() => /2 листопада – 8 листопада/.test(document.querySelector('.wk-page')?.textContent || ''));
  ok(/5\s*хвилин/.test(await page.textContent('.wk-page')), T('previous week: its own numbers'));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-wk-hide]');
  await page.click('[data-wk-hide]');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  ok(await page.locator('.wk-card').count() === 0, T('«✕» hides the card for that week'));
  await page.goto(BASE + '#/week/0', { waitUntil: 'networkidle' });
  ok(/Цей тиждень/.test(await page.textContent('.wk-page h1')), T('#/week/0'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
// Thursday: no card
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await ctx.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(2026, 10, 19, 10));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok(await page.locator('.wk-card').count() === 0, 'Thursday: no card');
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL WEEK UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
