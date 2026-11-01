// Speech QA: nothing may speak unless a speaker / «Прослухати» button (or V / R key) is pressed.
// Counts speechSynthesis.speak() calls while visiting every tab and study mode, flipping cards,
// going to the next card, answering, running flashcard autoplay and the exam (incl. listening),
// then checks that the speaker buttons do speak, and that 🔇 silences them.
//   QA_MODULES=<dir with node_modules> node tools/qa-speech.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : import.meta.url);
const { chromium } = require('playwright-core');
const PORT = 5194;
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(PORT);

const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// stub speech: count calls, never actually talk
await page.addInitScript(() => {
  window.__spoken = [];
  const ss = window.speechSynthesis;
  ss.speak = u => { window.__spoken.push({ text: u.text, at: location.hash }); setTimeout(() => u.onend?.(), 50); };
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.dismiss().catch(() => {}));
const wait = ms => page.waitForTimeout(ms);
const spoken = () => page.evaluate(() => window.__spoken.splice(0));
const fails = [];
const expectSilent = async label => { const s = await spoken(); if (s.length) fails.push(`${label}: spoke ${s.length}× (${s.map(x => x.text).join(', ')})`); else console.log('silent ✓', label); };
const go = async h => { await page.evaluate(x => (location.hash = x), h); await wait(700); };
const press = async k => { await page.keyboard.press(k); await wait(250); };
const click = async sel => { const el = await page.$(sel); if (el) { await el.click().catch(() => {}); await wait(300); } return !!el; };

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await wait(800);
await expectSilent('home load');
for (const h of ['#/grammar', '#/grammar/1', '#/grammar/30', '#/kanji', '#/kanji/k300-01', '#/kanji/k300-01/k300-001', '#/kanji/k700-01', '#/exam', '#/set/mnn-01']) { await go(h); await page.mouse.move(400, 400); await page.mouse.wheel(0, 600); await wait(300); await expectSilent('visit ' + h); }

// kanji card: next/previous with arrows
await go('#/kanji/k300-01/k300-001'); await press('ArrowRight'); await press('ArrowRight'); await press('ArrowLeft'); await press('Escape');
await expectSilent('kanji card arrows + close');

for (const set of ['mnn-01', 'k300-01', 'k300-01-w']) {
  await go(`#/set/${set}/flashcards`);
  for (let i = 0; i < 4; i++) { await press('Space'); await press('ArrowRight'); }
  await expectSilent(`${set} flashcards flip/next`);
  await click('[data-t="auto"]'); await wait(6500); await click('[data-t="auto"]');
  await expectSilent(`${set} flashcards autoplay (auto-voice off)`);
  for (const m of ['learn', 'write', 'test', 'match', 'listen']) {
    await go(`#/set/${set}/${m}`);
    for (let i = 0; i < 3; i++) {
      if (await page.$('.choice')) await click('.choice');
      else if (await page.$('.answer-input')) { await page.fill('.answer-input', 'x'); await press('Enter'); }
      else if (await page.$('.tile')) { await click('.tile.ja'); await click('.tile.uk'); }
      await press('Enter'); await wait(400);
    }
    await expectSilent(`${set} ${m} answering / next`);
  }
}

// exam with every task type incl. listening
await page.evaluate(() => localStorage.setItem('jp.examPresets.last', JSON.stringify({ name: '', part: 'all', from: 1, to: 50, mine: false, kanji: true, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 3, krand: 30, types: ['l', 'p', 'w', 'k', 'tj'], count: 20, mock: false, timer: 0 })));
await go('#/exam'); await click('[data-start]'); await wait(600);
for (let q = 0; q < 20 && (await page.evaluate(() => location.hash.startsWith('#/exam/run'))); q++) {
  if (await page.$('.ex-answer .choice')) await click('.ex-answer .choice');
  else if (await page.$('.ex-answer .answer-input')) { await page.fill('.ex-answer .answer-input', 'x'); await press('Enter'); }
  else await click('[data-dk]');
  await click('[data-next]');
}
await expectSilent('exam 20 questions incl. listening');

// explicit actions DO speak
const mustSpeak = async (label, fn) => { await fn(); const s = await spoken(); if (s.length !== 1) fails.push(`${label}: expected 1 utterance, got ${s.length}`); else console.log('speaks ✓', label, '→', s[0].text); };
await go('#/set/mnn-01/flashcards'); await mustSpeak('flashcards speaker button', () => click('.fc-tools ~ * [data-say], [data-say]'));
await mustSpeak('flashcards V key', () => press('v'));
await go('#/set/mnn-01/listen'); await mustSpeak('listen «Прослухати»', () => click('[data-play]'));
await mustSpeak('listen replay', () => click('[data-play]'));
await go('#/grammar/1'); await go('#/grammar/2'); await go('#/grammar/1');
await mustSpeak('grammar example speaker (after 3 lesson visits → still once)', () => click('.g-ex [data-say]'));
// auto-voice on → flashcards speak by themselves; 🔇 → nothing at all
await page.evaluate(() => localStorage.setItem('jp.autoSpeak', '1'));
await go('#/set/mnn-01/flashcards'); await wait(300);
const auto = await spoken(); console.log(auto.length ? 'auto-voice on: card spoken ✓' : 'auto-voice on: (prompt side is Ukrainian — spoken on flip)');
await page.evaluate(() => localStorage.setItem('jp.autoSpeak', '0'));
await go('#/'); await click('#sound-btn');
await go('#/set/mnn-01/flashcards'); await click('[data-say]'); await press('v');
await go('#/set/mnn-01/listen'); await click('[data-play]');
await expectSilent('muted 🔇: speaker buttons');
await go('#/'); await click('#sound-btn');

await browser.close(); srv.close();
if (errors.length) fails.push(...errors.map(e => 'pageerror: ' + e));
console.log(fails.length ? `\nFAILED (${fails.length}):\n- ` + fails.join('\n- ') : '\nALL SPEECH CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
