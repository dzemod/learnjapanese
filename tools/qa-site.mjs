// Full-site QA: opens every route at 1920 (desktop) and 375 (mobile) and checks
// fonts (Cyrillic/Latin → Manrope, Japanese → Noto Serif JP), overflow / cut text,
// horizontal scroll, overlapping text, empty blocks, broken images, console errors.
//
//   npm i --no-save playwright-core        (or QA_MODULES=<dir with node_modules>)
//   node tools/qa-site.mjs [words,grammar,kanji,exam,ts,translate,other] [--no-shots] [--limit N]
//   ts = exam «Переклад речень» (realistic answers + verdict checks, all 1254 items self-checked in the browser);
//   translate = Перекладач (ja and uk sentences, word details, examples, history, dialogs; needs internet for MyMemory).
//   QA_VIEW=d|m — only desktop (1920) or only mobile (375); default both in parallel (needs more memory).
//   The page is reopened every QA_RECYCLE steps (default 150) and the report is saved as the run goes,
//   so a long run uses little memory and an interrupted run still leaves a partial report.
//
// Screenshots + report go to qa/ (gitignored): qa/report.json, qa/report.md, qa/shots/{d,m}/*.png
// Chrome: QA_CHROME=<path to chrome.exe> (default: Program Files Google Chrome).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'qa', process.env.QA_OUT || '');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : import.meta.url);
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const groups = (args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || 'words,grammar,kanji,exam,ts,translate,other').split(',');
const SHOTS = !args.includes('--no-shots');
const LIMIT = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : Infinity;
const PORT = +process.env.QA_PORT || 5190;

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
plan.kanji.push({ name: 'kanji', hash: '#/kanji' });
for (const b of kanji) for (const l of b.lessons) {
  plan.kanji.push({ name: `kanji-${l.id}`, hash: `#/kanji/${l.id}` });
  for (const k of l.kanji) plan.kanji.push({ name: `kcard-${k.id}`, hash: `#/kanji/${l.id}/${k.id}`, act: k === l.kanji[0] ? ['click:.modal [data-edit]', 'back', 'click:.modal [data-exedit]'] : [] });
  for (const m of MODES) {
    plan.kanji.push({ name: `kmode-${l.id}-${m}`, hash: `#/set/${l.id}/${m}`, act: modeActs(m) });
    plan.kanji.push({ name: `kmode-${l.id}-w-${m}`, hash: `#/set/${l.id}-w/${m}`, act: modeActs(m) });
  }
}
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
function pageCheck(fontsWanted) {
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
      el.setAttribute('data-qaf', i++);
      const cs = getComputedStyle(el);
      texts.push({ el: label(el), x: txt.slice(0, 50), cyr, lat, jp, sym, ls: cs.letterSpacing, ff: cs.fontFamily.slice(0, 40), ownCyr: CYR.test(txt), ownJp: JP.test(txt) });
    }
  }
  const loaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''));
  return { issues: out, texts, loaded: [...new Set(loaded)] };
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
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
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
  for (const id of nodeIds) {
    const { attributes } = await P.cdp.send('DOM.getAttributes', { nodeId: id });
    const idx = +attributes[attributes.indexOf('data-qaf') + 1];
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
  const r = await P.page.evaluate(pageCheck, !!P.cdp);
  let issues = r.issues;
  if (P.cdp) issues = issues.concat(await fontCheck(P, r.texts));
  if (P.cdp && name === 'home' && !['Manrope', 'Noto Serif JP'].every(f => r.loaded.includes(f))) issues.push({ t: 'fonts-not-loaded', d: r.loaded.join(', ') });
  for (const e of P.errs.splice(0)) issues.push({ t: 'error', d: e });
  if (SHOTS) {
    await P.page.screenshot({ path: path.join(OUT, 'shots', P.kind, safe(name) + '.png'), fullPage: full }).catch(() => {});
    report.shots++;
  }
  report.steps++;
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

async function runAll(P) {
  for (const g of groups) {
    let n = 0;
    for (const step of plan[g] || []) {
      if (++n > LIMIT) break;
      try {
        if (step.selfcheck) { await tsSelfcheck(P, g); continue; }
        if (step.exam) { await runExam(P, step, g); continue; }
        await go(P, step.hash);
        const big = !/^(kcard|mode|kmode)-/.test(step.name);
        await check(P, step.name, g, big);
        for (const [i, a] of (step.act || []).entries()) {
          const did = await act(P, a);
          if (did === false) continue;
          await sleep(200);
          await check(P, `${step.name}~${i + 1}`, g, false);
        }
      } catch (e) { report.issues.push({ v: P.kind, step: step.name, group: g, t: 'runner', d: e.message.slice(0, 200) }); }
      if (n % 50 === 0) { console.log(P.kind, g, n, '/', plan[g].length, 'issues', report.issues.length); writeReport(false); }
      if (++P.used >= RECYCLE) await recycle(P);
    }
  }
}

const RECYCLE = +process.env.QA_RECYCLE || 150;
async function recycle(P) {
  await P.page.context().close().catch(() => {});
  Object.assign(P, await makePage(P.kind), { used: 0 });
}
{
const views = process.env.QA_VIEW ? process.env.QA_VIEW.split(',') : ['d', 'm'];
if (process.env.QA_VIEW) { for (const v of views) { const P = Object.assign(await makePage(v), { used: 0 }); await runAll(P); await P.page.context().close().catch(() => {}); } }
else { const [D, M] = [Object.assign(await makePage('d'), { used: 0 }), Object.assign(await makePage('m'), { used: 0 })]; await Promise.all([runAll(D), runAll(M)]); }
await browser.close();
srv.close();

writeReport(true);
}
// ---------- report ----------
function writeReport(final) {
report.finished = final ? new Date().toISOString() : `(partial, ${new Date().toISOString()})`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const byType = {};
for (const i of report.issues) (byType[i.t] ||= []).push(i);
let md = `# QA report ${report.finished}\n\nGroups: ${groups.join(', ')} · steps: ${report.steps} · screenshots: ${report.shots} · issues: ${report.issues.length}\n`;
for (const [t, list] of Object.entries(byType)) {
  md += `\n## ${t} (${list.length})\n`;
  const uniq = new Map();
  for (const i of list) { const k = `${i.v} ${i.el || ''} ${i.d || ''} ${i.x || ''}`; if (!uniq.has(k)) uniq.set(k, { ...i, n: 0 }); uniq.get(k).n++; }
  for (const i of [...uniq.values()].slice(0, 300)) md += `- [${i.v}] ${i.step} ×${i.n} — ${i.el || ''} ${i.d || ''} ${i.x ? '«' + i.x + '»' : ''}\n`;
}
fs.writeFileSync(path.join(OUT, 'report.md'), md);
if (final) console.log(md.slice(0, 4000));
}
