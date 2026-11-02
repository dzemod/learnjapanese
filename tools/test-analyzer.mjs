// Test the Перекладач analysis in Node (same code as the browser: site/js/analyzer.js + wordindex.js).
//   npm i --no-save kuromoji@0.1.2   (or KUROMOJI=<path to kuromoji package>)
//   node tools/test-analyzer.mjs "日本へ行ったことがあります。" "…"      → print the analysis
//   node tools/test-analyzer.mjs --coverage 1 10                           → constructions found in the textbook
//        examples (文型/例文) of lessons 1–10: for every grammar point, how many of its own examples hit it
//   node tools/test-analyzer.mjs --unknown 1 50                            → words of the examples missing from my data
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { analyzeText, literal } from '../site/js/analyzer.js';
import { buildIndex, lookupWord } from '../site/js/wordindex.js';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kuroPath = process.env.KUROMOJI || path.join(root, 'node_modules', 'kuromoji');
const kuromoji = require(kuroPath);
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const D = read('site/data/analyzer.json');
const G = read('site/data/grammar.json');
const sets = read('site/data/sets.json').sets.map(s => ({ ...s, cards: s.cards.map(c => ({ ...c, japanese: c.kanji || c.kana, reading: c.kanji ? c.kana : '' })) }));
const idx = buildIndex(sets, read('site/data/kanji.json').books);
const lookup = (b, k, o) => lookupWord(idx, b, k, o);

const tk = await new Promise((res, rej) => kuromoji.builder({ dicPath: path.join(kuroPath, 'dict') }).build((e, t) => (e ? rej(e) : res(t))));
const plain = s => String(s).replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1').replace(/[（(][^）)]*[）)]/g, '');
const run = s => analyzeText(tk.tokenize(s), D, lookup);

const args = process.argv.slice(2);
if (args[0] === '--coverage' || args[0] === '--unknown') {
  const from = +args[1] || 1, to = +args[2] || from;
  const unknown = new Map();
  let pts = 0, hit = 0;
  for (const l of G.lessons.filter(l => l.lesson >= from && l.lesson <= to)) {
    for (const p of l.points) {
      const exs = p.blocks.filter(b => b.ex).map(b => plain(b.ex)).filter(x => !/[Ａ-Ｚ]|～/.test(x));
      if (!exs.length) continue;
      let n = 0;
      const miss = [];
      for (const ex of exs) {
        const res = run(ex);
        if (res.some(r => r.constructions.some(c => c.point === p.id))) n++; else miss.push(ex);
        for (const r of res) for (const b of r.blocks) if (!b.meaning && !['particle', 'punct', 'copula', 'copneg', 'aux'].includes(b.cls)) unknown.set(b.base, (unknown.get(b.base) || 0) + 1);
      }
      pts++;
      if (n) hit++;
      if (args[0] === '--coverage') console.log(`${n ? '✓' : '·'} ${p.id.padEnd(6)} ${n}/${exs.length}  ${plain(p.title).slice(0, 50)}${n < exs.length && miss.length ? '\n         miss: ' + miss.slice(0, 2).join(' ｜ ') : ''}`);
    }
  }
  if (args[0] === '--coverage') console.log(`\npoints with at least one detected example: ${hit}/${pts}`);
  else console.log([...unknown].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join('\n'));
  process.exit(0);
}

for (const s of args) {
  for (const r of run(s)) {
    console.log(`\n${r.text}  (${r.kana})`);
    for (const b of r.blocks) {
      if (b.cls === 'punct') continue;
      console.log(`  [${b.surface}] ${b.cls}/${b.pos}${b.group ? ' ' + b.group : ''} base=${b.base}(${b.baseKana}) keys=${(b.keys || []).join(',')} ${b.steps.map(s => s.chain.join('→')).join(' | ')} ${b.meaning ? '= ' + b.meaning.uk.slice(0, 40) + ' [' + b.meaning.src + ']' : ''}${b.particle ? ' :: ' + b.particle.use + ' ' + b.particle.label + ' (' + b.particle.point + ') «' + b.particle.phrase + '»' : ''}`);
    }
    console.log('  constructions: ' + r.constructions.map(c => `${c.id}(${c.point}) «${c.match}»`).join(', '));
    console.log('  structure: ' + r.structure.map(x => `${x.label}: ${x.text}`).join(' | '));
    console.log('  politeness: ' + r.politeness.map(p => p.label).join(', '));
    console.log('  literal: ' + literal(r));
  }
}
