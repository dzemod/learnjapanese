// Browser QA of «Тренажер дієслів» (375 + 1280 px): entry on the home page, setup (lesson range, forms of that
// range only, count), a run with right / wrong / «Не знаю» answers, romaji → kana, feedback with the rule and the
// grammar link, results + «Повторити помилки», per-form accuracy stored, no horizontal scroll, no page errors.
//   node tools/qa-drill.mjs   → screenshots in qa/drill/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const C = await import(pathToFileURL(path.join(ROOT, 'site/js/conjugate.js')).href);
const OUT = path.join(ROOT, 'qa/drill');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const formOfLabel = Object.fromEntries(Object.entries(C.FORMS).map(([k, f]) => [f.label, k]));

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.click('.drill-entry');
  await page.waitForSelector('.dr-setup');
  ok(await noScroll(page), T('setup: no horizontal scroll'));
  // lesson range 20 → forms te, nai, dict, ta, nakatta only
  await page.fill('.dr-setup input[name="upTo"]', '20');
  await page.dispatchEvent('.dr-setup input[name="upTo"]', 'change');
  const forms = await page.$$eval('[data-f]', els => els.map(e => e.dataset.f));
  ok(forms.join() === 'te,nai,dict,ta,nakatta', T('lessons ≤ 20: only the 5 forms taught by then'), forms.join());
  await page.click('[data-n] [data-v="10"]');
  await page.screenshot({ path: path.join(OUT, `setup-${width}.png`), fullPage: true });
  await page.click('[data-start]');
  await page.waitForSelector('.dr-card');
  let right = 0, wrongN = 0;
  for (let i = 0; i < 10; i++) {
    await page.waitForSelector('.dr-card .answer-input:not([disabled])');
    const info = await page.evaluate(() => ({ jp: document.querySelector('.dr-jp').textContent, rd: document.querySelector('.dr-verb .reading')?.textContent || '', form: document.querySelector('.dr-arrow b').textContent, group: /група (I{1,3})/.exec(document.querySelector('.dr-card').textContent)?.[1] }));
    const f = formOfLabel[info.form];
    const ans = C.conjugate(i % 2 ? info.jp : info.rd || info.jp, info.group, f);
    if (i === 3) await page.click('[data-dk]');
    else if (i % 3 === 2) { await page.fill('.answer-input', 'ばつ'); await page.click('.dr-card button[type="submit"]'); }
    else { await page.fill('.answer-input', ans); await page.click('.dr-card button[type="submit"]'); }
    await page.waitForSelector('[data-next]');
    const fb = await page.textContent('.q-foot');
    if (/Правильно!/.test(fb)) right++; else wrongN++;
    if (i === 2) {
      ok(/Правильно:/.test(fb) && /Граматика: урок \d+/.test(fb), T('wrong answer: correct form + grammar link'), fb.slice(0, 120));
      ok(/груп/.test(fb), T('feedback explains the rule'), fb.slice(0, 160));
      await page.screenshot({ path: path.join(OUT, `wrong-${width}.png`) });
    }
    await page.keyboard.press('Enter');
  }
  ok(right === 6 && wrongN === 4, T('6 right (kana and kanji), 4 wrong / «Не знаю»'), `${right}/${wrongN}`);
  await page.waitForSelector('.results');
  ok(/6 з 10 правильно/.test(await page.textContent('.results')), T('results: 6 з 10'));
  ok(await page.locator('.miss').count() === 4, T('results list the 4 mistakes'));
  ok(await noScroll(page), T('results: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `results-${width}.png`), fullPage: true });
  const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('jp.drill.stats')));
  ok(Object.values(stats).reduce((a, s) => a + s.n, 0) === 10 && Object.values(stats).reduce((a, s) => a + s.ok, 0) === 6, T('per-form accuracy stored'), JSON.stringify(stats));
  await page.click('[data-retry]');
  await page.waitForSelector('.dr-card');
  ok(/1 \/ 4/.test(await page.textContent('.today-count')), T('«Повторити помилки»: 4 questions'));
  // romaji
  await page.goto(BASE + '#/drill', { waitUntil: 'networkidle' });
  await page.click('[data-drop]').catch(() => {});
  await page.check('.dr-setup input[name="romaji"]');
  await page.click('[data-start]');
  await page.waitForSelector('.dr-card .answer-input:not([disabled])');
  const info = await page.evaluate(() => ({ rd: document.querySelector('.dr-verb .reading')?.textContent || document.querySelector('.dr-jp').textContent, form: document.querySelector('.dr-arrow b').textContent, group: /група (I{1,3})/.exec(document.querySelector('.dr-card').textContent)?.[1] }));
  await page.waitForFunction(() => !!window.wanakana, null, { timeout: 8000 }).catch(() => {});
  const kana = C.conjugate(info.rd, info.group, formOfLabel[info.form]);
  const W = await page.evaluate(k => window.wanakana ? window.wanakana.toRomaji(k) : '', kana);
  if (W) {
    await page.type('.answer-input', W, { delay: 20 });
    await page.click('.dr-card button[type="submit"]');
    await page.waitForSelector('[data-next]');
    ok(/Правильно!/.test(await page.textContent('.q-foot')), T('romaji answer converted to kana and accepted'), `${W} → ${kana}`);
  } else ok(false, T('wanakana loaded for romaji'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL DRILL UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
