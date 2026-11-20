// Browser QA of the mini-games (375 + 1280 px): home entry, hub + lesson range, offers after a grammar lesson and an
// exam result (way back to them), each of the 4 games played to the end with right and wrong answers (Playwright
// clock for the timed ones), records + «Варто повторити», «Перша гра» achievement (no game link inside a game),
// no horizontal scroll, no page errors.
//   node tools/qa-games.mjs   → screenshots in qa/games/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/games');
fs.mkdirSync(OUT, { recursive: true });
const clean = s => String(s || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
// Japanese word → its meanings, Ukrainian sentence → particle answers (to play like a learner who knows them)
const meaning = new Map();
for (const s of JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets)
  for (const c of s.cards) { const k = c.kanji || c.kana; (meaning.get(k) || meaning.set(k, new Set()).get(k)).add(clean(c.ukrainian)); }
const partOf = new Map(), plain = s => String(s || '').replace(/\{([^{}|]+)\|([^{}]+)\}/g, '$1($2)');
for (const l of JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exam.json'), 'utf8')).lessons)
  for (const i of l.items) if (i.t === 'p') partOf.set(plain(i.pre) + '？' + plain(i.post), [i.a, ...(i.alt || [])]);

const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const go = (page, h) => page.evaluate(h => (location.hash = h), h);

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  await page.clock.install();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.clock.runFor(2000);
  ok(await page.locator('.drill-entry[href="#/play"]').count() === 1, T('home: «Міні-ігри» entry'));

  // grammar lesson → offer → hub with the way back
  await go(page, '#/grammar/5');
  await page.waitForSelector('.gm-offer');
  ok(await page.getAttribute('.gm-offer', 'href') === '#/play/5-5', T('grammar lesson 5 offers lesson 5'));
  await page.click('.gm-offer');
  await page.waitForSelector('.gm-card');
  ok(await page.locator('.gm-card').count() === 4 && await page.locator('.gm-card.off').count() === 0, T('hub: 4 playable games for lesson 5'));
  ok(/До граматики уроку 5/.test(await page.textContent('.games .back')), T('hub: back to the grammar lesson'));
  ok(await noScroll(page), T('hub: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `hub-${width}.png`), fullPage: true });
  await page.selectOption('[data-to]', '8');
  await page.waitForFunction(() => location.hash === '#/play/5-8');
  ok(/Уроки/.test(await page.textContent('.gm-range')), T('hub: range changed to 5–8'));

  // ---- rain: 4 right, then wrong until the lives are gone
  await go(page, '#/play/5-8/rain');
  await page.waitForSelector('.gm-drop:not([hidden])');
  for (let i = 0; i < 7; i++) {
    await page.waitForSelector('.gm-opt:not([disabled])');
    const ja = await page.textContent('.gm-drop .gm-ja');
    const opts = await page.$$eval('.gm-opt', b => b.map(x => x.textContent.slice(1)));
    const right = opts.findIndex(o => meaning.get(ja)?.has(clean(o)));
    const pick = i < 4 ? right : (right + 1) % 4;
    if (i === 2) await page.keyboard.press(String(pick + 1)); else await page.click(`.gm-opt[data-i="${pick}"]`);
    if (i === 4) { await page.screenshot({ path: path.join(OUT, `rain-${width}.png`) }); ok(await noScroll(page), T('rain: no horizontal scroll')); }
    await page.clock.runFor(1500);
    if (await page.$('.gm-end')) break;
  }
  await page.waitForSelector('.gm-end');
  const rainScore = +(await page.textContent('.gm-score')).replace(/\D/g, '');
  ok(rainScore >= 40, T('rain: 4 right answers score'), String(rainScore));
  ok(await page.locator('.gm-miss-row').count() >= 1, T('rain: missed words listed'));
  ok(/новий рекорд/.test(await page.textContent('.gm-end h2')), T('rain: first game = record'));
  await page.waitForSelector('.ach-pop', { timeout: 3000 }).catch(() => {});
  const pop = await page.locator('.ach-pop').textContent().catch(() => '');
  ok(/Перша гра/.test(pop), T('achievement «Перша гра»'), pop);
  ok(await page.locator('.ach-pop-play').count() === 0, T('no mini-game link in the pop-up inside a game'));
  await page.screenshot({ path: path.join(OUT, `rain-end-${width}.png`), fullPage: true });

  // falling to the ground costs a life
  await page.click('[data-again]');
  await page.waitForSelector('.gm-drop:not([hidden])');
  await page.clock.runFor(10000);
  ok(await page.locator('.gm-lives i').textContent() === '♥', T('rain: a word that lands costs a life'));

  // ---- memory: one wrong pair, then solve
  await go(page, '#/play/5-8/memory');
  await page.waitForSelector('.gm-tile');
  const faces = await page.$$eval('.gm-face', f => f.map(x => ({ ja: x.classList.contains('ja'), t: x.classList.contains('ja') ? x.querySelector('.gm-ja').textContent : x.textContent })));
  ok(faces.length === 12, T('memory: 12 tiles'));
  const jas = faces.map((f, i) => [f, i]).filter(([f]) => f.ja), uks = faces.map((f, i) => [f, i]).filter(([f]) => !f.ja);
  const pairOf = j => uks.find(([u]) => meaning.get(j.t)?.has(clean(u.t)))?.[1];
  await page.click(`.gm-tile[data-k="${jas[0][1]}"]`);
  await page.click(`.gm-tile[data-k="${uks.find(([, i]) => i !== pairOf(jas[0][0]))[1]}"]`);
  await page.clock.runFor(1000);
  ok(await page.locator('.gm-tile.up').count() === 0, T('memory: a wrong pair turns back'));
  for (const [j, i] of jas) { await page.click(`.gm-tile[data-k="${i}"]`); await page.click(`.gm-tile[data-k="${pairOf(j)}"]`); await page.clock.runFor(100); }
  if (width === 375) await page.screenshot({ path: path.join(OUT, `memory-${width}.png`) });
  ok(await noScroll(page), T('memory: no horizontal scroll'));
  await page.clock.runFor(1000);
  await page.waitForSelector('.gm-end');
  ok(/7 ходів/.test(await page.textContent('.gm-end')), T('memory: 7 moves counted'), await page.textContent('.gm-end .results'));

  // ---- particles: right, wrong (explanation + grammar link), time out
  await go(page, '#/play/5-8/particle');
  await page.waitForSelector('.gm-sent');
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('.gm-opt:not([disabled])');
    const uk = await page.textContent('.gm-ja-sent');
    const opts = await page.$$eval('.gm-opt', b => b.map(x => x.textContent.slice(1)));
    const right = opts.findIndex(o => partOf.get(uk)?.includes(o));
    ok(right >= 0, T(`particle: one option is right (${uk})`), JSON.stringify([...partOf.keys()].filter(k => k.slice(0, 4) === uk.slice(0, 4)).slice(0, 3)));
    await page.click(`.gm-opt[data-i="${i === 3 ? (right + 1) % 4 : right}"]`);
    if (i === 3) {
      ok((await page.textContent('.gm-why')).length > 10, T('particle: wrong answer shows the rule'));
      await page.screenshot({ path: path.join(OUT, `particle-${width}.png`) });
      ok(await noScroll(page), T('particle: no horizontal scroll'));
    }
    await page.clock.runFor(2000);
  }
  await page.clock.runFor(61000);
  await page.waitForSelector('.gm-end');
  ok(/4 з 5 правильно/.test(await page.textContent('.gm-end')), T('particle: 4 of 5'), await page.textContent('.gm-end'));
  ok(await page.locator('.gm-miss-row.p a[href^="#/grammar/"]').count() === 1, T('particle: mistake links to its grammar point'));

  // ---- moles: hit the target once, a wrong one, time out
  await go(page, '#/play/5-8/mole');
  await page.waitForSelector('.gm-target b');
  let hit = false, miss = false;
  for (let t = 0; t < 60 && !(hit && miss); t++) {
    await page.clock.runFor(300);
    const target = clean(await page.textContent('.gm-target b'));
    const up = await page.$$eval('.gm-mole.up:not(.ok):not(.bad)', m => m.map(x => [x.dataset.h, x.querySelector('.gm-ja').textContent]));
    const good = up.find(([, j]) => meaning.get(j)?.has(target)), bad = up.find(([, j]) => !meaning.get(j)?.has(target));
    if (!hit && good) { await page.click(`.gm-mole[data-h="${good[0]}"]`); hit = true; }
    else if (!miss && bad) { await page.click(`.gm-mole[data-h="${bad[0]}"]`); miss = true; }
  }
  ok(hit && miss, T('moles: the target and other words pop up'));
  await page.screenshot({ path: path.join(OUT, `mole-${width}.png`) });
  ok(await noScroll(page), T('moles: no horizontal scroll'));
  await page.clock.runFor(46000);
  await page.waitForSelector('.gm-end');
  ok(/1 влучання/.test(await page.textContent('.gm-end')) && /помилок 1/.test(await page.textContent('.gm-end')), T('moles: 1 hit, 1 mistake'), await page.textContent('.gm-end .results'));
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem('jp.play.best')));
  ok(best && best.rain > 0 && best.memory > 0 && best.particle > 0 && best.mole > 0, T('records stored for all 4 games'), JSON.stringify(best));

  // ---- exam result offers a game for the exam's lessons
  await page.evaluate(() => { localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'all', from: 3, to: 6, mine: false, kanji: false, types: ['p'], count: 5, mock: false, timer: 0 })); sessionStorage.removeItem('jp.examSession'); });
  await go(page, '#/exam');
  await page.waitForSelector('[data-start]');
  await page.click('[data-start]');
  await page.waitForFunction(() => location.hash.startsWith('#/exam/run'));
  await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); S.res = S.qs.map(() => ({ ok: false, given: '' })); S.i = S.qs.length; sessionStorage.setItem('jp.examSession', JSON.stringify(S)); });
  await page.goto(BASE + '#/exam/result');
  await page.waitForSelector('.gm-offer');
  ok(await page.getAttribute('.gm-offer', 'href') === '#/play/3-6', T('exam result offers lessons 3–6'));
  await page.click('.gm-offer');
  await page.waitForSelector('.gm-card');
  ok(/До результатів екзамену/.test(await page.textContent('.games .back')), T('hub: back to the exam result'));

  ok(!errs.length, T('no page errors'), errs.join('\n'));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`${passed} passed, ${issues.length} failed`);
process.exit(issues.length ? 1 : 0);
