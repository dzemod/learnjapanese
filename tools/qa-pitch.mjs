// Browser QA of the pitch accent (375 + 1280 px): marks on lesson word rows and study cards (雨 [1], ます-verb drops
// after ま), dictionary word page (雨 vs 飴, Kanjium credit), the home setting turns it off and on, no horizontal
// scroll, no page errors.
//   node tools/qa-pitch.mjs   → screenshots in qa/pitch/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/pitch');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const go = (page, h) => page.evaluate(h => (location.hash = h), h);
const pitchOfRow = (page, jp) => page.evaluate(jp => {
  const row = [...document.querySelectorAll('.term-jp')].find(r => r.querySelector('.jp')?.textContent === jp);
  const p = row?.querySelector('.pitch');
  return p ? { n: p.querySelector('small').textContent, cells: [...p.querySelectorAll(':scope > span')].map(s => s.className + ':' + s.textContent) } : null;
}, jp);

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  await page.goto(BASE + '#/set/mnn-12', { waitUntil: 'networkidle' });
  await page.waitForSelector('.term-jp');
  const ame = await pitchOfRow(page, '雨');
  ok(ame && ame.n === '1' && ame.cells[0].startsWith('h d') && ame.cells[1].startsWith('l'), T('雨 あめ: high-low [1]'), JSON.stringify(ame));
  ok(await page.locator('.term-jp .pitch').count() > 20, T('lesson 12: many words with pitch'));
  ok(await noScroll(page), T('lesson: no horizontal scroll'));
  await page.locator('.term-jp >> nth=0').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `lesson-${width}.png`) });
  await go(page, '#/set/mnn-05');
  await page.waitForSelector('.term-jp');
  const iku = await pitchOfRow(page, '行きます');
  ok(iku && iku.n === '3' && iku.cells[2] === 'h d:ま' && iku.cells[3] === 'l:す', T('行きます: drop after ま'), JSON.stringify(iku));

  // dictionary word pages: 雨 [1] vs 飴 [0]
  await go(page, '#/dict/q/' + encodeURIComponent('あめ'));
  await page.waitForSelector('a.dc-item[href^="#/dict/w/"]', { timeout: 60000 });
  const links = await page.$$eval('a.dc-item[href^="#/dict/w/"]', a => a.map(x => [x.getAttribute('href'), x.querySelector('.dc-main')?.textContent]));
  const ameL = links.find(l => l[1] === '雨'), ameC = links.find(l => l[1] === '飴');
  for (const [l, want] of [[ameL, '1'], [ameC, '0']]) {
    if (!l) { ok(false, T(`dictionary result for ${want === '1' ? '雨' : '飴'}`)); continue; }
    await go(page, l[0]);
    await page.waitForSelector('.dc-word');
    await page.waitForSelector('.dc-pitch .pitch', { timeout: 15000 }).catch(() => {});
    const n = await page.textContent('.dc-pitch .pitch small').catch(() => '');
    ok(n === want, T(`dictionary ${l[1]}: [${want}]`), n);
    ok(/Kanjium/.test(await page.textContent('.dc-pitch')), T('dictionary: Kanjium credit'));
    if (want === '1') await page.locator('.dc-word').screenshot({ path: path.join(OUT, `dict-${width}.png`) });
  }

  // setting off → no marks, on → back
  await go(page, '#/');
  await page.waitForSelector('[data-pitch]');
  await page.locator('[data-pitch]').uncheck();
  ok(await page.evaluate(() => localStorage.getItem('jp.pitch')) === 'off', T('setting off stored'));
  await go(page, '#/set/mnn-12');
  await page.waitForSelector('.term-jp');
  ok(await page.locator('.term-jp .pitch').count() === 0, T('setting off: no marks'));
  await go(page, '#/');
  await page.waitForSelector('[data-pitch]');
  await page.locator('[data-pitch]').check();
  await go(page, '#/set/mnn-12');
  await page.waitForSelector('.term-jp .pitch');
  ok(true, T('setting on: marks back'));

  ok(!errs.length, T('no page errors'), errs.join('\n'));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`${passed} passed, ${issues.length} failed`);
process.exit(issues.length ? 1 : 0);
