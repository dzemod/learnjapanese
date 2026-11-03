// Test the exam checker «Переклад речень» (site/js/sentcheck.js) on items of data/exam.json.
//   node tools/test-sentcheck.mjs                       → built-in cases (must all pass)
//   node tools/test-sentcheck.mjs ts5-1 "きょうとにいきます"  → show the comparison for one answer
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { preKana, checkSentence } from '../site/js/sentcheck.js';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kuroPath = process.env.KUROMOJI || path.join(ROOT, 'node_modules', 'kuromoji');
const kuromoji = require(kuroPath);
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/exam.json'), 'utf8'));
const items = new Map(bank.lessons.flatMap(l => l.items).filter(i => i.t === 'ts').map(i => [i.id, i]));
const tk = await new Promise((res, rej) => kuromoji.builder({ dicPath: path.join(kuroPath, 'dict') }).build((e, t) => (e ? rej(e) : res(t))));
const hira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

// same steps as exam.js: model kanji → kana, remaining kanji → Kuromoji reading
export function check(it, answer) {
  const models = [it.k, ...(it.alt || [])];
  const pre = preKana(answer, models);
  let kana = pre.text;
  if (pre.kanjiLeft) kana = tk.tokenize(kana).map(t => (/[㐀-鿿々〆]/.test(t.surface_form) ? hira(t.reading || t.surface_form) : t.surface_form)).join('');
  return checkSentence(kana, models);
}

const args = process.argv.slice(2);
if (args[0] === '--all') {
  // every item must accept its own model answer written with kanji and written only in kana
  let n = 0, bad = 0;
  for (const it of items.values()) {
    const plain = it.ja.replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1');
    const kana = it.k.filter(t => t[2] !== 's').map(t => t[1]).join('');
    for (const ans of [plain, kana]) {
      n++;
      const r = check(it, ans);
      if (r.verdict !== 'ok') { bad++; console.log(`✗ ${it.id} «${ans}» → ${r.verdict} ${Math.round(r.score * 100)}%`, JSON.stringify(r.issues)); }
    }
    for (const t of it.k) if (t[2] !== 's' && !/^[ぁ-ゖァ-ヺー0-9A-Za-zＡ-Ｚａ-ｚ０-９・.,]+$/.test(t[1])) { bad++; console.log(`✗ ${it.id} token reading «${t[0]}» → «${t[1]}»`); }
  }
  console.log(bad ? `${bad} PROBLEMS in ${items.size} items` : `ALL ${items.size} items accept their model answer (${n} checks)`);
  process.exit(bad ? 1 : 0);
}
if (args.length === 2) {
  const r = check(items.get(args[0]), args[1]);
  console.log(JSON.stringify({ score: r.score, verdict: r.verdict, issues: r.issues, toks: r.toks.map(t => `${t.s}:${t.st}`).join(' '), user: r.user }, null, 1));
} else {
  // [id, answer, expected verdict, expected issue kinds (subset)]
  const CASES = [
    ['ts5-1', '京都へ行きます。', 'ok', []],
    ['ts5-1', 'きょうとへいきます', 'ok', []],
    ['ts5-1', 'キョウトヘイキマス', 'ok', []],
    ['ts5-1', 'わたしは京都へ行きます', 'ok', []],
    ['ts5-1', '京都に行きます', 'ok', []],
    ['ts5-1', '京都で行きます', 'almost', ['particle']],
    ['ts5-1', '京都へ行きました', 'almost', ['form']],
    ['ts5-1', '京都へ', 'bad', ['missing']],
    ['ts5-1', '行きます京都へ', 'almost', ['order']],
    ['ts5-2', '日本へ来ました。', 'ok', []],
    ['ts5-2', 'にほんへきました', 'ok', []],
    ['ts5-2', '私は日本へ来ました', 'ok', []],
    ['ts5-2', '日本へ来ます', 'almost', ['form']],
  ];
  let fail = 0;
  for (const [id, ans, v, kinds] of CASES) {
    const it = items.get(id);
    if (!it) { console.log('missing item', id); fail++; continue; }
    const r = check(it, ans);
    const got = r.issues.map(i => i.kind);
    const ok = r.verdict === v && kinds.every(k => got.includes(k));
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} ${id} «${ans}» → ${r.verdict} ${Math.round(r.score * 100)}% [${got.join(', ')}]${ok ? '' : `  expected ${v} [${kinds.join(', ')}]`}`);
  }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
}
