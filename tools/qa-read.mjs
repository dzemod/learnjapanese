// Browser QA of «Читання» (375 + 1280 px): entry on the home page, textbook text for lessons ≤ 5 (8 sentences with
// furigana, translation toggles, speaker), tapping a word → meaning from my lessons + lesson link + grammar point,
// furigana off, «Прочитано» → toast + achievement; desktop also: an AI story (Puter.js mocked, real Kuromoji
// dictionary from the CDN — needs internet) split into tappable words; sign-in cancelled → message.
//   node tools/qa-read.mjs   → screenshots in qa/read/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/read');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const PUTER = 'https://js.puter.com/v2/';
const MOCK = `window.puter = { auth: { isSignedIn: () => !window.__out, signIn: async () => { if (window.__out) throw { error: 'cancelled' }; } },
  ai: { chat: async (msgs) => { window.__asked = msgs; return { message: { content: '毎朝 七時に 起きます。 ||| Щоранку я встаю о сьомій.\\n駅まで 歩きます。 ||| Іду пішки до станції.\\n電車で 会社へ 行きます。 ||| Їду електричкою на роботу.' }, finish_reason: 'stop' }; } } };`;

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  await ctx.route(PUTER, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.click('a.drill-entry[href="#/read"]');
  await page.waitForSelector('.rd-setup');
  await page.fill('.rd-setup input[name="upTo"]', '5');
  await page.dispatchEvent('.rd-setup input[name="upTo"]', 'change');
  await page.click('[data-book]');
  await page.waitForSelector('.rd-text');
  ok(await page.locator('.rd-s').count() === 8, T('textbook text: 8 sentences'));
  ok(/Уроки 1–5/.test(await page.textContent('.rd-top')), T('lessons 1–5'));
  ok(await page.locator('.rd-w ruby').count() > 0, T('furigana on kanji'));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), T('no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `text-${width}.png`), fullPage: true });
  await page.click('[data-tr="0"]');
  ok(await page.isVisible('.rd-s[data-s="0"] .rd-uk'), T('translation of sentence 1 shown'));
  // tap the first noun / verb with kanji
  const w = page.locator('.rd-w.c-n:has(ruby), .rd-w.c-v:has(ruby)').first();
  await w.click();
  await page.waitForSelector('.rd-sheet');
  const sheet = await page.textContent('.rd-sheet');
  ok(/Урок|урок|Канджі|mnn|Вступний/.test(sheet) && !/немає у ваших уроках/.test(sheet), T('tapped word: meaning + lesson link'), sheet.replace(/\s+/g, ' ').slice(0, 160));
  ok(/Граматика речення: Урок \d+, пункт \d+/.test(sheet), T('tapped word: the sentence grammar point'));
  await page.waitForTimeout(450); // the sheet's opening animation
  await page.screenshot({ path: path.join(OUT, `word-${width}.png`) });
  await page.click('.rd-sheet [data-close]');
  await page.uncheck('[data-furi]');
  ok(await page.$eval('.rd-w ruby rt', e => getComputedStyle(e).visibility) === 'hidden', T('furigana off'));
  await page.check('[data-furi]');
  await page.click('[data-done]');
  await page.waitForTimeout(300);
  ok(/Текст прочитано/.test(await page.textContent('#toast')), T('«Прочитано» → toast'));
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('jp.achievements') || '{}')['read-1'], null, { timeout: 3000 }).catch(() => {});
  ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem('jp.achievements') || '{}')['read-1']), T('achievement «Перший текст»'));
  if (kind === 'desktop') {
    await page.evaluate(() => { window.__out = true; });
    await page.click('[data-ai]');
    await page.waitForSelector('.rd-setup .ask-err', { timeout: 10000 }).catch(() => {});
    ok(/увійдіть у безкоштовний акаунт Puter/.test(await page.textContent('.rd-setup').catch(() => '')), T('AI: sign-in cancelled → message'));
    await page.evaluate(() => { window.__out = false; });
    await page.click('[data-ai]');
    await page.waitForSelector('.rd-text', { timeout: 120000 }).catch(() => {});
    ok(await page.locator('.rd-s').count() === 3, T('AI story: 3 sentences'));
    ok(/ШІ, може містити помилки/.test(await page.textContent('.rd-top').catch(() => '')), T('AI story marked'));
    const asked = await page.evaluate(() => window.__asked);
    ok(asked?.[0]?.role === 'system' && /Lessons 1–5/.test(asked?.[1]?.content || ''), T('AI request: lessons 1–5 with words'));
    const okiru = page.locator('.rd-w', { hasText: '起き' }).first();
    if (await okiru.count()) {
      await okiru.click();
      await page.waitForSelector('.rd-sheet');
      ok(/вставати/.test(await page.textContent('.rd-sheet')), T('AI word 起き → «вставати» from lesson 6'), await page.textContent('.rd-sheet'));
    } else ok(false, T('AI story split into words'));
    await page.screenshot({ path: path.join(OUT, `ai-${width}.png`) });
  }
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL READING UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
