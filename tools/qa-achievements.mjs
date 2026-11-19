// Browser QA of achievements, heatmap, streak freezes and kanji associations (375 + 1280 px):
//   new learner (zeros, no errors, no horizontal scroll), storage blocked, a full state (first run = one summary
//   pop-up, freeze in the header, streak + heatmap with a frozen day, unlocked/locked/secret cards), a new badge
//   right after a study action («Сьогодні» → 10th word), the kanji card: components, own association (saved, shown
//   masked in the writing mode), «Сенсей підкаже» with a mocked Puter.js (ideas → «Взяти» → «Зберегти»; error).
//   node tools/qa-achievements.mjs   → screenshots in qa/achievements/   (KVG_DIR=<KanjiVG svg dir> serves the
//   stroke files locally, default %TEMP%/claude-kvg; otherwise they come from jsDelivr)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/achievements');
fs.mkdirSync(OUT, { recursive: true });
const KVG_DIR = process.env.KVG_DIR || path.join(process.env.TEMP || '/tmp', 'claude-kvg');
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const D = 864e5;
const dayStr = d => { const x = new Date(Date.now() - d * D); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const PUTER = 'https://js.puter.com/v2/';
const MOCK = `window.puter = { auth: { isSignedIn: () => true, signIn: async () => true },
  ai: { chat: async (msgs) => { window.__asked = msgs; if (window.__fail) throw { error: { code: 'server_error', message: 'boom' } };
    return { message: { content: '1. Людина (亻) сперлася на дерево (木) і відпочиває.\\n2. **Під деревом (木)** відпочиває людина (亻).' }, finish_reason: 'stop' }; } } };`;

async function context(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route(PUTER, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK }));
  if (fs.existsSync(KVG_DIR)) await ctx.route(/KanjiVG\/kanjivg@[^/]+\/kanji\/([0-9a-f]+)\.svg$/, r => {
    const f = path.join(KVG_DIR, /([0-9a-f]+)\.svg$/.exec(r.request().url())[1] + '.svg');
    return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(f, 'utf8') }) : r.fulfill({ status: 404, body: '' });
  });
  return ctx;
}
const noScroll = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1);

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const phone = kind === 'phone';
  const opts = { viewport: { width, height }, isMobile: phone, hasTouch: phone, locale: 'uk-UA' };

  // ---- new learner
  let ctx = await context(opts);
  let page = await ctx.newPage();
  let errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/achievements', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ach-page');
  ok(/Відкрито 0 з \d+/.test(await page.textContent('.ach-page .hero')), T('new learner: 0 unlocked'));
  ok(await page.locator('.hm-grid .hm-c').count() >= 70, T('heatmap drawn'), String(await page.locator('.hm-grid .hm-c').count()));
  ok(await page.locator('.ach-card.secret').count() === 3, T('3 secret cards hidden'));
  ok(await page.locator('.ach-pop').count() === 0, T('new learner: no pop-up'));
  ok(await noScroll(page), T('new learner: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `empty-${width}.png`), fullPage: true });
  ok(!errs.length, T('new learner: no page errors'), errs.join(' | '));
  await ctx.close();

  // ---- storage blocked
  ctx = await context(opts);
  await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  page = await ctx.newPage();
  errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/achievements', { waitUntil: 'networkidle' });
  ok(await page.locator('.ach-page').count() === 1 && !errs.length, T('storage blocked: page works'), errs.join(' | '));
  await ctx.close();

  // ---- full state
  ctx = await context(opts);
  const l1 = sets.find(s => s.id === 'mnn-01').cards;
  const progress = {};
  l1.forEach(c => (progress[`mnn-01/${c.id}`] = { c: 2, w: 0, lvl: 2, star: false, last: Date.now() - D }));
  const more = ['mnn-02', 'mnn-03', 'mnn-04'].flatMap(id => sets.find(s => s.id === id).cards.map(c => `${id}/${c.id}`)).slice(0, 120 - l1.length);
  more.forEach(k => (progress[k] = { c: 1, w: 0, lvl: 2, star: false, last: Date.now() - D })); // 120 known words, lesson 1 complete
  const kw = {};
  kj.books[0].lessons[0].kanji.concat(kj.books[0].lessons[1].kanji).concat(kj.books[0].lessons[2].kanji).slice(0, 55).forEach((k, i) => (kw[k.id] = { due: Date.now() + D, interval: i < 30 ? 2 * D : 600e3, rating: i < 26 ? 'easy' : 'good', reps: 2, last: Date.now() - D }));
  // 14 studied days, then one missed (frozen), then yesterday + today → streak 16, one freeze left
  const days = [...Array.from({ length: 14 }, (_, i) => dayStr(16 - i)), dayStr(1), dayStr(0)];
  const activity = Object.fromEntries(days.map((d, i) => [d, [3, 8, 25, 60][i % 4]]));
  const history = [{ at: Date.now() - 2 * D, name: 'Уроки 1–5', n: 20, ok: 19, pct: 95, byType: { ts: { n: 5, ok: 5, label: 'Переклад речень' } }, mistakes: [] }];
  await ctx.addInitScript(([p, k, d, a, h]) => {
    if (sessionStorage.getItem('qa.init')) return;
    sessionStorage.setItem('qa.init', '1');
    localStorage.setItem('jp.progress', JSON.stringify(p)); localStorage.setItem('jp.kanjiWrite', JSON.stringify(k));
    localStorage.setItem('jp.days', JSON.stringify(d)); localStorage.setItem('jp.activity', JSON.stringify(a)); localStorage.setItem('jp.examHistory', JSON.stringify(h));
  }, [progress, kw, days, activity, history]);
  page = await ctx.newPage();
  errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ach-pop', { timeout: 5000 }).catch(() => {});
  const popTxt = await page.locator('.ach-pop').textContent().catch(() => '');
  ok(/У вас уже \d+ досягнен/.test(popTxt), T('first run: one summary pop-up'), popTxt);
  ok(await page.locator('.ach-pop').count() <= 1, T('only one pop-up at a time'));
  const head = await page.textContent('#streak');
  ok(/16/.test(head) && head.includes('❄'), T('header: streak 16 with a freeze'), head);
  ok((await page.getAttribute('#streak', 'href')) === '#/achievements', T('header streak links to achievements'));
  const line = await page.textContent('.today-ach');
  ok(line.includes(`Досягнення ${/У вас уже (\d+)/.exec(popTxt)?.[1]} /`), T('«Сьогодні» panel count updated after the first check'), line);
  ok(/Досягнення \d+ \/ \d+/.test(line) && line.includes('❄'), T('«Сьогодні» panel: achievements line with freezes'), line);
  ok(await noScroll(page), T('home: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `home-${width}.png`) });
  await page.click('.today-ach');
  await page.waitForSelector('.ach-page');
  const got = await page.$$eval('.ach-card.got', els => els.map(e => e.querySelector('b').textContent));
  for (const t of ['Три дні поспіль', 'Тиждень поспіль', 'Заморозка врятувала серію', '100 слів', 'Урок пройдено', '50 канджі', 'Легка рука', 'Перший екзамен', 'Відмінно', 'Перекладач'])
    ok(got.includes(t), T(`unlocked: ${t}`), got.join(', '));
  for (const t of ['Місяць поспіль', '500 слів', 'Перша асоціація', 'Без жодної помилки']) ok(!got.includes(t), T(`still locked: ${t}`));
  ok(/16/.test(await page.textContent('.ach-st-num')), T('streak card: 16'));
  ok(await page.locator('.fz-ic.on').count() === 1, T('one freeze left (14 days earned 2, one used)'));
  ok(await page.locator('.hm-c.fz').count() >= 1, T('heatmap: the frozen day is marked'));
  ok(await page.locator('.hm-c.l4').count() >= 1 && await page.locator('.hm-c.l1').count() >= 1, T('heatmap: activity levels'));
  const bar = await page.$eval('.ach-card.locked .ach-num', e => e.textContent).catch(() => '');
  ok(/^\d+ \/ \d+$/.test(bar.trim()), T('locked card shows progress'), bar);
  ok(await noScroll(page), T('achievements: no horizontal scroll'));
  const hmW = await page.$eval('.hm-grid', e => e.getBoundingClientRect().right <= e.closest('.panel').getBoundingClientRect().right + 0.5);
  ok(hmW, T('heatmap fits its panel'));
  await page.screenshot({ path: path.join(OUT, `full-${width}.png`), fullPage: true });

  // ---- a new badge right after a study action: the 10th known word of lesson 3 via «Сьогодні»
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('jp.progress'));
    for (const k of Object.keys(p)) if (!k.startsWith('mnn-01/')) delete p[k];
    localStorage.setItem('jp.progress', JSON.stringify(p));
    const un = JSON.parse(localStorage.getItem('jp.achievements'));
    delete un['words-100'];
    localStorage.setItem('jp.achievements', JSON.stringify(un));
  });
  const known = Object.keys(progress).filter(k => k.startsWith('mnn-01/')).length;
  // lesson 1 alone has `known` words; make the total exactly 99 known + 1 due learning word
  const extra = ['mnn-05', 'mnn-06', 'mnn-07'].flatMap(id => sets.find(s => s.id === id).cards.map(c => `${id}/${c.id}`)).slice(0, 100 - known);
  await page.evaluate(([ex, now]) => {
    const p = JSON.parse(localStorage.getItem('jp.progress'));
    ex.forEach((c, i) => (p[c] = i === 0 ? { c: 1, w: 0, lvl: 1, star: false, last: now - 2 * 864e5 } : { c: 1, w: 0, lvl: 2, star: false, last: now }));
    localStorage.setItem('jp.progress', JSON.stringify(p));
    sessionStorage.removeItem('jp.today.session');
  }, [extra, Date.now()]);
  await page.goto(BASE + '#/today', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-show]');
  await page.click('[data-show]');
  await page.click('[data-yes]');
  await page.waitForSelector('.ach-pop', { timeout: 4000 }).catch(() => {});
  const pop2 = await page.locator('.ach-pop').textContent().catch(() => '');
  ok(/Нове досягнення/.test(pop2) && /100 слів/.test(pop2), T('new badge pop-up after the 100th word'), pop2);
  await page.screenshot({ path: path.join(OUT, `pop-${width}.png`) });
  ok(!errs.length, T('full state: no page errors'), errs.join(' | '));
  await ctx.close();

  // ---- kanji associations
  ctx = await context(opts);
  page = await ctx.newPage();
  errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const L = kj.books[0].lessons.find(l => l.kanji.some(k => k.kanji === '休'));
  const K = L.kanji.find(k => k.kanji === '休');
  await page.goto(BASE + `#/kanji/${L.id}/${K.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kc-assoc .as-part', { timeout: 8000 }).catch(() => {});
  const parts = await page.$$eval('.kc-assoc .as-part', els => els.map(e => e.textContent));
  ok(parts.length === 2 && parts[0].startsWith('亻') && parts[0].includes('людина') && parts[1].startsWith('木'), T('休: components 亻 + 木 with meanings'), parts.join(' | '));
  ok(await page.locator('.kc-assoc .as-default .check-badge').count() === 1 && (await page.textContent('.kc-assoc .as-default')).includes('(亻)'), T('no own note: ready-made association with «перевірити»'));
  await page.click('.kc-assoc [data-as-own]');
  ok((await page.inputValue('.kc-assoc textarea')).includes('(亻)'), T('«Взяти собі» copies it into the editor'));
  await page.click('[data-as-cancel]');
  // a kanji without a ready-made association: invitation text
  const noDef = kj.books[1].lessons.at(-1).kanji.at(-1);
  const ready = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji-assoc.json'), 'utf8')).kanji;
  if (!ready[noDef.id]) {
    const p2 = await ctx.newPage();
    await p2.goto(BASE + `#/kanji/${kj.books[1].lessons.at(-1).id}/${noDef.id}`, { waitUntil: 'networkidle' });
    await p2.waitForSelector('.kc-assoc .as-btns');
    ok(await p2.locator('.kc-assoc .as-empty').count() === 1 && await p2.locator('[data-as-own]').count() === 0, T('no ready-made one: invitation text'));
    await p2.close();
  }
  await page.click('.kc-assoc [data-as-ai]');
  await page.waitForSelector('.as-idea', { timeout: 5000 });
  ok(await page.locator('.as-idea').count() === 2, T('Сенсей: two ideas'));
  ok(!(await page.textContent('.as-ideas')).includes('**'), T('ideas without Markdown stars'));
  const asked = await page.evaluate(() => window.__asked);
  ok(asked?.[0]?.role === 'system' && /Складники: 亻 \(людина\), 木/.test(asked?.[1]?.content || ''), T('request: system prompt + kanji with components'), JSON.stringify(asked?.[1]));
  await page.click('[data-as-take="0"]');
  ok((await page.inputValue('.kc-assoc textarea')).startsWith('Людина (亻)'), T('«Взяти» fills the editor'));
  await page.fill('.kc-assoc textarea', 'Людина (亻) сперлася на дерево (木) — 休 відпочинок');
  await page.click('[data-as-save]');
  ok((await page.textContent('.kc-assoc .as-note')).includes('сперлася'), T('note saved and shown'));
  await page.waitForSelector('.ach-pop', { timeout: 4000 }).catch(() => {});
  ok(/Перша асоціація/.test(await page.locator('.ach-pop').textContent().catch(() => '')), T('«Перша асоціація» unlocked'));
  ok(await noScroll(page), T('kanji card: no horizontal scroll'));
  await page.screenshot({ path: path.join(OUT, `kanji-card-${width}.png`) });
  await page.evaluate(() => { window.__fail = true; });
  await page.click('.kc-assoc [data-as-ai]');
  await page.waitForSelector('.kc-assoc .ask-err', { timeout: 5000 }).catch(() => {});
  ok(/Не вдалося отримати відповідь/.test(await page.textContent('.kc-assoc').catch(() => '')), T('AI error: Ukrainian message, note kept'));
  ok((await page.textContent('.kc-assoc .as-note')).includes('сперлася'), T('note kept after an AI error'));
  const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('jp.kanjiNotes'))[id], K.id);
  ok(stored?.t.includes('сперлася') && stored.at > 0, T('note stored with time (for sync)'));
  // writing mode: the note as a hint, the kanji masked while recalling (a due kanji)
  await page.evaluate(id => { localStorage.setItem('jp.kanjiWrite', JSON.stringify({ [id]: { due: Date.now() - 1000, interval: 600e3, rating: 'good', reps: 1, last: Date.now() - 900e3 } })); }, K.id);
  await page.goto(BASE + `#/kanji/write/${L.id}/${K.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.as-hint', { timeout: 5000 }).catch(() => {});
  const hint = await page.$eval('.as-hint p', e => e.innerHTML).catch(() => '');
  ok(hint.includes('kw-mask') && !hint.includes('休'), T('writing mode: note hint with the kanji masked'), hint);
  await page.screenshot({ path: path.join(OUT, `write-hint-${width}.png`) });
  ok(!errs.length, T('kanji: no page errors'), errs.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
fs.writeFileSync(path.join(OUT, 'report.md'), `# Achievements QA\n\n${passed} checks passed, ${issues.length} failed.\n\n${issues.map(i => `- ${i}`).join('\n')}\n`);
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL ACHIEVEMENT UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
