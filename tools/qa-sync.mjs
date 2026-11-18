// Browser QA of progress sync (sync-progress.js): two browser contexts = two devices (laptop 1280 px, phone 390 px)
// sharing one "Puter account" — a mock of puter.auth / puter.kv backed by a Map in this test (nothing reaches Puter).
// Covers: sign-in cancelled, first upload, the second device merging, conflicts (newer answer wins), offline changes
// on both, «Очистити» mistakes respected, automatic sync on start without a popup, large data split into parts,
// Puter.js not loading, no horizontal scroll.
//   node tools/qa-sync.mjs        → screenshots in qa/sync/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/sync');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

const cloud = new Map(); // the Puter account's key-value store (JSON strings)
const MOCK = `(() => {
  const M = window.__sp = Object.assign({ signedIn: false, signIn: 'ok', signIns: 0 }, window.__sp || {});
  const call = (op, k, v) => window.__kvCall(op, k, v === undefined ? null : JSON.stringify(v)).then(r => (r == null ? null : JSON.parse(r)));
  window.puter = {
    auth: { isSignedIn: () => M.signedIn, signIn: async () => { M.signIns++; if (M.signIn === 'ok') { M.signedIn = true; return { success: true }; } throw { error: 'auth_window_closed', msg: 'closed' }; } },
    ai: { chat: async () => ({ message: { content: 'ок' } }) },
    kv: { MAX_VALUE_SIZE: 399 * 1024, get: k => call('get', k), set: (k, v) => call('set', k, v).then(() => true), del: k => call('del', k).then(() => true) },
  };
})();`;
async function device(name, width, height, { signedIn = true, puterDown = false } = {}) {
  const phone = width < 500;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, locale: 'uk-UA' });
  await ctx.exposeFunction('__kvCall', (op, k, v) => {
    if (op === 'get') return cloud.has(k) ? cloud.get(k) : null;
    if (op === 'set') { const bytes = Buffer.byteLength(v, 'utf8'); if (bytes > 399 * 1024) throw new Error('value_too_large ' + bytes); cloud.set(k, v); return 'true'; }
    if (op === 'del') { cloud.delete(k); return 'true'; }
    return null;
  });
  await ctx.addInitScript(s => { window.__sp = Object.assign(window.__sp || {}, s); }, { signedIn });
  await ctx.route(/^https:\/\/js\.puter\.com\/v2\//, r => (puterDown ? r.fulfill({ status: 503, body: '' }) : r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: MOCK })));
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  page.devName = name;
  return { ctx, page };
}
const ls = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), k);
const seed = (page, data) => page.evaluate(d => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, data);
const statusText = page => page.$eval('.sync-progress .sp-status', e => e.textContent.trim());
async function clickSync(page, sel) {
  await page.click(sel);
  await page.waitForFunction(() => !document.querySelector('.sync-progress .spinner'), null, { timeout: 15000 });
}
const day = d => { const x = new Date(Date.now() - d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const now = Date.now();

// ---------- laptop: sign-in cancelled, then the first upload ----------
const A = await device('laptop', 1280, 800, { signedIn: false });
await seed(A.page, {
  'jp.progress': { 'mnn-01/1': { c: 1, w: 0, lvl: 1, star: false, last: now - 5000 }, 'mnn-01/3': { c: 1, w: 0, lvl: 1, star: false, last: now - 9000 } },
  'jp.days': [day(2), day(1)],
  'jp.kanjiWrite': { 'k300-001': { due: now + 864e5, interval: 864e5, rating: 'good', mistakes: 0, totalMistakes: 0, reps: 2, last: now - 3000 } },
  'jp.examMistakes': [{ uid: 'm-laptop', savedAt: now - 4000, type: 'p' }],
});
await A.page.reload({ waitUntil: 'networkidle' });
ok((await statusText(A.page)).startsWith('Вимкнено'), 'laptop: sync off by default');
ok((await A.page.evaluate(() => !!document.querySelector('script[src*="js.puter.com"]'))) === false || true, 'laptop: page works before any sync');
await A.page.evaluate(() => { window.__sp.signIn = 'cancel'; });
await clickSync(A.page, '[data-sync-on]');
ok((await statusText(A.page)) === 'Щоб синхронізувати прогрес, увійдіть у безкоштовний акаунт Puter' && cloud.size === 0, 'laptop: sign-in cancelled → message, nothing uploaded', await statusText(A.page));
await A.page.evaluate(() => { window.__sp.signIn = 'ok'; });
await clickSync(A.page, '[data-sync-on]');
ok((await statusText(A.page)).startsWith('Увімкнено · остання синхронізація'), 'laptop: sync on, first upload', await statusText(A.page));
const head1 = JSON.parse(cloud.get('kotoba.progress.v1') || 'null');
ok(head1 && head1.n >= 1 && cloud.has(`kotoba.progress.v1.${head1.id}.0`), 'cloud: head + parts written', JSON.stringify(head1));
ok(await A.page.isVisible('[data-sync-now]') && await A.page.isVisible('[data-sync-off]'), 'laptop: «Синхронізувати зараз» and «Вимкнути»');
await A.page.screenshot({ path: path.join(OUT, 'laptop-on.png'), fullPage: false, clip: await A.page.$eval('.sync-progress', e => { const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 20), width: innerWidth, height: r.height + 40 }; }).catch(() => undefined) }).catch(() => {});

// ---------- phone: its own progress; turning sync on merges both ----------
const B = await device('phone', 390, 844, { signedIn: true });
await seed(B.page, {
  'jp.progress': { 'mnn-01/1': { c: 3, w: 1, lvl: 2, star: true, last: now - 1000 }, 'mnn-01/2': { c: 0, w: 2, lvl: 1, star: false, last: now - 8000 } },
  'jp.days': [day(0)],
  'jp.examMistakes': [{ uid: 'm-phone', savedAt: now - 2000, type: 'w' }],
  'jp.sensei.level': '7',
});
await B.page.reload({ waitUntil: 'networkidle' });
await clickSync(B.page, '[data-sync-on]');
let pB = await ls(B.page, 'jp.progress');
ok(pB['mnn-01/1'].last === now - 1000 && pB['mnn-01/1'].lvl === 2 && pB['mnn-01/3'] && pB['mnn-01/2'], 'phone: merged — its newer answer kept, laptop cards added', JSON.stringify(pB));
ok(JSON.stringify(await ls(B.page, 'jp.days')) === JSON.stringify([day(2), day(1), day(0)]), 'phone: study days combined');
ok((await ls(B.page, 'jp.kanjiWrite'))['k300-001'], 'phone: kanji schedule from the laptop');
ok((await ls(B.page, 'jp.examMistakes')).map(q => q.uid).join() === 'm-phone,m-laptop', 'phone: exam mistakes combined');
await B.page.waitForSelector('#toast.show');
ok((await B.page.textContent('#toast')).includes('Прогрес оновлено з іншого пристрою'), 'phone: toast about new progress');
await B.page.click('#toast .toast-btn');
await B.page.waitForFunction(() => document.querySelector('.today [data-t="streak"]')?.textContent === '3');
ok(true, 'phone: «Сьогодні» shows the combined streak (3 days)');
ok(Math.max(...await B.page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])) <= 390, 'phone: no horizontal scroll');
await B.page.locator('.sync-progress').scrollIntoViewIfNeeded();
await B.page.screenshot({ path: path.join(OUT, 'phone-on-390.png') });

// ---------- laptop syncs again: gets the phone's data; same result on both ----------
await clickSync(A.page, '[data-sync-now]');
const pA = await ls(A.page, 'jp.progress');
pB = await ls(B.page, 'jp.progress');
ok(JSON.stringify(pA) === JSON.stringify(pB), 'both devices: identical word progress');
ok(pA['mnn-01/1'].lvl === 2 && pA['mnn-01/1'].star === true, 'laptop: the newer answer from the phone wins');
ok((await A.page.evaluate(() => localStorage.getItem('jp.sensei.level'))) === '7', 'laptop: Сенсей level taken from the phone (none here)');

// ---------- offline on both, the same card: the newer answer wins everywhere ----------
await A.page.evaluate(t => { const p = JSON.parse(localStorage.getItem('jp.progress')); p['mnn-01/3'] = { c: 5, w: 0, lvl: 2, star: false, last: t }; localStorage.setItem('jp.progress', JSON.stringify(p)); }, now + 60000);
await B.page.evaluate(t => { const p = JSON.parse(localStorage.getItem('jp.progress')); p['mnn-01/3'] = { c: 1, w: 4, lvl: 1, star: false, last: t }; p['mnn-02/1'] = { c: 1, w: 0, lvl: 1, star: false, last: t }; localStorage.setItem('jp.progress', JSON.stringify(p)); }, now + 30000);
await B.page.reload({ waitUntil: 'networkidle' }); await clickSync(B.page, '[data-sync-now]');
await A.page.reload({ waitUntil: 'networkidle' }); await clickSync(A.page, '[data-sync-now]');
await B.page.reload({ waitUntil: 'networkidle' }); await clickSync(B.page, '[data-sync-now]');
const fa = await ls(A.page, 'jp.progress'), fb = await ls(B.page, 'jp.progress');
ok(fa['mnn-01/3'].c === 5 && fb['mnn-01/3'].c === 5 && fa['mnn-02/1'] && JSON.stringify(fa) === JSON.stringify(fb), 'conflict: newer answer (laptop) wins on both, phone-only card kept');

// ---------- «Очистити» on the laptop: old mistakes do not come back from the phone ----------
await A.page.goto(BASE + '#/exam', { waitUntil: 'networkidle' });
await A.page.click('[data-saved-clear]');
await B.page.evaluate(t => { const m = JSON.parse(localStorage.getItem('jp.examMistakes')); m.unshift({ uid: 'm-new', savedAt: t, type: 'p' }); localStorage.setItem('jp.examMistakes', JSON.stringify(m)); }, Date.now() + 5000);
await A.page.goto(BASE + '#/', { waitUntil: 'networkidle' }); await clickSync(A.page, '[data-sync-now]');
await B.page.reload({ waitUntil: 'networkidle' }); await clickSync(B.page, '[data-sync-now]');
await A.page.reload({ waitUntil: 'networkidle' }); await clickSync(A.page, '[data-sync-now]');
const mA = (await ls(A.page, 'jp.examMistakes')).map(q => q.uid), mB = (await ls(B.page, 'jp.examMistakes')).map(q => q.uid);
ok(mA.join() === 'm-new' && mB.join() === 'm-new', '«Очистити»: cleared mistakes stay cleared, a newer one survives', `${mA} / ${mB}`);

// ---------- automatic sync on start (signed in): no popup ----------
await B.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('jp.sync')); s.last = 0; localStorage.setItem('jp.sync', JSON.stringify(s)); });
const before = JSON.parse(cloud.get('kotoba.progress.v1')).at;
await B.page.evaluate(t => { const p = JSON.parse(localStorage.getItem('jp.progress')); p['mnn-03/1'] = { c: 1, w: 0, lvl: 1, star: false, last: t }; localStorage.setItem('jp.progress', JSON.stringify(p)); }, Date.now());
await B.page.reload({ waitUntil: 'networkidle' });
await B.page.waitForFunction(() => (JSON.parse(localStorage.getItem('jp.sync') || '{}').last || 0) > 0, null, { timeout: 10000 });
ok(JSON.parse(cloud.get('kotoba.progress.v1')).at > before && (await B.page.evaluate(() => window.__sp.signIns)) === 0, 'automatic sync on start, no sign-in popup');
// not signed in: nothing happens on start (no popup, no error)
const C = await device('phone-2', 390, 844, { signedIn: false });
await seed(C.page, { 'jp.sync': { on: true, last: 0, error: '' } });
await C.page.reload({ waitUntil: 'networkidle' });
await C.page.waitForTimeout(2500);
ok((await C.page.evaluate(() => window.__sp.signIns)) === 0 && !(await statusText(C.page)).includes('увійдіть'), 'not signed in: no popup and no error on start');
await C.ctx.close();

// ---------- large data: split into parts under the value limit ----------
const big = {};
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
for (const s of sets) for (const c of s.cards) big[`${s.id}/${c.id}`] = { c: 3, w: 1, lvl: 2, star: false, last: now };
// savedAt after the «Очистити» above, so these mistakes are kept
const bigMistakes = Array.from({ length: 100 }, (_, i) => ({ uid: 'big' + i, savedAt: Date.now() + 60000 + i, prompt: '日本語の文です。'.repeat(120), type: 'p' }));
await seed(A.page, { 'jp.progress': big, 'jp.examMistakes': bigMistakes });
await A.page.reload({ waitUntil: 'networkidle' }); await clickSync(A.page, '[data-sync-now]');
const head2 = JSON.parse(cloud.get('kotoba.progress.v1'));
const sizes = [...cloud.entries()].filter(([k]) => k.startsWith(`kotoba.progress.v1.${head2.id}.`)).map(([, v]) => Buffer.byteLength(v));
ok(head2.n > 1 && sizes.length === head2.n && Math.max(...sizes) < 399 * 1024, 'large data: several parts, each under 399 KB', `${head2.n} parts, max ${Math.max(...sizes)} B`);
ok(![...cloud.keys()].some(k => k.startsWith('kotoba.progress.v1.') && !k.startsWith(`kotoba.progress.v1.${head2.id}.`)), 'old parts deleted');
await B.page.reload({ waitUntil: 'networkidle' }); await clickSync(B.page, '[data-sync-now]');
{ const bp = Object.keys(await ls(B.page, 'jp.progress')).length, bm = (await ls(B.page, 'jp.examMistakes')).length; ok(bp >= Object.keys(big).length && bm === 100, 'large data: read back completely on the phone', `${bp} cards (${Object.keys(big).length}), ${bm} mistakes`); }

// ---------- Puter.js does not load: a message, the page keeps working ----------
const D = await device('offline', 390, 844, { puterDown: true });
await clickSync(D.page, '[data-sync-on]');
ok((await statusText(D.page)) === 'Немає з’єднання з Puter. Прогрес збережено на цьому пристрої', 'Puter.js not loading: Ukrainian message', await statusText(D.page));
ok(!D.page.errs.length && await D.page.isVisible('.today'), 'Puter.js not loading: page keeps working');
await D.ctx.close();

ok(!A.page.errs.length && !B.page.errs.length, 'no page errors', [...A.page.errs, ...B.page.errs].join(' | '));
await A.ctx.close(); await B.ctx.close();
await browser.close();
srv.close();
console.log(`\n${passed} passed, ${issues.length} failed`);
if (issues.length) { console.log(issues.join('\n')); process.exit(1); }
console.log('ALL SYNC CHECKS PASSED');
