// node tools/build-grammar.js <srcDir> — upserts lessons from <srcDir>/L*.js into site/data/grammar.json (other lessons are kept).
// Textbook content lives in point.blocks; extra explanations («Детальніше») live in point.details and are
// kept from the current file when the source has none. After writing, tools/check-grammar.js must pass
// (no textbook block lost or changed) — otherwise nothing is written.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srcDir = path.resolve(process.argv[2] || '.');
const files = fs.readdirSync(srcDir).filter(f => /^L\d.*\.js$/.test(f)).sort();
const gfile = path.join(root, 'site/data/grammar.json');
const existing = fs.existsSync(gfile) ? JSON.parse(fs.readFileSync(gfile, 'utf8')).lessons : [];
const fresh = files.flatMap(f => require(path.join(srcDir, f)));
// keep «Детальніше» of re-imported lessons
for (const l of fresh) { const old = existing.find(x => x.lesson === l.lesson); if (old) for (const p of l.points) { const op = old.points.find(x => x.id === p.id); if (op?.details && !p.details) p.details = op.details; } }
const lessons = [...existing.filter(l => !fresh.some(x => x.lesson === l.lesson)), ...fresh].sort((a, b) => a.lesson - b.lesson);
const ids = new Set();
for (const l of lessons) for (const p of l.points) {
  if (ids.has(p.id)) throw new Error('dup id ' + p.id);
  ids.add(p.id);
  for (const b of p.blocks) {
    const txt = JSON.stringify(b);
    if ((txt.match(/\{/g) || []).length !== (txt.match(/\}/g) || []).length) throw new Error('brace mismatch in ' + p.id + ': ' + txt);
    if (b.ex != null && /[一-鿿々](?![^{]*\|)/.test(b.ex.replace(/\{[^}]*\}/g, ''))) console.warn('kanji without reading in', p.id, b.ex);
  }
}
const J = JSON.stringify;
const out = '{\n  "lessons": [\n' + lessons.map(l => '    {\n      "lesson": ' + l.lesson + ',\n      "points": [\n' +
  l.points.map(p => '        {\n          "id": ' + J(p.id) + ',\n          "title": ' + J(p.title) + ',\n          "blocks": [\n' +
    p.blocks.map(b => '            ' + J(b)).join(',\n') + '\n          ]' +
    (p.details?.length ? ',\n          "details": [\n' + p.details.map(b => '            ' + J(b)).join(',\n') + '\n          ]' : '') + '\n        }').join(',\n') +
  '\n      ]\n    }').join(',\n') + '\n  ]\n}\n';
JSON.parse(out);
const check = require('./check-grammar.js');
const problems = check.compare(JSON.parse(out).lessons);
if (problems.length && !process.argv.includes('--textbook-update')) {
  console.error('NOT WRITTEN — textbook content would change:\n' + problems.slice(0, 40).join('\n'));
  process.exit(1);
}
fs.writeFileSync(path.join(root, 'site/data/grammar.json'), out);
if (process.argv.includes('--textbook-update')) check.update();
console.log('grammar.json:', lessons.map(l => `L${l.lesson}:${l.points.length}`).join(' '));
