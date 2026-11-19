// Lists the next common JMdict words without a Ukrainian meaning, in the order of order.json, for writing a batch.
// Run: node tools/dump-dict-batch.mjs [count=500] [skip=0]
// Output (one per line): id <TAB> written forms <TAB> readings <TAB> pos of sense 1 <TAB> English senses (≤ 4, " / ")
// Write the batch as U*.js (module.exports = { "id": "значення; значення", … }) and merge with tools/add-dict-uk.mjs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(ROOT, 'site/data/dict');
const [count = 500, skip = 0] = process.argv.slice(2).map(Number);
const meta = JSON.parse(fs.readFileSync(path.join(D, 'meta.json'), 'utf8'));
const order = JSON.parse(fs.readFileSync(path.join(D, 'order.json'), 'utf8')).ids;
const uk = fs.existsSync(path.join(D, 'uk.json')) ? JSON.parse(fs.readFileSync(path.join(D, 'uk.json'), 'utf8')).m : {};
const E = new Map();
for (let i = 0; i < meta.chunks; i++) for (const x of JSON.parse(fs.readFileSync(path.join(D, `words-${String(i).padStart(2, '0')}.json`), 'utf8')).e) if (x[3]) E.set(x[0], x);
const todo = order.filter(id => !uk[id]);
console.error(`translated ${Object.keys(uk).length} · left ${todo.length}`);
for (const id of todo.slice(skip, skip + count)) {
  const x = E.get(id);
  console.log([id, x[1], x[2], x[4][0][0].split('|')[0], x[4].slice(0, 4).map(s => s[1]).join(' / ')].join('\t'));
}
