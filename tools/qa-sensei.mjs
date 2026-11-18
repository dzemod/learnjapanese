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
        // normalized (OpenAI) shape: finish_reason "length" = stopped by the output limit
        return { message: { role: 'assistant', content: r.parts || r.text }, finish_reason: r.finish || 'stop', normalized: true };
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
    ok(await page.$eval('.ss-msg.ai strong', b => b.textContent === 'щодня').catch(() => false), T('**bold** rendered'));
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
    const lengthLimit = [/200 words/, /\d+\s*(words?|sentences?|paragraphs?|characters?|tokens?|lines?|слів|слова|речень|символів|рядків)(?![a-zа-яіїєґ])/i, /\b(under|at most|no more than|maximum of|up to|within)\s+(about\s+)?\d/i];
    ok(lengthLimit.every(re => !re.test(sys)), T('prompt has no numeric length limit'), lengthLimit.filter(re => re.test(sys)).join(' '));
    ok(lengthLimit.every(re => re.test('Keep most answers under about 200 words.')) && lengthLimit[1].test('не більше 3 речень'), T('length-limit detector works'));
    ok(sys.includes('Give complete, detailed explanations. Cover the topic fully: the rule, the reason behind it, examples with readings and translation, common mistakes, and a practice tip. Use short sections with bold headings when the answer has several parts.'), T('prompt asks for full answers'));
    ok(sys.includes('Stay on learning Japanese, the language, and Japan.'), T('prompt keeps the topic rule'));
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

  // ---------- full answers: a ≈ 1500-word reply, the output limit, «Продовжити» ----------
  const LAST = 'Це останнє речення відповіді Сенсея.';
  const para = i => `Пункт ${i}: частка は позначає тему речення, а が — підмет, на який падає наголос; порівняйте 私は学生です (わたしは がくせいです) і 私が学生です (わたしが がくせいです), щоб відчути різницю між темою та новою інформацією у кожному прикладі.`;
  const SECTIONS = ['**Правило**', '## Чому так', '**Приклади**', '## Типові помилки', '**Порада для практики**'];
  const BIG = SECTIONS.map((h, s) => `${h}\n${Array.from({ length: 11 }, (_, i) => para(s * 11 + i + 1)).join('\n')}`).join('\n\n') + `\n\n${LAST}`;
  const bigWords = BIG.split(/\s+/).filter(Boolean).length;
  const CUT = 'Частка は позначає тему, а частка が позначає підмет. Наприклад, у реченні 私は学生です тема — це я, і далі ми говоримо про мене. Коли ж ми хочемо підкреслити, хто саме є студентом, ми каже';
  const CONT = 'мо 私が学生です: саме я, а не хтось інший. Це і є головна різниця.';
  for (const [width, height] of [[320, 568], [390, 844]]) {
    const T = s => `${width}px full answers: ${s}`;
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, locale: 'uk-UA' });
    await mockPuter(ctx, { signedIn: true, reply: { text: BIG } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL_ + '#/sensei', { waitUntil: 'networkidle' });
    await page.fill('.ss-input', 'Поясни детально різницю між は і が');
    await page.click('.ss-send');
    await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
    const call = await page.evaluate(() => window.__pm.calls.at(-1));
    ok(call.options.max_tokens === 128000 && call.options.normalize === true && call.options.model === 'claude-haiku-5-5', T('highest output limit of the model requested'), JSON.stringify(call.options));
    await page.waitForTimeout(900); // smooth scroll to the new reply
    const r = await page.evaluate(last => {
      const list = document.querySelector('.ss-list'), msg = [...list.querySelectorAll('.ss-msg.ai')].pop();
      const top = msg.getBoundingClientRect().top, bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const startShown = top >= bar - 1 && top < innerHeight; // the page scrolled to the start of the new reply
      // no inner scroll box anywhere in the chat: every element shows its whole content
      const innerScroll = [list, ...list.querySelectorAll('*')].filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) || e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible').map(e => e.className || e.tagName);
      const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT); let node = null; for (let n; (n = walker.nextNode());) if (n.textContent.includes(last)) node = n;
      node.parentElement.scrollIntoView({ block: 'end' }); // the page scrolls to the end of the reply
      const rg = document.createRange(); const at = node.textContent.indexOf(last); rg.setStart(node, at); rg.setEnd(node, at + last.length);
      const onScreen = [...rg.getClientRects()].every(c => c.top >= 0 && c.bottom <= innerHeight + 0.5 && c.right <= innerWidth + 0.5);
      const cs = getComputedStyle(msg);
      return { startShown, innerScroll, onScreen, grows: cs.maxHeight === 'none' && cs.overflow === 'visible',
        h2: [...msg.querySelectorAll('h2')].map(b => b.textContent), h3: [...msg.querySelectorAll('h3')].map(b => b.textContent),
        paras: msg.querySelectorAll('p').length, brs: msg.querySelectorAll('br').length,
        text: msg.textContent, docW: Math.max(document.documentElement.scrollWidth, innerWidth), cut: !!document.querySelector('.ss-cut') };
    }, LAST);
    ok(bigWords >= 1500 && r.text.endsWith(LAST) && Array.from({ length: 55 }, (_, i) => `Пункт ${i + 1}:`).every(p => r.text.includes(p)), T('≈1500-word reply rendered in full'), `${bigWords} words`);
    ok(r.startShown, T('page scrolls to the start of the new reply'));
    ok(!r.innerScroll.length, T('no inner scroll box / scrollbar'), r.innerScroll.join(', '));
    ok(r.onScreen, T('last sentence visible after scrolling the page to the end'));
    ok(r.grows, T('reply grows with its content'));
    ok(r.paras >= 6 && r.brs >= 50, T('paragraphs and line breaks kept'), `${r.paras} p, ${r.brs} br`);
    ok(['Чому так', 'Типові помилки'].every(h => r.h2.includes(h)) && ['Правило', 'Приклади', 'Порада для практики'].every(h => r.h3.includes(h)) && !/[#*]/.test(r.text), T('## → h2, **title** line → h3, no raw # or *'), `${r.h2.join('|')} / ${r.h3.join('|')}`);
    ok(r.docW <= width, T('no horizontal scroll'), String(r.docW));
    ok(!r.cut, T('complete answer has no cut note'));
    await page.screenshot({ path: path.join(OUT, `long-${width}.png`) });

    // Markdown subset → tags; no raw markers; one font stack for Cyrillic and Japanese in a paragraph
    const MD = '## Heading\n### Subheading\nТекст з **bold** і *italic* та `код`.\n--\n- item one\n- item two\n\n1. перший\n2. другий\n---\nАбзац: слово 日本語 (にほんご) і українська -- в одному рядку.\n**Порада:**\nОстанній абзац.';
    await page.evaluate(t => { window.__pm.queue.push({ text: t }); }, MD);
    await page.fill('.ss-input', 'Покажи форматування'); await page.click('.ss-send');
    await page.waitForFunction(() => !document.querySelector('.ss-typing') && [...document.querySelectorAll('.ss-msg.ai')].pop().querySelector('h2'));
    const md = await page.evaluate(() => {
      const msg = [...document.querySelectorAll('.ss-msg.ai')].pop(), q = s => [...msg.querySelectorAll(s)].map(e => e.textContent);
      const p = [...msg.querySelectorAll('p')].find(e => /日本語/.test(e.textContent)), ff = e => getComputedStyle(e).fontFamily;
      const els = ['p', 'h2', 'h3', 'li', 'strong', 'em'].map(s => msg.querySelector(s));
      return { h2: q('h2'), h3: q('h3'), hr: q('hr').length, ul: q('ul > li'), ol: q('ol > li'), strong: q('strong'), em: q('em'), code: q('code'), text: msg.textContent,
        pFont: ff(p), pSize: getComputedStyle(p).fontSize, pLine: getComputedStyle(p).lineHeight, same: els.every(e => e && ff(e) === ff(p)), pText: p.textContent, kids: p.children.length };
    });
    await page.evaluate(() => { const m = [...document.querySelectorAll('.ss-msg.ai')].pop(); m.style.scrollMarginTop = document.querySelector('.topbar').offsetHeight + 12 + 'px'; m.scrollIntoView({ block: 'start' }); });
    await page.screenshot({ path: path.join(OUT, `markdown-${width}.png`) });
    ok(md.h2.join() === 'Heading' && md.h3.join() === 'Subheading,Порада', T('## → h2, ### → h3'), `${md.h2} / ${md.h3}`);
    ok(md.hr >= 1 && md.ul.join('|') === 'item one|item two' && md.ol.join('|') === 'перший|другий', T('-- → hr, - → ul, 1. → ol'), JSON.stringify(md));
    ok(md.strong.includes('bold') && md.em.includes('italic') && md.code.includes('код'), T('**bold** → strong, *italic* → em, `code` → code'));
    ok(!/[#*`]|--/.test(md.text) && md.pText.includes('українська — в одному'), T('no raw #, --, * in the text'), md.text);
    ok(/^"?Manrope"?, "?Noto Sans JP"?/.test(md.pFont) && md.same && md.kids === 0, T('Cyrillic and Japanese in one paragraph: one font stack'), md.pFont);
    ok(md.pSize === '16px' && Math.abs(parseFloat(md.pLine) - 16 * 1.65) < 0.2, T('16 px, line height 1.65 on phones'), `${md.pSize} ${md.pLine}`);
    // how chat models really format (found on the live site): "###Title" without a space, "#Title", * bullets, nested
    // items, "> quote", a table with |---|, "***" — nothing raw may stay visible
    const REAL = ['## Різниця між は і が', '', 'Частка **は** позначає *тему*, а **が** — *підмет*.', '', '---', '', '### 1. Тема (は)',
      '* **私は学生です** (わたしは がくせいです) — Я студент.', '* Друге речення', '  * вкладений пункт', '', '--', '', '###Без пробілу', '#Ще один', '',
      '1. **Перше:** пояснення', '2. Друге', '', '> Цитата з поясненням', '', '| Частка | Роль |', '|---|---|', '| は | тема |', '| が | підмет |', '',
      '**Порада:** читайте вголос', '', '***', 'Кінець *відповіді*.'].join('\n');
    await page.evaluate(t => { window.__pm.queue.push({ text: t }); }, REAL);
    await page.fill('.ss-input', 'Як пишуть моделі'); await page.click('.ss-send');
    await page.waitForFunction(() => !document.querySelector('.ss-typing') && [...document.querySelectorAll('.ss-msg.ai')].pop().querySelector('table'));
    const real = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.ss-msg.ai')].pop(), q = s => [...m.querySelectorAll(s)].map(e => e.textContent.trim());
      return { raw: m.innerText.match(/#|\*|(^|\n)\s*-{2,}|\||(^|\n)\s*>/g) || [], h2: q('h2'), h3: q('h3'), hr: q('hr').length, quote: q('blockquote'), th: q('th'), td: q('td'), ul: q('ul > li').length, ol: q('ol > li').length,
        scroll: [m, ...m.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 || (e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible')).map(e => e.tagName), docW: Math.max(document.documentElement.scrollWidth, innerWidth) };
    });
    ok(!real.raw.length, T('real model formatting: no raw #, *, --, |, >'), JSON.stringify(real.raw));
    ok(real.h2.includes('Різниця між は і が') && real.h2.includes('Ще один') && real.h3.includes('1. Тема (は)') && real.h3.includes('Без пробілу') && real.hr >= 2, T('headings with and without a space, dividers'), JSON.stringify(real));
    ok(real.quote.includes('Цитата з поясненням') && real.th.join() === 'Частка,Роль' && real.td.join() === 'は,тема,が,підмет' && real.ul === 3 && real.ol === 2, T('blockquote, table, lists'), JSON.stringify(real));
    ok(!real.scroll.length && real.docW <= width, T('real reply: no inner scrollbar, no page scroll'), `${real.scroll} ${real.docW}`);
    // the model's text is never trusted: tags come out as text
    const XSS = '<script>window.__xss = 1</script><img src=x onerror="window.__xss = 2"> **ok** <b onclick="x">b</b>';
    await page.evaluate(t => { window.__pm.queue.push({ text: t }); }, XSS);
    await page.fill('.ss-input', 'XSS'); await page.click('.ss-send');
    await page.waitForFunction(() => !document.querySelector('.ss-typing') && /window\.__xss/.test([...document.querySelectorAll('.ss-msg.ai')].pop().textContent));
    await page.waitForTimeout(300);
    const xss = await page.evaluate(() => { const m = [...document.querySelectorAll('.ss-msg.ai')].pop(); return { tags: [...m.querySelectorAll('script, img, b, [onclick], [onerror]')].length, flag: window.__xss, text: m.textContent }; });
    ok(xss.tags === 0 && xss.flag === undefined && xss.text.includes('<script>window.__xss = 1</script>') && xss.text.includes('<img src=x onerror='), T('script / img onerror shown as escaped text'), JSON.stringify(xss));

    // stopped by the output limit → note + «Продовжити»; each click = one follow-up request
    await page.evaluate(([cut, cont]) => { window.__pm.queue.push({ text: cut, finish: 'length' }); }, [CUT, CONT]);
    await page.fill('.ss-input', 'А коротше?');
    await page.click('.ss-send');
    await page.waitForSelector('.ss-cut');
    ok((await page.textContent('.ss-cut span')) === 'Відповідь обірвана через ліміт. Натисніть «Продовжити»' && (await page.isVisible('.ss-cut [data-continue]')), T('cut answer: note and «Продовжити»'));
    ok((await page.$$('.ss-msg.ai.cut')).length === 1, T('cut answer marked'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.ss-cut [data-continue]');
    ok(true, T('note survives a reload'));
    await page.evaluate(cont => { window.__pm.signedIn = true; window.__pm.queue.push({ text: cont.slice(0, 20), finish: 'length' }, { text: cont.slice(20), finish: 'stop' }); }, CONT); // the mock restarts with the page
    const n0 = await page.evaluate(() => window.__pm.calls.length);
    await page.click('[data-continue]');
    await page.waitForFunction(() => !document.querySelector('.ss-typing'));
    await page.waitForSelector('.ss-cut [data-continue]');
    const c1 = await page.evaluate(() => ({ n: window.__pm.calls.length, last: window.__pm.calls.at(-1) }));
    ok(c1.n === n0 + 1, T('«Продовжити» sends one follow-up request'), `${c1.n - n0}`);
    const m = c1.last.messages;
    ok(m.at(-1).role === 'user' && m.at(-1).content === 'Продовжи з того місця, де зупинився' && m.at(-2).role === 'assistant' && m.at(-2).content === CUT && m[0].role === 'system' && m.length <= 11, T('follow-up has the cut answer in context'), JSON.stringify(m.slice(-2)).slice(0, 200));
    ok((await page.$$('.ss-cut')).length === 1, T('still cut → the note stays'));
    await page.click('[data-continue]');
    await page.waitForFunction(() => !document.querySelector('.ss-typing'));
    const c2 = await page.evaluate(() => window.__pm.calls.length);
    const lastMsg = await page.$eval('.ss-list .ss-msg.ai:last-of-type', e => e.textContent);
    ok(c2 === n0 + 2, T('second click: one more request'));
    ok(lastMsg === CUT + CONT && !(await page.$('.ss-cut')), T('continuation joined to the answer, note gone'), lastMsg.slice(-80));
    // an older cut answer keeps its note (without the button) after the next question
    await page.evaluate(cut => { window.__pm.queue.push({ text: cut, finish: 'length' }, { text: 'Наступна відповідь.' }); }, CUT);
    await page.fill('.ss-input', 'Ще приклад'); await page.click('.ss-send'); await page.waitForSelector('.ss-cut');
    await page.fill('.ss-input', 'Дякую'); await page.click('.ss-send');
    await page.waitForFunction(() => !document.querySelector('.ss-typing') && document.querySelectorAll('.ss-msg.ai').length >= 4);
    ok((await page.$$('.ss-cut')).length === 1 && !(await page.$('.ss-cut [data-continue]')), T('older cut answer: note stays, no button'));
    ok(!errs.length, T('no page errors'), errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  srv.close();
  console.log(`\n${passed} passed, ${issues.length} failed`);
  if (issues.length) { console.log(issues.join('\n')); process.exit(1); }
  console.log('ALL SENSEI CHECKS PASSED');
}
