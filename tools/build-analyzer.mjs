// Builds site/data/analyzer.json (rules + Ukrainian explanations for the Перекладач tab)
// from tools/analyzer/base.js (parts of speech, conjugation steps, particles, lexicon, politeness)
// and tools/analyzer/L*.js (constructions of Minna no Nihongo lessons, module.exports = [ ... ]).
//   node tools/build-analyzer.mjs
// Checks: every point exists in site/data/grammar.json, every pattern compiles, every kanji in
// Ukrainian text has a reading ({漢字|かな}), construction ids are unique.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { compilePattern } from '../site/js/analyzer.js';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tools', 'analyzer');
const base = require(path.join(dir, 'base.js'));
const grammar = JSON.parse(fs.readFileSync(path.join(root, 'site/data/grammar.json'), 'utf8'));
const points = new Map(grammar.lessons.flatMap(l => l.points.map(p => [p.id, p.title])));

const constructions = [];
for (const f of fs.readdirSync(dir).filter(f => /^L\d.*\.js$/.test(f)).sort()) {
  const list = require(path.join(dir, f));
  for (const c of list) constructions.push({ ...c, file: f });
}

const errors = [];
const KANJI = /[㐀-鿿々〆]/;
const noMarkup = s => String(s).replace(/\{[^{}|]+\|[^{}]+\}/g, '');
function checkText(where, s) {
  if (s == null) return;
  if (KANJI.test(noMarkup(s))) errors.push(`${where}: kanji without reading → ${s}`);
}
const checkPoint = (where, p) => { if (p && !points.has(p)) errors.push(`${where}: unknown grammar point ${p}`); };

for (const [cls, list] of Object.entries(base.steps)) list.forEach((s, i) => { checkText(`steps.${cls}[${i}]`, s.text); s.chain.forEach(c => checkText(`steps.${cls}[${i}].chain`, c)); checkPoint(`steps.${cls}[${i}]`, s.point); });
checkPoint('potential', base.potential.point);
for (const [k, v] of Object.entries(base.politeness)) { checkText(`politeness.${k}`, v.text); checkText(`politeness.${k}.label`, v.label); checkPoint(`politeness.${k}`, v.point); }
for (const [p, def] of Object.entries(base.particles)) for (const [u, use] of Object.entries(def.uses)) { checkText(`particles.${p}.${u}`, use.text); checkText(`particles.${p}.${u}.label`, use.label); checkPoint(`particles.${p}.${u}`, use.point); }

const ids = new Set();
const out = [];
for (const c of constructions) {
  const where = `${c.file} ${c.id}`;
  if (!c.id || !c.pattern || !c.title || !c.text) errors.push(`${where}: id, pattern, title and text are required`);
  if (ids.has(c.id)) errors.push(`${where}: duplicate id`);
  ids.add(c.id);
  checkPoint(where, c.point);
  if (!c.point) errors.push(`${where}: point is required`);
  checkText(where + ' title', c.title);
  checkText(where + ' text', c.text);
  try { compilePattern(c.pattern); } catch (e) { errors.push(`${where}: ${e.message}`); }
  const { file, ...rest } = c;
  out.push({ lesson: +String(c.point).split('-')[0], ...rest });
}
if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} problem(s) — analyzer.json NOT written.`); process.exit(1); }

const data = { version: 1, pos: base.pos, groups: base.groups, roles: base.roles, steps: base.steps, potential: base.potential, politeness: base.politeness, particles: base.particles, lexicon: base.lexicon, constructions: out };
// one construction / step / particle per line (readable diffs)
let json;
json = JSON.stringify(data).replace(/^\{/, '{\n').replace(/("constructions":\[)/, '$1\n').replace(/\},\{"id"/g, '},\n{"id"').replace(/,"(pos|groups|roles|steps|potential|politeness|particles|lexicon|constructions)":/g, ',\n"$1":');
JSON.parse(json);
fs.writeFileSync(path.join(root, 'site/data/analyzer.json'), json + '\n');
const byLesson = {};
out.forEach(c => (byLesson[c.lesson] = (byLesson[c.lesson] || 0) + 1));
console.log(`analyzer.json: ${out.length} constructions`, JSON.stringify(byLesson));
