// Merges Ukrainian meanings of JMdict words into site/data/dict/uk.json { about, m: { jmdictId: "значення; …" } }.
// Run: node tools/add-dict-uk.mjs <dir> [--force]   (dir with U*.js: module.exports = { "1358280": "їсти; харчуватися" })
// Checks: id exists in the dictionary; text 1–160 chars; no Latin except abbreviations in CAPS (CD, SMS) and
// units; apostrophe ’ (not ' or ʼ); senses separated by "; "; existing meanings are kept unless --force.
// The meanings are written by Claude from the English JMdict glosses → shown with «перевірити» on the site.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(ROOT, 'site/data/dict');
const args = process.argv.slice(2), force = args.includes('--force'), dir = args.find(a => !a.startsWith('--'));
if (!dir) { console.error('usage: node tools/add-dict-uk.mjs <dir> [--force]'); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(path.join(D, 'meta.json'), 'utf8'));
const ids = new Set();
for (let i = 0; i < meta.chunks; i++) for (const x of JSON.parse(fs.readFileSync(path.join(D, `words-${String(i).padStart(2, '0')}.json`), 'utf8')).e) ids.add(x[0]);
const file = path.join(D, 'uk.json');
const uk = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).m : {};

const errors = [];
let added = 0, replaced = 0, kept = 0;
for (const f of fs.readdirSync(dir).filter(f => /^U.*\.js$/.test(f)).sort()) {
  const data = require(path.resolve(dir, f));
  for (let [id, t] of Object.entries(data)) {
    t = String(t).replace(/['ʼ`]/g, '’').replace(/\s*;\s*/g, '; ').replace(/\s+/g, ' ').trim();
    const where = `${f} ${id}`;
    if (!ids.has(id)) { errors.push(`${where}: no such JMdict id`); continue; }
    if (!t || t.length > 160) { errors.push(`${where}: length ${t.length}`); continue; }
    if (/[a-z]{2,}/.test(t.replace(/\b(км|кг|см|мм|мл)\b/g, ''))) { errors.push(`${where}: Latin text «${t}»`); continue; }
    if (!/[а-яіїєґ]/i.test(t)) { errors.push(`${where}: no Ukrainian «${t}»`); continue; }
    if (/[ыэъё]/i.test(t)) { errors.push(`${where}: Russian letters «${t}»`); continue; }
    if (uk[id] && !force) { if (uk[id] !== t) kept++; continue; }
    if (uk[id]) replaced++; else added++;
    uk[id] = t;
  }
}
if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} error(s) — nothing written`); process.exit(1); }
const keys = Object.keys(uk).sort((a, b) => Number(a) - Number(b));
const body = keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(uk[k])}`).join(',\n');
fs.writeFileSync(file, `{"about":"Ukrainian meanings of JMdict words, written by Claude from the English glosses (check). tools/add-dict-uk.mjs","m":{\n${body}\n}}\n`);
console.log(`uk.json: ${keys.length} words (+${added}, replaced ${replaced}, kept existing ${kept})`);
