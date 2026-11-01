// Textbook guard for site/data/grammar.json.
//   node tools/check-grammar.js            → compare with tools/grammar-baseline.json, exit 1 if anything is missing
//   node tools/check-grammar.js --update   → accept the current textbook content as the new baseline
//                                            (only after a deliberate, reviewed correction of the textbook text)
// The baseline stores, per grammar point, the number of textbook examples and a hash of every textbook
// block (explanation, subheading, note, table, 文型/例文 example with translation). Only point.blocks is
// textbook content; point.details («Детальніше») is free to change and is not checked.
// Run after every batch of grammar work (build-grammar.js runs it automatically before writing).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const GFILE = path.join(ROOT, 'site/data/grammar.json');
const BASE = path.join(__dirname, 'grammar-baseline.json');

const hash = b => crypto.createHash('sha1').update(JSON.stringify(b)).digest('base64').slice(0, 12);
const label = b => (b.ex != null ? `приклад «${String(b.ex).slice(0, 40)}»` : b.p ? `пояснення «${b.p.slice(0, 40)}…»` : b.note ? `примітка «${b.note.slice(0, 40)}…»` : b.h ? `підзаголовок «${b.h.slice(0, 40)}»` : b.table ? 'таблиця' : JSON.stringify(b).slice(0, 50));
function snapshot(lessons) {
  const pts = {};
  for (const l of lessons) for (const p of l.points) pts[p.id] = { lesson: l.lesson, title: p.title, examples: p.blocks.filter(b => b.ex != null).length, blocks: p.blocks.map(b => [hash(b), label(b)]) };
  return pts;
}
function compare(lessons) {
  if (!fs.existsSync(BASE)) return [];
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8')).points;
  const cur = snapshot(lessons);
  const out = [];
  for (const [id, b] of Object.entries(base)) {
    const c = cur[id];
    if (!c) { out.push(`L${b.lesson} ${id}: пункт «${b.title}» зник`); continue; }
    if (c.title !== b.title) out.push(`L${b.lesson} ${id}: змінено назву «${b.title}» → «${c.title}»`);
    if (c.examples < b.examples) out.push(`L${b.lesson} ${id}: прикладів ${b.examples} → ${c.examples}`);
    const have = new Map();
    for (const [h] of c.blocks) have.set(h, (have.get(h) || 0) + 1);
    for (const [h, what] of b.blocks) { if (have.get(h)) have.set(h, have.get(h) - 1); else out.push(`L${b.lesson} ${id}: відсутнє або змінене — ${what}`); }
  }
  return out;
}
function update() {
  const lessons = JSON.parse(fs.readFileSync(GFILE, 'utf8')).lessons;
  const points = snapshot(lessons);
  fs.writeFileSync(BASE, JSON.stringify({ note: 'Textbook baseline for tools/check-grammar.js — do not edit by hand', created: new Date().toISOString().slice(0, 10), points }) + '\n');
  return points;
}
module.exports = { compare, update, snapshot };

if (require.main === module) {
  if (process.argv.includes('--update')) {
    const p = update();
    console.log(`baseline updated: ${Object.keys(p).length} points, ${Object.values(p).reduce((n, x) => n + x.examples, 0)} examples`);
  } else {
    const lessons = JSON.parse(fs.readFileSync(GFILE, 'utf8')).lessons;
    const problems = compare(lessons);
    const s = snapshot(lessons);
    console.log(`checked ${lessons.length} lessons, ${Object.keys(s).length} points, ${Object.values(s).reduce((n, x) => n + x.examples, 0)} textbook examples`);
    if (problems.length) { console.error(`FAIL — ${problems.length} textbook problems:\n` + problems.join('\n')); process.exit(1); }
    console.log('OK — no textbook content missing or changed');
  }
}
