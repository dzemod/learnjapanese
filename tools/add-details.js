// node tools/add-details.js <srcDir> — sets «Детальніше» (point.details) from <srcDir>/D*.js.
// Each file: module.exports = { "1-1": [blocks...], "1-2": [...] } (same block format as point.blocks:
// {h} {p} {note} {table} {ex, uk}). Only point.details is replaced — point.blocks (textbook) is never touched.
// Refuses to write if: unknown point id, unknown block keys, kanji without a {漢字|かな} reading,
// brace mismatch, or tools/check-grammar.js reports any textbook change.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const gfile = path.join(root, 'site/data/grammar.json');
const srcDir = path.resolve(process.argv[2] || '.');
const files = fs.readdirSync(srcDir).filter(f => /^D.*\.js$/.test(f)).sort();
const data = JSON.parse(fs.readFileSync(gfile, 'utf8'));
const byId = new Map(data.lessons.flatMap(l => l.points).map(p => [p.id, p]));
const KEYS = new Set(['h', 'p', 'note', 'table', 'ex', 'uk']);
const KANJI = /[一-鿿㐀-䶿々〆]/;
const errors = [];
const strip = s => s.replace(/\{[^{}|]+\|[^{}]+\}/g, '');
let n = 0;
for (const f of files) {
  const src = require(path.join(srcDir, f));
  for (const [id, blocks] of Object.entries(src)) {
    const p = byId.get(id);
    if (!p) { errors.push(`${f}: unknown point ${id}`); continue; }
    if (!Array.isArray(blocks) || !blocks.length) { errors.push(`${id}: details must be a non-empty array`); continue; }
    for (const b of blocks) {
      for (const k of Object.keys(b)) if (!KEYS.has(k)) errors.push(`${id}: unknown key "${k}"`);
      const strs = [b.h, b.p, b.note, b.ex, b.uk, ...(b.table || []).flat()].filter(s => s != null);
      for (const s of strs) {
        if (typeof s !== 'string') { errors.push(`${id}: non-string value ${JSON.stringify(s)}`); continue; }
        if ((s.match(/\{/g) || []).length !== (s.match(/\}/g) || []).length) errors.push(`${id}: brace mismatch: ${s}`);
        if (KANJI.test(strip(s))) errors.push(`${id}: kanji without reading: ${s}`);
      }
      if (b.ex != null && b.uk == null) errors.push(`${id}: example without uk: ${b.ex}`);
    }
    p.details = blocks; n++;
  }
}
if (errors.length) { console.error('NOT WRITTEN:\n' + errors.join('\n')); process.exit(1); }
const J = JSON.stringify;
const out = '{\n  "lessons": [\n' + data.lessons.map(l => '    {\n      "lesson": ' + l.lesson + ',\n      "points": [\n' +
  l.points.map(p => '        {\n          "id": ' + J(p.id) + ',\n          "title": ' + J(p.title) + ',\n          "blocks": [\n' +
    p.blocks.map(b => '            ' + J(b)).join(',\n') + '\n          ]' +
    (p.details?.length ? ',\n          "details": [\n' + p.details.map(b => '            ' + J(b)).join(',\n') + '\n          ]' : '') + '\n        }').join(',\n') +
  '\n      ]\n    }').join(',\n') + '\n  ]\n}\n';
const check = require('./check-grammar.js');
const problems = check.compare(JSON.parse(out).lessons);
if (problems.length) { console.error('NOT WRITTEN — textbook content would change:\n' + problems.slice(0, 40).join('\n')); process.exit(1); }
fs.writeFileSync(gfile, out);
const all = data.lessons.flatMap(l => l.points);
console.log(`details set for ${n} points; points with details: ${all.filter(p => p.details).length}/${all.length}`);
