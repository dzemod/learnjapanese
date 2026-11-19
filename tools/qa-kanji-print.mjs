// Browser QA of the printable kanji sheets: #/kanji/print/<lesson> at 375 + 1280 px (rows, stroke steps, practice
// squares, options, no horizontal scroll), print media (site header/nav hidden, 12 squares) and a real PDF of
// lesson k300-01 and k700-32 (page count, A4) via Chrome's print-to-PDF.
//   node tools/qa-kanji-print.mjs   → qa/kanji-print/*.png, *.pdf  (KVG_DIR = local KanjiVG files, default %TEMP%/claude-kvg)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/kanji-print');
fs.mkdirSync(OUT, { recursive: true });
const KVG_DIR = process.env.KVG_DIR || path.join(process.env.TEMP || '/tmp', 'claude-kvg');
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const strokes = Object.fromEntries(kj.books.flatMap(b => b.lessons.flatMap(l => l.kanji.map(k => [k.id, k.strokes]))));
async function context(opts) {
  const ctx = await browser.newContext(opts);
  if (fs.existsSync(KVG_DIR)) await ctx.route(/KanjiVG\/kanjivg@[^/]+\/kanji\/([0-9a-f]+)\.svg$/, r => {
    const f = path.join(KVG_DIR, /([0-9a-f]+)\.svg$/.exec(r.request().url())[1] + '.svg');
    return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(f, 'utf8') }) : r.fulfill({ status: 404, body: '' });
  });
  return ctx;
}

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await context({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/kanji/k300-02', { waitUntil: 'networkidle' });
  await page.click('a[href="#/kanji/print/k300-02"]');
  await page.waitForSelector('[data-print]:not([disabled])', { timeout: 20000 });
  ok(await page.locator('.kp-row').count() === 20, T('20 kanji rows'));
  const steps = await page.$$eval('.kp-row', rows => rows.map(r => [r.dataset.id, r.querySelectorAll('.kp-step').length]));
  ok(steps.every(([id, n]) => n === Math.min(strokes[id], 24)), T('stroke steps = stroke count for every kanji'), JSON.stringify(steps.filter(([id, n]) => n !== strokes[id]).slice(0, 4)));
  ok(await page.locator('.kp-row').first().locator('.kp-sq.trace').count() === 3, T('3 trace squares per row'));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), T('no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `screen-${width}.png`) });
  await page.uncheck('[data-trace]');
  ok(await page.$eval('.kp-sq.trace span', e => getComputedStyle(e).visibility) === 'hidden', T('option: no trace kanji'));
  await page.check('[data-trace]');
  await page.emulateMedia({ media: 'print' });
  const pr = await page.evaluate(() => ({ top: getComputedStyle(document.querySelector('.topbar')).display, tools: getComputedStyle(document.querySelector('.kp-tools')).display, sq: [...document.querySelector('.kp-row').querySelectorAll('.kp-sq')].filter(e => getComputedStyle(e).display !== 'none').length }));
  ok(pr.top === 'none' && pr.tools === 'none' && pr.sq === 12, T('print: only the sheet, 12 squares'), JSON.stringify(pr));
  await page.emulateMedia({ media: 'screen' });
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
// jsDelivr refuses (403): asked once, then every stroke file comes from GitHub raw
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let cdn = 0, raw = 0;
  await ctx.route(/cdn\.jsdelivr\.net\/gh\/KanjiVG\//, r => { cdn++; return r.fulfill({ status: 403, body: '' }); });
  await ctx.route(/raw\.githubusercontent\.com\/KanjiVG\/kanjivg\/[^/]+\/kanji\/([0-9a-f]+)\.svg$/, r => {
    raw++;
    const f = path.join(KVG_DIR, /([0-9a-f]+)\.svg$/.exec(r.request().url())[1] + '.svg');
    return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(f, 'utf8') });
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/kanji/print/k300-03', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-print]:not([disabled])', { timeout: 20000 });
  const steps = await page.locator('.kp-row .kp-steps svg').count();
  ok(steps > 100 && raw === 20 && cdn <= 20, `jsDelivr 403 → GitHub raw (cdn ${cdn}, raw ${raw}, steps ${steps})`);
  const cdnBefore = cdn;
  await page.goto(BASE + '#/kanji/print/k300-04', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-print]:not([disabled])', { timeout: 20000 });
  ok(cdn === cdnBefore && raw === 40, `next lesson: GitHub raw first, jsDelivr not asked again (cdn ${cdn}, raw ${raw})`);
  await ctx.close();
}
// real PDFs
for (const id of ['k300-01', 'k700-32']) {
  const ctx = await context({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + `#/kanji/print/${id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-print]:not([disabled])', { timeout: 20000 });
  const file = path.join(OUT, `${id}.pdf`);
  await page.pdf({ path: file, format: 'A4', preferCSSPageSize: true, printBackground: true });
  const pdf = fs.readFileSync(file, 'latin1');
  const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const rows = await page.locator('.kp-row').count();
  ok(pages >= 2 && pages <= Math.ceil(rows / 5) + 1, `PDF ${id}: ${rows} kanji on ${pages} A4 pages`, String(pages));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL PRINT CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
