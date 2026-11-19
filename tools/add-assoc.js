// node tools/add-assoc.js <srcDir> [--force]
// Adds ready-made kanji associations from <srcDir>/A*.js (module.exports = { "k300-001": "text", … }) into
// site/data/kanji-assoc.json ({ kanji: { id: { t, check: true } } }, one kanji per line, in book order).
// Existing entries are kept unless --force. Refuses: unknown ids, empty/too long text (> 300), Latin letters,
// straight apostrophes/quotes (use ’ and «»), a text that names none of the kanji's components or the kanji itself.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const srcDir = path.resolve(args.find(a => !a.startsWith('--')) || '.');
const file = path.join(root, 'site/data/kanji-assoc.json');
const MAX = 300;
const kj = JSON.parse(fs.readFileSync(path.join(root, 'site/data/kanji.json'), 'utf8'));
const order = [], byId = new Map();
for (const b of kj.books) for (const l of b.lessons) for (const k of l.kanji) { order.push(k.id); byId.set(k.id, k); }
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { kanji: {} };
data.kanji ||= {};

const errors = [], added = [], kept = [];
const files = fs.readdirSync(srcDir).filter(f => /^A.*\.js$/.test(f)).sort();
if (!files.length) { console.error('no A*.js files in', srcDir); process.exit(1); }
for (const f of files) {
  const src = require(path.join(srcDir, f));
  for (const [id, raw] of Object.entries(src)) {
    const k = byId.get(id);
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!k) { errors.push(`${f}: unknown id ${id}`); continue; }
    if (!t) { errors.push(`${id}: empty`); continue; }
    if (t.length > MAX) errors.push(`${id}: ${t.length} > ${MAX} characters`);
    if (/[A-Za-z]/.test(t)) errors.push(`${id}: Latin letters`);
    if (/['"]/.test(t)) errors.push(`${id}: straight quote/apostrophe — use ’ and «»`);
    if (!/[㐀-鿿⺀-⿟㇀-㇯\u{20000}-\u{2ffff}]/u.test(t)) errors.push(`${id}: names no component (no kanji/radical in brackets)`);
    if (data.kanji[id] && !force) { kept.push(id); continue; }
    data.kanji[id] = { t, check: true };
    added.push(id);
  }
}
if (errors.length) { console.error('REFUSED, nothing written:\n' + errors.map(e => '  ' + e).join('\n')); process.exit(1); }
const ids = order.filter(id => data.kanji[id]);
const out = '{\n  "kanji": {\n' + ids.map(id => `    ${JSON.stringify(id)}: ${JSON.stringify(data.kanji[id])}`).join(',\n') + '\n  }\n}\n';
JSON.parse(out);
fs.writeFileSync(file, out);
console.log(`added ${added.length}, kept ${kept.length} (use --force to replace); total ${ids.length} / ${order.length}`);
const missing = order.filter(id => !data.kanji[id]);
if (missing.length && missing.length < 40) console.log('missing:', missing.join(' '));
