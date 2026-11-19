// Lists kanji with their KanjiVG components (+ meanings) for writing associations:
//   node tools/dump-kanji-parts.mjs <KanjiVG svg dir> <lessonId>[,<lessonId>…] | all
// Output per line: id kanji «meaning» | components ch=meaning … | readings
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(pathToFileURL(path.join(ROOT, 'site/js/kanji-parts.js')).href);
const [dir, which = 'all'] = process.argv.slice(2);
if (!dir) { console.error('usage: node tools/dump-kanji-parts.mjs <svg dir> <lessonIds|all>'); process.exit(1); }
const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8'));
const mean = new Map();
for (const b of kj.books) for (const l of b.lessons) for (const k of l.kanji) mean.set(k.kanji, k.meaning);
const want = which === 'all' ? null : new Set(which.split(','));
for (const b of kj.books) for (const l of b.lessons) {
  if (want && !want.has(l.id)) continue;
  console.log(`# ${l.id} ${l.titleUk || l.title}`);
  for (const k of l.kanji) {
    const f = path.join(dir, k.kanji.codePointAt(0).toString(16).padStart(5, '0') + '.svg');
    const parts = fs.existsSync(f) ? P.partsWithMeanings(P.partsFromSVG(fs.readFileSync(f, 'utf8'), k.kanji), ch => (ch === k.kanji ? '' : mean.get(ch) || '')) : [];
    console.log(`${k.id} ${k.kanji} «${k.meaning}» (${k.en}) | ${parts.map(p => `${p.ch}=${p.uk || '?'}`).join(' ') || '—'} | ${[...k.on, ...k.kun].join('、')}`);
  }
}
