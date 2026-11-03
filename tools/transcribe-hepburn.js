// One-off + reusable: converts Cyrillic Japanese names/terms from the old Kovalenko spelling to the
// Hepburn-based Ukrainian transcription (し ші, ち чі, じ джі, しゃ ша, ちゃ ча, じゃ джа, ず з…).
// Only the words listed in MAP (whole words, case kept) are changed — ordinary Ukrainian words never.
// Usage: node tools/transcribe-hepburn.js [--write]   (without --write: dry run, prints the table)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// old → new, whole words only; a key ending in * is a stem (any Ukrainian ending may follow)
const MAP = {
  'кандзі': 'канджі', 'фудзі': 'фуджі', 'судзукі': 'сузукі', 'хорюдзі': 'хорюджі', 'сіндзюку': 'шінджуку',
  'ґендзі': 'ґенджі', 'міядзакі': 'міязакі', 'мейдзі': 'мейджі', 'ромадзі': 'ромаджі', 'дзюсьо': 'джушо',
  'сінкансен*': 'шінкансен', 'тіба': 'чіба', 'татіірі': 'тачіірі', 'кінсі': 'кінші', 'хіросім*': 'хірошім',
  'сікібу': 'шікібу', 'сін-осак*': 'шін-осак', 'косіен*': 'кошіен', 'кюсю': 'кюшу', 'сасімі': 'сашімі',
  'сусі': 'суші', 'сьоґі': 'шоґі', 'патінко': 'пачінко', 'хаясі': 'хаяші',
};
const FILES = [
  ...['sets', 'grammar', 'kanji', 'exam', 'analyzer', 'exam-presets'].map(f => `site/data/${f}.json`),
  ...fs.readdirSync(path.join(ROOT, 'site/js')).map(f => 'site/js/' + f), 'site/index.html',
  ...fs.readdirSync(path.join(ROOT, 'tools/analyzer')).map(f => 'tools/analyzer/' + f),
  'REVIEW.md', 'QA.md',
].filter(f => fs.existsSync(path.join(ROOT, f)));
const L = 'а-щьюяіїєґ’ʼА-ЩЬЮЯІЇЄҐ';
const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);
const re = new RegExp(`(?<![${L}])(${keys.map(k => k.endsWith('*') ? k.slice(0, -1) + `(?=[${L}]*)` : k + `(?![${L}])`).join('|')})`, 'gi');
const dict = Object.fromEntries(keys.map(k => [k.replace('*', ''), MAP[k]]));
const keepCase = (src, dst) => [...dst].map((ch, i) => (src[i] && src[i] !== src[i].toLowerCase() ? ch.toUpperCase() : ch)).join('');
const word = new RegExp(`[${L}-]+`, 'y');
const table = new Map();
const write = process.argv.includes('--write');
for (const f of FILES) {
  const p = path.join(ROOT, f);
  const src = fs.readFileSync(p, 'utf8');
  const out = src.replace(re, (m, stem, off) => {
    const neu = keepCase(m, dict[m.toLowerCase()]);
    word.lastIndex = off;
    const whole = word.exec(src)[0];
    const key = whole + ' → ' + neu + whole.slice(m.length);
    const e = table.get(key) || { n: 0, files: new Set() };
    e.n++; e.files.add(path.basename(f));
    table.set(key, e);
    return neu;
  });
  if (write && out !== src) fs.writeFileSync(p, out);
}
for (const [k, e] of [...table].sort((a, b) => b[1].n - a[1].n)) console.log(`| ${k.replace(' → ', ' | ')} | ${e.n} | ${[...e.files].join(', ')} |`);
console.log(write ? 'written' : 'dry run (add --write)');
