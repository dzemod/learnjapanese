// Browser QA of the exam's AI helper (1920 and 375 px). The Puter.js script (https://js.puter.com/v2/) is replaced by a
// mock, so nothing reaches Puter and no account is needed. The mock is steered through window.__pm:
//   signedIn, signIn ('ok' | 'cancel' | 'blocked'), reply { text | parts | reject }, queue [one-off replies], hold, calls
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
const SIGNIN = 'Щоб отримати пояснення, увійдіть у безкоштовний акаунт Puter';
const PUTER = /^https:\/\/js\.puter\.com\/v2\//;

// The mock SDK: the documented calls only (auth.isSignedIn, auth.signIn, ai.chat(messages, testMode, options)).
const MOCK = `(() => {
  const M = window.__pm = Object.assign({ signedIn: false, signIn: 'ok', reply: { text: 'ок' }, queue: [], calls: [], signIns: 0, hold: null }, window.__pm || {});
  window.puter = {
    auth: {
      isSignedIn: () => M.signedIn,
      signIn: async () => {
        M.signIns++;
        if (M.signIn === 'ok') { M.signedIn = true; return { success: true }; }
        throw M.signIn === 'blocked' ? { error: 'popup_blocked', msg: 'Popup blocked' } : { error: 'auth_window_closed', msg: 'The user closed the window' };
      },
    },
    ai: {
      chat: async (messages, testMode, options) => {
        M.calls.push({ messages, testMode, options });
        if (M.hold) await M.hold;
        const r = M.queue.length ? M.queue.shift() : M.reply;
        if (r.reject) throw r.reject;
        return { message: { role: 'assistant', content: r.parts || r.text } };
      },
    },
  };
})();`;
const mockPuter = async (ctx, init = {}) => {
  await ctx.addInitScript(s => { window.__pm = s; }, init);
  await ctx.route(PUTER, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK }));
};
const PRESET = (extra = {}) => JSON.stringify({ name: '', part: 'I', from: 1, to: 5, tsAdded: true, wtAdded: true, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: ['p'], count: 3, mock: false, timer: 0, ...extra });
const startOn = async (page, extra) => {
  await page.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
  await page.evaluate(p => { localStorage.setItem('jp.examPresets.last', p); sessionStorage.removeItem('jp.examSession'); }, PRESET(extra));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-start]');
  await page.locator('[data-start]').click();
  await page.waitForSelector('.ex-answer .choice');
};

const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [kind, width, height] of [['desktop', 1920, 1080], ['mobile', 375, 780]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: kind === 'mobile', isMobile: kind === 'mobile', locale: 'uk-UA' });
  await mockPuter(ctx, { signedIn: true, reply: { text: 'Тут потрібна **は**: 私(わたし)は — тема речення.\nУрок 1.' } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|^ask: /.test(m.text())) errs.push(m.text()); });
  page.on('dialog', d => d.accept());
  const pm = () => page.evaluate(() => ({ calls: window.__pm.calls, signIns: window.__pm.signIns }));
  const setPm = v => page.evaluate(v => Object.assign(window.__pm, v), v);
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

  // ---------- the script is loaded only on the Exam tab, with defer ----------
  await page.goto(URL_ + '#/', { waitUntil: 'networkidle' });
  ok(await page.locator('script[src*="puter.com"]').count() === 0, T('no Puter.js on the Words tab'));
  await page.goto(URL_ + '#/grammar', { waitUntil: 'networkidle' });
  ok(await page.locator('script[src*="puter.com"]').count() === 0, T('no Puter.js on the Grammar tab'));

  // ---------- normal exam ----------
  await startOn(page, { timer: 30 });
  ok(await page.locator('script[src="https://js.puter.com/v2/"][defer]').count() === 1, T('Puter.js loaded once on the Exam tab, with defer'));
  ok(await page.locator('.ask-block textarea').count() === 1, T('«Запитай ШІ» block is there before answering'));
  ok(await page.locator('.ask-block [aria-live="polite"]').count() === 1, T('answer area has aria-live'));
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

  // loading state, then the answer
  await page.evaluate(() => { window.__pm.hold = new Promise(r => (window.__release = r)); });
  await page.locator('.ask-panel .ask-send').click();
  await page.waitForSelector('.ask-panel .spinner');
  ok(await page.locator('.ask-panel .ask-send').isDisabled(), T('button disabled while waiting'));
  ok(await page.locator('.ask-block .ask-send').isDisabled(), T('bottom button disabled too: one request at a time'));
  await page.screenshot({ path: `${OUT}/${kind}-loading.png`, fullPage: true });
  await page.evaluate(() => { window.__pm.hold = null; window.__release(); });
  await page.waitForSelector('.ask-panel .ask-msg.ai');
  ok(!(await page.locator('.ask-panel .ask-send').isDisabled()), T('button enabled again'));
  const call = (await pm()).calls.at(-1);
  const [sys, user] = call.messages;
  ok(sys.role === 'system' && /Minna no Nihongo/.test(sys.content) && /Answer in Ukrainian/.test(sys.content) && /only in kana/.test(sys.content) && /contact the developer/.test(sys.content), T('system prompt sent with the request'), sys.content.slice(0, 80));
  ok(user.role === 'user' && user.content.startsWith(ctxText) && user.content.includes('Запитання учня: Поясни'), T('user message carries context and question'), user.content.slice(0, 120));
  ok(call.testMode === false && call.options.model === 'claude-haiku-5-5' && call.options.max_tokens > 0, T('documented call: chat(messages, false, { model, max_tokens })'), JSON.stringify(call.options));
  ok((await pm()).signIns === 0, T('no sign-in when already signed in'));
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

  // errors: exactly the agreed text, the typed question is kept, the fallback model is tried once
  await page.locator('.ask-block textarea').fill('Що таке は?');
  for (const [name, setup, text, calls] of [
    ['model unavailable', { queue: [{ reject: { error: { code: 'model_not_found', message: 'no such model' } } }, { reject: { error: { code: 'model_not_found', message: 'no such model' } } }] }, FAIL, 2],
    ['service error', { queue: [{ reject: new Error('500 Internal') }, { reject: new Error('500 Internal') }] }, FAIL, 2],
    ['empty answer', { queue: [{ text: '' }, { text: '' }] }, FAIL, 2],
    ['auth error from chat', { queue: [{ reject: { error: { code: 'token_auth_failed', message: 'auth' } } }] }, SIGNIN, 1],
  ]) {
    const n0 = (await pm()).calls.length;
    await setPm(setup);
    await page.locator('.ask-block .ask-send').click();
    await page.waitForSelector('.ask-block .ask-err');
    ok((await page.locator('.ask-block .ask-err').innerText()) === text, T(`error text: ${name}`), await page.locator('.ask-block .ask-err').innerText());
    ok((await pm()).calls.length - n0 === calls, T(`${name}: ${calls} model call(s)`), (await pm()).calls.length - n0);
    ok((await page.locator('.ask-block textarea').inputValue()) === 'Що таке は?', T(`question kept after: ${name}`));
  }
  const fb = (await pm()).calls.slice(-3, -1).map(c => c.options.model);
  ok(fb[0] === 'claude-haiku-5-5' && fb[1] === 'gpt-5.4-nano', T('fallback model after a failure'), fb.join(', '));
  await layout('error');
  // the fallback answers; a list of parts is read too; markup in the answer is shown as text
  await setPm({ queue: [{ reject: new Error('busy') }, { parts: [{ type: 'text', text: '<img src=x onerror="window.__xss=1"> は — ' }, { type: 'text', text: 'тема.' }] }] });
  await page.locator('.ask-block .ask-send').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ask-block .ask-msg.ai')].some(m => m.textContent.includes('тема.')));
  ok(!(await pm()).calls.at(-1).messages[1].content.includes('Розділ:'), T('free-form question has no context'));
  ok((await page.locator('.ask-block textarea').inputValue()) === '', T('box cleared after success'));
  ok(await page.evaluate(() => !window.__xss && !document.querySelector('.ask-msg img')), T('the answer cannot inject markup'));

  // only the last 5 messages are kept, and they survive the next question
  await setPm({ reply: { text: 'Так.' } });
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
  ok(await page.locator('script[src*="puter.com"]').count() === 1, T('Puter.js is not added twice'));
  await layout('results');
  await page.screenshot({ path: `${OUT}/${kind}-results.png`, fullPage: true });

  // the typed task types have their own feedback code
  for (const [type, form] of [['ts', '.ex-sentform'], ['wt', '.ex-wtform']]) {
    await page.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
    await page.evaluate(p => { localStorage.setItem('jp.examPresets.last', p); sessionStorage.removeItem('jp.examSession'); }, PRESET({ types: [type], count: 2 }));
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
  await page.evaluate(p => { localStorage.setItem('jp.examPresets.last', p); sessionStorage.removeItem('jp.examSession'); }, PRESET({ univ: true }));
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
  await page.locator('.u-in').first().fill('は');
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

  // ---------- grammar lessons: the same block at the bottom of every lesson ----------
  const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/grammar.json'), 'utf8')).lessons;
  await page.evaluate(() => { for (const k of Object.keys(sessionStorage)) if (k.startsWith('jp.ask.grammar.')) sessionStorage.removeItem(k); });
  for (const n of [1, 26, 50]) {
    const L = G.find(l => l.lesson === n);
    await page.goto(URL_ + `#/grammar/${n}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.grammar-lesson .ask-block');
    ok(await page.locator('.g-card').count() === L.points.length, T(`grammar ${n}: all points shown`));
    ok(await page.locator('.ask-block').count() === 1 && await page.evaluate(() => { const b = document.querySelector('.grammar-lesson .ask-block'); return b.nextElementSibling?.classList.contains('g-pager') && b.previousElementSibling?.classList.contains('g-cards'); }), T(`grammar ${n}: block between the lesson content and the pager`));
    ok(await page.locator('script[src="https://js.puter.com/v2/"][defer]').count() === 1, T(`grammar ${n}: Puter.js loaded once, with defer`));
    ok(await page.locator('.ask-block [aria-live="polite"]').count() === 1, T(`grammar ${n}: aria-live`));
    ok(await page.locator('.ask-block .ask-select option').count() === L.points.length + 1, T(`grammar ${n}: «Увесь урок» + every point in the select`));
    ok((await page.locator('.ask-block textarea').inputValue()) === '' && await page.locator('.ask-block .ask-text').count() === 0, T(`grammar ${n}: no exam question when not coming from the exam`));
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ask-block textarea')).fontFamily === getComputedStyle(document.querySelector('.g-ja')).fontFamily), T(`grammar ${n}: textarea uses the Japanese font stack`), await page.evaluate(() => getComputedStyle(document.querySelector('.ask-block textarea')).fontFamily + ' | ' + getComputedStyle(document.querySelector('.g-ja')).fontFamily));
    // a question about the whole lesson
    await page.locator('.ask-block textarea').fill(`Питання про урок ${n}`);
    await page.locator('.ask-block .ask-send').click();
    await page.waitForFunction(q => [...document.querySelectorAll('.ask-block .ask-msg.me')].some(m => m.textContent === q), `Питання про урок ${n}`);
    let c = (await pm()).calls.at(-1);
    ok(c.messages[0].content.startsWith('You are a patient Japanese teacher') && /Answer in Ukrainian/.test(c.messages[0].content) && /only in kana/.test(c.messages[0].content), T(`grammar ${n}: same rules in the system prompt`));
    ok(c.messages[0].content.includes(`Minna no Nihongo, урок ${n}. Пункти:`) && L.points.every((p, i) => c.messages[0].content.includes(`Урок ${n}, пункт ${i + 1}:`)), T(`grammar ${n}: whole lesson in the system prompt`));
    ok(c.messages[1].content === `Питання про урок ${n}`, T(`grammar ${n}: user message = the question`), c.messages[1].content);
    // a question about one point: title, textbook explanation, examples and «Детальніше»
    const pi = L.points.length > 1 ? 1 : 0, P = L.points[pi];
    await page.locator('.ask-block .ask-select').selectOption(String(pi + 1));
    await page.locator('.ask-block .ask-ctx summary').click();
    ok((await page.locator('.ask-block .ask-note').innerText()).includes(`пункт ${pi + 1}`), T(`grammar ${n}: «Що побачить ШІ» follows the select`));
    await page.locator('.ask-block textarea').fill('Поясни цей пункт');
    const nCalls = (await pm()).calls.length;
    await page.locator('.ask-block .ask-send').click();
    await page.waitForFunction(k => window.__pm.calls.length === k, nCalls + 1);
    c = (await pm()).calls.at(-1);
    const sys = c.messages[0].content, plain = s => String(s).replace(/\{([^|}]+)\|([^}]+)\}/g, '$1($2)');
    const ex = P.blocks.find(b => b.ex != null), para = P.blocks.find(b => b.p), det = (P.details || []).find(b => b.p || b.ex);
    ok(sys.includes(`Урок ${n}, пункт ${pi + 1}: ${plain(P.title)}`) && !sys.includes(`Урок ${n}, пункт ${pi + 2}:`), T(`grammar ${n}: point title, only that point`));
    ok(!para || sys.includes(plain(para.p)), T(`grammar ${n}: textbook explanation`));
    ok(!ex || (sys.includes(plain(ex.ex)) && (!ex.uk || sys.includes(plain(ex.uk)))), T(`grammar ${n}: example with translation`));
    ok(!det || (sys.includes('Детальніше') && sys.includes(plain(det.p ?? det.ex))), T(`grammar ${n}: «Детальніше» text`), det ? 'missing' : '');
    ok(!/\{[^|}]+\|/.test(sys), T(`grammar ${n}: no furigana markup left in the material`));
    await page.waitForFunction(() => document.querySelectorAll('.ask-block .ask-msg.ai').length >= 2);
    const lg = await page.evaluate(k => JSON.parse(sessionStorage.getItem(k) || '[]'), `jp.ask.grammar.${n}`);
    ok(lg.length === 4, T(`grammar ${n}: own history in sessionStorage`), lg.length);
    // the lesson itself still works: «Детальніше», collapse, pager
    const more = page.locator('.g-more').first();
    await more.locator('summary').click();
    ok(await more.evaluate(d => d.open), T(`grammar ${n}: «Детальніше» opens`));
    await page.locator('[data-toggle]').click();
    ok(await page.evaluate(() => [...document.querySelectorAll('.g-card')].every(d => !d.open)), T(`grammar ${n}: «Згорнути все»`));
    await page.locator('[data-toggle]').click();
    await layout(`grammar ${n}`);
    await page.screenshot({ path: `${OUT}/${kind}-grammar-${n}.png`, fullPage: true });
    await page.locator('.grammar-lesson .ask-block').screenshot({ path: `${OUT}/${kind}-grammar-${n}-block.png` });
    const nextL = G.find(l => l.lesson > n), prevL = G.filter(l => l.lesson < n).at(-1);
    const go = nextL || prevL;
    await page.locator(`.g-pager a[href="#/grammar/${go.lesson}"]`).click();
    await page.waitForFunction(h => location.hash === h && document.querySelector('.set-title')?.textContent.includes(`Урок ${h.split('/')[2]} `), `#/grammar/${go.lesson}`);
    await page.waitForSelector('.grammar-lesson .ask-block');
    ok(await page.locator('.ask-block .ask-msg').count() === 0, T(`grammar ${n} → ${go.lesson}: pager works, the other lesson has its own (empty) history`));
  }
  await page.goto(URL_ + '#/grammar/1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.grammar-lesson .ask-block .ask-msg');
  ok(await page.locator('.ask-block .ask-msg').count() === 4, T('grammar 1: history is back on return'));
  await page.goto(URL_ + '#/grammar/1/1-2', { waitUntil: 'networkidle' });
  await page.waitForSelector('.grammar-lesson .ask-block');
  ok((await page.locator('.ask-block .ask-select').inputValue()) === '2', T('a link to a point preselects that point'));

  // ---------- exam → reference link → grammar: the question goes with it ----------
  await startOn(page);
  const qx = await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); return S.qs[S.i]; });
  await page.locator(`.ex-answer .choice:not([data-v="${qx.answer}"])`).first().click();
  await page.waitForSelector('.ex-ref');
  await page.locator('.ex-ref').first().click();
  await page.waitForSelector('.grammar-lesson .ask-block');
  const gctx = await page.locator('.ask-block .ask-text').innerText();
  ok(gctx.includes('Розділ: Частки') && gctx.includes('неправильно') && gctx.includes(`Урок: ${qx.lesson}`), T('exam question shown in the grammar block'), gctx);
  ok((await page.locator('.ask-block textarea').inputValue()).startsWith('Поясни, будь ласка'), T('exam prefill in the grammar block'));
  ok(await page.locator('#exam-return').count() === 1, T('«Повернутися до екзамену» still there'));
  await page.locator('.ask-block .ask-send').click();
  await page.waitForFunction(() => document.querySelectorAll('.ask-block .ask-msg.ai').length > 0);
  const cx = (await pm()).calls.at(-1);
  ok(cx.messages[1].content.startsWith(gctx) && cx.messages[0].content.includes('Minna no Nihongo') && /Урок \d+, пункт \d+:/.test(cx.messages[0].content), T('exam question in the user message + lesson material in the system prompt'));
  await layout('grammar from exam');
  await page.locator('#exam-return').click();
  await page.waitForSelector('[data-next]');
  ok(await page.locator('#exam-return').count() === 0, T('back in the exam'));
  await ctx.close();

  // ---------- not signed in: cancelled / blocked sign-in, then a successful one ----------
  const ctx2 = await browser.newContext({ viewport: { width, height }, locale: 'uk-UA' });
  await mockPuter(ctx2, { signedIn: false, signIn: 'cancel', reply: { text: 'Пояснення після входу.' } });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(String(e)));
  await startOn(p2);
  await p2.locator('.ex-answer .choice').first().click();
  await p2.waitForSelector('[data-next]');
  const i0 = await p2.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')).i);
  await p2.locator('.ask-open').click();
  await p2.locator('.ask-panel .ask-send').click();
  await p2.waitForSelector('.ask-panel .ask-err');
  const st2 = await p2.evaluate(() => ({ signIns: window.__pm.signIns, calls: window.__pm.calls.length }));
  ok((await p2.locator('.ask-panel .ask-err').innerText()) === SIGNIN, T('cancelled sign-in: the sign-in message'));
  ok(st2.signIns === 1 && st2.calls === 0, T('cancelled sign-in: no model call'), JSON.stringify(st2));
  ok(await p2.locator('.modal').count() === 0, T('no password dialog for the helper'));
  ok((await p2.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')).i)) === i0, T('cancelled sign-in does not move the exam'));
  await p2.evaluate(() => { window.__pm.signIn = 'blocked'; });
  await p2.locator('.ask-panel .ask-send').click();
  await p2.waitForFunction(() => window.__pm.signIns === 2);
  await p2.waitForSelector('.ask-panel .ask-err');
  ok((await p2.locator('.ask-panel .ask-err').innerText()) === SIGNIN, T('blocked popup: the sign-in message'));
  // the rest of the exam keeps working
  await p2.locator('[data-next]').click();
  await p2.waitForSelector('.ex-answer .choice');
  ok((await p2.evaluate(() => JSON.parse(sessionStorage.getItem('jp.examSession')).i)) === i0 + 1, T('the exam goes on after a cancelled sign-in'));
  await p2.evaluate(() => { window.__pm.signIn = 'ok'; });
  await p2.locator('.ask-block textarea').fill('Що таке を?');
  await p2.locator('.ask-block .ask-send').click();
  await p2.waitForSelector('.ask-block .ask-msg.ai');
  ok((await p2.locator('.ask-block .ask-msg.ai').innerText()) === 'Пояснення після входу.', T('signed in on click, then the answer'));
  ok(await p2.evaluate(() => window.__pm.signIns === 3 && window.__pm.signedIn), T('sign-in asked once more, now done'));
  await p2.locator('.ask-block textarea').fill('Ще одне');
  await p2.locator('.ask-block .ask-send').click();
  await p2.waitForFunction(() => window.__pm.calls.length === 2);
  ok(await p2.evaluate(() => window.__pm.signIns === 3), T('no sign-in again once signed in'));
  ok(!errs2.length, T('no page errors in the sign-in path'), errs2.join(' | '));
  await ctx2.close();

  // ---------- Puter.js cannot be loaded (offline, blocked): the message, and the exam still works ----------
  const ctx4 = await browser.newContext({ viewport: { width, height }, locale: 'uk-UA' });
  await ctx4.route(PUTER, route => route.abort());
  const p4 = await ctx4.newPage();
  const errs4 = [];
  p4.on('pageerror', e => errs4.push(String(e)));
  await startOn(p4);
  await p4.locator('.ask-block textarea').fill('Питання');
  await p4.locator('.ask-block .ask-send').click();
  await p4.waitForSelector('.ask-block .ask-err');
  ok((await p4.locator('.ask-block .ask-err').innerText()) === FAIL, T('no Puter.js: the failure message'));
  await p4.locator('.ex-answer .choice').first().click();
  await p4.waitForSelector('[data-next]');
  ok(!errs4.length, T('no Puter.js: no page errors, the exam works'), errs4.join(' | '));
  await ctx4.close();

  // ---------- sessionStorage unavailable: the helper still works ----------
  const ctx3 = await browser.newContext({ viewport: { width, height }, locale: 'uk-UA' });
  await mockPuter(ctx3, { signedIn: true, reply: { text: 'працює' } });
  await ctx3.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('storage blocked'); } }); });
  const p3 = await ctx3.newPage();
  const errs3 = [];
  p3.on('pageerror', e => errs3.push(String(e)));
  await p3.goto(URL_ + '#/exam', { waitUntil: 'networkidle' });
  await p3.evaluate(p => localStorage.setItem('jp.examPresets.last', p), PRESET());
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
