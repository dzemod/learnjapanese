// Browser QA of «Сьогодні» (home page panel + #/today session), 320 / 390 / 1280 px:
//   empty state, storage blocked, a mocked full state (due words, due kanji, real saved exam mistakes, streak),
//   «Почати сесію» = words → kanji → exam mistakes with a progress bar, the streak over two days.
//   node tools/qa-today.mjs        → screenshots in qa/today/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/today');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const l1 = sets.find(s => s.id === 'mnn-01').cards.map(c => c.id);
const H = 36e5, D = 864e5;

// local calendar day, as the site writes it (YYYY-MM-DD)
const dayFn = `d => { const x = new Date(Date.now() - d * ${D}); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }`;
const panel = page => page.evaluate(() => {
  const q = s => document.querySelector(`.today [data-t="${s}"]`)?.textContent;
  return { words: q('words'), kanji: q('kanji'), exam: q('exam'), streak: q('streak'), start: !!document.querySelector('[data-start-today]'), empty: document.querySelector('.today-empty')?.textContent || '',
    first: document.querySelector('.home')?.querySelector('.today') === document.querySelector('.home .today-slot > .today'), slotFirst: [...document.querySelector('.home').children].findIndex(e => e.classList.contains('today-slot')),
    docW: Math.max(document.documentElement.scrollWidth, innerWidth) };
});

for (const [kind, width, height] of [['narrow', 320, 640], ['phone', 390, 844], ['desktop', 1280, 800]]) {
  const T = s => `${kind}: ${s}`;
  const phone = kind !== 'desktop';
  const opts = { viewport: { width, height }, isMobile: phone, hasTouch: phone, locale: 'uk-UA' };

  // ---- empty state
  let ctx = await browser.newContext(opts);
  let page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.today [data-t="kanji"]')?.textContent !== '…');
  let p = await panel(page);
  ok(p.slotFirst <= 1, T('panel at the top of the home page'), String(p.slotFirst));
  ok(p.words === '0' && p.kanji === '0' && p.exam === '0' && p.streak === '0', T('empty: zeros, no broken numbers'), JSON.stringify(p));
  ok(!p.start && /Поки нічого не треба повторювати/.test(p.empty), T('empty: Ukrainian message, no session button'), p.empty);
  ok(p.docW <= width, T('empty: no horizontal scroll'), String(p.docW));
  await page.screenshot({ path: path.join(OUT, `empty-${width}.png`) });
  await page.goto(BASE + '#/today', { waitUntil: 'networkidle' });
  ok((await page.textContent('.today-run')).includes('Сьогодні нічого не треба повторювати'), T('empty: session page says nothing is due'));
  await ctx.close();

  // ---- storage blocked: the page still works, zeros
  ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  page = await ctx.newPage();
  const errsB = [];
  page.on('pageerror', e => errsB.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.today [data-t="words"]');
  p = await panel(page);
  ok(p.words === '0' && p.exam === '0' && p.streak === '0' && !errsB.length, T('storage blocked: zeros, no errors'), errsB.join(' | '));
  await ctx.close();

  // ---- full state
  ctx = await browser.newContext(opts);
  page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  // real saved exam mistakes: a «Слово: напиши сам(а)» exam, two wrong answers flagged with «Додати до помилок»
  await page.evaluate(() => { localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'I', from: 1, to: 2, tsAdded: true, wtAdded: true, mine: false, kanji: false, types: ['wt'], count: 3, mock: false, timer: 0 })); sessionStorage.clear(); });
  await page.goto(BASE + '#/exam', { waitUntil: 'networkidle' });
  await page.click('[data-start]');
  for (let i = 0; i < 2; i++) {
    await page.waitForSelector('.ex-wtform .answer-input');
    await page.fill('.ex-wtform .answer-input', 'ぬぬぬ');
    await page.press('.ex-wtform .answer-input', 'Enter');
    await page.waitForSelector('[data-flag]');
    await page.click('[data-flag]');
    await page.click('[data-next]');
  }
  const mistakes = await page.evaluate(() => JSON.parse(localStorage.getItem('jp.examMistakes') || '[]').length);
  ok(mistakes === 2, T('two real exam mistakes saved'), String(mistakes));
  // words: 2 days ago lvl 1 (due), 10 days ago lvl 2 (due), 1 hour ago lvl 1 (not due), more wrong than right 1 h ago (due), never (not due)
  await page.evaluate(([ids, H, D, dayFn]) => {
    const now = Date.now(), k = i => 'mnn-01/' + ids[i];
    localStorage.setItem('jp.progress', JSON.stringify({
      [k(0)]: { c: 1, w: 0, lvl: 1, star: false, last: now - 2 * D }, [k(1)]: { c: 3, w: 0, lvl: 2, star: false, last: now - 10 * D },
      [k(2)]: { c: 1, w: 0, lvl: 1, star: false, last: now - H }, [k(3)]: { c: 0, w: 2, lvl: 1, star: false, last: now - H },
    }));
    // kanji: one due an hour ago, one due tomorrow
    localStorage.setItem('jp.kanjiWrite', JSON.stringify({ 'k300-001': { due: now - H, interval: D, rating: 'good', mistakes: 0, totalMistakes: 0, reps: 2, last: now - D - H },
      'k300-002': { due: now + D, interval: 2 * D, rating: 'good', mistakes: 0, totalMistakes: 0, reps: 3, last: now - D } }));
    const day = eval(dayFn);
    localStorage.setItem('jp.days', JSON.stringify([day(2), day(1)])); // studied the day before yesterday and yesterday
    sessionStorage.removeItem('jp.examSession');
  }, [l1, H, D, dayFn]);
  await page.goto(BASE + '#/', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.today [data-t="kanji"]')?.textContent !== '…');
  p = await panel(page);
  ok(p.words === '3' && p.kanji === '1' && p.exam === '2', T('full: 3 words, 1 kanji, 2 exam mistakes due'), JSON.stringify(p));
  ok(p.streak === '2', T('streak: two days (before studying today)'), p.streak);
  ok(p.start && p.docW <= width, T('full: «Почати сесію», no horizontal scroll'), String(p.docW));
  await page.screenshot({ path: path.join(OUT, `full-${width}.png`) });

  // ---- the session: words → kanji → exam
  await page.click('[data-start-today]');
  await page.waitForSelector('.today-run');
  ok(page.url().endsWith('#/today') && (await page.textContent('.today-count')).trim() === '1 / 5', T('session: 5 items (3 words, 1 kanji, exam)'), await page.textContent('.today-count'));
  const kinds = [];
  for (let i = 0; i < 4; i++) {
    const eyebrow = (await page.textContent('.today-card .eyebrow')).trim();
    kinds.push(eyebrow.split(' ·')[0]);
    const bar = await page.$eval('.today-bar i', e => parseFloat(e.style.width));
    ok(Math.abs(bar - (i / 5) * 100) < 0.6, T(`progress bar at item ${i + 1}`), String(bar));
    await page.click('[data-show]');
    if (eyebrow.startsWith('Слово')) {
      ok(await page.isVisible('.today-jp'), T('word: answer revealed'));
      await page.click(i === 0 ? '[data-no]' : '[data-yes]');
    } else {
      await page.waitForSelector('.today-kvg path', { timeout: 15000 }).catch(() => {});
      ok(await page.isVisible('.today-kanji') && (await page.$$('.today-rate [data-r]')).length === 4, T('kanji: revealed with 4 ratings'));
      await page.click('[data-r="good"]');
    }
    if (i === 0) {
      ok((await page.evaluate(() => document.querySelector('.today-streak, .streak') && JSON.parse(localStorage.getItem('jp.days')).length)) === 3, T('streak: today added after the first item'));
    }
  }
  ok(kinds.join(',') === 'Слово,Слово,Слово,Канджі', T('order: words, then kanji'), kinds.join(','));
  const after = await page.evaluate(([ids]) => ({ p: JSON.parse(localStorage.getItem('jp.progress')), k: JSON.parse(localStorage.getItem('jp.kanjiWrite')) }), [l1]);
  ok(after.p[`mnn-01/${l1[3]}`] && after.k['k300-001'].due > Date.now() + 36e5, T('answers recorded: word progress and kanji schedule updated'));
  ok((await page.textContent('.today-card .eyebrow')).startsWith('Екзамен') && (await page.textContent('.today-count')).trim() === '5 / 5', T('last: exam mistakes'));
  if (kind === 'phone') await page.screenshot({ path: path.join(OUT, `session-exam-${width}.png`) });
  await page.click('[data-exam]');
  await page.waitForSelector('.ex-wtform, .ex-answer');
  const ex = await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); return { name: S.conf.name, n: S.qs.length, timer: S.conf.timer }; });
  ok(page.url().endsWith('#/exam/run') && ex.name === 'Сьогодні: мої помилки' && ex.n === 2 && ex.timer === 0, T('exam: the saved mistakes open in the exam'), JSON.stringify(ex));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.today [data-t="kanji"]')?.textContent !== '…');
  p = await panel(page);
  // the word answered wrong comes back after 10 min (word-srs.js SRS.AGAIN), so right after the session nothing is due
  ok(p.streak === '3' && p.words === '0' && p.kanji === '0', T('after the session: streak 3, nothing due right now'), JSON.stringify(p));
  const later = await page.evaluate(() => { const pr = JSON.parse(localStorage.getItem('jp.progress')); for (const v of Object.values(pr)) { v.last -= 11 * 6e4; if (v.due) v.due -= 11 * 6e4; } localStorage.setItem('jp.progress', JSON.stringify(pr)); });
  void later;
  await page.reload({ waitUntil: 'networkidle' });
  ok((await page.textContent('.today [data-t="words"]')) === '1', T('11 minutes later: the word answered wrong is due again'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}

// ---- the streak over two days (a gap breaks it; studying today continues it)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  const streakWith = async days => {
    await page.evaluate(([dayFn, days]) => { const day = eval(dayFn); localStorage.setItem('jp.days', JSON.stringify(days.map(day))); }, [dayFn, days]);
    await page.reload({ waitUntil: 'networkidle' });
    return page.textContent('.today [data-t="streak"]');
  };
  ok((await streakWith([1, 0])) === '2', 'streak: yesterday + today = 2');
  ok((await streakWith([1])) === '1', 'streak: only yesterday = 1 (today not studied yet, still alive)');
  ok((await streakWith([3, 2])) === '0', 'streak: a missed day breaks it');
  ok((await streakWith([])) === '0', 'streak: none = 0');
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`\n${passed} passed, ${issues.length} failed`);
if (issues.length) { console.log(issues.join('\n')); process.exit(1); }
console.log('ALL TODAY CHECKS PASSED');
