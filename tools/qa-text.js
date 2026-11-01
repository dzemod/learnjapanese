// Text QA over ALL data files and UI strings.
//   node tools/qa-text.js [--fix]
// Checks: mixed Latin/Cyrillic letters inside a word (homoglyphs), split words («м і сце»),
// double / leading / trailing spaces, wrong apostrophes (' ʼ `), straight or „“ quotes in Ukrainian,
// spaced hyphen instead of dash, leftover abbreviations, English words in UI strings,
// Cyrillic (Polivanov) in kana fields, kanji without a reading in grammar/exam Japanese text.
// --fix repairs the safe ones (homoglyphs, spaces, apostrophes); the rest is only reported.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FIX = process.argv.includes('--fix');

const CYR = /[А-Яа-яІіЇїЄєҐґ]/, LAT = /[A-Za-z]/;
const HOMO = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х', y: 'у' };
const KANJI = /[㐀-鿿々]/;
const issues = [];
const add = (file, where, type, text, extra = '') => issues.push({ file, where, type, text: String(text).slice(0, 140), extra });

// keys whose values are Japanese or technical (not Ukrainian prose)
const JA_KEYS = new Set(['kanji', 'kana', 'word', 'ex', 'ja', 'pre', 'post', 'a', 'base', 'w', 'on', 'kun', 'radical', 'id', 'setId', 'pt', 'spt', 'src', 'verbGroup', 'section', 'source', 'dateCreated', 'kind', 't', 'l', 'h']);
const EN_KEYS = new Set(['en']);

function checkUk(file, where, s, key) {
  let out = s;
  // homoglyphs: a word with both scripts
  out = out.replace(/[A-Za-zА-Яа-яІіЇїЄєҐґ’'ʼ]+/g, w => {
    if (!(CYR.test(w) && LAT.test(w))) return w;
    const fixed = w.replace(/[A-Za-z]/g, c => HOMO[c] || c);
    if (LAT.test(fixed)) { add(file, where, 'mixed-script', w, s); return w; }
    add(file, where, 'homoglyph', `${w} → ${fixed}`, s);
    return fixed;
  });
  if (/ {2,}/.test(out)) { add(file, where, 'double-space', out); out = out.replace(/ {2,}/g, ' '); }
  if (out !== out.trim() && key !== 'p') { add(file, where, 'edge-space', JSON.stringify(out)); out = out.trim(); }
  out = out.replace(/([А-Яа-яІіЇїЄєҐґ])['ʼ`]([А-Яа-яІіЇїЄєҐґ])/g, (m, a, b) => { add(file, where, 'apostrophe', m, s); return a + '’' + b; });
  if (/"[^"]*[А-Яа-яІіЇїЄєҐґ][^"]*"|„|“|”/.test(out)) add(file, where, 'quotes', out);
  if (/[А-Яа-яІіЇїЄєҐґ)] - [А-Яа-яІіЇїЄєҐґ(]/.test(out)) add(file, where, 'hyphen-dash', out);
  if (/(?<![А-Яа-яІіЇїЄєҐґ’])(ІМ|ДІЄСЛ|ПРИКМ|РЕЧ|напр|букв|досл|див|ур|англ)\./.test(out) || /(?<![А-Яа-яІіЇїЄєҐґ’])(ІМ|ДІЄСЛ|ПРИКМ|РЕЧ)(?![А-Яа-яІіЇїЄєҐґ])/.test(out)) add(file, where, 'abbreviation', out);
  // split word: a lone consonant that is not a Ukrainian one-letter word (в з й ж)
  for (const m of out.matchAll(/(?<![А-Яа-яІіЇїЄєҐґ’-])([гґдклмнпрстфхцчшщ])(?= [а-яіїєґ])/g)) add(file, where, 'split-word?', out.slice(Math.max(0, m.index - 12), m.index + 14));
  return out;
}

function walkJSON(file) {
  const full = path.join(ROOT, file);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  let changed = 0;
  const visit = (v, where, key) => {
    if (typeof v === 'string') {
      if (key === 'kana' || key === 'kun' || key === 'on') {
        if (CYR.test(v) || /[A-Za-z]/.test(v.replace(/CD|ATM|NHK|JL|PIN|IMC|TV|OK|SNS|DVD|PC/g, ''))) add(file, where, 'non-kana-reading', v);
        return v;
      }
      if (EN_KEYS.has(key)) { if (CYR.test(v)) add(file, where, 'cyrillic-in-en', v); return v; }
      if (JA_KEYS.has(key) && key !== 'h') return v;
      if (!CYR.test(v)) return v;
      const out = checkUk(file, where, v, key);
      if (out !== v) changed++;
      return FIX ? out : v;
    }
    if (Array.isArray(v)) return v.map((x, i) => visit(x, `${where}[${i}]`, key));
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = visit(v[k], where + (v.id ? `#${v.id}` : '') + '.' + k, k); return v; }
    return v;
  };
  visit(data, '', '');
  return { data, changed };
}

// furigana coverage: kanji in Japanese text of grammar examples / exam sentences must be inside {漢字|かな}
function furiCheck(file, s, where) {
  const bare = s.replace(/\{[^{}|]+\|[^{}]+\}/g, '');
  if (KANJI.test(bare)) add(file, where, 'kanji-no-reading', s);
}

const files = ['site/data/sets.json', 'site/data/grammar.json', 'site/data/exam.json', 'site/data/kanji.json', 'site/data/exam-presets.json'].filter(f => fs.existsSync(path.join(ROOT, f)));
const counts = {};
for (const f of files) {
  const { data, changed } = walkJSON(f);
  counts[f] = changed;
  if (f.endsWith('grammar.json')) for (const l of data.lessons) for (const p of l.points) {
    furiCheck(f, p.title, `L${l.lesson} ${p.id} title`);
    for (const b of p.blocks) { if (b.ex) furiCheck(f, b.ex, `${p.id} ex`); if (b.p) furiCheck(f, b.p, `${p.id} p`); if (b.note) furiCheck(f, b.note, `${p.id} note`); if (b.h) furiCheck(f, b.h, `${p.id} h`); for (const r of b.table || []) for (const c of r) furiCheck(f, c, `${p.id} table`); }
  }
  if (f.endsWith('exam.json')) for (const l of data.lessons) for (const it of l.items) for (const k of ['pre', 'post', 'a', 'ja', 'base']) if (it[k]) furiCheck(f, it[k], `L${l.lesson} ${it.id || ''} ${k}`);
  if (FIX && changed) {
    // keep the one-item-per-line layout: re-serialize with the same writer as the tools
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    let out = '', i = 0;
    const flat = [];
    (function collect(v) { if (typeof v === 'string') flat.push(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object') for (const k of Object.keys(v)) collect(v[k]); })(data);
    let n = 0;
    while (i < src.length) {
      if (src[i] !== '"') { out += src[i++]; continue; }
      let j = i + 1;
      while (src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      const lit = src.slice(i, j + 1);
      if (/^\s*:/.test(src.slice(j + 1, j + 10))) out += lit;
      else { const nv = flat[n++]; out += nv === JSON.parse(lit) ? lit : JSON.stringify(nv); }
      i = j + 1;
    }
    JSON.parse(out);
    fs.writeFileSync(path.join(ROOT, f), out);
  }
}

// UI strings in the code: Ukrainian text checks + English words shown to the user
const UI_OK = /^(Kotoba|Minna|no|Nihongo|GitHub|Vercel|APP_PASSWORD|KanjiVG|CC|BY|SA|JSON|PDF|OCR|CD|Claude|Enter|Esc|Space|Tab|Shift|Tesseract|Kuroshiro|jsDelivr|ID|URL|OK|IV|II|III|I|A|B|PNG|JPG|Google|Chrome|Safari|Android|iPhone|iOS|Windows|Mac|UTF|Ctrl|Cmd|Alt|N|Noto|Serif|JP|Manrope)$/;
for (const f of fs.readdirSync(path.join(ROOT, 'site/js')).map(x => 'site/js/' + x).concat('site/index.html')) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*?[А-Яа-яІіЇїЄєҐґ](?:(?!\1)[^\\\n]|\\.)*?)\1|>([^<>{}\n]*[А-Яа-яІіЇїЄєҐґ][^<>{}\n]*)</g)) {
    const s = (m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' ');
    const line = src.slice(0, m.index).split('\n').length;
    checkUk(f, 'line ' + line, s.replace(/<[^>]+>/g, ' ').replace(/ {2,}/g, ' ').trim(), 'ui');
    for (const w of s.replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').match(/\b[A-Za-z]{2,}\b/g) || []) if (!UI_OK.test(w) && !/^(class|data|href|lang|span|div|aria|type|button|input|title|id|sm|btn|ghost|primary|muted|small|ja|uk|en|svg|path|kbd|br|b|i|s|em|code|summary|details|label|placeholder|name|value|checked|disabled|hidden|on|off|px|rem)$/.test(w)) add(f, 'line ' + line, 'english-in-ui?', w, s.slice(0, 100));
  }
}

const byType = {};
for (const i of issues) (byType[i.type] ||= []).push(i);
console.log(`Files: ${files.join(', ')} + site/js/*.js, index.html`);
for (const [t, list] of Object.entries(byType)) {
  console.log(`\n## ${t} (${list.length})`);
  for (const i of list.slice(0, 60)) console.log(`- ${i.file} ${i.where}: ${i.text}${i.extra && t !== 'english-in-ui?' ? '' : i.extra ? '   ⟵ ' + i.extra : ''}`);
}
if (FIX) console.log('\nFixed (strings changed):', counts);
fs.mkdirSync(path.join(ROOT, 'qa'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'qa/text-report.json'), JSON.stringify(issues, null, 1));
