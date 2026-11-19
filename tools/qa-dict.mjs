// Browser QA of «Словник» (375 + 1280 px): the tab in the navigation (7 tabs, phones 4 + 3), loading progress,
// search 日本 / にほん / nihon (romaji → kana) / rain (English) / дощ (Ukrainian → my lessons), ranking (the common exact
// word first), word page (senses with Ukrainian parts of speech, «у ваших уроках», kanji links, favourite), kanji page
// (stroke order, Ukrainian meaning from the kanji book, readings, words with it), radical search (木 + 日 → 東),
// favourites on the home of the tab, no horizontal scroll, no page errors.
//   node tools/qa-dict.mjs   → screenshots in qa/dict/   (KVG_DIR = local KanjiVG files, default %TEMP%/claude-kvg)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/dict');
fs.mkdirSync(OUT, { recursive: true });
const KVG_DIR = process.env.KVG_DIR || path.join(process.env.TEMP || '/tmp', 'claude-kvg');
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const firstItem = page => page.$eval('.dc-item', e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  if (fs.existsSync(KVG_DIR)) await ctx.route(/KanjiVG\/kanjivg@[^/]+\/kanji\/([0-9a-f]+)\.svg$/, r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(path.join(KVG_DIR, /([0-9a-f]+)\.svg$/.exec(r.request().url())[1] + '.svg'), 'utf8') }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  const nav = await page.$$eval('.tabs-nav a', as => as.map(a => [a.dataset.tab, Math.round(a.getBoundingClientRect().top)]));
  ok(nav.length === 7 && nav.some(n => n[0] === 'dict'), T('7 tabs incl. Словник'));
  if (kind === 'phone') ok(new Set(nav.map(n => n[1])).size === 2, T('phone: tabs in two rows'), JSON.stringify(nav));
  await page.click('.tabs-nav a[data-tab="dict"]');
  await page.waitForSelector('.dc-search');
  ok(await page.$eval('.tabs-nav a[data-tab="dict"]', a => getComputedStyle(a).backgroundColor !== 'rgba(0, 0, 0, 0)'), T('Словник tab highlighted'));
  await page.screenshot({ path: path.join(OUT, `home-${width}.png`) });
  const search = async q => { await page.fill('.dc-search input', q); await page.press('.dc-search input', 'Enter'); await page.waitForSelector('.dc-res .dc-item, .dc-res p', { timeout: 30000 }); await page.waitForTimeout(150); };
  await search('日本');
  ok(/^日本\s*にほん/.test(await firstItem(page)) && /Japan/.test(await firstItem(page)), T('日本 → 日本 にほん «Japan» first'), await firstItem(page));
  ok(await page.locator('.dc-k').count() >= 2, T('日本: kanji tiles 日 本'));
  ok(await noScroll(page), T('results: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `results-${width}.png`) });
  await search('nihon');
  ok(/にほん/.test(await page.textContent('.dc-res .group-title')) && /日本/.test(await firstItem(page)), T('romaji nihon → にほん → 日本'), await firstItem(page));
  await search('rain');
  const enTitles = await page.$$eval('.dc-res .group-title', h => h.map(x => x.textContent));
  const enFirst = await page.$$eval('.dc-res .dc-list', l => l.at(-1)?.querySelector('.dc-item')?.textContent.replace(/\s+/g, ' ') || '');
  ok(enTitles.some(t => /Англійською/.test(t)) && /雨/.test(enFirst), T('English rain → 雨 first'), enFirst);
  await search('дощ');
  ok(/Ваші уроки/.test(await page.textContent('.dc-res')) && /雨/.test(await page.textContent('.dc-res')), T('Ukrainian дощ → my lessons 雨'));
  // word page
  await search('勉強');
  await page.click('.dc-item');
  await page.waitForSelector('.dc-word');
  const wtxt = await page.textContent('.dc-word');
  ok(/勉強/.test(wtxt) && /study/i.test(wtxt), T('word page 勉強: senses'), wtxt.replace(/\s+/g, ' ').slice(0, 120));
  ok(/іменник|дієслово з する/.test(wtxt), T('parts of speech in Ukrainian'));
  ok(await page.locator('.dc-word .dc-mine').count() === 1, T('«у ваших уроках» meaning shown'));
  await page.click('[data-fav]');
  await page.screenshot({ path: path.join(OUT, `word-${width}.png`) });
  // kanji page
  await page.click('.dc-k >> nth=0');
  await page.waitForSelector('.dc-kpage');
  await page.waitForSelector('.dc-so svg', { timeout: 8000 }).catch(() => {});
  const ktxt = await page.textContent('.dc-kpage');
  ok(/勉/.test(ktxt) && /exertion|endeavour|effort/i.test(ktxt), T('kanji page 勉: English meaning'));
  ok(/старанність/.test(ktxt), T('kanji page: Ukrainian meaning from the kanji book'));
  ok(await page.locator('.dc-so svg path').count() > 0, T('stroke order drawn'));
  await page.waitForSelector('.dc-with .dc-item', { timeout: 30000 });
  ok(await page.locator('.dc-with .dc-item').count() >= 5, T('words with 勉'));
  ok(await noScroll(page), T('kanji page: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `kanji-${width}.png`) });
  // radicals
  await page.goto(BASE + '#/dict/radicals', { waitUntil: 'networkidle' });
  await page.waitForSelector('.dc-r');
  await page.click('.dc-r[data-r="木"]');
  await page.click('.dc-r[data-r="日"]');
  const found = await page.$$eval('.dc-found .dc-k b', b => b.map(x => x.textContent));
  ok(found.includes('東') && found.includes('明') === false, T('radicals 木 + 日 → 東 (not 明)'), found.slice(0, 12).join(''));
  ok(await page.locator('.dc-r.dim').count() > 50, T('impossible radicals dimmed'));
  ok(await noScroll(page), T('radicals: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `radicals-${width}.png`) });
  // favourites + recent
  await page.goto(BASE + '#/dict', { waitUntil: 'networkidle' });
  ok(/勉強/.test(await page.textContent('.dc')) && /Обране/.test(await page.textContent('.dc')) && /Нещодавні пошуки/.test(await page.textContent('.dc')), T('favourite + recent searches on the tab home'));
  // whole dictionary loaded
  await page.waitForFunction(() => !document.querySelector('.dc-load'), null, { timeout: 60000 }).catch(() => {});
  await search('べちゃんこ'); // not a common word → in a later chunk
  ok(/べちゃんこ/.test(await firstItem(page)) && /squished flat/.test(await firstItem(page)), T('a rare word from a later chunk found'), await firstItem(page));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL DICTIONARY CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
