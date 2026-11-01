// Which characters used on the site are NOT rendered by Manrope / Noto Serif JP?
// Collects every distinct character from site/data/*.json and site/js/*.js + index.html,
// renders each in the UI font stack and asks Chrome (CDP) which font it used.
//   QA_MODULES=<dir with node_modules> node tools/qa-chars.mjs
import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : import.meta.url);
const { chromium } = require('playwright-core');

const files = [...fs.readdirSync(path.join(SITE, 'data')).map(f => 'data/' + f), ...fs.readdirSync(path.join(SITE, 'js')).map(f => 'js/' + f), 'index.html'];
const where = new Map();
for (const f of files) {
  for (const ch of fs.readFileSync(path.join(SITE, f), 'utf8')) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || (cp >= 0x3040 && cp <= 0x30FF) || (cp >= 0x4E00 && cp <= 0x9FFF)) continue; // kana/kanji: Noto by definition
    if (!where.has(ch)) where.set(ch, new Set());
    where.get(ch).add(f);
  }
}
const chars = [...where.keys()];
const srv = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html lang="uk"><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Serif+JP:wght@400;500;700&display=swap"><link rel="stylesheet" href="/css/style.css"></head>
      <body>${chars.map((c, i) => `<span data-i="${i}">${c.replace(/[<&]/g, m => (m === '<' ? '&lt;' : '&amp;'))}</span>`).join(' ')}</body></html>`);
  }
  const f = path.join(SITE, req.url);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/css' });
  fs.createReadStream(f).pipe(res);
}).listen(5191);
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
await page.goto('http://localhost:5191/', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'span[data-i]' });
const bad = [];
for (const id of nodeIds) {
  const { attributes } = await cdp.send('DOM.getAttributes', { nodeId: id });
  const ch = chars[+attributes[attributes.indexOf('data-i') + 1]];
  const fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id })).fonts.map(f => f.familyName);
  if (!fonts.length || fonts.every(f => /^(Manrope|Noto Serif JP)/i.test(f))) continue;
  bad.push({ ch, cp: 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), fonts: fonts.join(', '), files: [...where.get(ch)].join(' ') });
}
await browser.close();
srv.close();
console.log(`${chars.length} distinct non-kana characters; ${bad.length} not in Manrope/Noto Serif JP:`);
for (const b of bad) console.log(`${b.ch}\t${b.cp}\t${b.fonts}\t${b.files}`);
