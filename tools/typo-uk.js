// node tools/typo-uk.js [--dry] — normalizes Ukrainian typography in site/data/*.json (layout kept: line-based replace).
//   “…” and "…" inside Ukrainian text → «…»;  ' and ʼ between Cyrillic letters → ’;  " – " / " - " between words → " — ";  "..." → "…"
// Japanese text is not affected (patterns require Cyrillic context or are Japanese-neutral).
const fs = require('fs'), path = require('path');
const dry = process.argv.includes('--dry');
const CYR = 'А-Яа-яІіЇїЄєҐґ';
const rules = [
  ['quotes “”', /“([^”\n]*)”/g, '«$1»'],
  ['apostrophe', new RegExp(`([${CYR}])['ʼ‘\`]([${CYR}])`, 'g'), '$1’$2'],
  ['dash', new RegExp(`([${CYR}0-9.,!?…»)\\]~])\\s[–-]\\s(?=[${CYR}«(0-9])`, 'g'), '$1 — '],
  ['ellipsis', /\.\.\./g, '…'],
];
const total = {};
for (const f of ['sets.json', 'grammar.json', 'kanji.json', 'exam.json']) {
  const file = path.join(__dirname, '../site/data', f);
  let s = fs.readFileSync(file, 'utf8');
  for (const [name, re, rep] of rules) {
    const n = (s.match(re) || []).length;
    if (n) { total[`${f} ${name}`] = n; s = s.replace(re, rep); }
  }
  JSON.parse(s);
  if (!dry) fs.writeFileSync(file, s);
}
console.log(total);
