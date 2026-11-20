// Browser QA of the grammar review settings (gear in «Повторення граматики», grammar-review-conf.js) at 320, 390 and
// 1280 px: the dialog opens/closes without horizontal scroll; chosen exercise types are the only ones in the next
// session; no type → start blocked with «Оберіть хоча б один тип вправи»; lesson filter (scheduled + «Перевірити себе
// зараз»); skipped types note; mini-game offer follows the «Міні-гра» type; «Прибрати з повторення»; fixed schedule;
// reload keeps the settings; a corrupted value → defaults; blocked storage → defaults + note. Pure rules first.
//   node tools/qa-grammar-review.mjs   → screenshots in qa/grammar-review/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/grammar-review');
fs.mkdirSync(OUT, { recursive: true });
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };

// ---------- pure rules (node) ----------
const C = await import(pathToFileURL(path.join(ROOT, 'site/js/grammar-review-conf.js')).href);
const G = await import(pathToFileURL(path.join(ROOT, 'site/js/grammar-srs.js')).href);
const DAY = 864e5;
ok(JSON.stringify(C.sanitize(null)) === JSON.stringify(C.DEFAULTS), 'sanitize(null) = defaults');
ok(JSON.stringify(C.sanitize('x')) === JSON.stringify(C.DEFAULTS), 'sanitize(string) = defaults');
{
  const s = C.sanitize({ types: ['x', 'fill', 'tj'], count: 7, sched: 'never', days: 0, lessons: [3, 3, 99, '5', 1.5] });
  ok(s.types.join() === 'tj,fill' && s.count === 10 && s.sched === 'auto' && s.days === 3 && s.lessons.join() === '3,5', 'sanitize repairs each field', JSON.stringify(s));
}
ok(C.fixedMs({ sched: 'auto' }) === 0 && C.fixedMs({ sched: 'daily' }) === DAY && C.fixedMs({ sched: 'alt' }) === 2 * DAY && C.fixedMs({ sched: 'weekly' }) === 7 * DAY && C.fixedMs({ sched: 'custom', days: 4 }) === 4 * DAY, 'fixed intervals');
{
  const now = 1e12, d0 = G.addTo({}, ['5-1'], now - 10 * DAY);
  const r = G.applyAnswer(d0, '5-1', true, now, 7 * DAY), w = G.applyAnswer(d0, '5-1', false, now, 7 * DAY);
  ok(r['5-1'].due === now + 7 * DAY && w['5-1'].due === now + DAY, 'fixed: right → +interval, wrong → tomorrow');
  const auto = G.applyAnswer(d0, '5-1', true, now, 0);
  ok(auto['5-1'].due === now + 20 * 36e5, 'auto: spaced schedule unchanged (first success 20 h)');
  const far = { '5-1': { due: now + 30 * DAY, last: now - 2 * DAY, ivl: 30 * DAY }, '7-1': { due: now - 1, last: now - DAY } };
  ok(G.dueIds(far, now, 0).join() === '7-1' && G.dueIds(far, now, DAY).sort().join() === '5-1,7-1', 'fixed: due once last + interval passed');
  ok(G.dueIds(far, now, DAY, id => id.startsWith('5-')).join() === '5-1', 'dueIds lesson filter');
}

// ---------- browser ----------
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const KEY = 'jp.grammarReview.conf';
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const go = (page, h) => page.evaluate(h => (location.hash = h), h);
const conf = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const session = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession') || 'null'));

async function openConf(page, scope = '.g-review') {
  await page.waitForSelector(`${scope} [data-g-conf]`, { timeout: 15000 }).catch(async e => { await page.screenshot({ path: path.join(OUT, 'fail.png') }); console.log('at', await page.evaluate(() => location.hash), await page.evaluate(() => document.querySelector('#app')?.innerText.slice(0, 300))); throw e; });
  await page.click(`${scope} [data-g-conf]`);
  await page.waitForSelector('.modal.grc');
}
/** Set the dialog: types (ids), lessons (numbers | 'all'), count, sched, days; then Зберегти. */
async function setConf(page, { types, lessons, count, sched, days }, scope) {
  await openConf(page, scope);
  if (types) for (const id of ['tj', 'uj', 'fill', 'choose', 'build', 'game']) await page.setChecked(`.grc input[name="type"][value="${id}"]`, types.includes(id));
  if (lessons === 'all') await page.click('.grc [data-all]');
  else if (lessons) { await page.click('.grc [data-none]'); for (const n of lessons) await page.click(`.grc input[name="lesson"][value="${n}"]`); }
  if (count) await page.click(`.grc input[name="count"][value="${count}"]`);
  if (sched) await page.check(`.grc input[name="sched"][value="${sched}"]`);
  if (days) await page.fill('.grc input[name="days"]', String(days));
  await page.click('.grc [data-save]');
  await page.waitForSelector('.modal.grc', { state: 'detached' });
}
async function startNow(page, scope) {
  await page.evaluate(() => sessionStorage.removeItem('jp.examSession'));
  await page.click(`${scope} [data-g-now]`);
  await page.waitForFunction(() => location.hash.startsWith('#/exam/run') || location.hash.startsWith('#/play') || !document.querySelector('[data-g-msg]')?.hidden, null, { timeout: 15000 });
  return session(page);
}

for (const [kind, width, height] of [['phone', 320, 640], ['phone', 390, 844], ['desktop', 1280, 860]]) {
  const T = s => `${width}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  await page.goto(BASE + '#/grammar', { waitUntil: 'networkidle' });

  // open / close: gear on the grammar home panel and on a lesson
  await openConf(page);
  ok(await noScroll(page), T('dialog: no horizontal page scroll'));
  ok(await page.$eval('.modal.grc', m => m.scrollWidth <= m.clientWidth + 1), T('dialog: no horizontal scroll inside'));
  ok(await page.$$eval('.grc input[name="type"]:checked', a => a.map(x => x.value).join()) === 'tj,fill,choose,game', T('dialog: default types'));
  ok(await page.$$eval('.grc input[name="lesson"]:checked', a => a.length) === 50 && await page.$eval('.grc input[name="count"][value="10"]', x => x.checked), T('dialog: default lessons + count'));
  ok(await page.$$eval('.grc [data-grp]', a => a.length) === 5, T('dialog: lessons grouped by 10'));
  ok(!(await page.$('[data-grc-nostore]')), T('dialog: no storage note when storage works'));
  await page.waitForTimeout(450); // fade-in animation
  await page.screenshot({ path: path.join(OUT, `dialog-${width}.png`) });
  await page.$eval('.modal.grc', m => m.scrollTo(0, m.scrollHeight));
  await page.screenshot({ path: path.join(OUT, `dialog-bottom-${width}.png`) });
  const btnBox = await page.$eval('.grc [data-save]', b => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; });
  ok(btnBox, T('dialog: Зберегти visible'));
  await page.click('.grc [data-close]');
  await page.waitForSelector('.modal.grc', { state: 'detached' });
  ok(true, T('dialog closes (✕)'));
  await openConf(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal.grc', { state: 'detached' });
  ok(true, T('dialog closes (Escape)'));
  ok(await conf(page) === null, T('closing without Зберегти saves nothing'));

  // group checkbox toggles its 10 lessons
  await openConf(page);
  await page.click('.grc [data-grp="1"]');
  ok(await page.$$eval('.grc input[name="lesson"]:checked', a => a.filter(x => +x.value >= 11 && +x.value <= 20).length) === 0, T('group 11–20 off'));
  await page.click('.grc input[name="lesson"][value="12"]');
  ok(await page.$eval('.grc [data-grp="1"]', g => g.indeterminate), T('group partly on → indeterminate'));
  await page.click('.grc [data-close]');

  // lesson page: gear there too, mini-game offer follows the type
  await go(page, '#/grammar/5');
  await page.waitForSelector('.g-review-l [data-g-now]');
  ok(!!(await page.$('.g-review-slot .gm-offer')), T('lesson: mini-game offer with default types'));
  await openConf(page, '.g-review-l');
  ok(await noScroll(page), T('lesson dialog: no horizontal scroll'));
  await page.click('.grc [data-close]');
  await page.waitForSelector('.modal.grc', { state: 'detached' });
  await page.locator('.g-review-l').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `lesson-panel-${width}.png`) });
  ok(await noScroll(page), T('lesson panel: no horizontal scroll'));

  // only «Заповнити пропуск» → only particle / verb-form blanks
  await setConf(page, { types: ['fill'] }, '.g-review-l');
  await page.waitForSelector('.g-review-l [data-g-now]');
  ok(!(await page.$('.g-review-slot .gm-offer')), T('mini-game off → no offer'));
  ok(/заповнити пропуск/.test(await page.textContent('[data-g-conf-line]')), T('panel shows the chosen types'));
  let S = await startNow(page, '.g-review-l');
  ok(S && S.qs.length > 0 && S.qs.every(q => q.rt === 'fill' && (q.type === 'p' || q.type === 'v')), T('fill only → only fill-in items'), S ? S.qs.map(q => q.type).join() : 'no session');
  ok(S && S.qs.length <= 10, T('count 10 respected'), String(S?.qs.length));
  ok(S && S.qs.every(q => q.ref.point.startsWith('5-')), T('lesson session = lesson 5 points'));
  await page.waitForSelector('.ex-answer, .ex-q, .exam');
  ok(await noScroll(page), T('review run: no horizontal scroll'));

  // other single types map to their generators
  for (const [t, kinds, lesson] of [['tj', ['tj'], 5], ['uj', ['tu'], 5], ['choose', ['g'], 17], ['fill', ['p', 'v'], 17], ['build', ['ts'], 5]]) {
    await go(page, `#/grammar/${lesson}`);
    await setConf(page, { types: [t], count: 5 }, '.g-review-l');
    S = await startNow(page, '.g-review-l');
    ok(S && S.qs.length > 0 && S.qs.length <= 5 && S.qs.every(q => kinds.includes(q.type)), T(`${t} only → ${kinds}`), S ? S.qs.map(q => q.type).join() : 'no session');
    if (t === 'choose') ok(S && S.qs.every(q => q.options.length === 3), T('choose: 3 options'), S?.qs.map(q => q.options.length).join());
  }

  // only the mini-game → straight to the game of the lesson
  await go(page, '#/grammar/5');
  await setConf(page, { types: ['game'] }, '.g-review-l');
  await page.click('.g-review-l [data-g-now]');
  await page.waitForFunction(() => location.hash.startsWith('#/play/5-5'));
  await page.waitForFunction(() => /Міні-ігри/.test(document.querySelector('#app')?.innerText || ''));
  ok(true, T('game only → #/play/5-5'));

  // no type → blocked with the message
  await go(page, '#/grammar/5');
  await setConf(page, { types: [] }, '.g-review-l');
  await page.click('.g-review-l [data-g-now]');
  await page.waitForSelector('.g-review-l [data-g-msg]:not([hidden])');
  ok((await page.textContent('.g-review-l [data-g-msg]')).trim() === 'Оберіть хоча б один тип вправи', T('no type → «Оберіть хоча б один тип вправи», no session'));
  ok(await page.evaluate(() => location.hash) === '#/grammar/5', T('no type → stays on the lesson'));
  await go(page, '#/grammar');
  await page.waitForSelector('.g-review [data-g-now]');
  await page.click('.g-review [data-g-now]');
  await page.waitForSelector('.g-review [data-g-msg]:not([hidden])');
  ok(/Оберіть хоча б один тип вправи/.test(await page.textContent('.g-review [data-g-msg]')), T('home: no type → message'));
  await page.screenshot({ path: path.join(OUT, `no-type-${width}.png`) });

  // skipped type note: lesson 1 has no verb forms → «Вибрати правильну форму» skipped
  await go(page, '#/grammar/1');
  await setConf(page, { types: ['tj', 'choose'] }, '.g-review-l');
  S = await startNow(page, '.g-review-l');
  ok(S && S.qs.every(q => q.type === 'tj'), T('lesson 1: only translation items'));
  ok(/Пропущено.*Вибрати правильну форму/.test(await page.textContent('#toast')), T('skipped types listed'), await page.textContent('#toast'));

  // lesson filter: home «Перевірити себе зараз» with lessons 7 + 12 only (nothing scheduled)
  await go(page, '#/grammar');
  await setConf(page, { types: ['tj', 'fill'], lessons: [7, 12], count: 20 });
  ok(await page.waitForFunction(() => /уроків: 2 з 50/.test(document.querySelector('.g-review [data-g-conf-line]')?.textContent || ''), null, { timeout: 8000 }).then(() => true, () => false), T('panel shows lesson count'));
  S = await startNow(page, '.g-review');
  const ls = S ? [...new Set(S.qs.map(q => +q.ref.point.split('-')[0]))] : [];
  ok(S && S.qs.length > 0 && ls.every(l => l === 7 || l === 12), T('lesson filter: only lessons 7 and 12'), ls.join());
  // scheduled: points of lessons 5 and 7 due now → only lesson 7 counts
  await page.evaluate(() => {
    const now = Date.now(), d = {};
    for (const id of ['5-1', '5-2', '7-1', '7-2']) d[id] = { added: now - 2e8, due: now - 1000, ivl: 0, ease: 2.5, last: now - 2e8, c: 0, w: 0 };
    localStorage.setItem('jp.grammarSrs', JSON.stringify(d));
  });
  await go(page, '#/');
  await page.waitForSelector('[data-t="grammar"]');
  ok(+(await page.textContent('[data-t="grammar"]')) === 2, T('«Сьогодні» counts only chosen lessons'));
  await go(page, '#/grammar');
  await page.waitForSelector('[data-g-review]');
  ok(+(await page.textContent('[data-g-due]')) === 2, T('home: due count of chosen lessons'));
  await page.evaluate(() => sessionStorage.removeItem('jp.examSession'));
  await page.click('[data-g-review]');
  await page.waitForFunction(() => location.hash.startsWith('#/exam/run'));
  S = await session(page);
  ok(S.qs.every(q => q.ref.point.startsWith('7-')), T('scheduled review: only lesson 7'), S.qs.map(q => q.ref.point).join());

  // «Прибрати з повторення» on a lesson writes the same schedule
  await go(page, '#/grammar/7');
  await page.waitForSelector('.g-review-l [data-g-rm]');
  await page.click('.g-review-l [data-g-rm]');
  await page.waitForSelector('.g-review-l [data-g-add]');
  const gs = await page.evaluate(() => JSON.parse(localStorage.getItem('jp.grammarSrs') || '{}'));
  ok(!Object.keys(gs).some(id => id.startsWith('7-')) && gs['5-1'], T('«Прибрати з повторення» removes only lesson 7'));

  // fixed schedule: weekly → a right answer schedules +7 days
  await setConf(page, { types: ['tj'], lessons: 'all', sched: 'custom', days: 9 }, '.g-review-l');
  ok((await conf(page)).sched === 'custom' && (await conf(page)).days === 9, T('custom interval saved'));
  ok(await page.waitForFunction(() => /кожні 9 дн/.test(document.querySelector('.g-review-l [data-g-conf-line]')?.textContent || ''), null, { timeout: 8000 }).then(() => true, () => false), T('panel shows custom interval'));

  // reload keeps the settings
  await page.reload({ waitUntil: 'networkidle' });
  await openConf(page, '.g-review-l');
  ok(await page.$$eval('.grc input[name="type"]:checked', a => a.map(x => x.value).join()) === 'tj' && await page.$eval('.grc input[name="days"]', x => x.value) === '9' && !(await page.$eval('.grc input[name="days"]', x => x.disabled)), T('reload keeps the settings'));
  // «Скинути до стандартного»
  await page.click('.grc [data-reset]');
  ok(await page.$$eval('.grc input[name="type"]:checked', a => a.map(x => x.value).join()) === 'tj,fill,choose,game' && (await conf(page)).sched === 'auto', T('reset → defaults (form + storage)'));
  await page.click('.grc [data-close]');

  // corrupted value → defaults, no error
  for (const bad of ['{broken', '"text"', '[1,2]', JSON.stringify({ types: 'all', count: 99, sched: 3, lessons: 'x' })]) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, bad]);
    await page.reload({ waitUntil: 'networkidle' });
    await openConf(page, '.g-review-l');
    const st = await page.evaluate(() => ({ t: [...document.querySelectorAll('.grc input[name="type"]:checked')].map(x => x.value).join(), l: document.querySelectorAll('.grc input[name="lesson"]:checked').length, c: document.querySelector('.grc input[name="count"]:checked')?.value }));
    ok(st.t === 'tj,fill,choose,game' && st.l === 50 && st.c === '10', T(`corrupted ${bad.slice(0, 20)} → defaults`), JSON.stringify(st));
    ok(JSON.stringify(await conf(page))?.includes('"count":10'), T(`corrupted ${bad.slice(0, 12)} → repaired in storage`));
    await page.click('.grc [data-close]');
  }
  ok(!errs.length, T('no page errors'), errs.join('\n'));
  await ctx.close();
}

// blocked storage: defaults + note, still usable
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'uk-UA' });
  await ctx.addInitScript(() => {
    const no = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.setItem = no; Storage.prototype.getItem = no; Storage.prototype.removeItem = no;
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  await page.goto(BASE + '#/grammar/5', { waitUntil: 'networkidle' });
  await openConf(page, '.g-review-l');
  ok(!!(await page.$('[data-grc-nostore]')), 'blocked storage: note shown');
  ok(await page.$$eval('.grc input[name="type"]:checked', a => a.map(x => x.value).join()) === 'tj,fill,choose,game', 'blocked storage: defaults');
  await page.screenshot({ path: path.join(OUT, 'blocked-390.png') });
  await page.setChecked('.grc input[name="type"][value="tj"]', false);
  await page.click('.grc [data-save]');
  await page.waitForSelector('.modal.grc', { state: 'detached' });
  ok(/не збережуться|до перезавантаження/.test(await page.textContent('#toast')), 'blocked storage: save toast says not kept');
  ok(!/переклад з японської/.test(await page.textContent('.g-review-l [data-g-conf-line]')), 'blocked storage: settings act for this page');
  ok(!errs.filter(e => !/blocked/.test(e)).length, 'blocked storage: no page errors', errs.join('\n'));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`\n${passed} passed, ${issues.length} failed`);
if (issues.length) { console.log(issues.join('\n')); process.exitCode = 1; }
