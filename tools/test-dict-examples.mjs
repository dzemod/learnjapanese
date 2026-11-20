// Data check of the dictionary example sentences (site/data/dict/ex-0 … ex-f.json, tools/build-dict-examples.mjs):
// shards parse, every word id exists in the dictionary and sits in the right shard, rows are well formed, the
// highlighted form occurs in its sentence, every row has a translation, Ukrainian rows exist.
//   node tools/test-dict-examples.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(ROOT, 'site/data/dict');
let passed = 0;
const fails = [];
const ok = (c, name) => { if (c) passed++; else { fails.push(name); console.log('FAIL', name); } };

const ids = new Set();
for (const f of fs.readdirSync(D).filter(f => /^words-\d+\.json$/.test(f))) for (const e of JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')).e) ids.add(String(e[0]));
let words = 0, rows = 0, uk = 0, bad = [];
const shardOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 16; };
for (let i = 0; i < 16; i++) {
  const f = path.join(D, `ex-${i.toString(16)}.json`);
  ok(fs.existsSync(f), `ex-${i.toString(16)}.json exists`);
  const x = JSON.parse(fs.readFileSync(f, 'utf8')).x;
  ok(fs.statSync(f).size < 500e3, `ex-${i.toString(16)}.json < 500 KB (${fs.statSync(f).size})`);
  for (const [id, list] of Object.entries(x)) {
    words++;
    if (!ids.has(id)) bad.push(`${id}: not in the dictionary`);
    if (shardOf(id) !== i) bad.push(`${id}: wrong shard ${i}`);
    if (list.length > 6) bad.push(`${id}: ${list.length} examples`);
    for (const r of list) {
      rows++;
      const [si, ja, form, en, u, tid] = r;
      if (r.length !== 6 || !Number.isInteger(si) || si < -1 || typeof ja !== 'string' || !ja) bad.push(`${id}: bad row`);
      if (form && !ja.includes(form)) bad.push(`${id}: form ${form} not in ${ja}`);
      if (!en && !u) bad.push(`${id}: no translation`);
      if (si === -1 && !u) bad.push(`${id}: extra sentence without Ukrainian`);
      if (u) uk++;
      if (!(tid >= 0)) bad.push(`${id}: tatoeba id`);
    }
  }
}
ok(!bad.length, `rows well formed (${bad.slice(0, 5).join('; ')})`);
ok(words > 25000 && rows > 30000, `coverage: ${words} words, ${rows} sentences`);
ok(uk > 1000, `Ukrainian translations: ${uk}`);
console.log(`${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
