// Full-site QA: opens every route at 1920 (desktop) and 375 (mobile) and checks
// fonts (Cyrillic/Latin → Manrope, Japanese → Noto Serif JP), overflow / cut text,
// horizontal scroll, overlapping text, empty blocks, broken images, console errors.
//
//   npm i --no-save playwright-core        (or QA_MODULES=<dir with node_modules>)
//   node tools/qa-site.mjs [words,grammar,kanji,exam,ts,translate,other] [--no-shots] [--limit N]
//   ts = exam «Переклад речень» (realistic answers + verdict checks, all 1254 items self-checked in the browser);
//   translate = Перекладач (ja and uk sentences, word details, examples, history, dialogs; needs internet for MyMemory).
//   kanji --quick       20 kanji (every 50th) + 2 lessons' modes, desktop + phone, ≈ 4 min → qa/quick/ (after each change)
//   kanji --batch N     kanji (N-1)*100+1 … N*100 → qa/kanji/bNN/; all batches + merged report: node tools/qa-kanji-full.mjs (before a release)
//   fonttest            self-test: a test page with broken fonts must be reported (desktop): QA_VIEW=d node tools/qa-site.mjs fonttest
//   Font check: once per text style (family, size, weight, style, colour, spacing) + script mix + new characters, cached
//   per route (QA_FONT_CACHE=0 checks every text). The estimated time is printed at the start (learned in qa/.timing.json).
//   QA_PORT=<port> (default 5190) — to run two QA processes at once.
//   QA_VIEW=d|m — only desktop (1920) or only mobile (375); default both in parallel (needs more memory).
//   The page is reopened every QA_RECYCLE steps (default 150) and the report is saved as the run goes,
//   so a long run uses little memory and an interrupted run still leaves a partial report.
//
// Screenshots + report go to qa/ (gitignored): qa/report.json, qa/report.md, qa/shots/{d,m}/*.png
//   QA_BASE=<url> — test a deployed site instead of the local server (e.g. https://learnjapanese-site-two.vercel.app/).
//   QA_STEPS=<name,name,…> — run only these step names (e.g. kcard-k700-046,kmode-k300-15-flashcards).
// Chrome: QA_CHROME=<path to chrome.exe> (default: Program Files Google Chrome).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'qa', process.env.QA_OUT || (process.argv.includes('--quick') ? 'quick' : process.argv.includes('--batch') ? `kanji/b${String(process.argv[process.argv.indexOf('--batch') + 1]).padStart(2, '0')}` : ''));
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : import.meta.url);
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const groups = (args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || 'words,grammar,kanji,exam,ts,translate,other').split(',');
const SHOTS = !args.includes('--no-shots');
const LIMIT = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : Infinity;
const PORT = +process.env.QA_PORT || 5190;
const BASE = process.env.QA_BASE || `http://localhost:${PORT}/`;
const ONLY_STEPS = process.env.QA_STEPS ? new Set(process.env.QA_STEPS.split(',')) : null;

// ---------- static server ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT);

// ---------- routes from the data ----------
const sets = JSON.parse(fs.readFileSync(path.join(SITE, 'data/sets.json'), 'utf8')).sets;
const grammar = JSON.parse(fs.readFileSync(path.join(SITE, 'data/grammar.json'), 'utf8')).lessons;
const kanji = JSON.parse(fs.readFileSync(path.join(SITE, 'data/kanji.json'), 'utf8')).books;
const MODES = ['flashcards', 'learn', 'write', 'test', 'match', 'listen'];
const EXAM_TYPES = ['p', 'v', 'c', 'tj', 'tu', 'w', 'k', 'g', 'l', 'e', 'wt'];

// A step = { name, hash, act?: [actions] }. Actions run after navigation, each followed by a check.
const plan = { words: [], grammar: [], kanji: [], exam: [], ts: [], translate: [], other: [] };
plan.words.push({ name: 'home', hash: '#/' }, { name: 'home-gojuon', hash: '#/', act: ['click:[data-order="gojuon"], [data-v="gojuon"]'] });
for (const s of sets) {
  plan.words.push({ name: `set-${s.id}`, hash: `#/set/${s.id}`, act: ['click:[data-pedit]'] });
  plan.words.push({ name: `set-${s.id}-edit`, hash: `#/set/${s.id}/edit` }, { name: `set-${s.id}-add`, hash: `#/set/${s.id}/add` });
  for (const m of MODES) plan.words.push({ name: `mode-${s.id}-${m}`, hash: `#/set/${s.id}/${m}`, act: modeActs(m) });
}
plan.words.push({ name: 'new-set', hash: '#/new' });
plan.grammar.push({ name: 'grammar', hash: '#/grammar' });
for (const l of grammar) plan.grammar.push({ name: `grammar-${l.lesson}`, hash: `#/grammar/${l.lesson}` });
// Kanji: full = every kanji (≈ 2 660 steps per viewport); --batch N = kanji (N-1)*100+1 … N*100 (10 batches,
// each its own command and report, see tools/qa-kanji-full.mjs); --quick = 20 kanji spread over both books + 2 lessons' modes.
// A lesson's pages (lesson, 12 study modes, writing-mode lesson) go to the batch that holds its first kanji.
const KBATCH = args.includes('--batch') ? +args[args.indexOf('--batch') + 1] : 0;
const QUICK = args.includes('--quick');
const KSIZE = 100;
{
  let idx = 0;
  const inRange = i => (QUICK ? i % 50 === 0 : !KBATCH || (i >= (KBATCH - 1) * KSIZE && i < KBATCH * KSIZE));
  const quickModes = new Set([kanji[0].lessons[0].id, kanji[1]?.lessons[0].id]);
  const head = !KBATCH || KBATCH === 1;
  if (head) plan.kanji.push({ name: 'kanji', hash: '#/kanji' }, { name: 'kwrite', hash: '#/kanji/write', kw: true });
  for (const b of kanji) {
    if (head) plan.kanji.push({ name: `kwrite-${b.id}`, hash: `#/kanji/write/${b.id}`, kw: true });
    for (const l of b.lessons) {
      const first = idx, picked = l.kanji.map((k, j) => inRange(first + j));
      idx += l.kanji.length;
      const lessonHere = QUICK ? picked.some(Boolean) : inRange(first);
      if (lessonHere) plan.kanji.push({ name: `kanji-${l.id}`, hash: `#/kanji/${l.id}` });
      l.kanji.forEach((k, j) => { if (picked[j]) plan.kanji.push({ name: `kcard-${k.id}`, hash: `#/kanji/${l.id}/${k.id}`, act: j === 0 || QUICK ? ['click:.modal [data-edit]', 'back', 'click:.modal [data-exedit]'] : [] }); });
      if (QUICK ? quickModes.has(l.id) : lessonHere) {
        for (const m of MODES) {
          plan.kanji.push({ name: `kmode-${l.id}-${m}`, hash: `#/set/${l.id}/${m}`, act: modeActs(m) });
          plan.kanji.push({ name: `kmode-${l.id}-w-${m}`, hash: `#/set/${l.id}-w/${m}`, act: modeActs(m) });
        }
        plan.kanji.push({ name: `kwrite-${l.id}`, hash: `#/kanji/write/${l.id}`, kw: true, act: ['click:[data-hint]', 'click:[data-skip]'] });
      }
      // writing mode for one kanji: stroke data must load, the right kanji is shown, stroke count = book, hint works
      l.kanji.forEach((k, j) => { if (picked[j]) plan.kanji.push({ name: `kwrite-${k.id}`, hash: `#/kanji/write/${l.id}/${k.id}`, kw: k.kanji, strokes: k.strokes, act: ['click:[data-hint]'] }); });
    }
  }
}
// font self-test (desktop only): a test page with deliberately broken fonts must be reported, also with the font cache
plan.fonttest = [{ name: 'fonttest', fonttest: true }];
plan.exam.push({ name: 'exam', hash: '#/exam' });
for (const t of EXAM_TYPES) plan.exam.push({ name: `exam-${t}`, exam: t });
plan.exam.push({ name: 'exam-mine', exam: 'w', mine: true });
plan.exam.push({ name: 'exam-wt-L1-5', exam: 'wt', from: 1, to: 5 }, { name: 'exam-wt-L26-30', exam: 'wt', from: 26, to: 30 }, { name: 'exam-wt-mine', exam: 'wt', mine: true, from: 1, to: 1 });
plan.exam.push({ name: 'exam-saved-mistakes', hash: '#/exam', act: ['click:[data-saved]', 'wait:.ex-answer'] });
plan.exam.push({ name: 'exam-mock', exam: 'mock' });
plan.other.push({ name: 'home-after', hash: '#/' }, { name: 'bad-route', hash: '#/nope' });
// «Переклад речень»: browser self-check of every item, one exam per 10 lessons, the full mock, saved mistakes
plan.ts.push({ name: 'ts-selfcheck', selfcheck: true });
for (const [a, b] of [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50]]) plan.ts.push({ name: `ts-L${a}-${b}`, exam: 'ts', from: a, to: b });
plan.ts.push({ name: 'ts-setup', hash: '#/exam' }, { name: 'ts-saved', hash: '#/exam', act: ['click:[data-saved]', 'wait:.ex-sentform'] });
// Перекладач
const TR = [
  ['ja-short', '私は毎日日本語を勉強しています。'], ['ja-kana', 'きのう ともだちと えいがを みました。'], ['ja-long', '日本へ来てから、もう3年になりますが、まだ漢字を読むのが難しいと思います。'],
  ['ja-multi', 'この本は面白いです。でも、ちょっと高いですね。駅の前の本屋で買いました。'], ['ja-keigo', '先生はもうお帰りになりました。'], ['ja-passive', '弟に私のケーキを食べられました。'],
  ['uk-short', 'Я хочу поїхати до Японії взимку.'], ['uk-long', 'Вчора я ходив до бібліотеки, взяв дві книжки і потім зустрівся з другом біля станції.'], ['uk-question', 'Скільки коштує цей годинник?'],
];
plan.translate.push({ name: 'tr-empty', hash: '#/translate' });
for (const [n, t] of TR) plan.translate.push({ name: `tr-${n}`, hash: '#/translate/' + encodeURIComponent(t), act: ['wait:.tr-sent .wb', 'wait:.tr-mt .tr-mt-text, .tr-mt [data-mtretry]', 'click:.tr-sent .wb[data-b="0"]', 'click:.tr-sent .wb[data-b="2"]', 'click:.tr-exs details, .tr-hist summary'] });
plan.translate.push({ name: 'tr-addword', hash: '#/translate/' + encodeURIComponent(TR[0][1]), act: ['wait:.tr-sent .wb', 'click:.tr-sent .wb[data-b="0"]', 'click:[data-addword]', 'back'] });
plan.translate.push({ name: 'tr-addsent', hash: '#/translate/' + encodeURIComponent(TR[0][1]), act: ['wait:.tr-sent .wb', 'click:[data-addsent]', 'back'] });
plan.translate.push({ name: 'tr-example', hash: '#/translate/' + encodeURIComponent(TR[6][1]), act: ['wait:.tr-exs .tr-ex', 'click:.tr-exs [data-analyze]', 'wait:.tr-sent .wb'] });
plan.translate.push({ name: 'tr-history', hash: '#/translate', act: ['click:.tr-hist summary', 'click:.tr-hist-item', 'wait:.tr-sent .wb', 'click:[data-clear]'] });
plan.translate.push({ name: 'tr-grammar-button', hash: '#/grammar/14/14-1', act: ['click:a[href^="#/translate/"]', 'wait:.tr-sent .wb'] });

function modeActs(m) {
  if (m === 'flashcards') return ['key:Space', 'key:ArrowRight'];
  if (m === 'learn' || m === 'test' || m === 'listen') return ['click:.choice', 'type:.answer-input=x', 'key:Enter'];
  if (m === 'write') return ['type:.answer-input=x', 'key:Enter'];
  if (m === 'match') return ['click:.match-tile, .tile'];
  return [];
}

// ---------- in-page checks ----------
function pageCheck([fontsWanted, fontCacheOn]) {
  const W = innerWidth;
  const out = [];
  const CYR = /[\u0400-\u04FF]/, LAT = /[A-Za-z]/, JP = /[\u3000-\u303F\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF01-\uFF5E\uFF66-\uFF9F]/;
  const skip = el => el.closest('.bg-wave, .side-accent, #toast, .toast, #syncbar, script, style, noscript, head');
  const visible = el => el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
  const label = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.');
    return s;
  };
  const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const all = [...document.body.querySelectorAll('*')].filter(el => !skip(el));
  const vis = all.filter(visible);

  // horizontal scroll / elements out of the viewport
  const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (docW > W + 1) out.push({ t: 'hscroll', d: `document ${docW}px > ${W}px` });
  const offs = new Set();
  for (const el of vis) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (getComputedStyle(el).position === 'fixed' && r.right <= 0) continue;
    if (r.right > W + 1 || r.left < -1) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1 && pr.left >= -1) { clipped = true; break; } }
        p = p.parentElement;
      }
      if (!clipped) offs.add(el);
    }
  }
  for (const el of offs) if (!offs.has(el.parentElement)) { const r = el.getBoundingClientRect(); out.push({ t: 'offscreen', el: label(el), d: `${Math.round(r.left)}…${Math.round(r.right)} (vw ${W})`, x: (el.innerText || '').slice(0, 60) }); }

  // cut / spilling text
  for (const el of vis) {
    if (/^(INPUT|TEXTAREA|SELECT|svg|path|OPTION|text|tspan|g)$/i.test(el.tagName) || el.closest("svg")) continue;
    const txt = ownText(el);
    if (!txt) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || !el.clientWidth) continue;
    const clipX = /(hidden|clip)/.test(cs.overflowX), clipY = /(hidden|clip)/.test(cs.overflowY);
    const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
    if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') { if (dy > 2) out.push({ t: 'clamped', el: label(el), x: txt.slice(0, 60) }); continue; }
    if (dx > 1 && (clipX || cs.textOverflow === 'ellipsis')) out.push({ t: 'cut', el: label(el), d: `+${dx}px`, x: txt.slice(0, 60) });
    else if (dy > 2 && clipY) out.push({ t: 'cut-y', el: label(el), d: `+${dy}px`, x: txt.slice(0, 60) });
    else if (dx > 1 && !/(auto|scroll)/.test(cs.overflowX)) out.push({ t: 'spill', el: label(el), d: `+${dx}px`, x: txt.slice(0, 60) });
  }

  // overlapping text (text-node boxes of different elements) and controls
  // With a dialog open only the dialog is checked (the page underneath is covered on purpose);
  // otherwise text inside fixed layers is skipped. Flip-card faces (backface hidden) never pair.
  const boxes = [];
  const modal = [...document.querySelectorAll('.modal-back')].pop();
  const cache = new Map();
  const layer = el => { // { fixed, face } of the nearest ancestors
    if (!el || el === document.body) return { fixed: false, face: null };
    if (cache.has(el)) return cache.get(el);
    const up = layer(el.parentElement), cs = getComputedStyle(el);
    const clipsHere = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    const v = { fixed: up.fixed || cs.position === 'fixed' || cs.position === 'sticky', face: up.face || (cs.backfaceVisibility === 'hidden' ? el : null), clip: clipsHere ? el.getBoundingClientRect() : up.clip };
    cache.set(el, v);
    return v;
  };
  const walker = document.createTreeWalker(modal || document.body, NodeFilter.SHOW_TEXT);
  const rng = document.createRange();
  for (let n; (n = walker.nextNode());) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || skip(el) || !visible(el)) continue;
    const ly = layer(el);
    if (!modal && ly.fixed) continue;
    const inClip = r => !ly.clip || (r.left + r.width / 2 >= ly.clip.left && r.left + r.width / 2 <= ly.clip.right && r.top + r.height / 2 >= ly.clip.top && r.top + r.height / 2 <= ly.clip.bottom);
    rng.selectNodeContents(n);
    for (const r of rng.getClientRects()) if (r.width > 2 && r.height > 2 && inClip(r)) boxes.push({ el, r, face: ly.face, x: n.textContent.trim().slice(0, 30) });
  }
  boxes.sort((a, b) => a.r.top - b.r.top);
  const seen = new Set();
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].r.top < a.r.bottom; j++) {
      const b = boxes[j];
      if (a.el === b.el || (a.face && b.face && a.face !== b.face)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 3 && h > Math.min(a.r.height, b.r.height) * 0.4) {
        const k = label(a.el) + '|' + label(b.el);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ t: 'overlap', el: k, x: `${a.x} ⟷ ${b.x}` });
      }
    }
  }

  // empty blocks
  for (const el of vis) {
    if (!el.matches('.panel, .card, section, .tile, .kcell, .choice, .chip, .badge, .btn, li, .g-block, .ex-q, .ex-answer:not(:empty), p, h1, h2, h3')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if ((el.innerText || '').trim() || el.querySelector('img, svg, canvas, input, textarea, select, video, iframe')) continue;
    out.push({ t: 'empty', el: label(el), d: `${Math.round(r.width)}×${Math.round(r.height)}` });
  }

  // broken images
  for (const img of document.images) if (img.complete && !img.naturalWidth && visible(img)) out.push({ t: 'img', el: label(img), x: img.src.slice(0, 90) });

  // text samples for the font check (tag elements with their own text)
  const texts = [];
  // kept on the page while the route stays the same (the action steps of one route share it)
  if (!window.__qaFC || window.__qaFC.hash !== location.hash) window.__qaFC = { hash: location.hash, map: new Map() };
  const fontCache = window.__qaFC.map;
  let fontSkipped = 0;
  if (fontsWanted) {
    let i = 0;
    for (const el of vis) {
      const txt = ownText(el);
      // form fields render their value in a shadow tree: the platform-font API reports nothing for them
      if (!txt || /^(svg|text|tspan|title|path|textarea|input|select|option)$/i.test(el.tagName) || el.closest('svg')) continue;
      // fonts are reported for the whole subtree → classify the whole subtree text
      const full = el.textContent;
      const cyr = CYR.test(full), lat = LAT.test(full), jp = JP.test(full);
      if (!cyr && !lat && !jp) continue;
      // symbols Manrope has no glyph for (★ ← → ◊ ①, combining accents…) legitimately come from Noto Serif JP
      const sym = /[^\u0000-ɏЀ-ӿ -⁯№\s]/.test(full.replace(/[　-ヿ㐀-鿿豈-﫿＀-￯]/g, ''));
      const cs = getComputedStyle(el);
      // Font cache: the font a browser draws a character with depends only on the character and the style
      // (family, size, weight, style, colour) — so a text is checked only if it brings a character not yet
      // checked with the same style and the same script mix. Same style + already-checked characters = same fonts.
      const key = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.color, cs.letterSpacing, cyr, lat, jp, sym, CYR.test(txt), JP.test(txt)].join('|');
      const seenChars = fontCache.get(key) || new Set();
      const fresh = [...new Set(full.replace(/\s/g, ''))].filter(c => !seenChars.has(c));
      if (!fresh.length && fontCacheOn) { fontSkipped++; continue; }
      fresh.forEach(c => seenChars.add(c)); fontCache.set(key, seenChars);
      el.setAttribute('data-qaf', i++);
      texts.push({ el: label(el), x: txt.slice(0, 50), cyr, lat, jp, sym, ls: cs.letterSpacing, ff: cs.fontFamily.slice(0, 40), ownCyr: CYR.test(txt), ownJp: JP.test(txt) });
    }
  }
  const loaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''));
  return { issues: out, texts, loaded: [...new Set(loaded)], fontSkipped };
}

// ---------- runner ----------
const report = { started: new Date().toISOString(), groups, steps: 0, shots: 0, issues: [] };
fs.mkdirSync(path.join(OUT, 'shots/d'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'shots/m'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALLOWED = ['manrope', 'noto serif jp'];

async function makePage(kind) {
  const ctx = await browser.newContext(kind === 'd' ? { viewport: { width: 1920, height: 1080 } } : { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('requestfailed', r => { if (!/speech|favicon/.test(r.url())) errs.push('requestfailed: ' + r.url().slice(0, 120)); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) errs.push(`http ${r.status()}: ${r.url().slice(0, 120)}`); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const cdp = kind === 'd' ? await ctx.newCDPSession(page) : null;
  if (cdp) { await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); }
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { kind, page, cdp, errs };
}

async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('#app > .loading'), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await sleep(250);
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

async function fontCheck(P, texts) {
  const res = [];
  const { root } = await P.cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await P.cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-qaf]' });
  // both lists are in document order → the n-th node is texts[n] (no getAttributes round trip)
  for (const [idx, id] of nodeIds.entries()) {
    const t = texts[idx];
    if (!t) continue;
    let fonts = [];
    try { fonts = (await P.cdp.send('CSS.getPlatformFontsForNode', { nodeId: id })).fonts.map(f => f.familyName.toLowerCase()); } catch { continue; }
    const symOnly = t.sym;
    const other = fonts.filter(f => !ALLOWED.some(a => f.startsWith(a)) && !(symOnly && /symbol|emoji/.test(f)));
    const noto = fonts.some(f => f.startsWith('noto serif jp')), man = fonts.some(f => f.startsWith('manrope'));
    if (other.length) res.push({ t: 'font-other', el: t.el, d: other.join(', '), x: t.x });
    if ((t.cyr || t.lat) && !man) res.push({ t: 'font-noUI', el: t.el, d: fonts.join(', '), x: t.x });
    if ((t.cyr || t.lat) && !t.jp && !t.sym && noto) res.push({ t: 'font-jp-on-uk', el: t.el, d: fonts.join(', '), x: t.x });
    if (t.jp && !noto) res.push({ t: 'font-noJP', el: t.el, d: fonts.join(', '), x: t.x });
    if (t.ownCyr && t.ownJp && t.ls !== 'normal' && parseFloat(t.ls) !== 0) res.push({ t: 'letterspacing-mixed', el: t.el, d: t.ls, x: t.x });
  }
  await P.page.evaluate(() => document.querySelectorAll('[data-qaf]').forEach(e => e.removeAttribute('data-qaf')));
  return res;
}

const safe = s => s.replace(/[^a-z0-9-]+/gi, '_').slice(0, 90);
async function check(P, name, group, full = true) {
  await settle(P.page);
  const r = await P.page.evaluate(pageCheck, [!!P.cdp, process.env.QA_FONT_CACHE !== '0']);
  let issues = r.issues;
  if (P.cdp) { issues = issues.concat(await fontCheck(P, r.texts)); report.fontChecked = (report.fontChecked || 0) + r.texts.length; report.fontSkipped = (report.fontSkipped || 0) + r.fontSkipped; }
  if (P.cdp && name === 'home' && !['Manrope', 'Noto Serif JP'].every(f => r.loaded.includes(f))) issues.push({ t: 'fonts-not-loaded', d: r.loaded.join(', ') });
  for (const e of P.errs.splice(0)) issues.push({ t: 'error', d: e });
  // exam instructions carry no hint in brackets (e.g. the form name): task line of a question, section task of the paper
  for (const t of await P.page.$$eval('.q-label, .u-task', els => els.map(e => e.textContent)).catch(() => [])) if (/[(（]/.test(t)) issues.push({ t: 'exam-label-hint', d: t });
  if (SHOTS) {
    await P.page.screenshot({ path: path.join(OUT, 'shots', P.kind, safe(name) + '.png'), fullPage: full }).catch(() => {});
    report.shots++;
  }
  report.steps++;
  doneSteps[P.kind]++;
  const hash = await P.page.evaluate(() => location.hash);
  for (const i of issues) report.issues.push({ v: P.kind, step: name, group, hash, ...i });
}

async function act(P, a) {
  const page = P.page;
  if (a === 'back') { await page.keyboard.press('Escape'); return; }
  const [kind, rest] = [a.slice(0, a.indexOf(':')), a.slice(a.indexOf(':') + 1)];
  if (kind === 'key') return page.keyboard.press(rest);
  if (kind === 'click') { const el = await page.$(rest); if (el) await el.click({ timeout: 3000 }).catch(() => {}); return !!el; }
  if (kind === 'type') { const [sel, val] = rest.split('='); const el = await page.$(sel); if (el) await el.fill(val).catch(() => {}); return !!el; }
  if (kind === 'wait') { const ok = await page.waitForSelector(rest, { timeout: 90000 }).then(() => true, () => false); if (!ok) report.issues.push({ v: P.kind, step: 'wait', t: 'wait-timeout', d: rest, hash: await page.evaluate(() => location.hash) }); return ok; }
}

async function go(P, hash) {
  await P.page.evaluate(h => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash);
}

async function runExam(P, step, group) {
  const conf = { name: '', part: 'all', from: step.from || 1, to: step.to || 50, tsAdded: true, mine: !!step.mine, kanji: step.exam === 'k' || step.exam === 'mock', kbook: 'k700', kmode: 'lessons', kfrom: 1, kto: 28, krand: 30,
    types: step.exam === 'mock' ? EXAM_TYPES : [step.exam], count: 50, mock: step.exam === 'mock', timer: step.exam === 'mock' ? 90 : 0 };
  await P.page.evaluate(c => { localStorage.setItem('jp.examPresets.last', JSON.stringify(c)); sessionStorage.removeItem('jp.examSession'); }, conf);
  await go(P, '#/exam/');
  await go(P, '#/exam');
  await settle(P.page);
  await P.page.click('[data-start]');
  await settle(P.page);
  if (!(await P.page.evaluate(() => location.hash.startsWith('#/exam/run')))) { report.issues.push({ v: P.kind, step: step.name, group, t: 'exam-no-start', d: await P.page.evaluate(() => document.querySelector('#toast, .toast')?.innerText || '') }); return; }
  for (let q = 0; q < 70; q++) {
    if (!(await P.page.evaluate(() => location.hash.startsWith('#/exam/run')))) break;
    await check(P, `${step.name}-q${q + 1}`, group, false);
    const page = P.page;
    if (await page.$('.ex-wtform')) { await answerWt(P, step, group, q); continue; }
    if (await page.$('.ex-sentform')) { await answerTs(P, step, group, q); continue; }
    if (await page.$('.ex-answer .choice')) await page.click('.ex-answer .choice');
    else if (await page.$('.ex-answer .answer-input')) { await page.fill('.ex-answer .answer-input', 'x'); await page.press('.ex-answer .answer-input', 'Enter'); }
    else if (await page.$('[data-t]')) { for (let i = 0; i < 30 && (await page.$('[data-t]')); i++) await page.click('[data-t]'); await page.click('[data-check]').catch(() => {}); }
    else if (await page.$('[data-c]')) {
      await page.click('[data-c]');
      await sleep(150);
      if (await page.$('.ex-fix .choice')) await page.click('.ex-fix .choice');
      else if (await page.$('.ex-fix .answer-input')) { await page.fill('.ex-fix .answer-input', 'x'); await page.press('.ex-fix .answer-input', 'Enter'); }
    }
    await sleep(150);
    if (!(await page.$('[data-next]'))) { await page.click('[data-dk]').catch(() => {}); await sleep(150); }
    if (q < 3 || q % 10 === 0) await check(P, `${step.name}-q${q + 1}-fb`, group, false);
    if (!(await page.$('[data-next]'))) { report.issues.push({ v: P.kind, step: step.name, group, t: 'exam-stuck', d: `question ${q + 1}` }); break; }
    await page.click('[data-next]');
    await sleep(100);
  }
  await check(P, `${step.name}-result`, group);
}

// «Переклад речень»: 8 answer strategies in turn; verdicts that must be «Правильно» are verified
async function answerTs(P, step, group, q) {
  const page = P.page;
  const it = await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); return S.qs[S.i]; });
  const toks = it.it.k.filter(t => t[2] !== 's');
  const kana = toks.map(t => t[1]).join('');
  const mode = q % 8;
  const inp = '.ex-sentform textarea';
  let answer = '', expectOk = false, label = '';
  if (mode === 0) { answer = kana; expectOk = true; label = 'kana'; }
  else if (mode === 1) { answer = it.answer; expectOk = true; label = 'kanji'; }
  else if (mode === 2) { const i = toks.findIndex(t => t[2] === 'p' && ['を', 'が', 'で', 'に', 'は'].includes(t[0])); answer = toks.map((t, j) => (j === i ? (t[0] === 'を' ? 'が' : 'を') : t[1])).join(''); label = 'wrong-particle'; }
  else if (mode === 3) { answer = kana.slice(0, Math.ceil(kana.length / 2)); label = 'half'; }
  else if (mode === 5) { for (const h of ['w', 'g', 'f']) await page.click(`[data-hint="${h}"]`).catch(() => {}); await check(P, `${step.name}-q${q + 1}-hints`, group, false); answer = kana; expectOk = true; label = 'hints'; }
  else if (mode === 7) { answer = kana.replace(/ます$|です$|た$/, 'ませんでした'); if (answer === kana) answer = kana.slice(0, -1) + 'ませんでした' + kana.slice(-1); label = 'wrong-form'; }
  if (mode === 4) {
    label = 'romaji';
    if (!(await page.isChecked('[data-romaji]'))) await page.click('[data-romaji]');
    await page.waitForFunction(() => window.wanakana, null, { timeout: 20000 }).catch(() => {});
    // ん as «nn» (as a learner types it before な/に…; a single n would join the next vowel)
    const rom = await page.evaluate(k => window.wanakana?.toRomaji(k, { customRomajiMapping: { ん: 'nn' } }) || '', kana);
    await page.click(inp);
    await page.keyboard.type(rom, { delay: 5 });
    await page.click('[data-romaji]');
    await page.keyboard.press('Enter');
    expectOk = true;
  } else if (mode === 6) { label = 'dont-know'; await page.click('[data-dk]'); }
  else { await page.fill(inp, answer); await page.press(inp, 'Enter'); }
  const ok = await page.waitForSelector('[data-next]', { timeout: 90000 }).then(() => true, () => false);
  if (!ok) { report.issues.push({ v: P.kind, step: step.name, group, t: 'ts-stuck', d: `${it.uid} ${label}` }); await page.click('[data-dk]').catch(() => {}); await sleep(300); }
  const verdict = await page.$eval('.ex-feedback .feedback', e => e.textContent).catch(() => '');
  if (expectOk && !/^Правильно/.test(verdict)) report.issues.push({ v: P.kind, step: step.name, group, t: 'ts-verdict', d: `${it.uid} ${label}: «${mode === 4 ? 'romaji' : answer}» → ${verdict}`, x: it.answer });
  if (!expectOk && mode !== 2 && /^Правильно/.test(verdict)) report.issues.push({ v: P.kind, step: step.name, group, t: 'ts-wrong-accepted', d: `${it.uid} ${label}: «${answer}» → ${verdict}`, x: it.answer });
  if (mode === 6) await page.click('[data-right]').catch(() => {});
  if (mode === 7) await page.click('[data-flag]').catch(() => {});
  await check(P, `${step.name}-q${q + 1}-${label}`, group, false);
  await page.click('[data-next]').catch(() => {});
  await sleep(100);
}
// «Слово: напиши сам(а)»: kanji, kana with spaces, dictionary form, romaji, hint, wrong, «Не знаю» + «Я мав(ла) рацію», flag
async function answerWt(P, step, group, q) {
  const page = P.page;
  const it = await page.evaluate(() => { const S = JSON.parse(sessionStorage.getItem('jp.examSession')); return S.qs[S.i]; });
  const main = it.cards[0], kana = main.reading || main.japanese;
  const dict = it.cards.find(c => /ます$/.test(main.japanese) && !/ます$/.test(c.japanese));
  const mode = q % 8, inp = '.ex-wtform .answer-input';
  let answer = '', expectOk = false, label = '';
  if (mode === 0) { answer = main.japanese; expectOk = true; label = 'kanji'; }
  else if (mode === 1) { answer = ' ' + [...kana].join(' ') + ' '; expectOk = true; label = 'kana-spaces'; }
  else if (mode === 2) { answer = dict ? dict.reading || dict.japanese : kana; expectOk = true; label = dict ? 'dict' : 'kana'; }
  else if (mode === 4) { await page.click('[data-hint="k"]'); answer = kana; expectOk = true; label = 'hint'; }
  else if (mode === 5 || mode === 7) { answer = 'ぬぬぬ'; label = mode === 5 ? 'wrong' : 'wrong-flag'; }
  if (mode === 3) {
    label = 'romaji';
    if (!(await page.isChecked('[data-romaji]'))) await page.click('[data-romaji]');
    await page.waitForFunction(() => window.wanakana, null, { timeout: 20000 }).catch(() => {});
    const rom = await page.evaluate(k => window.wanakana?.toRomaji(k.replace(/[～〜~]/g, ''), { customRomajiMapping: { ん: 'nn' } }) || '', kana);
    await page.click(inp);
    await page.keyboard.type(rom, { delay: 5 });
    await page.click('[data-romaji]');
    await page.press(inp, 'Enter');
    answer = rom; expectOk = !/[ァ-ヶー]/.test(kana); // wanakana writes long katakana vowels as hiragana
  } else if (mode === 6) { label = 'dont-know'; await page.click('[data-dk]'); }
  else { await page.fill(inp, answer); await page.press(inp, 'Enter'); }
  const ok = await page.waitForSelector('[data-next]', { timeout: 10000 }).then(() => true, () => false);
  if (!ok) { report.issues.push({ v: P.kind, step: step.name, group, t: 'wt-stuck', d: `${it.uid} ${label}` }); await page.click('[data-dk]').catch(() => {}); await sleep(300); }
  const verdict = await page.$eval('.ex-feedback .feedback', e => e.textContent).catch(() => '');
  if (expectOk && !/^Правильно/.test(verdict)) report.issues.push({ v: P.kind, step: step.name, group, t: 'wt-verdict', d: `${it.uid} ${label}: «${answer}» → ${verdict}`, x: main.japanese + ' ' + kana });
  if (!expectOk && mode !== 3 && /^Правильно/.test(verdict)) report.issues.push({ v: P.kind, step: step.name, group, t: 'wt-wrong-accepted', d: `${it.uid} ${label}: «${answer}» → ${verdict}` });
  if (mode === 4 && !/75%/.test(verdict)) report.issues.push({ v: P.kind, step: step.name, group, t: 'wt-hint-score', d: `${it.uid}: ${verdict}` });
  if (mode === 6) await page.click('[data-right]').catch(() => {});
  if (mode === 7) await page.click('[data-flag]').catch(() => {});
  await check(P, `${step.name}-q${q + 1}-${label}`, group, false);
  await page.click('[data-next]').catch(() => {});
  await sleep(100);
}
// every item accepts its own model answer in the browser too (same module as the site)
async function tsSelfcheck(P, group) {
  await go(P, '#/exam'); await settle(P.page);
  const bad = await P.page.evaluate(async () => {
    const m = await import('./js/sentcheck.js');
    const bank = await fetch('data/exam.json').then(r => r.json());
    const out = []; let n = 0;
    for (const it of bank.lessons.flatMap(l => l.items).filter(i => i.t === 'ts')) {
      const models = [it.k, ...(it.alt || [])];
      for (const ans of [it.ja.replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1'), it.k.filter(t => t[2] !== 's').map(t => t[1]).join('')]) {
        n++;
        const pre = m.preKana(ans, models);
        const r = m.checkSentence(pre.text, models);
        if (r.verdict !== 'ok') out.push(`${it.id}: «${ans}» → ${r.verdict}`);
      }
    }
    return { n, out };
  });
  report.steps++;
  console.log(P.kind, 'ts self-check:', bad.n, 'answers,', bad.out.length, 'problems');
  for (const d of bad.out) report.issues.push({ v: P.kind, step: 'ts-selfcheck', group, t: 'ts-selfcheck', d });
}

// Broken fonts that must be caught: (1) a whole text in Courier New, (2) twelve texts of one style — eleven fine,
// the last one with a letter the site fonts lack (Ѣ → system fallback; same style and script mix, so only the
// character cache can let it through), (3) Japanese forced into a font without kana, (4) a clean control text.
async function fontSelfTest(P, group) {
  if (!P.cdp) return;
  await go(P, '#/'); await settle(P.page);
  await P.page.evaluate(() => {
    const box = document.createElement('section');
    box.id = 'qa-fonttest';
    box.innerHTML = '<p class="ft-courier" style="font-family:Courier New">Зламаний шрифт</p>'
      + Array.from({ length: 11 }, () => '<p class="ft-same">Привіт, світе</p>').join('') + '<p class="ft-same ft-rare">Привѣт, свѢте</p>'
      + '<p class="ft-jp" style="font-family:Manrope">ひらがな カタカナ</p><p class="ft-ok">Усе гаразд</p>';
    document.querySelector('#app').prepend(box);
  });
  const before = report.issues.length;
  await check(P, 'fonttest', group);
  const got = report.issues.slice(before).filter(i => i.t.startsWith('font'));
  const want = { courier: /ft-courier/, rare: /ft-rare/, japanese: /ft-jp/ };
  const res = Object.entries(want).map(([k, re]) => [k, got.some(i => re.test(i.el))]);
  const falsePos = got.filter(i => /ft-ok/.test(i.el) || (/ft-same/.test(i.el) && !/ft-rare/.test(i.el)));
  console.log('font self-test:', res.map(([k, ok]) => `${k} ${ok ? 'caught' : 'MISSED'}`).join(', '), '· false alarms', falsePos.length);
  // the expected findings are not problems of the site: replace them by a pass/fail line
  report.issues.splice(before, report.issues.length - before, ...report.issues.slice(before).filter(i => !i.t.startsWith('font') && i.t !== 'error'));
  for (const [k, ok] of res) if (!ok) report.issues.push({ v: P.kind, step: 'fonttest', group, t: 'fonttest-missed', d: k });
  for (const i of falsePos) report.issues.push({ v: P.kind, step: 'fonttest', group, t: 'fonttest-false-alarm', el: i.el, d: i.d });
  report.fonttest = Object.fromEntries(res);
}

// writing mode: wait for the stroke data (or the «no data» message); for one kanji the shown kanji must be the requested one
async function kwReady(P, step, group) {
  const st = await P.page.waitForFunction(() => {
    if (document.querySelector('.kw-done')) return 'done';
    if (document.querySelector('.kw-pad .so-missing')) return 'missing';
    return document.querySelector('.kw-diag svg path, .kw-hint path') || (document.querySelector('.kw-canvas') && document.querySelector('.kw-diag[hidden]')) ? 'ok' : false;
  }, null, { timeout: 20000 }).then(h => h.jsonValue(), () => 'timeout');
  if (st === 'missing' || st === 'timeout') report.issues.push({ v: P.kind, step: step.name, group, t: 'kw-' + st, d: typeof step.kw === 'string' ? step.kw : step.hash });
  if (typeof step.kw === 'string') {
    const shown = await P.page.evaluate(() => [...document.querySelectorAll('.kw-ex-list ruby')].map(r => r.textContent).join(' '));
    report.kwChecked = (report.kwChecked || 0) + 1;
    const n = await P.page.$eval('.kw-diag svg path', ps => ps.length);
    if (st === 'ok' && step.strokes && n && n !== step.strokes) report.issues.push({ v: P.kind, step: step.name, group, t: 'kw-stroke-count', d: `${step.kw}: KanjiVG ${n}, book ${step.strokes}` });
    if (st === 'ok' && shown && !shown.includes(step.kw) && !shown.includes('◯')) report.issues.push({ v: P.kind, step: step.name, group, t: 'kw-wrong-kanji', d: step.kw, x: shown.slice(0, 60) });
  }
}

async function runAll(P) {
  const t0 = Date.now();
  try { await runGroups(P); } finally { viewSec[P.kind] = (Date.now() - t0) / 1000; }
}
async function runGroups(P) {
  for (const g of groups) {
    let n = 0;
    for (const step of plan[g] || []) {
      if (ONLY_STEPS && !ONLY_STEPS.has(step.name)) continue;
      if (++n > LIMIT) break;
      try {
        if (step.selfcheck) { await tsSelfcheck(P, g); continue; }
        if (step.fonttest) { await fontSelfTest(P, g); continue; }
        if (step.exam) { await runExam(P, step, g); continue; }
        await go(P, step.hash);
        const big = !/^(kcard|mode|kmode|kwrite)-/.test(step.name);
        if (step.kw) await kwReady(P, step, g);
        await check(P, step.name, g, big);
        for (const [i, a] of (step.act || []).entries()) {
          const did = await act(P, a);
          if (did === false) continue;
          await sleep(200);
          await check(P, `${step.name}~${i + 1}`, g, false);
        }
      } catch (e) { report.issues.push({ v: P.kind, step: step.name, group: g, t: 'runner', d: e.message.slice(0, 200) }); }
      if (n % 50 === 0) { console.log(P.kind, g, n, '/', plan[g].length, 'issues', report.issues.length, '· left ≈', eta(P.kind)); writeReport(false); }
      if (++P.used >= RECYCLE) await recycle(P);
    }
  }
}

const RECYCLE = +process.env.QA_RECYCLE || 150;
// ---------- time estimate: seconds per step per viewport and group, learned from previous runs (qa/.timing.json) ----------
const TIMING_F = path.join(ROOT, 'qa', '.timing.json');
const DEFAULT_SPS = { d: 3, m: 1.2 };
let timing = {};
try { timing = JSON.parse(fs.readFileSync(TIMING_F, 'utf8')); } catch {}
const sps = (v, g) => timing[`${v}/${g}`]?.sps ?? DEFAULT_SPS[v];
const stepCount = g => Math.min(LIMIT, (plan[g] || []).filter(s => !ONLY_STEPS || ONLY_STEPS.has(s.name)).reduce((n, s) => n + 1 + (s.act || []).length + (s.exam ? 60 : 0), 0));
const fmtMin = sec => (sec < 90 ? `${Math.round(sec)} с` : sec < 5400 ? `${Math.round(sec / 60)} хв` : `${(sec / 3600).toFixed(1)} год`);
const runStart = Date.now();
const doneSteps = { d: 0, m: 0 }, viewSec = {};
function eta(v) { // remaining time of this viewport from its own speed so far
  const total = groups.reduce((n, g) => n + stepCount(g), 0), done = doneSteps[v];
  return done ? fmtMin(((Date.now() - runStart) / 1000 / done) * (total - done)) : '?';
}
async function recycle(P) {
  await P.page.context().close().catch(() => {});
  Object.assign(P, await makePage(P.kind), { used: 0 });
}
{
const views = process.env.QA_VIEW ? process.env.QA_VIEW.split(',') : ['d', 'm'];
{
  const per = views.map(v => groups.reduce((t, g) => t + stepCount(g) * sps(v, g), 0));
  const est = process.env.QA_VIEW ? per.reduce((a, b) => a + b, 0) : Math.max(...per);
  console.log(`QA: ${groups.join(',')}${QUICK ? ' (quick)' : KBATCH ? ` (batch ${KBATCH})` : ''} · ${groups.reduce((n, g) => n + stepCount(g), 0)} checks per viewport · ${views.join('+')} · estimated time ≈ ${fmtMin(est)}${Object.keys(timing).length ? '' : ' (first run: rough guess)'}`);
}
if (process.env.QA_VIEW) { for (const v of views) { const P = Object.assign(await makePage(v), { used: 0 }); await runAll(P); await P.page.context().close().catch(() => {}); } }
else { const [D, M] = [Object.assign(await makePage('d'), { used: 0 }), Object.assign(await makePage('m'), { used: 0 })]; await Promise.all([runAll(D), runAll(M)]); }
await browser.close();
srv.close();
if (!ONLY_STEPS && LIMIT === Infinity) {
  for (const v of views) { const n = doneSteps[v]; if (n > 20 && viewSec[v]) for (const g of groups) timing[`${v}/${g}`] = { sps: +(viewSec[v] / n).toFixed(3), at: new Date().toISOString() }; }
  try { fs.writeFileSync(TIMING_F, JSON.stringify(timing, null, 1)); } catch {}
}
report.seconds = Math.round((Date.now() - runStart) / 1000);

writeReport(true);
}
// ---------- report ----------
function writeReport(final) {
report.finished = final ? new Date().toISOString() : `(partial, ${new Date().toISOString()})`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const byType = {};
for (const i of report.issues) (byType[i.t] ||= []).push(i);
let md = `# QA report ${report.finished}\n\nGroups: ${groups.join(', ')}${QUICK ? ' (quick)' : KBATCH ? ` (batch ${KBATCH})` : ''} · steps: ${report.steps} · screenshots: ${report.shots} · issues: ${report.issues.length}${report.seconds ? ` · time: ${fmtMin(report.seconds)}` : ''}${report.fontChecked != null ? ` · font checks: ${report.fontChecked} (cached: ${report.fontSkipped})` : ''}${report.kwChecked ? ` · writing-mode kanji: ${report.kwChecked}` : ''}\n`;
for (const [t, list] of Object.entries(byType)) {
  md += `\n## ${t} (${list.length})\n`;
  const uniq = new Map();
  for (const i of list) { const k = `${i.v} ${i.el || ''} ${i.d || ''} ${i.x || ''}`; if (!uniq.has(k)) uniq.set(k, { ...i, n: 0 }); uniq.get(k).n++; }
  for (const i of [...uniq.values()].slice(0, 300)) md += `- [${i.v}] ${i.step} ×${i.n} — ${i.el || ''} ${i.d || ''} ${i.x ? '«' + i.x + '»' : ''}\n`;
}
fs.writeFileSync(path.join(OUT, 'report.md'), md);
if (final) console.log(md.slice(0, 4000));
}
