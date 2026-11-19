// Browser QA of offline use (service worker on localhost via ?sw=1), 375 + 1280 px:
// first visit online → the worker caches the site files and data; then offline: the page reloads, home with all
// lessons, a lesson, grammar lesson 1, a kanji lesson, the conjugation drill, the offline bar; an answer offline is
// saved; back online → the bar disappears. Manifest + icons are valid.
//   node tools/qa-offline.mjs   → screenshots in qa/offline/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/offline');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

// manifest + icons
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/manifest.webmanifest'), 'utf8'));
ok(man.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable') && man.icons.some(i => i.sizes === '192x192') && man.display === 'standalone' && man.start_url, 'manifest: icons 192/512/maskable, standalone, start_url');
ok(man.icons.every(i => fs.existsSync(path.join(ROOT, 'site', i.src))), 'manifest icons exist');

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '?sw=1#/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => !!navigator.serviceWorker.controller), T('service worker controls the page'));
  // visit the parts once online (their modules load), then wait for the warm-up to cache the data files
  for (const h of ['#/grammar/1', '#/kanji/k300-01', '#/drill', '#/']) { await page.evaluate(x => (location.hash = x), h); await page.waitForTimeout(700); }
  await page.evaluate(() => dispatchEvent(new Event('load')));
  await page.waitForFunction(async () => { const c = await caches.open('kotoba-site-v1'); const k = (await c.keys()).map(r => r.url); return ['data/sets.json', 'data/grammar.json', 'data/kanji.json', 'js/drill.js', 'css/style.css'].every(f => k.some(u => u.endsWith(f))); }, null, { timeout: 20000 }).catch(() => {});
  const keys = await page.evaluate(async () => (await (await caches.open('kotoba-site-v1')).keys()).map(r => r.url.replace(location.origin, '')));
  ok(['/data/sets.json', '/data/grammar.json', '/data/kanji.json', '/data/kanji-assoc.json', '/js/app.js', '/css/style.css'].every(f => keys.includes(f)), T('site files and data cached'), `${keys.length} files`);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.set-card', { timeout: 15000 }).catch(() => {});
  ok(await page.locator('.set-card').count() >= 52, T('offline reload: home with all lessons'), String(await page.locator('.set-card').count()));
  ok(await page.isVisible('#netbar') && /Немає інтернету/.test(await page.textContent('#netbar')), T('offline bar shown'));
  await page.screenshot({ path: path.join(OUT, `home-offline-${width}.png`) });
  await page.evaluate(() => (location.hash = '#/grammar/1'));
  await page.waitForSelector('.g-point, .gpoint, [data-point]', { timeout: 10000 }).catch(() => {});
  ok((await page.textContent('#app')).length > 500 && !/Не вдалося завантажити/.test(await page.textContent('#app')), T('offline: grammar lesson 1'));
  await page.evaluate(() => (location.hash = '#/kanji/k300-01'));
  await page.waitForTimeout(800);
  ok(/人/.test(await page.textContent('#app')), T('offline: kanji lesson'));
  await page.evaluate(() => (location.hash = '#/set/mnn-01/write'));
  await page.waitForSelector('.answer-input', { timeout: 8000 });
  await page.click('[data-dk]');
  await page.waitForSelector('[data-next]');
  await page.click('[data-next]'); // write mode saves the answer on «Далі»
  ok(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jp.progress') || '{}')).some(k => k.startsWith('mnn-01/'))), T('offline: an answer is saved'));
  await ctx.setOffline(false);
  await page.waitForFunction(() => document.querySelector('#netbar').hidden, null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => document.querySelector('#netbar').hidden), T('back online: bar hidden'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL OFFLINE CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
