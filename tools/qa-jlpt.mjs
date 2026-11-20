// Browser QA of the JLPT levels (375 + 1280 px): #/jlpt page (5 levels, bars, counts follow jp.progress and
// jp.kanjiWrite, lazy word lists, links to the dictionary), home entry, «N5» chips on lesson word rows, the kanji card
// and the dictionary word / kanji pages, no horizontal scroll, no page errors.
//   node tools/qa-jlpt.mjs   → screenshots in qa/jlpt/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/jlpt');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const go = (page, h) => page.evaluate(h => (location.hash = h), h);
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const l1 = sets.find(s => s.id === 'mnn-01');

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  // lesson 1 known, 日 mastered in the writing schedule
  await page.addInitScript(([cards]) => {
    if (sessionStorage.getItem('qa.seeded')) return;
    sessionStorage.setItem('qa.seeded', '1');
    const p = {};
    for (const id of cards) p[`mnn-01/${id}`] = { c: 3, w: 0, lvl: 2, star: false, last: Date.now() - 864e5, due: Date.now() + 9e8, ivl: 9e8, ease: 2.5 };
    localStorage.setItem('jp.progress', JSON.stringify(p));
    localStorage.setItem('jp.kanjiWrite', JSON.stringify({ 'k300-001': { due: Date.now() + 30 * 864e5, interval: 30 * 864e5, rating: 'easy', reps: 5, last: Date.now() - 864e5, mistakes: 0, totalMistakes: 0 } }));
  }, [l1.cards.map(c => c.id)]);
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  ok(await page.locator('.drill-entry[href="#/jlpt"]').count() === 1, T('home: «Шлях до JLPT» entry'));
  await page.click('.drill-entry[href="#/jlpt"]');
  await page.waitForSelector('.jl-level');
  ok(await page.locator('.jl-level').count() === 5, T('5 levels'));
  const n5 = await page.textContent('#n5');
  const known = +/знаю (\d+)/.exec(n5)?.[1];
  ok(known >= 10, T('N5: lesson 1 words counted as known'), n5.slice(0, 200));
  ok(/засвоєно 1 /.test(n5) || /засвоєно 1·/.test(n5) || /засвоєно 1\b/.test(n5), T('N5: 日 mastered'), n5.slice(0, 300));
  ok(await noScroll(page), T('jlpt: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `jlpt-${width}.png`), fullPage: true });
  await page.click('#n3 details.jl-more summary');
  await page.waitForSelector('#n3 [data-words] a');
  const chips = await page.locator('#n3 [data-words] a').count();
  ok(chips > 100, T('N3: missing words listed when opened'), String(chips));
  const href = await page.getAttribute('#n3 [data-words] a >> nth=0', 'href');
  ok(/^#\/dict\/q\//.test(href), T('missing word links to the dictionary'), href);
  ok(await noScroll(page), T('jlpt with an open list: no horizontal scroll'));

  // chips: lesson rows, kanji card, dictionary
  await go(page, '#/set/mnn-05');
  await page.waitForSelector('.term-jp');
  const rowChips = await page.locator('.term-jp .jlpt-chip').count();
  ok(rowChips > 20, T('lesson 5 rows: JLPT chips'), String(rowChips));
  await page.screenshot({ path: path.join(OUT, `lesson-${width}.png`) });
  await go(page, '#/kanji/k300-01/k300-001');
  await page.waitForSelector('.kc-facts');
  ok(/N5/.test(await page.textContent('.kc-facts')), T('kanji card: N5 chip'));
  await go(page, '#/dict/k/' + encodeURIComponent('働'));
  await page.waitForSelector('.dc-kpage .kc-facts', { timeout: 30000 });
  ok(/JLPT\s*N3/.test(await page.textContent('.dc-kpage .kc-facts')), T('dictionary kanji: JLPT N3'), await page.textContent('.dc-kpage .kc-facts'));
  await go(page, '#/dict/q/' + encodeURIComponent('先生'));
  await page.waitForSelector('a.dc-item[href^="#/dict/w/"]', { timeout: 60000 });
  await page.click('a.dc-item[href^="#/dict/w/"] >> nth=0');
  await page.waitForSelector('.dc-word');
  ok(await page.locator('.dc-word .jlpt-chip[data-n="5"]').count() === 1, T('dictionary word 先生: N5 chip'));
  await page.screenshot({ path: path.join(OUT, `dict-word-${width}.png`) });

  ok(!errs.length, T('no page errors'), errs.join('\n'));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`${passed} passed, ${issues.length} failed`);
process.exit(issues.length ? 1 : 0);
