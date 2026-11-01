// Full-site QA: opens every route at 1920 (desktop) and 375 (mobile) and checks
// fonts (Cyrillic/Latin → Manrope, Japanese → Noto Serif JP), overflow / cut text,
// horizontal scroll, overlapping text, empty blocks, broken images, console errors.
//
//   npm i --no-save playwright-core        (or QA_MODULES=<dir with node_modules>)
//   node tools/qa-site.mjs [words,grammar,kanji,exam,other] [--no-shots] [--limit N]
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
const groups = (args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || 'words,grammar,kanji,exam,other').split(',');
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
const EXAM_TYPES = ['p', 'v', 'c', 'tj', 'tu', 'w', 'k', 'g', 'l', 'e'];

// A step = { name, hash, act?: [actions] }. Actions run after navigation, each followed by a check.
const plan = { words: [], grammar: [], kanji: [], exam: [], other: [] };
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
plan.exam.push({ name: 'exam-mock', exam: 'mock' });
plan.other.push({ name: 'home-after', hash: '#/' }, { name: 'bad-route', hash: '#/nope' });

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
  const CYR = /[\u0400-\u04FF]/, LAT = /[A-Za-z]/, JP = /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F]/;
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
    const v = { fixed: up.fixed || cs.position === 'fixed', face: up.face || (cs.backfaceVisibility === 'hidden' ? el : null) };
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
    rng.selectNodeContents(n);
    for (const r of rng.getClientRects()) if (r.width > 2 && r.height > 2) boxes.push({ el, r, face: ly.face, x: n.textContent.trim().slice(0, 30) });
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
    if (!el.matches('.panel, .card, section, .tile, .kcell, .choice, .chip, .badge, .btn, li, td, .g-block, .ex-q, .ex-answer:not(:empty), p, h1, h2, h3')) continue;
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
      if (!txt || /^(svg|text|tspan|title|path)$/i.test(el.tagName) || el.closest('svg')) continue;
      const cyr = CYR.test(txt), lat = LAT.test(txt), jp = JP.test(txt);
      if (!cyr && !lat && !jp) continue;
      el.setAttribute('data-qaf', i++);
      const cs = getComputedStyle(el);
      texts.push({ el: label(el), x: txt.slice(0, 50), cyr, lat, jp, ls: cs.letterSpacing, ff: cs.fontFamily.slice(0, 40) });
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
    const symOnly = /[←-⯿☀-➿🀀-🿿]/u.test(t.x);
    const other = fonts.filter(f => !ALLOWED.some(a => f.startsWith(a)) && !(symOnly && /symbol|emoji/.test(f)));
    const noto = fonts.some(f => f.startsWith('noto serif jp')), man = fonts.some(f => f.startsWith('manrope'));
    if (other.length) res.push({ t: 'font-other', el: t.el, d: other.join(', '), x: t.x });
    if ((t.cyr || t.lat) && !man) res.push({ t: 'font-noUI', el: t.el, d: fonts.join(', '), x: t.x });
    if ((t.cyr || t.lat) && !t.jp && noto) res.push({ t: 'font-jp-on-uk', el: t.el, d: fonts.join(', '), x: t.x });
    if (t.jp && !noto) res.push({ t: 'font-noJP', el: t.el, d: fonts.join(', '), x: t.x });
    if (t.cyr && t.jp && t.ls !== 'normal' && parseFloat(t.ls) !== 0) res.push({ t: 'letterspacing-mixed', el: t.el, d: t.ls, x: t.x });
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
}

async function go(P, hash) {
  await P.page.evaluate(h => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash);
}

async function runExam(P, step, group) {
  const conf = { name: '', part: 'all', from: 1, to: 50, mine: !!step.mine, kanji: step.exam === 'k' || step.exam === 'mock', kbook: 'k700', kmode: 'lessons', kfrom: 1, kto: 28, krand: 30,
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

async function runAll(P) {
  for (const g of groups) {
    let n = 0;
    for (const step of plan[g] || []) {
      if (++n > LIMIT) break;
      try {
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
      if (n % 50 === 0) console.log(P.kind, g, n, '/', plan[g].length, 'issues', report.issues.length);
    }
  }
}

const [D, M] = [await makePage('d'), await makePage('m')];
await Promise.all([runAll(D), runAll(M)]);
await browser.close();
srv.close();

// ---------- report ----------
report.finished = new Date().toISOString();
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
console.log(md.slice(0, 4000));
