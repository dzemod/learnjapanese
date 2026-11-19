// Browser QA of the kanji collection board (375 + 1280 px): 1000 cells, colours from the writing schedule
// (new / learning / due / known / mastered), legend counts, book filter, a cell opens the kanji card, entry on the
// kanji home page, no horizontal scroll, no page errors.   node tools/qa-kanji-board.mjs → qa/kanji-board/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/kanji-board');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const ids = kj.books[0].lessons[0].kanji.map(k => k.id); // k300-001 … 020
const D = 864e5;

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  await ctx.addInitScript(([ids, D]) => {
    const now = Date.now(), s = {};
    ids.slice(0, 4).forEach(id => (s[id] = { due: now + 6e5, interval: 6e5, rating: 'good', reps: 1, last: now }));          // learning 4
    ids.slice(4, 7).forEach(id => (s[id] = { due: now - 1000, interval: 2 * D, rating: 'good', reps: 2, last: now - 3 * D })); // due 3
    ids.slice(7, 12).forEach(id => (s[id] = { due: now + 5 * D, interval: 5 * D, rating: 'good', reps: 3, last: now }));      // known 5
    ids.slice(12, 14).forEach(id => (s[id] = { due: now + 30 * D, interval: 30 * D, rating: 'easy', reps: 5, last: now }));  // mastered 2
    localStorage.setItem('jp.kanjiWrite', JSON.stringify(s));
  }, [ids, D]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/kanji', { waitUntil: 'networkidle' });
  await page.click('a[href="#/kanji/board"]');
  await page.waitForSelector('.kb-grid');
  ok(await page.locator('.kb-grid .kb-c').count() === 1000, T('1000 kanji cells'), String(await page.locator('.kb-grid .kb-c').count()));
  const n = async c => page.locator(`.kb-grid .kb-c.${c}`).count();
  ok(await n('learning') === 4 && await n('review') === 3 && await n('known') === 5 && await n('mastered') === 2 && await n('new') === 986, T('cell colours by status'), JSON.stringify([await n('learning'), await n('review'), await n('known'), await n('mastered'), await n('new')]));
  ok(/Написано 14 з 1000 · засвоєно 2/.test(await page.textContent('.kb-page .hero')), T('summary line'));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), T('no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `board-${width}.png`) });
  await page.click('.kb-grid .kb-c.review >> nth=0');
  await page.waitForSelector('.kcard .kc-big');
  ok((await page.textContent('.kcard .kc-big')) === kj.books[0].lessons[0].kanji[4].kanji, T('a cell opens its kanji card'));
  await page.click('[data-close]');
  await page.click('.kb-books a:has-text("Середній 700")');
  await page.waitForFunction(() => location.hash === '#/kanji/board/k700');
  ok(await page.locator('.kb-grid .kb-c').count() === 700 && await page.locator('.kb-books a.on').textContent() === 'Середній 700', T('book filter: 700'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL KANJI BOARD CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
