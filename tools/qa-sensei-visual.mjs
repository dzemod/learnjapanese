// Visual QA of the «Сенсей» tab: the illustration, the input bar on the palms, below-the-hands fallback, scroll,
// motion (breathing, glow pulse) and reduced motion, image failure / slow image. Puter.js is mocked (qa-sensei.mjs).
//   node tools/qa-sensei-visual.mjs [screenshot dir]   (default qa/sensei/; screenshots at 390 and 1280 px)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve, mockPuter } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const SHOTS = path.resolve(process.argv[2] || path.join(ROOT, 'qa/sensei'));
fs.mkdirSync(SHOTS, { recursive: true });
// the same constants the page uses
const src = fs.readFileSync(path.join(ROOT, 'site/js/sensei.js'), 'utf8');
const PALMS = Function(`return (${src.match(/const PALMS = (\{[^;]+\});/)[1]})`)();
const BAR_MIN_PX = +src.match(/const BAR_MIN_PX = (\d+)/)[1];

const srv = await serve();
const URL_ = `http://localhost:${srv.address().port}/#/sensei`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const REPLY = 'Почніть з хіраґани: по 5 знаків щодня, потім слова з уроку 1 у вкладці «Слова».';

async function open({ width, height, phone, reduced = false, imgRoute = null }) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await mockPuter(ctx, { signedIn: true, reply: { text: REPLY } });
  if (imgRoute) await ctx.route(/assets\/sensei\//, imgRoute);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL_, { waitUntil: imgRoute ? 'domcontentloaded' : 'networkidle' });
  await page.waitForSelector('.ss-input');
  return { ctx, page, errs };
}
const geo = page => page.evaluate(() => {
  const r = el => { const b = el?.getBoundingClientRect(); return b && { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const img = document.querySelector('.ss-fig img');
  return {
    art: r(document.querySelector('.ss-art')), img: r(img), bar: r(document.querySelector('.ss-bar')),
    below: document.querySelector('.ss-stage').classList.contains('below'),
    loaded: img.complete && img.naturalWidth > 0, current: img.currentSrc, alt: img.alt,
    docW: Math.max(document.documentElement.scrollWidth, innerWidth), vw: document.documentElement.clientWidth, vh: innerHeight,
  };
});

for (const [width, height, phone] of [[320, 568, true], [390, 844, true], [1280, 800, false]]) {
  const T = s => `${width}px: ${s}`;
  const { ctx, page, errs } = await open({ width, height, phone });
  await page.waitForFunction(() => document.querySelector('.ss-fig img').complete);
  const g = await geo(page);
  ok(g.loaded, T('sensei image loads'), g.current);
  ok(/\.webp$/.test(g.current), T('WebP used'), g.current);
  ok(g.alt === 'Сенсей, наставник з японської', T('Ukrainian alt text'));
  ok(g.docW <= width && g.vw === width, T('no horizontal scroll'), `${g.docW} > ${width}`);
  ok(Math.abs(g.art.l + g.art.w / 2 - g.vw / 2) < 2, T('sensei centred'));
  if (phone) ok(g.art.h >= g.vh * 0.3 && g.art.h <= g.vh * 0.42, T('image ≈ 35–40 % of the screen height'), `${Math.round(g.art.h)} / ${g.vh}`);
  else ok(g.art.h <= 422 && g.art.h >= 300, T('image up to ≈ 420 px tall'), String(Math.round(g.art.h)));
  const palm = p => ({ x: g.art.l + g.art.w * p.x / 100, y: g.art.t + g.art.h * p.y / 100 });
  const L = palm(PALMS.left), R = palm(PALMS.right);
  const barOnHandsWidth = g.art.w * (PALMS.right.x - PALMS.left.x) / 100;
  if (barOnHandsWidth >= BAR_MIN_PX) {
    ok(!g.below, T('bar on the hands'));
    // ends on the palms, lower edge on the palm line, overlapping the hand area
    ok(Math.abs(g.bar.l - L.x) < 2 && Math.abs(g.bar.r - R.x) < 2, T('bar ends on the palm centres'), `${Math.round(g.bar.l)}–${Math.round(g.bar.r)} vs ${Math.round(L.x)}–${Math.round(R.x)}`);
    const handTop = g.art.t + g.art.h * 0.618, handBottom = g.art.t + g.art.h * 0.741; // skin pixels of the palms (y 61.8–74.1 %)
    ok(g.bar.b > handTop && g.bar.b <= handBottom, T('bar lower edge rests on the palms'), `${Math.round(g.bar.b)} in ${Math.round(handTop)}–${Math.round(handBottom)}`);
    ok(g.bar.l >= g.art.l && g.bar.r <= g.art.r && g.bar.t >= g.art.t, T('bar inside the illustration'));
  } else {
    ok(g.below, T('narrow: bar below the hands'));
    ok(g.bar.t >= g.img.b - 0.5, T('bar does not overlap the image'), `${Math.round(g.bar.t)} < ${Math.round(g.img.b)}`);
    ok(g.bar.l >= 15.5 && g.vw - g.bar.r >= 15.5 && Math.abs(g.bar.w - (g.vw - 32)) < 2, T('bar full width with 16 px gutters'), `${Math.round(g.bar.l)} / ${Math.round(g.vw - g.bar.r)}`);
  }
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.ss-fig')).animationName);
  ok(anim === 'ss-breathe', T('breathing animation'), anim);
  const breathe = await page.evaluate(async () => { const f = document.querySelector('.ss-fig'); let mn = 0; for (let i = 0; i < 25; i++) { mn = Math.min(mn, new DOMMatrix(getComputedStyle(f).transform).m42); await new Promise(r => setTimeout(r, 90)); } return mn; });
  ok(breathe < -0.3 && breathe >= -3.01, T('breathing moves ≤ 3 px'), String(breathe));
  // send → pulse while writing
  await page.evaluate(() => { window.__pm.hold = new Promise(r => (window.__pmRelease = r)); });
  await page.fill('.ss-input', 'Як краще вчити кану?');
  await page.click('.ss-send');
  await page.waitForSelector('.ss-typing');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ss-stage'), '::after').animationName === 'ss-pulse'), T('red pulse while the mentor writes'));
  await page.evaluate(() => { window.__pm.hold = null; window.__pmRelease(); });
  await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ss-stage'), '::after').animationName === 'none'), T('pulse stops after the reply'));
  ok((await page.inputValue('.ss-input')) === '', T('input cleared'));
  const g2 = await geo(page);
  ok(g2.docW <= width, T('no horizontal scroll with messages'), `${g2.docW} > ${width}`);
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  if (width !== 320) {
    await page.screenshot({ path: path.join(SHOTS, `sensei-${width}.png`), fullPage: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, `sensei-${width}-top.png`) });
  } else await page.screenshot({ path: path.join(SHOTS, `sensei-${width}.png`), fullPage: true });
  // the bar follows a resize (desktop → narrow)
  if (!phone) {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(150);
    const g3 = await geo(page), p3 = { l: g3.art.l + g3.art.w * PALMS.left.x / 100, r: g3.art.l + g3.art.w * PALMS.right.x / 100 };
    ok(!g3.below && Math.abs(g3.bar.l - p3.l) < 2 && Math.abs(g3.bar.r - p3.r) < 2, T('after a resize the bar stays on the palms'));
  }
  await ctx.close();
}

// a long reply (≈ 250 words, a long Japanese run, a long URL-like word): every line reachable, nothing clipped
const LONG_REPLY = Array.from({ length: 25 }, (_, i) => `Речення ${i + 1}: учіть кану щодня, повторюйте слова уроку і читайте прості тексти вголос.`).join(' ')
  + '\nЯпонською: 私は毎日日本語を勉強していますがまだ漢字を読むのが難しいと思いますので毎日少しずつ練習しています。'
  + '\nДовге слово: https://example.org/дуже-довге-посилання-без-пробілів-яке-не-має-обрізатися-праворуч'
  + '\nОСТАННІЙ РЯДОК ВІДПОВІДІ.';
for (const [width, height, phone] of [[320, 568, true], [390, 844, true], [1280, 800, false]]) {
  const T = s => `${width}px long reply: ${s}`;
  const { ctx, page } = await open({ width, height, phone });
  await page.evaluate(t => { window.__pm.reply = { text: t }; }, LONG_REPLY);
  await page.fill('.ss-input', 'Як вчити японську?');
  await page.click('.ss-send');
  await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
  const words = LONG_REPLY.split(/\s+/).length;
  const r = await page.evaluate(() => {
    const list = document.querySelector('.ss-list'), msg = [...list.querySelectorAll('.ss-msg.ai')].pop();
    list.scrollTop = list.scrollHeight; // the box's own scroll, to the bottom
    const cs = getComputedStyle(msg), L = list.getBoundingClientRect(), M = msg.getBoundingClientRect();
    // the last line of the reply: rect of its last character
    const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT); let last = null; for (let n; (n = walker.nextNode());) if (n.textContent.trim()) last = n;
    const rg = document.createRange(); const end = last.textContent.trimEnd().length; rg.setStart(last, end - 1); rg.setEnd(last, end);
    const C = rg.getBoundingClientRect();
    const clipped = [...msg.querySelectorAll('*'), msg].some(e => e.scrollWidth > e.clientWidth + 1 && !/(auto|scroll)/.test(getComputedStyle(e).overflowX));
    return { overflowMsg: cs.overflow, heightMsg: cs.height, maxH: cs.maxHeight, wrap: cs.overflowWrap, wb: cs.wordBreak, listOverflow: getComputedStyle(list).overflowY,
      lastIn: C.bottom <= L.bottom + 0.5 && C.top >= L.top - 0.5 && C.right <= L.right + 0.5 && C.left >= L.left - 0.5,
      msgInList: M.left >= L.left - 0.5 && M.right <= L.right + 0.5, clipped, listScroll: list.scrollHeight > list.clientHeight,
      docW: Math.max(document.documentElement.scrollWidth, innerWidth), text: msg.textContent };
  });
  ok(r.text.includes('ОСТАННІЙ РЯДОК ВІДПОВІДІ.') && words >= 250, T('whole reply rendered'), `${words} words`);
  ok(r.overflowMsg === 'visible' && r.maxH === 'none', T('reply box: no overflow hidden / max-height'), `${r.overflowMsg} ${r.maxH}`);
  ok(r.wrap === 'anywhere' && r.wb === 'break-word', T('long words wrap'), `${r.wrap} ${r.wb}`);
  ok(r.listOverflow === 'auto' && r.listScroll, T('long reply scrolls inside the chat box'));
  ok(r.lastIn, T('last line visible after scrolling to the bottom of the box'));
  ok(r.msgInList && !r.clipped, T('nothing clipped at the right edge'));
  ok(r.docW <= width, T('no horizontal page scroll'), `${r.docW}`);
  await page.locator('.ss-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `sensei-${width}-long.png`), fullPage: !phone });
  await ctx.close();
}

// reduced motion: no breathing, no pulse
for (const [width, height, phone] of [[390, 844, true], [1280, 800, false]]) {
  const { ctx, page } = await open({ width, height, phone, reduced: true });
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ss-fig')).animationName === 'none'), `${width}px reduced motion: breathing off`);
  await page.evaluate(() => document.querySelector('.sensei').classList.add('thinking'));
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ss-stage'), '::after').animationName === 'none'), `${width}px reduced motion: glow pulse off`);
  await ctx.close();
}

// the image fails: chat without it, input usable
{
  const { ctx, page, errs } = await open({ width: 390, height: 844, phone: true, imgRoute: r => r.fulfill({ status: 404, body: '' }) });
  await page.waitForFunction(() => document.querySelector('.ss-stage').classList.contains('no-img'));
  const g = await geo(page);
  ok(g.below && (await page.isHidden('.ss-art')) && (await page.isVisible('.ss-bar')), 'image fails: chat without the image, bar visible');
  await page.fill('.ss-input', 'Привіт');
  await page.click('.ss-send');
  await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
  ok(true, 'image fails: sending works');
  ok(!errs.length, 'image fails: no page errors', errs.join(' | '));
  await page.screenshot({ path: path.join(ROOT, 'qa/sensei/no-image-390.png'), fullPage: true });
  await ctx.close();
}
// slow image: the input works before it loads
{
  let release;
  const gate = new Promise(r => (release = r));
  const { ctx, page } = await open({ width: 1280, height: 800, phone: false, imgRoute: async r => { await gate; await r.continue(); } });
  ok(!(await page.evaluate(() => document.querySelector('.ss-fig img').complete && document.querySelector('.ss-fig img').naturalWidth > 0)), 'slow image: not loaded yet');
  const g = await geo(page);
  ok(g.art.h > 300 && !g.below, 'slow image: space reserved, bar already on the hands');
  await page.fill('.ss-input', 'Привіт');
  await page.click('.ss-send');
  await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
  ok(true, 'slow image: sending works before the image loads');
  release();
  await page.waitForFunction(() => document.querySelector('.ss-fig img').naturalWidth > 0);
  const g2 = await geo(page);
  ok(Math.abs((g2.bar.l - g2.art.l) - (g.bar.l - g.art.l)) < 1 && Math.abs((g2.bar.b - g2.art.t) - (g.bar.b - g.art.t)) < 1 && Math.abs(g2.art.h - g.art.h) < 1, 'slow image: the bar does not jump when the image arrives (relative to the image; the page may scroll)');
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`\n${passed} passed, ${issues.length} failed · screenshots: ${SHOTS}`);
if (issues.length) { console.log(issues.join('\n')); process.exit(1); }
console.log('ALL SENSEI VISUAL CHECKS PASSED');
