// Browser QA of the grammar review schedule (375 + 1280 px): lesson block «Повторювати граматику уроку N» (add,
// remove, «Перевірити себе зараз»), grammar home panel (empty / due / «Повторити»), the review run in the Exam runner
// (questions belong to the chosen points; answers move the schedule), exam mistakes add points, «Сьогодні» counts
// grammar and puts it into the session, no horizontal scroll, no page errors.
//   node tools/qa-grammar-srs.mjs   → screenshots in qa/grammar-srs/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/grammar-srs');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const go = (page, h) => page.evaluate(h => (location.hash = h), h);
const gs = page => page.evaluate(() => JSON.parse(localStorage.getItem('jp.grammarSrs') || '{}'));

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
  await page.goto(BASE + '#/grammar', { waitUntil: 'networkidle' });

  // empty schedule: explanation, no button
  await page.waitForSelector('.g-review');
  ok(/Додайте урок до повторення/.test(await page.textContent('.g-review')) && !(await page.$('[data-g-review]')), T('home: empty schedule explained'));

  // lesson 5: add → schedule tomorrow
  await go(page, '#/grammar/5');
  await page.waitForSelector('.g-review-l [data-g-add]');
  await page.screenshot({ path: path.join(OUT, `lesson-empty-${width}.png`) });
  await page.click('[data-g-add]');
  await page.waitForSelector('[data-g-rm]');
  let d = await gs(page);
  const ids = Object.keys(d);
  ok(ids.length >= 3 && ids.every(id => id.startsWith('5-')), T('lesson 5 points added'), ids.join());
  ok(ids.every(id => d[id].due > Date.now() + 20 * 36e5), T('first review tomorrow'));
  ok(/наступне повторення через/.test(await page.textContent('.g-review-l')), T('lesson block: next review shown'));
  await page.locator('.g-review-l').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `lesson-added-${width}.png`) });
  ok(await noScroll(page), T('lesson: no horizontal scroll'));
  await page.click('[data-g-rm]');
  await page.waitForSelector('.g-review-l [data-g-add]');
  ok(Object.keys(await gs(page)).length === 0, T('remove from the schedule'));
  await page.click('[data-g-add]');
  await page.waitForSelector('[data-g-rm]');

  // make them due → home panel → review run
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('jp.grammarSrs')); for (const k in d) d[k].due = Date.now() - 1000; localStorage.setItem('jp.grammarSrs', JSON.stringify(d)); });
  await go(page, '#/');
  await page.waitForSelector('[data-t="grammar"]');
  ok(+(await page.textContent('[data-t="grammar"]')) === ids.length, T('«Сьогодні»: grammar points counted'));
  ok(await noScroll(page), T('home: no horizontal scroll'));
  await page.locator('.today').screenshot({ path: path.join(OUT, `today-${width}.png`) });
  await go(page, '#/grammar');
  await page.waitForSelector('[data-g-review]');
  ok(+(await page.textContent('[data-g-due]')) === ids.length, T('home: due count'));
  await page.screenshot({ path: path.join(OUT, `home-due-${width}.png`) });
  await page.click('[data-g-review]');
  await page.waitForFunction(() => location.hash.startsWith('#/exam/run'));
  // a choice question first (reload: the exam takes the session from sessionStorage)
  await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); const i = S.qs.findIndex(q => q.mode === 'choice'); if (i > 0) S.qs.unshift(...S.qs.splice(i, 1)); sessionStorage.setItem('jp.examSession', JSON.stringify(S)); });
  await page.reload({ waitUntil: 'networkidle' });
  const S = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')));
  ok(S.qs.length >= ids.length && S.qs.length <= ids.length * 2, T('review: ≈ 2 questions per point'), String(S.qs.length));
  ok(S.qs.every(q => q.ref?.kind === 'g' && ids.includes(q.ref.point)), T('review: every question belongs to a chosen point'));
  ok(new Set(S.qs.map(q => q.ref.point)).size === ids.length, T('review: every point asked'));
  // answer the first question (choice → right option; other kinds → submit an empty/wrong answer)
  await page.waitForSelector('.ex-answer');
  const q0 = S.qs[0];
  if (q0.mode === 'choice') await page.click(`.ex-answer .choice[data-v="${q0.answer.replace(/"/g, '\\"')}"]`);
  else if (q0.mode === 'error') await page.click('.ex-answer .ex-chunk >> nth=0').catch(() => {});
  else { await page.fill('.ex-answer input, .ex-answer textarea', 'ばつ'); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `run-${width}.png`) });
  d = await gs(page);
  const p0 = d[q0.ref.point];
  ok(p0 && (p0.c + p0.w) >= 1, T('an answer moved the point'), JSON.stringify(p0));
  if (q0.mode === 'choice') ok(p0.due > Date.now() + 19 * 36e5, T('right answer: next review in ≈ 20 h'));

  // a wrong exam answer on a point not in the schedule adds it
  await page.evaluate(() => { localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'all', from: 12, to: 12, tsAdded: true, wtAdded: true, mine: false, kanji: false, types: ['p'], count: 3, mock: false, timer: 0 })); sessionStorage.removeItem('jp.examSession'); });
  await go(page, '#/exam');
  await page.waitForSelector('[data-start]');
  await page.click('[data-start]');
  await page.waitForSelector('.ex-answer .choice', { timeout: 8000 }).catch(async () => { await page.screenshot({ path: path.join(OUT, 'debug-exam.png'), fullPage: true }); });
  const S2 = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')));
  const wrongV = await page.$$eval('.ex-answer .choice', (b, a) => b.map(x => x.dataset.v).find(v => v !== a), S2.qs[0].answer);
  await page.click(`.ex-answer .choice[data-v="${wrongV}"]`);
  await page.waitForTimeout(300);
  d = await gs(page);
  ok(!!d[S2.qs[0].ref.point], T('exam mistake adds its grammar point'), S2.qs[0].ref.point);

  // «Сьогодні» session: grammar step opens the review in the exam
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('jp.grammarSrs')); for (const k in d) d[k].due = Date.now() - 1000; localStorage.setItem('jp.grammarSrs', JSON.stringify(d)); sessionStorage.removeItem('jp.today.session'); sessionStorage.removeItem('jp.examSession'); });
  await go(page, '#/today');
  await page.waitForSelector('[data-exam]');
  const plan = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.today.session')).plan);
  ok(plan.grammar.length >= 3, T('«Сьогодні» plan includes grammar'), JSON.stringify(plan.grammar));
  ok(/граматики на повторення/.test(await page.textContent('.today-card')), T('session step names the grammar points'));
  await page.screenshot({ path: path.join(OUT, `today-step-${width}.png`) });
  await page.click('[data-exam]');
  await page.waitForFunction(() => location.hash.startsWith('#/exam/run'));
  const S3 = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')));
  ok(S3.conf.name === 'Сьогодні: граматика' && S3.qs.every(q => plan.grammar.includes(q.ref.point)), T('«Сьогодні» opens the grammar review'), S3.conf.name);

  ok(!errs.length, T('no page errors'), errs.join('\n'));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`${passed} passed, ${issues.length} failed`);
process.exit(issues.length ? 1 : 0);
