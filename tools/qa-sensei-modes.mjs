// Browser QA of the Сенсей modes and the Exam's «Поясни мою помилку» (Puter.js mocked, nothing reaches Puter):
//   «Перевір речення» and «Розмова японською» (prompts with the lesson list, level 1–N, own conversations, URLs),
//   switching while Сенсей writes, Exam wrong answer → Сенсей with the question filled in (not sent) → back to the exam.
//   node tools/qa-sensei-modes.mjs        → screenshots in qa/sensei/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve, mockPuter } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/sensei');
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const CHECK_REPLY = '## Результат\nЄ помилки: 1\n## Виправлене речення\nきのう友達と映画を見ました。(きのう ともだちと えいがを みました。) — Учора я дивився фільм із другом.\n## Що змінено і чому\n- 見ます → 見ました: минулий час, Minna no Nihongo, урок 4.';
const TALK_REPLY = '### Виправлення\n✅ Без помилок\n### Сенсей\nいらっしゃいませ。何に しますか。(なにに しますか。)\n### Переклад\nЛаскаво просимо. Що будете замовляти?';

for (const [kind, width, height] of [['desktop', 1280, 800], ['phone', 390, 844], ['narrow', 320, 640]]) {
  const T = s => `${kind}: ${s}`;
  const phone = kind !== 'desktop';
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, locale: 'uk-UA' });
  await mockPuter(ctx, { signedIn: true, reply: { text: CHECK_REPLY } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const calls = () => page.evaluate(() => window.__pm.calls);
  const docW = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth));
  await page.goto(BASE + '#/sensei', { waitUntil: 'networkidle' });
  const tabs = await page.$$eval('.ss-mode', b => b.map(x => [x.dataset.mode, x.textContent, x.getAttribute('aria-selected')]));
  ok(JSON.stringify(tabs) === JSON.stringify([['ask', 'Запитання', 'true'], ['check', 'Перевір речення', 'false'], ['talk', 'Розмова японською', 'false']]), T('three modes, «Запитання» first'), JSON.stringify(tabs));
  ok((await docW()) <= width, T('modes fit, no horizontal scroll'), String(await docW()));
  // an «ask» message must not show up in the other modes
  await page.evaluate(() => sessionStorage.setItem('jp.sensei', JSON.stringify([{ r: 'u', t: 'Питання режиму Запитання' }, { r: 'a', t: 'Відповідь' }])));
  await page.reload({ waitUntil: 'networkidle' }); // the page reads a conversation once

  // ---- «Перевір речення»
  await page.click('.ss-mode[data-mode="check"]');
  ok(page.url().endsWith('#/sensei/check'), T('check: URL #/sensei/check'));
  ok((await page.getAttribute('.ss-input', 'placeholder')) === 'Речення японською…' && (await page.getAttribute('.ss-input', 'lang')) === 'ja', T('check: placeholder, lang ja'));
  ok((await page.textContent('.ss-sub')).includes('з номером уроку'), T('check: explanation under the title'));
  ok(!(await page.$('.ss-list .ss-msg')), T('check: own conversation (ask messages not shown)'));
  ok(await page.isHidden('.ss-level'), T('check: no level picker'));
  await page.click('.ss-chip >> nth=0');
  ok((await page.inputValue('.ss-input')) === 'きのう友達と映画を見ます。' && !(await calls()).length, T('check: starter fills the input, nothing sent'));
  await page.click('.ss-send');
  await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
  let c = (await calls()).at(-1);
  const sys = c.messages[0].content;
  ok(sys.startsWith('You are Сенсей') && sys.includes('MODE «Перевір моє речення»') && sys.includes('## Що змінено і чому'), T('check: mode rules in the prompt'));
  ok(/Урок 1: іменник₁ は іменник₂ です/.test(sys) && /Урок 50: /.test(sys) && !/\{[^}|]+\|/.test(sys), T('check: lesson list 1–50 (plain, no furigana markup)'));
  ok(sys.includes('Never write ь in a transliterated Japanese word'), T('check: transliteration rule kept'));
  ok(c.messages.at(-1).content === 'きのう友達と映画を見ます。' && c.messages.length === 2, T('check: the sentence is the user message'));
  ok((await page.$$eval('.ss-msg.ai h2', h => h.map(x => x.textContent))).join('|') === 'Результат|Виправлене речення|Що змінено і чому', T('check: reply sections rendered'));
  ok((await page.getAttribute('.ss-msg.me', 'lang')) === 'ja', T('check: learner sentence marked Japanese'));
  if (kind === 'phone') await page.screenshot({ path: path.join(OUT, 'mode-check-390.png'), fullPage: true });

  // ---- «Розмова японською»
  await page.evaluate(t => { window.__pm.reply = { text: t }; }, TALK_REPLY);
  await page.click('.ss-mode[data-mode="talk"]');
  ok(page.url().endsWith('#/sensei/talk') && (await page.isVisible('.ss-level')), T('talk: URL and level picker'));
  ok((await page.inputValue('.ss-level-sel')) === '10', T('talk: default level 1–10'));
  ok((await page.$$eval('.ss-chip', b => b.map(x => x.textContent))).includes('У кафе'), T('talk: topic starters'));
  await page.selectOption('.ss-level-sel', '5');
  ok((await page.evaluate(() => localStorage.getItem('jp.sensei.level'))) === '5', T('talk: level remembered'));
  await page.click('.ss-chip >> text="У кафе"');
  ok((await page.inputValue('.ss-input')) === 'Почнімо розмову на тему «У кафе».', T('talk: topic fills the input'));
  await page.click('.ss-send');
  await page.waitForSelector('.ss-msg.ai:not(.ss-typing)');
  c = (await calls()).at(-1);
  const tsys = c.messages[0].content;
  ok(tsys.includes('Level: Minna no Nihongo lessons 1–5') && /Урок 5: /.test(tsys) && !/Урок 6: /.test(tsys), T('talk: level 1–5 and only lessons 1–5 in the list'));
  ok(tsys.includes('### Виправлення') && tsys.includes('«Кінець»'), T('talk: correction format and «Кінець» summary in the prompt'));
  ok((await page.$$eval('.ss-msg.ai h3', h => h.map(x => x.textContent))).join('|') === 'Виправлення|Сенсей|Переклад', T('talk: reply sections rendered'));
  // second turn keeps the conversation (multi-turn) inside the talk mode only
  await page.fill('.ss-input', 'コーヒーを ください。');
  await page.click('.ss-send');
  await page.waitForFunction(() => document.querySelectorAll('.ss-msg.ai:not(.ss-typing)').length === 2);
  c = (await calls()).at(-1);
  ok(c.messages.length === 4 && c.messages[1].content === 'Почнімо розмову на тему «У кафе».' && c.messages[2].role === 'assistant', T('talk: earlier turns sent'));
  if (kind === 'phone') await page.screenshot({ path: path.join(OUT, 'mode-talk-390.png'), fullPage: true });
  ok((await docW()) <= width, T('talk: no horizontal scroll'), String(await docW()));

  // ---- switching while Сенсей writes: the reply goes to the mode it was asked in
  await page.evaluate(() => { window.__pm.hold = new Promise(r => (window.__pmRelease = r)); window.__pm.reply = { text: 'Відповідь для розмови' }; });
  await page.fill('.ss-input', 'すみません。');
  await page.click('.ss-send');
  await page.waitForSelector('.ss-typing');
  await page.click('.ss-mode[data-mode="ask"]');
  ok((await page.$$eval('.ss-list .ss-msg.me', m => m.map(x => x.textContent))).join() === 'Питання режиму Запитання' && !(await page.$('.ss-typing')), T('switch while writing: ask shows its own conversation'));
  ok(await page.isDisabled('.ss-send'), T('switch while writing: sending disabled'));
  await page.evaluate(() => { window.__pm.hold = null; window.__pmRelease(); });
  await page.waitForFunction(() => !document.querySelector('.ss-send').disabled);
  const talkLog = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.sensei.talk')));
  const askLog = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jp.sensei')));
  ok(talkLog.at(-1).t === 'Відповідь для розмови' && askLog.length === 2, T('switch while writing: reply stored in the talk conversation'));
  // direct URL
  await page.goto(BASE + '#/sensei/check', { waitUntil: 'networkidle' });
  ok((await page.getAttribute('.ss-mode.on', 'data-mode')) === 'check' && (await page.$$('.ss-list .ss-msg')).length === 2, T('direct URL opens the mode with its conversation'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}

// ---- Exam: «Поясни мою помилку» on mistakes → Сенсей with the question filled in
const PRESET = JSON.stringify({ name: '', part: 'I', from: 1, to: 5, tsAdded: true, wtAdded: true, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: ['p'], count: 3, mock: false, timer: 0 });
for (const [kind, width, height] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
  const T = s => `exam ${kind}: ${s}`;
  const phone = kind === 'phone';
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, locale: 'uk-UA' });
  await mockPuter(ctx, { signedIn: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/exam', { waitUntil: 'networkidle' });
  await page.evaluate(p => { localStorage.setItem('jp.examPresets.last', p); sessionStorage.clear(); }, PRESET);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-start]');
  await page.waitForSelector('.ex-answer .choice');
  const answerQ = async right => {
    const ans = await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); return S.qs[S.i].answer; });
    const vals = await page.$$eval('.ex-answer .choice', b => b.map(x => x.dataset.v));
    await page.click(`.ex-answer .choice >> nth=${vals.findIndex(v => (right ? v === ans : v !== ans))}`);
    await page.waitForSelector('[data-next]');
  };
  await answerQ(true);
  ok(!(await page.$('[data-sensei]')) && (await page.$('.ask-open')), T('correct answer: no «Поясни мою помилку»'));
  await page.click('[data-next]');
  await page.waitForSelector('.ex-answer .choice');
  await answerQ(false);
  ok((await page.textContent('[data-sensei]')).trim() === 'Поясни мою помилку — Сенсей', T('wrong answer: button shown'));
  await page.click('[data-sensei]');
  await page.waitForSelector('.sensei .ss-input');
  const v = await page.inputValue('.ss-input');
  ok(page.url().endsWith('#/sensei') && (await page.getAttribute('.ss-mode.on', 'data-mode')) === 'ask', T('opens Сенсей, mode «Запитання»'));
  ok(v.startsWith('Поясни, будь ласка, мою помилку в екзамені') && v.includes('Відповідь учня:') && v.includes('Правильна відповідь:') && v.length <= 1000, T('question filled in with the exam context'), v.slice(0, 120));
  ok(!(await page.evaluate(() => window.__pm.calls.length)) && !(await page.$('.ss-list .ss-msg')), T('filled in, not sent'));
  ok(await page.isVisible('#exam-return'), T('«Повернутися до екзамену» visible'));
  await page.reload({ waitUntil: 'networkidle' });
  ok((await page.inputValue('.ss-input')) === '', T('prefill used once (not again after reload)'));
  await page.click('#exam-return');
  await page.waitForSelector('.ex-feedback, .ex-answer');
  ok(page.url().endsWith('#/exam/run'), T('back to the exam question'));
  // finish → results: the button on every mistake
  for (let i = 0; i < 5 && page.url().includes('#/exam/run'); i++) {
    if (await page.$('[data-next]')) await page.click('[data-next]');
    else if (await page.$('.ex-answer .choice')) await answerQ(false);
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('.ex-mistake');
  const mistakes = await page.$$eval('.ex-mistake', m => m.map(x => !!x.querySelector('[data-sensei]')));
  ok(mistakes.length >= 2 && mistakes.every(Boolean), T('results: the button on every mistake'), JSON.stringify(mistakes));
  ok(Math.max(...await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])) <= width, T('results: no horizontal scroll'));
  if (phone) await page.screenshot({ path: path.join(OUT, 'exam-mistake-390.png'), fullPage: false });
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`\n${passed} passed, ${issues.length} failed`);
if (issues.length) { console.log(issues.join('\n')); process.exit(1); }
console.log('ALL SENSEI MODE CHECKS PASSED');
