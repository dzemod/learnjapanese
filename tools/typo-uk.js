// node tools/typo-uk.js [--dry] — normalizes Ukrainian typography in site/data/*.json (file layout kept).
//   “…” and "…" inside Ukrainian text → «…»;  ' and ʼ between Cyrillic letters → ’;  " – " / " - " between words → " — ";  "..." → "…"
// Only Ukrainian string values are touched: Japanese fields (ex, ja, pre, post, a, base, kanji, kana, word…)
// are textbook text and are never changed (e.g. “Goodbye”は… in grammar 7-2 keeps its quotes).
const fs = require('fs'), path = require('path');
const dry = process.argv.includes('--dry');
const CYR = 'А-Яа-яІіЇїЄєҐґ';
const JA_KEYS = new Set(['ex', 'ja', 'pre', 'post', 'a', 'ak', 'base', 'kanji', 'kana', 'word', 'on', 'kun', 'w', 'src', 'id', 'radical', 'alt']);
const rules = [
  ['quotes “”', /“([^”\n]*)”/g, '«$1»'],
  ['apostrophe', new RegExp(`([${CYR}])['ʼ‘\`]([${CYR}])`, 'g'), '$1’$2'],
  ['dash', new RegExp(`([${CYR}0-9.,!?…»)\\]~])\\s[–-]\\s(?=[${CYR}«(0-9])`, 'g'), '$1 — '],
  ['ellipsis', /\.\.\./g, '…'],
];
const total = {};
for (const f of ['sets.json', 'grammar.json', 'kanji.json', 'exam.json']) {
  const file = path.join(__dirname, '../site/data', f);
  const src = fs.readFileSync(file, 'utf8');
  let out = '', i = 0, lastKey = null, line = '';
  while (i < src.length) {
    const c = src[i];
    if (c !== '"') { out += c; if (c === '\n') line = ''; i++; continue; }
    let j = i + 1;
    while (src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
    const lit = src.slice(i, j + 1);
    if (/^\s*:/.test(src.slice(j + 1, j + 4))) { lastKey = JSON.parse(lit); out += lit; i = j + 1; continue; }
    const lineStart = src.lastIndexOf('\n', i) + 1;
    line = src.slice(lineStart, src.indexOf('\n', i) < 0 ? undefined : src.indexOf('\n', i));
    let v = JSON.parse(lit);
    const parentJa = JA_KEYS.has(lastKey);
    if (!parentJa && new RegExp(`[${CYR}]`).test(v)) {
      for (const [name, re, rep] of rules) {
        // number placeholders (－人 = – людей) keep the en dash
        if (name === 'dash' && /"(kanji|kana)":"－/.test(line)) continue;
        const n = (v.match(re) || []).length;
        if (n) { total[`${f} ${name}`] = (total[`${f} ${name}`] || 0) + n; v = v.replace(re, rep); }
      }
    }
    out += v === JSON.parse(lit) ? lit : JSON.stringify(v);
    i = j + 1;
  }
  JSON.parse(out);
  if (!dry && out !== src) fs.writeFileSync(file, out);
}
console.log(total);
