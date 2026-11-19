// Browser QA of «Експорт в Anki» (375 + 1280 px): the dialog, a words file and a kanji file are downloaded with the
// Anki header and the right number of notes; «лише вивчені» with nothing learned → message, no file.
//   node tools/qa-anki.mjs
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { serve } from './qa-sensei.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const { chromium } = require('playwright-core');
const srv = await serve();
const BASE = `http://localhost:${srv.address().port}/`;
let passed = 0;
const issues = [];
const ok = (c, name, extra = '') => { if (c) passed++; else { issues.push(`${name} ${extra}`); console.log('FAIL', name, extra); } };
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const nWords = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets.reduce((a, s) => a + s.cards.length, 0);

for (const [kind, width, height] of [['phone', 375, 812], ['desktop', 1280, 860]]) {
  const T = s => `${kind}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, locale: 'uk-UA' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  const grab = async what => {
    await page.click('[data-anki]');
    await page.waitForSelector('.anki-form');
    await page.selectOption('.anki-form select', what);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('.anki-form .btn.primary')]);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
  };
  let f = await grab('all');
  const lines = f.text.trimEnd().split('\n');
  ok(/^kotoba-anki-words-all-\d{4}-\d{2}-\d{2}\.txt$/.test(f.name), T('words file name'), f.name);
  ok(lines[0] === '#separator:tab' && lines.filter(l => !l.startsWith('#')).length === nWords, T(`words file: header + ${nWords} notes`), String(lines.length));
  f = await grab('k300');
  ok(f.text.trimEnd().split('\n').filter(l => !l.startsWith('#')).length === 300 && /#deck:Kotoba::Канджі/.test(f.text), T('kanji-300 file: 300 notes'));
  ok(/^人\t/m.test(f.text) && /Людина \(人\)/.test(f.text), T('kanji file has the association'));
  await page.click('[data-anki]');
  await page.selectOption('.anki-form select', 'known');
  await page.click('.anki-form .btn.primary');
  await page.waitForTimeout(300);
  ok(/Немає що експортувати/.test(await page.textContent('#toast')), T('nothing learned yet → message'));
  ok(!errs.length, T('no page errors'), errs.join(' | '));
  await ctx.close();
}
await browser.close();
srv.close();
console.log(issues.length ? `\n${passed} passed, ${issues.length} failed` : `\n${passed} passed\nALL ANKI UI CHECKS PASSED`);
process.exit(issues.length ? 1 : 0);
