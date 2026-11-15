// QA of the kanji writing mode (#/kanji/write) — site/js/kanji-write.js + stroke-match.js.
//   npm i --no-save playwright-core   (or QA_MODULES=<dir with node_modules>), Chrome installed
//   node tools/qa-kanji-write.mjs     → report + screenshots in qa/kanji-write/
// Desktop viewport draws with the mouse, phone viewport (375×780, touch emulation) with CDP touch events.
// Strokes are drawn from the KanjiVG points with a small offset + wobble (a "human" hand), not pixel-perfect.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/kanji-write');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, 'site', p);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
});
await new Promise(r => srv.listen(0, r));
const URL0 = `http://localhost:${srv.address().port}/`;

// ---- test kanji: 妻 + a spread over both books incl. the most complex of kanji-700 ----
const KJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const ALL = [];
for (const b of KJ.books) for (const l of b.lessons) for (const k of l.kanji) ALL.push({ id: k.id, kanji: k.kanji, strokes: +k.strokes, lesson: l.id });
const pick = ch => ALL.find(k => k.kanji === ch);
const complex = ALL.filter(k => k.id.startsWith('k700')).sort((a, b) => b.strokes - a.strokes).slice(0, 4);
const TEST = [...new Set([pick('妻'), pick('一'), pick('人'), pick('書'), pick('右'), pick('左'), pick('必'), pick('飛'), pick('療'), pick('震'), ...complex].filter(Boolean))];
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;

const results = [], issues = [];
let steps = 0;
const ok = (v, step, cond, detail = '') => { steps++; if (!cond) { issues.push(`${v} · ${step}: ${detail}`); console.log('FAIL', v, step, detail); } return cond; };

const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [kind, width, height] of [['desktop', 1280, 900], ['phone', 375, 780]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: kind === 'phone', isMobile: kind === 'phone', deviceScaleFactor: kind === 'phone' ? 2 : 1, locale: 'uk-UA' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });

  const open = async (k) => {
    await page.goto(`${URL0}#/kanji/write/${k.lesson}/${k.id}`);
    await page.waitForFunction(id => window.__kw?.id === id && window.__kw.strokes?.length, k.id, { timeout: 20000 });
    await page.locator('.kw-pad').scrollIntoViewIfNeeded();
  };
  const toScreen = async pts => {
    const r = await page.locator('.kw-canvas').boundingBox();
    return pts.map(([x, y]) => [r.x + (x * r.width) / 109, r.y + (y * r.height) / 109]);
  };
  // "human" version of a KanjiVG stroke: shifted ~3 units, wobble ±1.5 units, ~2-unit steps
  const human = pts => pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1).map(([x, y], i) => [x + 2.5 + 1.5 * Math.sin(i * 0.9), y - 1.5 + Math.cos(i * 1.3) * 1.2]);
  const draw = async pts109 => {
    const pts = await toScreen(pts109);
    if (kind === 'desktop') {
      await page.mouse.move(pts[0][0], pts[0][1]);
      await page.mouse.down();
      for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y);
      await page.mouse.up();
    } else {
      const tp = ([x, y]) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
      for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.waitForTimeout(40);
  };
  const st = () => page.evaluate(() => ({ id: window.__kw.id, idx: window.__kw.idx, done: window.__kw.done, mistakes: window.__kw.mistakes, last: window.__kw.last }));
  const strokes = () => page.evaluate(() => window.__kw.strokes);
  const counters = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-c]')].map(b => [b.dataset.c, +b.textContent])));
  // colour of the canvas at 109-space point (rgba)
  const pixel = ([x, y]) => page.evaluate(([x, y]) => {
    const cv = document.querySelector('.kw-canvas'), c = cv.getContext('2d');
    return [...c.getImageData(Math.round((x * cv.width) / 109), Math.round((y * cv.height) / 109), 1, 1).data];
  }, [x, y]);
  const isRed = p => p[3] > 100 && p[0] > 150 && p[1] < 120 && p[2] < 120;
  const shot = name => page.screenshot({ path: path.join(OUT, `${kind}-${name}.png`) });

  // ================= 妻: rejections, full drawing, rating =================
  await page.goto(URL0 + '#/kanji');
  await page.evaluate(() => { try { localStorage.removeItem('jp.kanjiWrite'); } catch {} });
  const tsuma = pick('妻');
  await open(tsuma);
  const S = await strokes();
  ok(kind, '妻 stroke data', S.length === tsuma.strokes, `KanjiVG strokes ${S.length}, book ${tsuma.strokes}`);
  ok(kind, '妻 coloured diagram (Step A)', await page.locator('.kw-diag:not([hidden]) svg path').count() === S.length);
  ok(kind, '妻 demo ▶ button', await page.locator('[data-demo]').isVisible());
  ok(kind, 'hint ? button', await page.locator('[data-hint]').isVisible());
  ok(kind, 'confirm ✓ button', await page.locator('[data-ok]').isVisible());
  ok(kind, 'canvas touch-action none', await page.locator('.kw-canvas').evaluate(e => getComputedStyle(e).touchAction) === 'none');
  await shot('01-start');
  const c0 = await counters();

  // wrong order: stroke 3 before stroke 1
  const h2 = human(S[2]), mid2 = h2[Math.floor(h2.length / 2)];
  await draw(h2);
  let s = await st();
  const redOrder = isRed(await pixel(mid2));
  ok(kind, 'wrong order rejected', s.idx === 0 && s.last.reason === 'order', JSON.stringify(s.last));
  ok(kind, 'wrong order shown in red', redOrder);
  await shot('02-wrong-order');
  await page.waitForTimeout(1200);
  ok(kind, 'red stroke removed after ~1 s', !isRed(await pixel(mid2)));
  // wrong shape / place: a vertical line in the bottom-left corner
  await draw([[8, 70], [8, 80], [8, 90], [8, 100]]);
  s = await st();
  ok(kind, 'wrong shape rejected', s.idx === 0 && s.last.reason === 'shape', JSON.stringify(s.last));
  ok(kind, 'wrong shape shown in red', isRed(await pixel([8, 85])));
  await shot('03-wrong-stroke');
  await page.waitForTimeout(1200);
  // wrong direction: stroke 1 drawn right → left
  await draw(human([...S[0]].reverse()));
  s = await st();
  ok(kind, 'wrong direction rejected', s.idx === 0 && s.last.reason === 'direction', JSON.stringify(s.last));
  await page.waitForTimeout(1200);
  ok(kind, 'mistakes counted', s.mistakes === 3, `mistakes ${s.mistakes}`);
  // hint
  await page.locator('[data-hint]').click();
  // correct drawing, stroke by stroke
  const scrollBefore = await page.evaluate(() => window.scrollY);
  for (let i = 0; i < S.length; i++) {
    await draw(human(S[i]));
    s = await st();
    if (!ok(kind, `妻 stroke ${i + 1} accepted`, s.idx === i + 1, JSON.stringify(s.last))) break;
    if (i === 3) await shot('04-drawing');
  }
  const scrollAfter = await page.evaluate(() => window.scrollY);
  ok(kind, 'page does not scroll while drawing', scrollBefore === scrollAfter, `${scrollBefore} → ${scrollAfter}`);
  if (kind === 'phone') { // control: the same touch drag outside the canvas DOES scroll the page
    const box = await page.locator('.kw-meta').boundingBox();
    const y0 = await page.evaluate(() => window.scrollY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: Math.round(box.y + 10) }] });
    for (let d = 10; d <= 200; d += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: Math.round(box.y + 10 - d) }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    const y1 = await page.evaluate(() => window.scrollY);
    ok(kind, 'control: touch drag outside canvas scrolls', y1 !== y0, `${y0} → ${y1}`);
  }
  s = await st();
  ok(kind, '妻 completed', s.done === true);
  ok(kind, 'replay ▶ visible', await page.locator('[data-replay]').isVisible());
  const rateTxt = await page.locator('.kw-rate [data-r]').allInnerTexts();
  ok(kind, 'four rating buttons', rateTxt.length === 4, rateTxt.join(' | '));
  const want = [['Ще раз', '1 хв'], ['Важко', '5 хв'], ['Добре', '10 хв'], ['Легко', '16 дн']];
  ok(kind, 'rating labels + intervals', want.every(([a, b], i) => rateTxt[i]?.includes(a) && rateTxt[i]?.includes(b)), rateTxt.join(' | '));
  const bar = await page.locator('.kw-rate').boundingBox();
  ok(kind, 'rating bar fixed at the bottom', Math.abs(bar.y + bar.height - height) < 2 && await page.locator('.kw-rate').evaluate(e => getComputedStyle(e).position) === 'fixed', JSON.stringify(bar));
  await page.locator('[data-replay]').click();
  await page.waitForTimeout(600);
  await shot('05-rating');
  ok(kind, 'no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.locator('.kw-rate [data-r="good"]').click();
  await page.waitForFunction(id => window.__kw.id !== id, tsuma.id);
  const c1 = await counters();
  ok(kind, 'counters change after rating', c1.new === c0.new - 1 && c1.learning === c0.learning + 1, `${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
  const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('jp.kanjiWrite') || '{}')[id], tsuma.id);
  ok(kind, 'schedule saved', saved && saved.rating === 'good' && saved.mistakes === 3 && saved.interval === 600000 && saved.due > Date.now(), JSON.stringify(saved));
  // review (recall) state: 妻 due now → kanji hidden, counted as «review»; ✓ before the end shows the rest
  await page.evaluate(id => { const s = JSON.parse(localStorage.getItem('jp.kanjiWrite')); s[id].due = Date.now() - 1000; localStorage.setItem('jp.kanjiWrite', JSON.stringify(s)); }, tsuma.id);
  await page.goto(URL0 + '#/kanji');
  await open(tsuma);
  const c2 = await counters();
  ok(kind, 'due kanji counted as review', c2.review >= 1, JSON.stringify(c2));
  ok(kind, 'review: kanji hidden', await page.locator('.kw-diag').isHidden() && await page.locator('.kw-ex .kw-mask').count() > 0);
  await shot('07-review');
  await draw(human(S[0]));
  await page.locator('[data-ok]').click();
  s = await st();
  ok(kind, '✓ finishes, missing strokes = mistakes', s.done && s.mistakes === S.length - 1, JSON.stringify(s));
  ok(kind, 'review: kanji revealed after finishing', await page.locator('.kw-diag').isVisible() && await page.locator('.kw-ex .kw-mask').count() === 0);
  await page.locator('.kw-rate [data-r="again"]').click();
  const again = await page.evaluate(id => JSON.parse(localStorage.getItem('jp.kanjiWrite'))[id], tsuma.id);
  ok(kind, '«Ще раз» → 1 min', again.interval === 60000 && again.rating === 'again', JSON.stringify(again));
  results.push({ kind, kanji: '妻', id: tsuma.id, strokes: S.length, result: issues.some(x => x.startsWith(kind)) ? 'FAIL' : 'ok (wrong order / shape / direction rejected in red, 8/8 accepted, rated, review state)' });

  // ================= storage unavailable =================
  await page.evaluate(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await page.evaluate(() => { location.hash = '#/kanji/write/k300-01'; });
  await page.waitForFunction(() => window.__kw?.strokes?.length, null, { timeout: 20000 }).catch(() => {});
  ok(kind, 'works without localStorage', await page.locator('.kw-canvas').count() === 1 && !errs.length, errs.join(' / '));
  await page.reload();

  // ================= 10+ kanji: full correct drawing =================
  for (const k of TEST.slice(1).filter(k => !ONLY || ONLY.includes(k.kanji))) {
    await open(k);
    const P = await strokes();
    let bad = '';
    for (let i = 0; i < P.length; i++) {
      await draw(human(P[i]));
      const x = await st();
      if (x.idx !== i + 1) { bad = `stroke ${i + 1}/${P.length} rejected: ${JSON.stringify(x.last)}`; break; }
    }
    const done = (await st()).done;
    ok(kind, `${k.kanji} (${k.id}) all strokes accepted`, !bad && done, bad);
    // the canvas must be sized to its box (backing store = CSS width × dpr) — catches a stale-size bug
    ok(kind, `${k.kanji} canvas sized`, await page.locator('.kw-canvas').evaluate(c => Math.abs(c.width - c.getBoundingClientRect().width * Math.min(3, devicePixelRatio)) < 2));
    if (k === TEST[TEST.length - 1]) await shot('06-complex');
    if (done) await page.locator('.kw-rate [data-r="easy"]').click();
    results.push({ kind, kanji: k.kanji, id: k.id, strokes: P.length, result: !bad && done ? 'ok' : bad });
  }
  ok(kind, 'no JS errors', !errs.length, errs.join(' / '));
  await ctx.close();
}
await browser.close();
srv.close();

const md = [`# Kanji writing QA — ${new Date().toISOString().slice(0, 16)}`, '', `Steps: ${steps} · issues: ${issues.length}`, '',
  '| viewport | kanji | id | strokes | result |', '|---|---|---|---|---|', ...results.map(r => `| ${r.kind} | ${r.kanji} | ${r.id} | ${r.strokes} | ${r.result} |`), '',
  ...(issues.length ? ['## Issues', ...issues.map(x => `- ${x}`)] : ['No issues.'])].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log(md);
process.exit(issues.length ? 1 : 0);
