// Prints the token string that construction patterns are matched against, for every textbook
// example of the given grammar points / lessons (helper for writing tools/analyzer/L*.js).
//   node tools/analyzer-dump.mjs 1 10          → all points of lessons 1–10
//   node tools/analyzer-dump.mjs 6-2 7-3       → only these points
//   node tools/analyzer-dump.mjs "文"           → any sentence
// Token: ‹kana·tag·base·form›  — pattern syntax <TAG:form=base~kana> (see site/js/analyzer.js compilePattern).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kuroPath = process.env.KUROMOJI || path.join(root, 'node_modules', 'kuromoji');
const kuromoji = require(kuroPath);
const G = JSON.parse(fs.readFileSync(path.join(root, 'site/data/grammar.json'), 'utf8'));
const D = JSON.parse(fs.readFileSync(path.join(root, 'site/data/analyzer.json'), 'utf8'));
const { debugTokens } = await import('../site/js/analyzer.js');
const tk = await new Promise((res, rej) => kuromoji.builder({ dicPath: path.join(kuroPath, 'dict') }).build((e, t) => (e ? rej(e) : res(t))));
const plain = s => String(s).replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1').replace(/[（(][^）)]*[）)]/g, '');
const show = s => debugTokens(tk.tokenize(s), D).replace(/‹([^·]*)·([^·]*)·([^·]*)·([^›]*)›/g, (_, k, t, b, f) => `${b}${b !== k ? '~' + k : ''}/${t}${f && f !== '-' ? ':' + f : ''} `);

const args = process.argv.slice(2);
if (args.length && !/^\d+(-\d+)?$/.test(args[0])) { for (const s of args) console.log(show(s)); process.exit(0); }
const lessonRange = args.length === 2 && args.every(a => /^\d+$/.test(a)) ? [+args[0], +args[1]] : null;
for (const l of G.lessons) for (const p of l.points) {
  if (lessonRange ? (l.lesson < lessonRange[0] || l.lesson > lessonRange[1]) : !args.includes(p.id)) continue;
  console.log(`\n## ${p.id} ${plain(p.title)}`);
  for (const b of p.blocks.filter(b => b.ex)) console.log('  ' + plain(b.ex) + '\n    ' + show(plain(b.ex)));
}
