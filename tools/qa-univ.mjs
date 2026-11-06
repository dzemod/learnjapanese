// Browser QA of the exam «Університетська версія» + the «Типи завдань» panel (1920 and 375 px).
//   npm i --no-save playwright-core   (or QA_MODULES=<dir with node_modules>), Chrome installed
//   node tools/qa-univ.mjs            → screenshots and report in qa/univ/
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const OUT = path.join(ROOT, 'qa/univ');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, 'site', p);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
});
await new Promise(r => srv.listen(0, r));
const PORT = srv.address().port;
const issues = [];
let steps = 0;
const bad = (v, step, d) => { issues.push(`${v} · ${step}: ${d}`); console.log('ISSUE', v, step, d); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const RANGES = [[1, 5], [34, 42], [26, 50], [1, 35], [1, 50], [8, 8]];
for (const [kind, width, height] of [['desktop', 1920, 1080], ['mobile', 375, 780]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: kind === 'mobile', isMobile: kind === 'mobile', locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
  page.on('dialog', d => d.accept());
  const overflow = async step => {
    steps++;
    const r = await page.evaluate(() => {
      const w = document.documentElement.clientWidth, out = [];
      if (document.documentElement.scrollWidth > w + 1) out.push(`page ${document.documentElement.scrollWidth} > ${w}`);
      for (const el of document.querySelectorAll('.exam *, .u-paper *')) {
        const b = el.getBoundingClientRect();
        if (b.width && b.right > w + 1 && !el.closest('.seg')) { out.push(`${el.tagName}.${el.className} right=${Math.round(b.right)}`); if (out.length > 5) break; }
      }
      return out;
    });
    if (r.length) bad(kind, step, r.join('; '));
    if (errs.length) { bad(kind, step, errs.join(' | ')); errs.length = 0; }
  };
  // readable pieces of a long page: the start and the sections further down
  const shotParts = async name => {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const piece = Math.min(1500, h);
    for (const [i, y] of [0, Math.floor(h * 0.4), Math.max(0, h - piece)].entries()) await page.screenshot({ path: `${OUT}/${kind}-${name}-p${i + 1}.png`, fullPage: true, clip: { x: 0, y, width, height: piece } });
  };
  const go = async (hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(350); };
  await page.goto(`http://localhost:${PORT}/#/exam`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ex-setup');
  await overflow('setup-off');
  await page.locator('.ex-setup').screenshot({ path: `${OUT}/${kind}-setup-off.png` });

  // the panel: labels above the checkboxes, grid columns, equal cards, names within 2 lines, kanji hint
  const layout = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.ex-tgroup-wrap')].map(g => {
      const h = g.querySelector('.ex-tgroup').getBoundingClientRect(), grid = g.querySelector('.ex-tgrid'), cards = [...grid.children];
      return {
        above: h.bottom <= cards[0].getBoundingClientRect().top + 1, cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        heights: [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().height)))],
        clipped: cards.filter(c => { const n = c.querySelector('.ex-tname'); return n.scrollHeight > n.clientHeight + 2; }).map(c => c.textContent.trim()),
      };
    });
    return { groups, hint: document.querySelector('.ex-thint')?.textContent || '' };
  });
  steps++;
  for (const g of layout.groups) {
    if (!g.above) bad(kind, 'panel', 'group label is not above its cards');
    if (g.cols !== (kind === 'desktop' ? 3 : 1)) bad(kind, 'panel', `columns ${g.cols}`);
    if (g.heights.length > 1) bad(kind, 'panel', `heights ${g.heights}`);
    if (g.clipped.length) bad(kind, 'panel', `name is cut: ${g.clipped}`);
  }
  if (!layout.hint.includes('Оберіть книжку')) bad(kind, 'panel', 'no kanji hint');

  // toggle ON: everything else is disabled
  await page.locator('.ex-univ').click();
  await page.waitForTimeout(150);
  steps++;
  const dis = await page.evaluate(() => [...document.querySelectorAll('.ex-types input')].every(i => i.disabled));
  if (!dis) bad(kind, 'toggle', 'checkboxes stay enabled');
  await overflow('setup-on');
  await page.locator('.ex-setup').screenshot({ path: `${OUT}/${kind}-setup-on.png` });

  for (const [a, b] of RANGES) {
    const tag = `L${a}-${b}`;
    await go('#/exam');
    await page.waitForSelector('.ex-setup');
    // typed like a person: the form is redrawn on «change», so fill() can hit a stale state
    for (const [name, v] of [['from', a], ['to', b]]) {
      await page.locator(`input[name=${name}]`).click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(String(v));
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
    }
    await page.fill('input[name=timer]', a === 34 ? '60' : '0');
    await page.locator('[data-start]').click();
    await page.waitForSelector('.u-paper');
    await page.waitForTimeout(150);
    await overflow(`paper-${tag}`);
    if (a === 34 || a === 1 && b === 5) { await page.screenshot({ path: `${OUT}/${kind}-paper-${tag}.png`, fullPage: true }); await shotParts(`paper-${tag}`); }
    // the paper is complete: sections in order, 100 points
    const info = await page.evaluate(() => {
      const S = JSON.parse(sessionStorage.getItem('jp.examSession'));
      const labels = [...document.querySelectorAll('.u-sec-head h2')].map(h => h.textContent.trim());
      const raw = [...document.querySelectorAll('.u-text')].filter(e => /\{[^}]*\|/.test(e.textContent)).length;
      return { from: S.paper.from, to: S.paper.to, pts: S.paper.sections.reduce((n, s) => n + s.pts, 0), labels, raw, s: S.paper.sections.map(x => x.blanks), deadline: S.deadline };
    });
    if (info.from !== a || info.to !== b) bad(kind, tag, `range ${info.from}-${info.to}`);
    if (b - a >= 8 && info.s.join() !== '23,10,22,16,6,10,13') bad(kind, tag, `not a full paper: ${info.s}`);
    if (info.pts !== 100) bad(kind, tag, `points ${info.pts}`);
    if (info.labels.length !== 7) bad(kind, tag, `sections ${info.labels.length}`);
    if (info.raw) bad(kind, tag, 'furigana markup is visible');
    if ((a === 34) !== !!info.deadline) bad(kind, tag, 'timer');
    if (a === 34 && !(await page.textContent('.ex-timer'))) bad(kind, tag, 'timer is not shown');
    // half right, half wrong (typed + chosen), one option cleared again
    await page.evaluate(() => {
      const S = JSON.parse(sessionStorage.getItem('jp.examSession'));
      const key = {};
      S.paper.sections.forEach(s => s.items.forEach(it => it.parts.filter(p => typeof p !== 'string').forEach((p, i) => { key[`${it.id}:${i}`] = p; })));
      window.__key = key;
    });
    const inputs = await page.$$('.u-in');
    for (let i = 0; i < inputs.length; i++) {
      const k = await inputs[i].getAttribute('data-k');
      const ans = await page.evaluate(x => { const p = window.__key[x]; return p.a[0].replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1'); }, k);
      await inputs[i].fill(i % 2 ? ans : 'だめ');
    }
    const keys = await page.evaluate(() => Object.entries(window.__key).filter(([, p]) => p.o).map(([k, p]) => [k, p.c]));
    for (let i = 0; i < keys.length; i++) {
      const [k, c] = keys[i];
      const v = i % 2 ? c : (c + 1) % 3;
      await page.locator(`.u-opt[data-k="${k}"][data-v="${v}"]`).click();
    }
    await page.waitForTimeout(320);
    // answers survive leaving the page
    const saved = await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem('jp.examSession')).ua).length);
    if (saved !== inputs.length + keys.length) bad(kind, tag, `saved answers ${saved} / ${inputs.length + keys.length}`);
    await page.locator('[data-check]').click();
    await page.waitForSelector('.u-result');
    await page.waitForTimeout(200);
    await overflow(`result-${tag}`);
    if (a === 34 || a === 1 && b === 5) { await page.screenshot({ path: `${OUT}/${kind}-result-${tag}.png`, fullPage: true }); await shotParts(`result-${tag}`); }
    const res = await page.evaluate(() => {
      const hist = JSON.parse(localStorage.getItem('jp.examHistory') || '[]');
      const last = hist[hist.length - 1];
      const missing = [...document.querySelectorAll('.ex-mistake')].filter(m => !m.querySelector('.ex-expl p') || !m.querySelector('.ex-ref')).map(m => m.dataset.id);
      const emptyLinks = [...document.querySelectorAll('.ex-mistake .ex-ref')].filter(b => !/Minna no Nihongo/.test(b.textContent)).length;
      return { last, n: document.querySelectorAll('.ex-mistake').length, missing, emptyLinks, ring: document.querySelector('.score-ring span').textContent };
    });
    steps++;
    if (!res.last?.univ || res.last.n !== 100) bad(kind, tag, 'not in the history');
    if (!res.n) bad(kind, tag, 'no mistakes listed');
    if (res.missing.length) bad(kind, tag, `no explanation/link: ${res.missing}`);
    if (res.emptyLinks) bad(kind, tag, `links without «Minna no Nihongo»: ${res.emptyLinks}`);
    // a reference opens and the floating button returns to the results
    await page.locator('.ex-mistake .ex-ref').first().click();
    await page.waitForTimeout(350);
    await page.locator('#exam-return').click();
    await page.waitForSelector('.u-result', { timeout: 5000 }).catch(() => bad(kind, tag, 'return button does not open the results'));
    // override + new variant
    const right = await page.$('[data-right]');
    if (right) {
      const before = res.last.ok;
      await right.click();
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('jp.examHistory')); return h[h.length - 1].ok; });
      if (!(after > before)) bad(kind, tag, 'override does not add points');
    }
    await page.locator('[data-again]').click();
    await page.waitForSelector('.u-paper');
    await page.waitForTimeout(100);
    steps++;
    if (await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem('jp.examSession')).ua).length)) bad(kind, tag, 'new variant keeps old answers');
  }
  // setup page with the history + weak spots of university results
  await go('#/exam');
  await page.waitForSelector('.ex-setup');
  await page.waitForTimeout(100);
  await overflow('setup-history');
  await page.screenshot({ path: `${OUT}/${kind}-setup-history.png`, fullPage: true });
  // the normal exam still starts
  await page.locator('.ex-univ').click();
  await page.waitForTimeout(100);
  await page.locator('[data-start]').click();
  await page.waitForSelector('.ex-q');
  steps++;
  await ctx.close();
}
await browser.close();
srv.close();
fs.writeFileSync(`${OUT}/report.md`, `# QA: університетська версія\n\nSteps: ${steps}\nIssues: ${issues.length}\n\n${issues.map(i => '- ' + i).join('\n')}\n`);
console.log(`steps ${steps}, issues ${issues.length}`);
process.exit(issues.length ? 1 : 0);
