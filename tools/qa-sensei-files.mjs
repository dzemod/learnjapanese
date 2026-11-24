// Browser QA of the Сенсей attachments («Прикріпити», site/js/sensei-files.js): text file → chip → text sent with the
// question → reply; long text cut to 6000 characters; too large / unsupported file → Ukrainian message, not sent;
// chip removed → only the typed text; photo → resized (≤ 1024 px JPEG, no EXIF) → uploaded with puter.fs.write,
// { type: 'file', puter_path } part, puter.fs.delete; failure keeps the file; nothing of the file in sessionStorage;
// 1000-character limit = typed question only; notes; layout at 320 / 390 / 1280 (no horizontal scroll, chip fits).
// Paste (Ctrl+V / long-press «Вставити»): image → chip (same pipeline), plain / multi-line text pastes as before,
// image + text → both, a second image replaces the first (note), image over 5 MB → message, no image given → note.
// Puter.js is replaced by the mock of qa-sensei.mjs + puter.fs (write/delete) — nothing reaches Puter.
//   npm i --no-save playwright-core sharp kuromoji@0.1.2
//   node tools/qa-sensei-files.mjs   → screenshots in qa/sensei-files/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve, MOCK } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/sensei-files');
fs.mkdirSync(OUT, { recursive: true });

// puter.fs on top of the chat mock: write(path, blob) → { path }, delete(path); blobs measured for the checks
const FS_MOCK = `${MOCK}
(() => {
  const M = window.__pm;
  M.writes = []; M.deletes = [];
  window.puter.fs = {
    write: async (p, blob) => {
      if (M.writeFail) throw { error: 'upload_failed', msg: 'mock upload failure' };
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let w = 0, h = 0;
      try { const b = await createImageBitmap(blob); w = b.width; h = b.height; } catch { /* not an image */ }
      const head = Array.from(bytes.slice(0, 4096), c => String.fromCharCode(c)).join('');
      M.writes.push({ p, type: blob.type, size: blob.size, w, h, exif: head.includes('Exif'), jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 });
      return { path: '/mock/AppData/' + p };
    },
    delete: async p => { M.deletes.push(p); },
  };
})();`;

const REPLY = 'На фото — **слово** 本 (ほん), «книга».';
const BAD = 'Цей файл не підтримується або завеликий';
const LONG = 'Повідомлення надто довге, скоротіть його';
const FAIL = 'Не вдалося отримати відповідь, спробуйте ще раз';
const REPLACED = 'Попередній файл замінено';
const PASTE_FAIL = 'Не вдалося вставити зображення. Спробуйте кнопку скріпки';
const PRIV ='Файл надсилається у безкоштовний сервіс Puter. Не надсилайте документи з особистими даними.';

const srv = await serve();
const URL_ = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

async function open(width, height, phone) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone, locale: 'uk-UA' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL_ });
  await ctx.addInitScript(s => { window.__pm = Object.assign(window.__pm || {}, s); }, { signedIn: true, reply: { text: REPLY } });
  await ctx.route(/^https:\/\/js\.puter\.com\/v2\//, r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FS_MOCK }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|^ask: /.test(m.text())) errs.push(m.text()); });
  await page.goto(URL_ + '#/sensei', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sensei .ss-bar');
  return { ctx, page, errs };
}
const txt = (name, text, mimeType = 'text/plain') => ({ name, mimeType, buffer: Buffer.from(text, 'utf8') });
const pm = page => page.evaluate(() => ({ calls: window.__pm.calls.length, last: window.__pm.calls.at(-1), writes: window.__pm.writes, deletes: window.__pm.deletes }));
const status = page => page.$eval('.ss-status', e => e.textContent.trim());
const chip = page => page.$eval('.ss-att', e => (e.hidden ? '' : e.textContent.trim()));
async function reply(page, n) { await page.waitForFunction(k => document.querySelectorAll('.ss-list .ss-msg.ai:not(.ss-typing)').length >= k, n, { timeout: 8000 }); }
const noHScroll = (page, w) => page.evaluate(w => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= w, w);

// ---------------- behaviour (phone 390) ----------------
{
  const { ctx, page, errs } = await open(390, 844, true);
  const T = s => `behaviour: ${s}`;
  ok(await page.isVisible('.ss-clip'), T('paperclip button visible'));
  ok((await page.getAttribute('.ss-clip', 'aria-label')) === 'Прикріпити', T('button label «Прикріпити»'));
  const order = await page.$$eval('.ss-bar > *:not([hidden])', els => els.map(e => e.className.split(' ').find(c => c.startsWith('ss-'))));
  ok(order.join(',') === 'ss-clip,ss-input,ss-send', T('order: clip, textarea, send'), order.join(','));
  const acc = await page.getAttribute('.ss-file', 'accept');
  ok(/image\/\*/.test(acc) && /\.txt/.test(acc) && /\.md/.test(acc) && /\.pdf/.test(acc), T('accept image/* .txt .md .pdf'), acc);
  ok((await page.getAttribute('.ss-file', 'capture')) === null, T('no capture attribute (gallery stays available)'));
  const notes = await page.$$eval('.ss-note', ps => ps.map(p => p.textContent.trim()));
  ok(notes.some(n => n.startsWith('Відповідає ШІ сервісу Puter')) && notes.includes(PRIV), T('Puter note + privacy note'));

  // 1) text file → chip → sent with the question → reply
  const BODY = 'Сьогодні я вивчила слова: 本（ほん）, 学校（がっこう）.';
  await page.setInputFiles('.ss-file', txt('нотатки.txt', BODY));
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  const c1 = await chip(page);
  ok(c1.includes('нотатки.txt') && /КБ/.test(c1) && (await page.isVisible('.ss-att-x')), T('chip: name, size, ×'), c1);
  await page.fill('.ss-input', 'Перевір мої слова');
  await page.click('.ss-send');
  await reply(page, 1);
  let s = await pm(page);
  const u1 = s.last.messages.at(-1);
  ok(typeof u1.content === 'string' && u1.content.startsWith('Перевір мої слова') && u1.content.includes('Файл «нотатки.txt»') && u1.content.includes(BODY), T('question + file text in the user message'), JSON.stringify(u1).slice(0, 200));
  ok(!s.writes.length, T('a text file is not uploaded'));
  ok((await page.textContent('.ss-list .ss-msg.ai')).includes('книга'), T('reply shown'));
  ok((await page.textContent('.ss-list .ss-msg.me .ss-msg-file')).trim() === 'файл: нотатки.txt', T('history shows «файл: назва»'));
  ok(!(await chip(page)), T('chip cleared after sending'));
  const stored = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)]))) + JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))));
  ok(stored.includes('нотатки.txt') && !stored.includes('学校（がっこう）'), T('file text not stored, only the name'));
  // the next turn names the earlier file, its text is not sent again
  await page.fill('.ss-input', 'Дякую');
  await page.click('.ss-send');
  await reply(page, 2);
  s = await pm(page);
  const hist = s.last.messages.find(m => m.role === 'user' && String(m.content).startsWith('Перевір мої слова'));
  ok(hist && hist.content.includes('(файл: нотатки.txt)') && !hist.content.includes(BODY), T('earlier turn: file named, text not resent'));
  await page.screenshot({ path: path.join(OUT, 'phone-text-sent.png'), fullPage: true });

  // 2) long text → cut to 6000 characters, marked
  await page.setInputFiles('.ss-file', txt('довгий.md', 'あ'.repeat(9000), 'text/markdown'));
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  ok((await chip(page)).includes('обрізано'), T('long file: chip says «обрізано»'));
  await page.fill('.ss-input', 'Що тут?');
  await page.click('.ss-send');
  await reply(page, 3);
  s = await pm(page);
  const u2 = s.last.messages.at(-1).content;
  ok(u2.includes('обрізано до перших 6000 символів') && (u2.match(/あ/g) || []).length === 6000, T('text cut to 6000 + note'), String((u2.match(/あ/g) || []).length));

  // 3) too large / unsupported → message, nothing attached or sent
  const before = (await pm(page)).calls;
  await page.setInputFiles('.ss-file', txt('великий.txt', 'x'.repeat(210 * 1024)));
  await page.waitForFunction(m => document.querySelector('.ss-status').textContent.includes(m), BAD);
  ok(!(await chip(page)), T('too large text file: no chip'));
  await page.setInputFiles('.ss-file', { name: 'програма.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  ok((await status(page)) === BAD && !(await chip(page)), T('unsupported type: message, no chip'));
  const big = Buffer.alloc(5 * 1024 * 1024 + 10); big[0] = 0xff; big[1] = 0xd8;
  await page.setInputFiles('.ss-file', { name: 'велике.jpg', mimeType: 'image/jpeg', buffer: big });
  ok((await status(page)) === BAD && !(await chip(page)), T('photo over 5 MB: message, no chip'));
  ok((await pm(page)).calls === before, T('nothing sent for a rejected file'));
  await page.screenshot({ path: path.join(OUT, 'phone-too-large.png') });

  // 4) chip removed → only the typed text
  await page.setInputFiles('.ss-file', txt('прибрати.txt', 'СЕКРЕТНИЙ ТЕКСТ'));
  await page.waitForSelector('.ss-att-x');
  await page.click('.ss-att-x');
  ok(!(await chip(page)), T('× removes the chip'));
  await page.fill('.ss-input', 'Лише текст');
  await page.click('.ss-send');
  await reply(page, 4);
  s = await pm(page);
  ok(s.last.messages.at(-1).content === 'Лише текст', T('removed file: only the typed text sent'), JSON.stringify(s.last.messages.at(-1)));

  // 5) photo → resized JPEG without EXIF, uploaded, file part, deleted
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); g.fillStyle = '#c8102e'; g.fillRect(0, 0, 3000, 2000); g.fillStyle = '#fff'; g.font = '400px sans-serif'; g.fillText('本', 1200, 1200);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  // a JPEG with an EXIF block (APP1 with GPS-like content) to prove the redraw drops it
  const jpgExif = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; c.getContext('2d').fillRect(0, 0, 10, 10);
    const b = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const exif = new TextEncoder().encode('Exif\0\0GPSLatitude 50.45 GPSLongitude 30.52');
    const app1 = new Uint8Array([0xff, 0xe1, 0, exif.length + 2, ...exif]);
    return Array.from(new Uint8Array([...b.slice(0, 2), ...app1, ...b.slice(2)]));
  });
  await page.setInputFiles('.ss-file', { name: 'скрін.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  ok((await chip(page)).includes('скрін.png'), T('photo chip'));
  await page.fill('.ss-input', 'Що написано?');
  await page.click('.ss-send');
  await reply(page, 5);
  s = await pm(page);
  const w = s.writes.at(-1), u5 = s.last.messages.at(-1);
  ok(w && w.type === 'image/jpeg' && w.jpeg && Math.max(w.w, w.h) === 1024 && w.w === 1024 && w.h === 683, T('photo resized to 1024 px JPEG'), JSON.stringify(w));
  ok(Array.isArray(u5.content) && u5.content[0].type === 'file' && u5.content[0].puter_path === '/mock/AppData/' + w.p && u5.content[1].type === 'text' && u5.content[1].text === 'Що написано?', T('user message: file part + text part'), JSON.stringify(u5));
  ok(s.last.messages[0].role === 'system' && typeof s.last.messages[0].content === 'string' && s.last.messages[0].content.includes('When the learner sends an image or a file'), T('system prompt (string) with the file line'));
  await page.waitForFunction(() => window.__pm.deletes.length >= 1);
  ok((await pm(page)).deletes.at(-1) === '/mock/AppData/' + w.p, T('temporary file deleted'));
  ok((await page.$$eval('.ss-msg.me .ss-msg-file', e => e.map(x => x.textContent))).includes('файл: скрін.png'), T('photo in history as «файл: назва»'));
  await page.setInputFiles('.ss-file', { name: 'gps.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpgExif) });
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  await page.click('.ss-send'); // only a file: the default question is sent
  await reply(page, 6);
  s = await pm(page);
  ok(s.writes.at(-1) && !s.writes.at(-1).exif && s.writes.at(-1).w === 1024, T('EXIF/GPS dropped by the canvas redraw'), JSON.stringify(s.writes.at(-1)));
  ok(s.last.messages.at(-1).content[1].text === 'Що тут? Поясни, будь ласка.', T('file without text: default question'));

  // 6) failure: message, the typed text and the file come back
  await page.evaluate(() => { window.__pm.writeFail = true; });
  await page.setInputFiles('.ss-file', { name: 'скрін2.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  await page.fill('.ss-input', 'Не дійде');
  await page.click('.ss-send');
  await page.waitForFunction(m => document.querySelector('.ss-status').textContent.includes(m), FAIL);
  ok((await page.inputValue('.ss-input')) === 'Не дійде' && (await chip(page)).includes('скрін2.png'), T('failed upload: text and file kept'));
  await page.evaluate(() => { window.__pm.writeFail = false; window.__pm.queue.push({ reject: { error: 'boom', msg: 'x' } }, { reject: { error: 'boom', msg: 'x' } }); });
  await page.click('.ss-send');
  await page.waitForFunction(m => document.querySelector('.ss-status').textContent.includes(m), FAIL);
  ok((await chip(page)).includes('скрін2.png'), T('failed answer: file kept'));
  await page.waitForFunction(() => window.__pm.deletes.length >= 3);
  ok(true, T('temporary file deleted after a failed answer'));
  await page.click('.ss-att-x');

  // 7) the 1000-character limit counts the typed question only
  await page.setInputFiles('.ss-file', txt('ok.txt', 'я'.repeat(5000)));
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  await page.fill('.ss-input', 'ю'.repeat(1000));
  const n7 = (await pm(page)).calls;
  await page.click('.ss-send');
  await reply(page, 7);
  ok((await pm(page)).calls === n7 + 1, T('1000 typed + 5000 from a file: sent'));
  await page.fill('.ss-input', 'ю'.repeat(1001));
  await page.click('.ss-send');
  ok((await status(page)) === LONG, T('1001 typed: «надто довге»'));

  // 8) sign-in cancelled with a file: Сенсей sign-in message, file kept
  await page.fill('.ss-input', 'Питання');
  await page.setInputFiles('.ss-file', txt('a.txt', 'текст'));
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  await page.evaluate(() => { window.__pm.signedIn = false; window.__pm.signIn = 'cancel'; });
  await page.click('.ss-send');
  await page.waitForFunction(() => document.querySelector('.ss-status').textContent.includes('увійдіть'));
  ok((await chip(page)).includes('a.txt'), T('sign-in cancelled: file kept'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}

// ---------------- paste (390 phone + 1280 desktop) ----------------
// dispatches a paste event on the textarea: { png: [w, h, name] | bytes: n (oversize) | stub, text }; returns defaultPrevented
const paste = (page, spec) => page.evaluate(async ({ png, bytes, text, stub }) => {
  const ta = document.querySelector('.ss-input');
  ta.focus();
  let ev;
  if (stub) { // a phone that announces an image but gives none
    ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }], files: [], types: ['Files'], getData: () => '' } });
  } else {
    const dt = new DataTransfer();
    if (png) {
      const c = document.createElement('canvas'); c.width = png[0]; c.height = png[1];
      const g = c.getContext('2d'); g.fillStyle = '#336'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#fff'; g.fillText('日本語', 10, 30);
      const b = await new Promise(r => c.toBlob(r, 'image/png'));
      dt.items.add(new File([b], png[2], { type: 'image/png' }));
    }
    if (bytes) dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
    if (text) dt.setData('text/plain', text);
    ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  }
  ta.dispatchEvent(ev);
  return ev.defaultPrevented;
}, spec);
for (const [width, height, phone] of [[390, 844, true], [1280, 800, false]]) {
  const { ctx, page, errs } = await open(width, height, phone);
  const T = s => `paste ${width}px: ${s}`;
  // plain text: not intercepted, no chip
  ok(!(await paste(page, { text: 'просто текст' })) && !(await chip(page)), T('plain text: default paste kept, no chip'));
  // image over 5 MB: message, nothing attached
  ok(await paste(page, { bytes: 5 * 1024 * 1024 + 100 }), T('oversize image: default prevented'));
  await page.waitForFunction(m => document.querySelector('.ss-status').textContent.includes(m), BAD);
  ok(!(await chip(page)), T('oversize image: no chip'));
  // announced image, none given (phone long-press): note
  ok(await paste(page, { stub: true }), T('no image given: default prevented'));
  ok((await status(page)) === PASTE_FAIL && !(await chip(page)), T('no image given: «Не вдалося вставити зображення…»'), await status(page));
  // small PNG → chip with its name → attached (uploaded on send)
  ok(await paste(page, { png: [800, 500, 'image.png'] }), T('image: default prevented'));
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  ok((await chip(page)).includes('image.png'), T('image: chip with the name'), await chip(page));
  ok(!(await status(page)), T('image: no message'));
  // a second image replaces the first, with a note
  await paste(page, { png: [1600, 1200, 'знімок.png'] });
  await page.waitForFunction(() => document.querySelector('.ss-att-name')?.textContent === 'знімок.png');
  ok((await status(page)) === REPLACED && (await page.$$('.ss-att-chip')).length === 1, T('second image replaces the chip + note'), await status(page));
  // image + text: the image is attached, the text is pasted at the cursor
  await page.fill('.ss-input', 'Що тут ');
  await page.evaluate(() => { const t = document.querySelector('.ss-input'); t.selectionStart = t.selectionEnd = t.value.length; });
  ok(await paste(page, { png: [300, 200, 'з-текстом.png'], text: 'написано?\nі тут' }), T('image + text: default prevented'));
  await page.waitForFunction(() => document.querySelector('.ss-att-name')?.textContent === 'з-текстом.png');
  ok((await page.inputValue('.ss-input')) === 'Що тут написано?\nі тут', T('image + text: text pasted'), JSON.stringify(await page.inputValue('.ss-input')));
  // layout with the pasted chip
  const g = await page.evaluate(() => { const r = e => document.querySelector(e).getBoundingClientRect(); return { bar: r('.ss-bar'), c: r('.ss-att-chip'), inp: r('.ss-input') }; });
  ok(await noHScroll(page, width), T('no horizontal scroll'));
  ok(g.c.left >= g.bar.left - 0.5 && g.c.right <= g.bar.right + 0.5 && g.c.bottom <= g.inp.top + 1, T('chip inside the bar, above the textarea'));
  await page.screenshot({ path: path.join(OUT, `paste-${width}.png`), fullPage: !phone });
  // sending uploads the pasted image (resized JPEG)
  await page.click('.ss-send');
  await reply(page, 1);
  const s5 = await pm(page);
  ok(s5.writes.length === 1 && s5.writes[0].type === 'image/jpeg' && s5.writes[0].w === 300 && Array.isArray(s5.last.messages.at(-1).content), T('pasted image sent as a file'), JSON.stringify(s5.writes));
  if (!phone) {
    // the real keyboard path: Ctrl+V of multi-line text, then of an image from the system clipboard
    const multi = 'перший рядок\nдругий рядок\n  третій';
    await page.evaluate(t => navigator.clipboard.writeText(t), multi);
    await page.fill('.ss-input', '');
    await page.focus('.ss-input');
    await page.keyboard.press('Control+V');
    ok((await page.inputValue('.ss-input')) === multi && !(await chip(page)), T('real Ctrl+V: multi-line text as before'), JSON.stringify(await page.inputValue('.ss-input')));
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; c.getContext('2d').fillRect(0, 0, 50, 50);
      const b = await new Promise(r => c.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
    });
    await page.fill('.ss-input', '');
    await page.focus('.ss-input');
    await page.keyboard.press('Control+V');
    ok(await page.waitForSelector('.ss-att-chip .ss-att-name', { timeout: 4000 }).then(() => true, () => false), T('real Ctrl+V of a screenshot: chip'));
    ok((await page.inputValue('.ss-input')) === '', T('real Ctrl+V of a screenshot: no text inserted'));
  }
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}

// ---------------- layout 320 / 390 / 1280 ----------------
for (const [width, height, phone] of [[320, 640, true], [390, 844, true], [1280, 800, false]]) {
  const { ctx, page, errs } = await open(width, height, phone);
  const T = s => `${width}px: ${s}`;
  await page.setInputFiles('.ss-file', txt('Дуже-довга-назва-файлу-з-домашнім-завданням-до-уроку-12-ієрогліфи.txt', 'текст'));
  await page.waitForSelector('.ss-att-chip .ss-att-name');
  await page.fill('.ss-input', 'Перевір, будь ласка');
  const g = await page.evaluate(() => {
    const r = e => document.querySelector(e).getBoundingClientRect();
    const bar = r('.ss-bar'), c = r('.ss-att-chip'), clip = r('.ss-clip'), inp = r('.ss-input'), send = r('.ss-send'), x = r('.ss-att-x');
    return { bar, c, clip, inp, send, x, vw: innerWidth };
  });
  ok(await noHScroll(page, width), T('no horizontal scroll'));
  ok(g.c.left >= g.bar.left - 0.5 && g.c.right <= g.bar.right + 0.5 && g.x.right <= g.bar.right + 0.5, T('chip and × inside the bar'), JSON.stringify({ c: g.c, bar: g.bar }));
  ok(g.bar.left >= 15.5 && g.bar.right <= g.vw - 15.5, T('bar inside the 16 px gutter'), `${g.bar.left}..${g.bar.right} of ${g.vw}`);
  ok(g.c.bottom <= g.inp.top + 1, T('chip above the textarea'));
  ok(g.clip.right <= g.inp.left + 1 && g.inp.right <= g.send.left + 1 && Math.abs(g.clip.bottom - g.send.bottom) < 6, T('clip left, send right, one row'));
  ok(g.inp.width >= 100, T('textarea keeps room'), String(g.inp.width));
  await page.screenshot({ path: path.join(OUT, `layout-${width}.png`), fullPage: true });
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`\n${passed} passed, ${issues.length} failed`);
if (issues.length) { console.log(issues.map(i => ' - ' + i).join('\n')); process.exit(1); }
