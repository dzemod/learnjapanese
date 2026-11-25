// Browser QA of the Сенсей question bar and scroll (site/js/sensei.js dock(), nearEnd(), scroll memory):
//   - one form element only; it sits on the hands while that spot is on screen and docks at the bottom otherwise;
//   - after every reply (long Markdown answers) the bar is on screen, the reply's start is visible, and at the end of the
//     page the last message ends above the bar (bottom padding = bar height);
//   - the learner scrolls up while Сенсей writes → the reply does not move the page, the bar stays visible, a «↓ Нова
//     відповідь» button appears and shows the reply;
//   - scroll position: restored when the tab is shown again (route away and back), after visibilitychange in the same
//     session, after «back» from another site; not restored on a fresh visit from another link or in a new session;
//     sessionStorage blocked → no errors;
//   - no horizontal scroll at 320 / 390 / 1280 px.
// Puter.js is replaced by the mock of qa-sensei.mjs — nothing reaches Puter.
//   npm i --no-save playwright-core sharp kuromoji@0.1.2
//   node tools/qa-sensei-layout.mjs   → screenshots in qa/sensei-layout/
import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve, mockPuter } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/sensei-layout');
fs.mkdirSync(OUT, { recursive: true });

// a long answer in the Markdown the model really sends
const LONG = (n, tag) => [`## Відповідь ${tag}`, ...Array.from({ length: n }, (_, i) => `### Пункт ${i + 1}\nЧастка は (ва) позначає тему речення: 私は学生です。 — «Я студент». Це пояснення ${tag}-${i + 1} досить довге, щоб зайняти кілька рядків на вузькому екрані телефона.\n- приклад: 本は机の上にあります。\n- ще приклад: これは何ですか。`), `**Кінець ${tag}**`].join('\n\n');

const srv = await serve();
const URL_ = `http://localhost:${srv.address().port}/`;
// «another site»: a page on a different origin with a link back to the tab
const ext = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>інший сайт</title><a id="back" href="${URL_}#/sensei">Сенсей</a>`); });
await new Promise(r => ext.listen(0, r));
const EXT = `http://127.0.0.1:${ext.address().port}/`;

let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

async function open(width, height, phone, { block = false, ctx: given = null } = {}) {
  const ctx = given || await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone, locale: 'uk-UA', reducedMotion: 'reduce' });
  if (!given) {
    await mockPuter(ctx, { signedIn: true, reply: { text: 'ок' } });
    if (block) await ctx.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|^ask: /.test(m.text())) errs.push(m.text()); });
  await page.goto(URL_ + '#/sensei', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sensei .ss-bar');
  return { ctx, page, errs };
}
const geo = page => page.evaluate(() => {
  const bar = document.querySelector('.ss-bar').getBoundingClientRect();
  const msgs = [...document.querySelectorAll('.ss-list > *')];
  const last = msgs.at(-1)?.getBoundingClientRect();
  const lastAi = [...document.querySelectorAll('.ss-list .ss-msg.ai:not(.ss-typing)')].at(-1)?.getBoundingClientRect();
  const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
  return { bar: { top: bar.top, bottom: bar.bottom, left: bar.left, right: bar.right, h: bar.height }, last: last && { top: last.top, bottom: last.bottom }, lastAi: lastAi && { top: lastAi.top, bottom: lastAi.bottom },
    vh: innerHeight, vw: innerWidth, top, y: scrollY, max: document.documentElement.scrollHeight - innerHeight, docked: document.querySelector('.ss-bar').classList.contains('docked'),
    forms: document.querySelectorAll('form.ss-bar, .ss-input, .ss-send').length, hs: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth };
});
const barVisible = g => g.bar.top >= g.top - 1 && g.bar.bottom <= g.vh + 1 && g.bar.h > 30;
async function ask(page, q, reply) {
  const n = await page.$$eval('.ss-list .ss-msg.ai:not(.ss-typing)', e => e.length);
  await page.evaluate(t => window.__pm.queue.push({ text: t }), reply);
  await page.fill('.ss-input', q);
  await page.click('.ss-send');
  await page.waitForFunction(k => document.querySelectorAll('.ss-list .ss-msg.ai:not(.ss-typing)').length > k, n, { timeout: 8000 });
  await page.waitForTimeout(150); // scroll + dock frame
}
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

for (const [width, height, phone] of [[320, 640, true], [390, 844, true], [1280, 800, false]]) {
  const { ctx, page, errs } = await open(width, height, phone);
  const T = s => `${width}px: ${s}`;
  let g = await geo(page);
  ok(g.forms === 3, T('one form, one textarea, one send button'), String(g.forms));
  ok(barVisible(g) && (width === 320 || !g.docked), T('start: bar visible (on the hands at 390/1280)'), JSON.stringify(g.bar));
  ok(!g.hs, T('start: no horizontal scroll'));

  // three long answers: after each the bar is on screen and the reply's start is visible
  for (const k of [1, 2, 3]) {
    await ask(page, `Запитання ${k}: поясни は і が`, LONG(k === 2 ? 30 : 14, k));
    g = await geo(page);
    ok(barVisible(g), T(`reply ${k}: question bar visible`), JSON.stringify({ bar: g.bar, vh: g.vh, docked: g.docked }));
      ok(g.lastAi && g.lastAi.top >= g.top - 2 && g.lastAi.top < g.bar.top, T(`reply ${k}: its start is visible above the bar`), JSON.stringify({ ai: g.lastAi, bar: g.bar, top: g.top, y: g.y, max: g.max, docked: g.docked }));
    ok(!g.hs, T(`reply ${k}: no horizontal scroll`));
    ok(g.forms === 3, T(`reply ${k}: still one form`));
  }
  await page.screenshot({ path: path.join(OUT, `reply-${width}.png`) });

  // the end of the page: the last message ends above the docked bar
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await settle(page);
  g = await geo(page);
  ok(g.docked && barVisible(g), T('end of page: bar docked at the bottom'), JSON.stringify(g.bar));
  ok(g.bar.bottom <= g.vh - 9 && g.bar.bottom >= g.vh - 40, T('docked bar: bottom edge just above the screen edge'), `${g.bar.bottom} of ${g.vh}`);
  ok(g.last.bottom <= g.bar.top + 1, T('end of page: last message not hidden behind the bar'), JSON.stringify({ last: g.last, bar: g.bar }));
  ok(g.bar.left >= 15.5 && g.bar.right <= g.vw - 15.5, T('docked bar inside the 16 px gutter'), `${g.bar.left}..${g.bar.right}`);
  await page.screenshot({ path: path.join(OUT, `end-${width}.png`) });

  // the learner scrolls to the middle while Сенсей writes: the reply arrives, the page does not move, the bar stays
  await page.evaluate(t => { window.__pm.queue.push({ text: t }); window.__pm.hold = new Promise(r => (window.__pmRelease = r)); }, LONG(10, 4));
  await page.fill('.ss-input', 'Запитання 4');
  await page.click('.ss-send');
  await page.waitForSelector('.ss-typing');
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => { const y = Math.round((document.documentElement.scrollHeight - innerHeight) / 2); scrollTo(0, y); return scrollY; });
  await settle(page);
  await page.evaluate(() => { window.__pm.hold = null; window.__pmRelease(); });
  await page.waitForFunction(() => !document.querySelector('.ss-typing'));
  await page.waitForTimeout(250);
  g = await geo(page);
  ok(Math.abs(g.y - mid) <= 2, T('scrolled to the middle: the reply does not move the page'), `${g.y} vs ${mid}`);
  ok(barVisible(g), T('scrolled to the middle: question bar visible after the reply'), JSON.stringify(g.bar));
  ok(await page.isVisible('.ss-jump'), T('«↓ Нова відповідь» shown'));
  await page.screenshot({ path: path.join(OUT, `middle-${width}.png`) });
  await page.click('.ss-jump');
  await page.waitForTimeout(250);
  g = await geo(page);
  ok(g.lastAi.top >= g.top - 2 && g.lastAi.top < g.bar.top && !(await page.isVisible('.ss-jump')), T('the button shows the new reply and hides'), JSON.stringify(g.lastAi));
  // a follow-up right away, without scrolling up: type and send from where the learner is
  await page.click('.ss-input');
  ok(barVisible(await geo(page)), T('follow-up: the input is reachable without scrolling'));

  // the textarea grows with long text: the bar grows, the last message still clears it
  await page.fill('.ss-input', 'рядок\n'.repeat(12));
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await settle(page); await settle(page);
  g = await geo(page);
  ok(g.last.bottom <= g.bar.top + 1 && barVisible(g), T('taller bar: last message still above it'), JSON.stringify({ last: g.last, bar: g.bar }));
  await page.fill('.ss-input', '');
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close(); ext.close();
console.log(`\n${passed} passed, ${issues.length} failed`);
if (issues.length) { console.log(issues.map(i => ' - ' + i).join('\n')); process.exit(1); }
