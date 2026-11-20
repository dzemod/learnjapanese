// Browser QA of the dictionary example sentences (375 + 1280 px): word page お茶 (1002430) shows «Приклади речень»
// with the word highlighted, a Ukrainian translation, English, «Прослухати», «Розібрати» and the Tatoeba link +
// licence; a word without examples has no empty section; no horizontal scroll, no page errors.
//   node tools/qa-dict-examples.mjs   → screenshots in qa/dict-examples/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/dict-examples');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
// a dictionary word without any example (for the «no empty section» check)
const shardOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 16).toString(16); };
const withEx = new Set();
for (let i = 0; i < 16; i++) Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, `site/data/dict/ex-${i.toString(16)}.json`), 'utf8')).x).forEach(id => withEx.add(id));
const noEx = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/dict/words-00.json'), 'utf8')).e.map(e => String(e[0])).find(id => !withEx.has(id));

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  const asked = [];
  page.on('request', r => { const m = /dict\/ex-([0-9a-f])\.json/.exec(r.url()); if (m) asked.push(m[1]); });
  await page.goto(BASE + '#/dict/w/1002430', { waitUntil: 'networkidle' });
  await page.waitForSelector('.dc-ex:not([hidden]) .dc-exi', { timeout: 60000 });
  ok(asked.length === 1 && asked[0] === shardOf('1002430'), T('only the word’s example file is loaded'), asked.join());
  const n = await page.locator('.dc-exi').count();
  ok(n >= 3, T('お茶: several examples'), String(n));
  ok(await page.locator('.dc-exja b').count() >= 1 && /茶/.test(await page.textContent('.dc-exja b')), T('the word is highlighted'));
  ok(/Цей чай добре смакує/.test(await page.textContent('.dc-ex')), T('Ukrainian translation shown'));
  ok(await page.locator('.dc-exen').count() >= 1, T('English translation shown'));
  ok(await page.locator('.dc-ex a[href^="https://tatoeba.org/uk/sentences/show/"]').count() === n, T('every example links to Tatoeba'));
  ok(await page.locator('.dc-ex a[href^="#/translate/"]').count() === n, T('every example: «Розібрати»'));
  ok(/CC BY 2\.0 FR/.test(await page.textContent('.dc-ex')), T('Tatoeba licence'));
  ok(await noScroll(page), T('no horizontal scroll'));
  await page.locator('.dc-ex').screenshot({ path: path.join(OUT, `ocha-${width}.png`) });
  await page.click('.dc-exi [data-ex-say] >> nth=0'); // speech: must not throw
  await page.click('.dc-exi a[href^="#/translate/"] >> nth=0');
  await page.waitForFunction(() => location.hash.startsWith('#/translate/'));
  ok(true, T('«Розібрати» opens the Перекладач'));

  await page.goto(BASE + '#/dict/w/' + noEx, { waitUntil: 'networkidle' });
  await page.waitForSelector('.dc-word');
  await page.waitForTimeout(800);
  ok(await page.locator('.dc-ex').count() === 0, T('word without examples: no empty section'), noEx);

  ok(!errs.length, T('no page errors'), errs.join('\n'));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`${passed} passed, ${issues.length} failed`);
process.exit(issues.length ? 1 : 0);
