// Answer check (util.js check): ず = づ and じ = ぢ for Japanese answers (romaji "zu"/"ji" and most IMEs give ず/じ).
//   node tools/test-check-zu.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { check } = await import(pathToFileURL(path.join(ROOT, 'site/js/util.js')).href);
let fail = 0;
const t = (name, got, want) => { if (got !== want) { fail++; console.log('FAIL', name, got); } else console.log('ok  ', name); };
const card = { japanese: '片づけます', reading: 'かたづけます' };
t('かたづけます (exact)', check('かたづけます', card, 'ja').ok, true);
t('かたずけます (romaji zu)', check('かたずけます', card, 'ja').ok, true);
t('片ずけます (kanji + ず)', check('片ずけます', card, 'ja').ok, true);
t('かたつけます (wrong)', check('かたつけます', card, 'ja').ok, false);
t('はなじ for はなぢ', check('はなじ', { japanese: '鼻血', reading: 'はなぢ' }, 'ja').ok, true);
t('ちず stays ちず (no false づ→ず damage)', check('ちず', { japanese: '地図', reading: 'ちず' }, 'ja').ok, true);
t('Ukrainian side unchanged', check('прибирати', { ukrainian: 'прибирати' }, 'uk').ok, true);
console.log(fail ? `${fail} failed` : 'ALL ZU CHECKS PASSED');
process.exit(fail ? 1 : 0);
