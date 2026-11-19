// Browser QA of «Говоріння» (375 + 1280 px) with a fake SpeechRecognition (window.__say = what it "hears",
// window.__err = an error code): setup, a sentence with furigana, «Сказати» → the sentence itself = «Чудово 100%»,
// a missing word → marked red, microphone refused / nothing heard → Ukrainian messages, results; a browser without
// recognition → shadowing mode (listen + «Далі»), no page errors, no horizontal scroll.
//   node tools/qa-speak.mjs   → screenshots in qa/speak/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/speak');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const FAKE = () => {
  class FakeRec {
    start() {
      setTimeout(() => {
        if (window.__err) { this.onerror?.({ error: window.__err }); this.onend?.(); return; }
        const said = window.__say === '@sentence' ? document.querySelector('.sp-ja').textContent.replace(/[ぁ-ゖ]+(?=[ぁ-ゖ]*$)/, m => m) : window.__say;
        if (said) {
          const alt = Object.assign([{ transcript: said }], { isFinal: true });
          this.onresult?.({ results: [alt] });
        }
        this.onend?.();
      }, 120);
    }
    abort() {}
    stop() {}
  }
  // Chrome now has the unprefixed SpeechRecognition (used first by speak.js) — replace both
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: FakeRec, configurable: true, writable: true });
};
// the plain text of the sentence on the card (without furigana)
const sentence = page => page.$eval('.sp-ja', el => { const c = el.cloneNode(true); c.querySelectorAll('rt').forEach(r => r.remove()); return c.textContent; });

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  await ctx.addInitScript(FAKE);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.click('a.drill-entry[href="#/speak"]');
  await page.waitForSelector('.sp-setup');
  ok(/запис надсилається/.test(await page.textContent('.sp-setup')), T('privacy note shown'));
  await page.fill('.sp-setup input[name="upTo"]', '5');
  await page.click('[data-start]');
  await page.waitForSelector('.sp-card');
  ok(/1 \/ 10/.test(await page.textContent('.today-count')), T('10 sentences'));
  // 1: say the sentence itself
  let s = await sentence(page);
  await page.evaluate(x => { window.__err = ''; window.__say = x; }, s);
  await page.click('[data-mic]');
  await page.waitForSelector('.sp-verdict', { timeout: 5000 }).catch(() => {});
  ok(/Чудово!\s*100%/.test(await page.textContent('.sp-verdict')), T('the sentence itself → Чудово 100%'), await page.textContent('.sp-verdict'));
  ok(await page.locator('.sp-t.miss').count() === 0, T('nothing marked missing'));
  await page.screenshot({ path: path.join(OUT, `good-${width}.png`) });
  await page.click('[data-next]');
  // 2: drop the first word
  s = await sentence(page);
  const first = await page.$eval('.sp-t', el => { const c = el.cloneNode(true); c.querySelectorAll('rt').forEach(r => r.remove()); return c.textContent; });
  await page.evaluate(x => { window.__say = x; }, s.replace(first, ''));
  await page.click('[data-mic]');
  await page.waitForSelector('.sp-verdict');
  ok(await page.locator('.sp-t.miss').first().evaluate(el => el === el.parentElement.querySelector('.sp-t')), T('missing first word marked red'), `${first} / ${s}`);
  await page.screenshot({ path: path.join(OUT, `miss-${width}.png`) });
  // microphone refused, nothing heard
  await page.evaluate(() => { window.__err = 'not-allowed'; });
  await page.click('[data-mic]');
  await page.waitForSelector('.sp-out .ask-err');
  ok(/Дозвольте доступ до мікрофона/.test(await page.textContent('.sp-out')), T('microphone refused → message'));
  await page.evaluate(() => { window.__err = ''; window.__say = ''; });
  await page.click('[data-mic]');
  await page.waitForFunction(() => /Нічого не почуто/.test(document.querySelector('.sp-out')?.textContent || ''));
  ok(true, T('nothing heard → message'));
  for (let i = 0; i < 9; i++) await page.click('[data-next]'); // from sentence 2 to the results
  await page.waitForSelector('.results');
  ok(/Сказано 2 з 10/.test(await page.textContent('.results')), T('results: 2 of 10 said'), await page.textContent('.results'));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), T('no horizontal scroll'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
// a browser without speech recognition
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await ctx.addInitScript(() => { for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/speak', { waitUntil: 'networkidle' });
  ok(/не розпізнає мовлення/.test(await page.textContent('.sp-setup')), 'no recognition: explained');
  await page.click('[data-start]');
  await page.waitForSelector('.sp-card');
  ok(await page.locator('[data-mic]').count() === 0 && await page.locator('[data-listen]').count() === 1, 'no recognition: listen + «Далі» only');
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL SPEAKING UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
