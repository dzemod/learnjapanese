// Browser QA of the exam's AI helper (1920 and 375 px). /api/ask is mocked, so no key and no network to Google.
//   npm i --no-save playwright-core   (or QA_MODULES=<dir with node_modules>), Chrome installed
//   node tools/qa-ask-ui.mjs          → screenshots in qa/ask/
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/ask');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, 'site', p);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
});
await new Promise(r => srv.listen(0, r));
const URL_ = `http://localhost:${srv.address().port}/`;

let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (process.env.QA_VERBOSE) console.log(new Date().toISOString().slice(11, 19), name); if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const FAIL = 'Не вдалося отримати відповідь, спробуйте ще раз';
const LIMIT = 'Ліміт безкоштовних запитів вичерпано, спробуйте пізніше';

const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [kind, width, height] of [['desktop', 1920, 1080], ['mobile', 375, 780]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: kind === 'mobile', isMobile: kind === 'mobile', locale: 'uk-UA' });
  await ctx.addInitScript(() => { try { localStorage.setItem('jp.pw', 'test'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
  page.on('dialog', d => d.accept());
  // mock of /api/ask: the test sets the next reply and can hold it to look at the loading state
  const api = { requests: [], reply: { status: 200, body: { answer: 'Тут потрібна **は**: 私(わたし)は — тема речення.\nУрок 1.', truncated: false } }, hold: null };
  await page.route('**/api/ask', async route => {
    api.requests.push(JSON.parse(route.request().postData()));
    if (api.hold) await api.hold;
    await route.fulfill({ status: api.reply.status, contentType: 'application/json', body: JSON.stringify(api.reply.body) });
  });
  const layout = async step => {
    const r = await page.evaluate(() => {
      const w = document.documentElement.clientWidth, out = [];
      if (document.documentElement.scrollWidth > w + 1) out.push(`page ${document.documentElement.scrollWidth} > ${w}`);
      for (const el of document.querySelectorAll('.ask-zone, .ask-zone *')) {
        const b = el.getBoundingClientRect();
        if (b.width && (b.right > w - 15.5 || b.left < 15.5)) out.push(`${el.tagName}.${el.className} ${Math.round(b.left)}–${Math.round(b.right)}`);
      }
      return out.slice(0, 5);
    });
    ok(!r.length, T(`layout, no horizontal scroll, 16 px gutter: ${step}`), r.join('; '));
    ok(!errs.length, T(`no console errors: ${step}`), errs.join(' | '));
    errs.length = 0;
  };
  const session = () => page.evaluate(() => sessionStorage.getItem('jp.examSession'));
  const results = () => page.evaluate(() => localStorage.getItem('jp.examHistory'));
  const log = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examAsk') || '[]'));
  const startExam = async () => {
    await page.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'I', from: 1, to: 5, tsAdded: true, wtAdded: true, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: ['p'], count: 3, mock: false, timer: 30 }));
      sessionStorage.removeItem('jp.examSession');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-start]');
    await page.locator('[data-start]').click();
    await page.waitForSelector('.ex-answer .choice');
  };

  // ---------- normal exam ----------
  await startExam();
  ok(await page.locator('.ask-block textarea').count() === 1, T('«Запитай ШІ» block is there before answering'));
  ok(await page.locator('.ask-open').count() === 0, T('no «Чому так?» before answering'));
  await layout('question');
  const q0 = await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); return S.qs[S.i]; });
  const wrongChoice = page.locator(`.ex-answer .choice:not([data-v="${q0.answer}"])`).first();
  const given = await wrongChoice.getAttribute('data-v');
  await wrongChoice.click();
  await page.waitForSelector('.ask-open');
  ok((await page.locator('.ask-open').innerText()).includes('Чому так? Запитати ШІ'), T('button text'));
  const before = { session: await session(), results: await results() };
  await page.locator('.ask-open').click();
  const ctxText = await page.locator('.ask-panel .ask-text').innerText();
  for (const [what, needle] of [['section', 'Частки'], ['lesson', `Урок: ${q0.lesson}`], ['learner answer', `Відповідь учня: ${given}`], ['result', 'неправильно'], ['correct answer', 'Правильна відповідь:'], ...q0.options.map(o => [`option ${o.v}`, o.v])]) ok(ctxText.includes(needle), T(`context has the ${what}`), ctxText);
  ok(ctxText.length <= 800, T('context fits the limit'), ctxText.length);
  await layout('panel open');
  await page.screenshot({ path: `${OUT}/${kind}-panel.png`, fullPage: true });

  // loading state, then the answer; the mock's text must be escaped
  let release;
  api.hold = new Promise(r => (release = r));
  await page.locator('.ask-panel .ask-send').click();
  await page.waitForSelector('.ask-panel .spinner');
  ok(await page.locator('.ask-panel .ask-send').isDisabled(), T('button disabled while waiting'));
  ok(await page.locator('.ask-block .ask-send').isDisabled(), T('bottom button disabled too: one request at a time'));
  await page.screenshot({ path: `${OUT}/${kind}-loading.png`, fullPage: true });
  release(); api.hold = null;
  await page.waitForSelector('.ask-panel .ask-msg.ai');
  ok(!(await page.locator('.ask-panel .ask-send').isDisabled()), T('button enabled again'));
  const req = api.requests.at(-1);
  ok(req.password === 'test' && req.context === ctxText && req.question.length > 0, T('request carries question, context and password'), JSON.stringify(req).slice(0, 200));
  ok(req.question.length + req.context.length <= 1000, T('request is within 1000 characters'));
  ok((await page.locator('.ask-panel .ask-msg b').innerText()) === 'は', T('**bold** of the answer'));
  await layout('answer');
  ok((await session()) === before.session, T('session (scoring, timer) untouched by the helper'));
  ok((await results()) === before.results, T('history untouched by the helper'));

  // Enter inside the helper must not move the exam to the next question (the exam listens for Enter on the document)
  const iBefore = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')).i);
  await page.locator('.ask-panel textarea').fill('x');
  await page.locator('.ask-panel textarea').press('Enter');
  await page.locator('.ask-open').press('Enter');
  await page.waitForTimeout(100);
  ok((await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')).i)) === iBefore, T('Enter in the helper does not skip the question'));

  // errors: exactly the agreed text, and the typed question is kept
  await page.locator('.ask-block textarea').fill('Що таке は?');
  for (const [status, body, text] of [[429, { code: 'quota', error: LIMIT }, LIMIT], [502, { code: 'upstream', error: FAIL }, FAIL], [404, null, FAIL]]) {
    api.reply = { status, body };
    await page.locator('.ask-block .ask-send').click();
    await page.waitForSelector('.ask-block .ask-err');
    ok((await page.locator('.ask-block .ask-err').innerText()) === text, T(`error text for ${status}`));
    ok((await page.locator('.ask-block textarea').inputValue()) === 'Що таке は?', T(`question kept after ${status}`));
  }
  await layout('error');
  // free-form question: no context; markup in the answer is shown as text
  api.reply = { status: 200, body: { answer: '<img src=x onerror="window.__xss=1"> は — тема.', truncated: true } };
  await page.locator('.ask-block .ask-send').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ask-block .ask-msg.ai')].some(m => m.textContent.includes('обрізано')));
  ok(api.requests.at(-1).context === '', T('free-form question has no context'));
  ok((await page.locator('.ask-block textarea').inputValue()) === '', T('box cleared after success'));
  ok(await page.evaluate(() => !window.__xss && !document.querySelector('.ask-msg img')), T('the answer cannot inject markup'));
  ok((await page.locator('.ask-block .ask-msg.ai').last().innerText()).includes('обрізано'), T('truncated answer is marked'));

  // only the last 5 messages are kept, and they survive the next question
  for (let i = 0; i < 2; i++) {
    await page.locator('.ask-block textarea').fill(`Питання ${i}`);
    await page.locator('.ask-block .ask-send').click();
    await page.waitForFunction(n => [...document.querySelectorAll('.ask-block .ask-msg.me')].some(m => m.textContent === n), `Питання ${i}`);
  }
  ok((await log()).length === 5, T('5 messages kept'), (await log()).length);
  ok(await page.locator('.ask-block .ask-msg').count() === 5, T('5 messages shown'));
  await page.locator('.ask-block textarea').fill('чернетка');
  await page.locator('[data-next]').click();
  await page.waitForSelector('.ex-answer .choice');
  ok(await page.locator('.ask-block .ask-msg').count() === 5, T('messages stay on the next question'));
  ok((await page.locator('.ask-block textarea').inputValue()) === 'чернетка', T('draft stays on the next question'));
  await page.screenshot({ path: `${OUT}/${kind}-history.png`, fullPage: true });

  // a correct answer gets the button too; then the results page
  api.reply = { status: 200, body: { answer: 'Так, правильно.', truncated: false } };
  for (let i = 0; i < 2; i++) {
    const q = await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); return S.qs[S.i]; });
    await page.locator(`.ex-answer .choice[data-v="${q.answer}"]`).click();
    await page.waitForSelector('.ask-open');
    ok(await page.locator('.ask-open').count() === 1, T('button after a correct answer'));
    await page.locator('[data-next]').click();
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('.results');
  ok((await page.locator('.results').innerText()).includes('2 з 3'), T('score is 2 of 3 after 1 wrong answer + helper use'), await page.locator('.results').innerText());
  ok(await page.locator('.ex-mistake .ask-open').count() === 1, T('button on the mistake in the results'));
  await page.locator('.ex-mistake .ask-open').click();
  await page.locator('.ex-mistake .ask-send').click();
  await page.waitForSelector('.ex-mistake .ask-msg.ai');
  ok(await page.locator('.ask-block').count() === 1, T('block on the results page'));
  await layout('results');
  await page.screenshot({ path: `${OUT}/${kind}-results.png`, fullPage: true });

  // the typed task types have their own feedback code
  for (const [type, form] of [['ts', '.ex-sentform'], ['wt', '.ex-wtform']]) {
    await page.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
    await page.evaluate(t => {
      localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'I', from: 1, to: 5, tsAdded: true, wtAdded: true, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: [t], count: 2, mock: false, timer: 0 }));
      sessionStorage.removeItem('jp.examSession');
    }, type);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-start]');
    await page.locator('[data-start]').click();
    await page.waitForSelector(form);
    await page.locator('[data-dk]').click();
    await page.waitForSelector('.ask-open');
    await page.locator('.ask-open').click();
    const c = await page.locator('.ask-panel .ask-text').innerText();
    ok(c.includes('Відповідь учня: без відповіді') && /Правильна відповідь: \S/.test(c), T(`${type}: context`), c);
    await layout(`${type} panel`);
  }

  // ---------- university version ----------
  await page.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', univ: true, part: 'I', from: 1, to: 5, tsAdded: true, wtAdded: true, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: ['p'], count: 3, mock: false, timer: 0 }));
    sessionStorage.removeItem('jp.examSession');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-start]');
  if (!(await page.locator('.ex-univ.on').count())) await page.locator('.ex-univ').click();
  await page.locator('[data-start]').click();
  await page.waitForSelector('.u-paper');
  ok(await page.locator('.u-paper .ask-block').count() === 1, T('block on the paper'));
  await layout('paper');
  const uBefore = await session();
  await page.locator('.ask-block textarea').fill('Що таке か?');
  await page.locator('.ask-block .ask-send').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ask-block .ask-msg.me')].some(m => m.textContent === 'Що таке か?'));
  ok((await session()) === uBefore, T('paper session untouched by the helper'));
  const firstIn = page.locator('.u-in').first();
  await firstIn.fill('は');
  await page.locator('.u-paper [data-check]').click();
  await page.waitForSelector('.u-result');
  ok(await page.locator('.u-result .ex-mistake .ask-open').count() === await page.locator('.u-result .ex-mistake').count(), T('button on every mistake of the paper'));
  await page.locator('.ex-mistake .ask-open').first().click();
  const uCtx = await page.locator('.ex-mistake .ask-text').first().innerText();
  ok(uCtx.includes('Університетська версія') && uCtx.includes('Правильна відповідь:') && uCtx.includes('Урок:'), T('paper context'), uCtx);
  await page.locator('.ex-mistake .ask-send').first().click();
  await page.waitForSelector('.ex-mistake .ask-msg.ai');
  ok(await page.locator('.u-result .ask-block').count() === 1, T('block on the paper results'));
  await layout('paper results');
  await page.screenshot({ path: `${OUT}/${kind}-univ-results.png`, clip: { x: 0, y: 0, width, height: 1500 }, fullPage: true });
  await ctx.close();

  // ---------- no password yet: asked once, Enter in the dialog must not skip the question ----------
  const ctx2 = await browser.newContext({ viewport: { width, height }, locale: 'uk-UA' });
  const p2 = await ctx2.newPage();
  const seen = [];
  await p2.route('**/api/ask', async route => {
    const b = JSON.parse(route.request().postData());
    seen.push(b.password);
    const good = b.password === 'right';
    await route.fulfill({ status: good ? 200 : 401, contentType: 'application/json', body: JSON.stringify(good ? { answer: 'ок' } : { code: 'bad_password', error: 'Неправильний пароль. Спробуйте ще раз.' }) });
  });
  await p2.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
  await p2.evaluate(() => localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'I', from: 1, to: 5, tsAdded: true, wtAdded: true, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: ['p'], count: 3, mock: false, timer: 0 })));
  await p2.reload({ waitUntil: 'networkidle' });
  await p2.waitForSelector('[data-start]');
  await p2.locator('[data-start]').click();
  await p2.waitForSelector('.ex-answer .choice');
  await p2.locator('.ex-answer .choice').first().click();
  await p2.waitForSelector('[data-next]');
  const i0 = await p2.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')).i);
  await p2.locator('.ask-open').click();
  await p2.locator('.ask-panel .ask-send').click();
  await p2.waitForSelector('.modal input[type=password]');
  ok((await p2.locator('.modal h2').innerText()).includes('ШІ'), T('the dialog says what the password is for'));
  await p2.locator('.modal input[type=password]').fill('wrong');
  await p2.locator('.modal input[type=password]').press('Enter');
  await p2.waitForSelector('.ask-panel .ask-err');
  ok(seen.at(-1) === 'wrong' && (await p2.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')).i)) === i0, T('Enter in the password dialog submits it and does not skip the question'));
  ok((await p2.locator('.ask-panel .ask-err').innerText()).includes('Неправильний пароль'), T('wrong password message'));
  await p2.locator('.ask-panel .ask-send').click();
  await p2.waitForSelector('.modal input[type=password]');
  await p2.locator('.modal input[type=password]').fill('right');
  await p2.locator('.modal input[type=password]').press('Enter');
  await p2.waitForSelector('.ask-panel .ask-msg.ai');
  ok(seen.at(-1) === 'right', T('asked again after a wrong password'));
  await ctx2.close();

  // ---------- sessionStorage unavailable: the helper still works ----------
  const ctx3 = await browser.newContext({ viewport: { width, height }, locale: 'uk-UA' });
  await ctx3.addInitScript(() => {
    try { localStorage.setItem('jp.pw', 'test'); } catch { /* */ }
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('storage blocked'); } });
  });
  const p3 = await ctx3.newPage();
  const errs3 = [];
  p3.on('pageerror', e => errs3.push(String(e)));
  await p3.route('**/api/ask', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'працює' }) }));
  await p3.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
  await p3.evaluate(() => localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'I', from: 1, to: 5, tsAdded: true, wtAdded: true, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: ['p'], count: 3, mock: false, timer: 0 })));
  await p3.reload({ waitUntil: 'networkidle' });
  await p3.waitForSelector('[data-start]');
  await p3.locator('[data-start]').click();
  await p3.waitForSelector('.ask-block textarea');
  await p3.locator('.ask-block textarea').fill('Питання');
  await p3.locator('.ask-block .ask-send').click();
  await p3.waitForSelector('.ask-block .ask-msg.ai');
  ok((await p3.locator('.ask-block .ask-msg.ai').innerText()) === 'працює', T('works without sessionStorage'));
  ok(!errs3.length, T('no errors without sessionStorage'), errs3.join(' | '));
  await ctx3.close();
}
await browser.close();
srv.close();
console.log(`qa-ask-ui: ${passed} passed, ${issues.length} failed`);
process.exit(issues.length ? 1 : 0);
