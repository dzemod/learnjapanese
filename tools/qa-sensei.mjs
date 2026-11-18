// Browser QA of the «Сенсей» tab (#/sensei): navigation, chat with a mocked Puter.js, starters, «Нова розмова»,
// session history, blocked sessionStorage, errors, Enter / Shift+Enter, 1000-character limit.
// Puter.js (https://js.puter.com/v2/) is replaced by a mock (window.__pm) — nothing reaches Puter.
//   npm i --no-save playwright-core sharp kuromoji@0.1.2   (together: npm prunes other --no-save packages)
//   node tools/qa-sensei.mjs        → screenshots in qa/sensei/
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/sensei');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
export function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, 'site', p);
    fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}
// The mock SDK: the documented calls only (auth.isSignedIn, auth.signIn, ai.chat(messages, testMode, options)).
export const MOCK = `(() => {
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
export const mockPuter = async (ctx, init = {}) => {
  await ctx.addInitScript(s => { window.__pm = Object.assign(window.__pm || {}, s); }, init);
  await ctx.route(/^https:\/\/js\.puter\.com\/v2\//, route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: MOCK }));
};

// Transliteration check of a reply: Cyrillic words written next to Japanese — «神道 (шінто)» or «шінто (神道)» —
// must follow the Hepburn-based Ukrainian system (ai-helper.js TRANSLIT): no soft sign, no Polivanov/Kovalenko forms.
const JA_RUN = '[\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f々ー]+';
const CYR_RUN = '[А-ЩЬЮЯІЇЄҐа-щьюяіїєґ’-]+(?: [А-ЩЬЮЯІЇЄҐа-щьюяіїєґ’-]+)?';
const PAIR = new RegExp(`${JA_RUN}\\s*[(（](${CYR_RUN})[)）]|(${CYR_RUN})\\s*[(（]${JA_RUN}[)）]`, 'g');
export const BAD_FORMS = ['ь', 'сь', 'чь', 'джь', 'ць', 'дь', 'тю', 'сьо', 'чьо', 'джьо', 'сі', 'ті', 'дзі', 'ці'];
export function transliterated(text) { return [...String(text).matchAll(PAIR)].map(m => (m[1] || m[2]).toLowerCase()); }
export function translitIssues(text) {
  const out = [];
  for (const w of transliterated(text)) for (const bad of BAD_FORMS) if (w.includes(bad)) out.push(`${w}: ${bad}`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const srv = await serve();
  const URL_ = `http://localhost:${srv.address().port}/`;
  let passed = 0;
  const issues = [];
  const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
  const REPLY = 'Кану краще вчити **щодня** потроху.\nТренуйтеся у вкладці «Слова», урок 1: あ, い, う.';
  const FAIL = 'Не вдалося отримати відповідь, спробуйте ще раз';
  const SIGNIN = 'Щоб поговорити з Сенсеєм, увійдіть у безкоштовний акаунт Puter';
  const LONG = 'Повідомлення надто довге, скоротіть його';
  const STARTERS = ['Як краще вчити кану?', 'Що робити, якщо плутаю は і が?', 'Як не забути канджі?', 'Які фільми подивитися для практики?'];
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

  for (const [kind, width, height] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
    const T = s => `${kind}: ${s}`;
    const phone = kind === 'phone';
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone, locale: 'uk-UA' });
    await mockPuter(ctx, { signedIn: true, reply: { text: REPLY } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|^ask: /.test(m.text())) errs.push(m.text()); });
    const msgs = () => page.$$eval('.ss-list .ss-msg:not(.ss-typing)', els => els.map(e => [e.classList.contains('me') ? 'u' : 'a', e.textContent]));
    const pm = () => page.evaluate(() => ({ calls: window.__pm.calls.length, last: window.__pm.calls.at(-1), signIns: window.__pm.signIns }));
    const status = () => page.$eval('.ss-status', e => e.textContent.trim());

    // navigation
    await page.goto(URL_ + '#/', { waitUntil: 'networkidle' });
    const link = page.locator('.tabs-nav a[data-tab="sensei"]');
    ok(await link.isVisible(), T('tab visible in navigation'));
    ok((await link.textContent()).includes('Сенсей'), T('tab label'));
    await link.click();
    await page.waitForSelector('.sensei');
    ok(page.url().endsWith('#/sensei'), T('tab opens #/sensei'));
    ok(await page.waitForFunction(() => getComputedStyle(document.querySelector('.tabs-nav [data-tab="sensei"]')).backgroundColor === 'rgb(200, 16, 46)', null, { timeout: 2000 }).then(() => true, () => false), T('active tab red'));
    ok((await page.textContent('.ss-sub')).trim() === 'Запитай про навчання чи Японію', T('subtitle'));
    ok(await page.evaluate(w => Math.max(document.documentElement.scrollWidth, innerWidth) <= w, width), T('no horizontal scroll'));

    // starters fill the textarea without sending
    ok((await page.$$eval('.ss-chip', b => b.map(x => x.textContent))).join('|') === STARTERS.join('|'), T('starter questions'));
    for (const q of STARTERS) {
      await page.click(`.ss-chip >> text="${q}"`);
      ok((await page.inputValue('.ss-input')) === q, T('starter fills the input'), q);
    }
    ok((await pm()).calls === 0 && !(await msgs()).length, T('starters do not send'));
    await page.screenshot({ path: path.join(OUT, `${kind}-empty.png`), fullPage: true });

    // send → loading state → reply; input cleared
    await page.evaluate(() => { window.__pm.hold = new Promise(r => (window.__pmRelease = r)); });
    await page.fill('.ss-input', 'Як краще вчити кану?');
    await page.click('.ss-send');
    await page.waitForSelector('.ss-typing');
    ok(await page.isDisabled('.ss-send'), T('send disabled while pending'));
    ok((await page.textContent('.ss-send')).includes('Надсилаю'), T('loading label'));
    ok(await page.evaluate(() => document.querySelector('.sensei').classList.contains('thinking')), T('thinking state'));
    ok((await page.inputValue('.ss-input')) === '', T('input cleared after sending'));
    await page.fill('.ss-input', 'друге');
    await page.click('.ss-send', { force: true }).catch(() => {});
    await page.evaluate(() => { window.__pm.hold = null; window.__pmRelease(); });
    await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
    const m1 = await msgs();
    ok(m1.length === 2 && m1[0][1] === 'Як краще вчити кану?' && m1[1][1].includes('щодня'), T('question and mocked reply in the list'), JSON.stringify(m1));
    ok(await page.$eval('.ss-msg.ai b', b => b.textContent === 'щодня').catch(() => false), T('**bold** rendered'));
    ok((await pm()).calls === 1, T('no second request while pending'), String((await pm()).calls));
    ok(!(await page.isDisabled('.ss-send')), T('send enabled again'));
    const c1 = (await pm()).last;
    ok(c1.messages[0].role === 'system' && c1.messages[0].content.startsWith('You are Сенсей, a patient and warm Japanese mentor'), T('system prompt sent'));
    ok(c1.messages.at(-1).role === 'user' && c1.messages.at(-1).content === 'Як краще вчити кану?', T('question is the last message'));
    // transliteration rule in the prompt (Hepburn-based Ukrainian, no soft sign)
    const sys = c1.messages[0].content;
    for (const s of ['Never write ь in a transliterated Japanese word', 'し = ші, じ = джі, ち = чі, つ = цу, ふ = фу', 'しゃ = ша, しゅ = шу, しょ = шо; じゃ = джа, じゅ = джу, じょ = джо',
      'ちゃ = ча, ちゅ = чу, ちょ = чо', '神道 = шінто', '古事記 = Коджікі', '日本書紀 = Ніхон-шокі', 'ん = н, but м before б, п, м', 'Long vowels are written once'])
      ok(sys.includes(s), T(`prompt: ${s}`));
    if (!phone) {
      // a reply with し じ ち つ しょ ちょ じょ: Polivanov / soft-sign forms are caught, Hepburn-based ones pass
      const GOOD = '神道 (шінто), 古事記 (Коджікі), 日本書紀 (Ніхон-шокі), 一 (ічі), 津 (цу), 富士 (Фуджі), ちょうちん (чочін), 城 (джо), 中華 (чука).';
      const BAD = { 'сінто': '神道', 'Кодзікі': '古事記', 'Ніхон сьокі': '日本書紀', 'ічі': null, 'іті': '一', 'ці': '津', 'чьочін': 'ちょうちん', 'джьо': '城', 'тюка': '中華', 'Шьо': '書', 'Фудзі': '富士' };
      const caught = Object.entries(BAD).filter(([, ja]) => ja).map(([w, ja]) => [w, translitIssues(`${ja} (${w})`).length > 0, translitIssues(`${w} (${ja})`).length > 0]);
      ok(caught.every(([, a, b]) => a && b), T('Polivanov / soft-sign forms are caught'), JSON.stringify(caught.filter(([, a, b]) => !a || !b)));
      for (const bad of ['ь', 'сь', 'чь', 'джь', 'тю', 'сьо', 'чьо', 'джьо']) ok(translitIssues(`書 (а${bad}о)`).length > 0, T(`form «${bad}» is caught`));
      await page.evaluate(t => { window.__pm.queue.push({ text: t }); }, GOOD);
      await page.fill('.ss-input', 'Які книжки про шінто?');
      await page.click('.ss-send');
      await page.waitForFunction(() => document.querySelectorAll('.ss-msg.ai:not(.ss-typing)').length === 2);
      const shown = await page.$eval('.ss-msg.ai:not(.ss-typing):last-of-type', e => e.textContent);
      const words = transliterated(shown);
      ok(words.length === 9 && !translitIssues(shown).length, T('Hepburn-based reply passes'), translitIssues(shown).join('; ') || String(words.length));
      ok(['шо', 'чо', 'джо', 'ші', 'джі', 'чі', 'цу'].every(f => words.some(w => w.includes(f))), T('reply has шо, чо, джо, ші, джі, чі, цу'));
      await page.evaluate(() => { sessionStorage.setItem('jp.sensei', JSON.stringify(JSON.parse(sessionStorage.getItem('jp.sensei')).slice(0, 2))); });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.ss-msg');
    }
    ok(await page.$$eval('.ss-chip', b => b.every(x => !x.offsetParent)), T('starters hidden once the chat has messages'));
    await page.fill('.ss-input', '');

    // Enter / Shift+Enter (desktop); Enter = new line on a phone
    await page.click('.ss-input');
    await page.keyboard.type('Рядок 1');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Рядок 2');
    ok((await page.inputValue('.ss-input')) === 'Рядок 1\nРядок 2', T('Shift+Enter adds a line'));
    await page.keyboard.press('Enter');
    if (!phone) {
      await page.waitForFunction(() => document.querySelectorAll('.ss-msg.ai:not(.ss-typing)').length === 2);
      ok((await msgs()).length === 4, T('Enter sends on desktop'));
      const c2 = (await pm()).last;
      ok(c2.messages.length === 4 && c2.messages[1].role === 'user' && c2.messages[2].role === 'assistant', T('earlier turns sent (multi-turn)'), String(c2.messages.length));
    } else {
      ok((await page.inputValue('.ss-input')) === 'Рядок 1\nРядок 2\n' && (await pm()).calls === 1, T('Enter adds a line on a phone'));
      await page.click('.ss-send');
      await page.waitForFunction(() => document.querySelectorAll('.ss-msg.ai:not(.ss-typing)').length === 2);
    }

    // history: 20 kept, 10 sent
    await page.evaluate(() => sessionStorage.setItem('jp.sensei', JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ r: i % 2 ? 'a' : 'u', t: 'm' + i })))));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.ss-msg');
    ok((await msgs()).length === 20, T('20 messages kept'), String((await msgs()).length));
    await page.fill('.ss-input', 'нове');
    await page.click('.ss-send');
    await page.waitForFunction(() => document.querySelectorAll('.ss-msg.ai:not(.ss-typing)').length && !document.querySelector('.ss-typing'));
    const c3 = (await pm()).last;
    ok(c3.messages.length === 11 && c3.messages.at(-1).content === 'нове', T('last 10 messages + system sent'), String(c3.messages.length));
    ok(JSON.parse(await page.evaluate(() => sessionStorage.getItem('jp.sensei'))).length === 20, T('session stores the last 20'));

    // reload keeps the conversation
    const before = await msgs();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.ss-msg');
    ok(JSON.stringify(await msgs()) === JSON.stringify(before), T('reload keeps the messages'));
    await page.screenshot({ path: path.join(OUT, `${kind}-chat.png`), fullPage: true });

    // «Нова розмова»: cancel keeps, confirm clears
    await page.click('[data-new]');
    await page.waitForSelector('.modal [data-yes]');
    await page.click('.modal [data-no]');
    ok((await msgs()).length === 20, T('cancel keeps the conversation'));
    await page.click('[data-new]');
    await page.click('.modal [data-yes]');
    ok((await msgs()).length === 0 && (await page.isHidden('.ss-list')), T('confirm clears the list'));
    ok(JSON.parse(await page.evaluate(() => sessionStorage.getItem('jp.sensei'))).length === 0, T('session cleared'));
    ok(await page.isVisible('.ss-chip'), T('starters back after clearing'));

    // too long
    const callsBefore = (await pm()).calls;
    await page.fill('.ss-input', 'я'.repeat(1001));
    await page.click('.ss-send');
    ok((await status()) === LONG, T('over 1000 characters → message'), await status());
    ok((await pm()).calls === callsBefore && !(await msgs()).length, T('too long is not sent'));
    await page.fill('.ss-input', 'я'.repeat(1000));
    ok((await status()) === '', T('message cleared when short enough'));

    // service failure (both models) → message, question back in the input, nothing added
    await page.evaluate(() => { window.__pm.queue = [{ reject: { error: { code: 'server_error', message: 'boom' } } }, { reject: new Error('down') }]; });
    await page.fill('.ss-input', 'Питання');
    await page.click('.ss-send');
    await page.waitForFunction(() => document.querySelector('.ss-status').textContent.trim());
    ok((await status()) === FAIL, T('service failure message'), await status());
    ok((await page.inputValue('.ss-input')) === 'Питання' && (await msgs()).length === 0, T('failed question back in the input'));

    // sign-in cancelled / blocked
    for (const how of ['cancel', 'blocked']) {
      await page.evaluate(h => { window.__pm.signedIn = false; window.__pm.signIn = h; }, how);
      await page.click('.ss-send');
      await page.waitForFunction(() => !document.querySelector('.ss-typing'));
      ok((await status()) === SIGNIN, T(`sign-in ${how} message`), await status());
    }
    await page.evaluate(() => { window.__pm.signIn = 'ok'; });
    await page.click('.ss-send');
    await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
    ok((await status()) === '' && (await msgs()).length === 2, T('sign-in ok → answer'));
    ok(!errs.length, T('no page errors'), errs.join(' | '));
    await ctx.close();

    // blocked sessionStorage
    const ctx2 = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone });
    await mockPuter(ctx2, { signedIn: true, reply: { text: REPLY } });
    await ctx2.addInitScript(() => {
      const thrower = { get() { throw new DOMException('blocked', 'SecurityError'); } };
      Object.defineProperty(window, 'sessionStorage', thrower);
    });
    const p2 = await ctx2.newPage();
    const errs2 = [];
    p2.on('pageerror', e => errs2.push(String(e)));
    await p2.goto(URL_ + '#/sensei', { waitUntil: 'networkidle' });
    await p2.waitForSelector('.ss-input');
    await p2.fill('.ss-input', 'Привіт');
    await p2.click('.ss-send');
    await p2.waitForSelector('.ss-msg.ai:not(.ss-typing)');
    ok((await p2.$$eval('.ss-msg', e => e.length)) === 2, T('works with sessionStorage blocked'));
    ok(!errs2.length, T('no errors with storage blocked'), errs2.join(' | '));
    await ctx2.close();
  }
  await browser.close();
  srv.close();
  console.log(`\n${passed} passed, ${issues.length} failed`);
  if (issues.length) { console.log(issues.join('\n')); process.exit(1); }
  console.log('ALL SENSEI CHECKS PASSED');
}
