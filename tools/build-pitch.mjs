// Builds the pitch-accent data from Kanjium (https://github.com/mifunetoshiro/kanjium, CC BY-SA 4.0):
//   node tools/build-pitch.mjs <path to kanjium data/source_files/raw/accents.txt>
// accents.txt lines: form \t reading (empty = kana word) \t accents ("1", "0,2", "(副)0,(名)3" → notes dropped).
// Output: site/data/pitch.json { p: { "form|reading": "n[,n]" } } for my lesson cards (keys from site/js/pitch.js
// pitchKeys; ます-verbs are computed, not stored) + site/data/dict/pitch-0 … pitch-f.json (whole list, shard =
// pitchShard(form)). Prints the coverage of the textbook words.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-pitch.mjs <accents.txt>'); process.exit(1); }
const PJ = await import(pathToFileURL(path.join(ROOT, 'site/js/pitch.js')).href);

const all = new Map();
for (const line of fs.readFileSync(SRC, 'utf8').split('\n')) {
  const [form, rd, acc] = line.replace(/\r$/, '').split('\t');
  if (!form || acc == null) continue;
  const nums = [...new Set(acc.replace(/\([^)]*\)/g, '').split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)))];
  if (!nums.length) continue;
  const key = `${form}|${rd || form}`;
  if (!all.has(key)) all.set(key, nums.join(','));
}
console.log('Kanjium entries', all.size);

// my lessons
const sets = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/sets.json'), 'utf8')).sets;
const p = {};
let cards = 0, hit = 0, verbs = 0, kanaOnly = 0;
// reading → accent, only where all Kanjium entries with this reading have the same accent (はし: 橋 2 / 箸 1 → none)
const byReading = new Map(), clash = new Set();
for (const [k, v] of all) { const r = k.split('|')[1]; if (clash.has(r)) continue; if (byReading.has(r) && byReading.get(r) !== v) { byReading.delete(r); clash.add(r); } else byReading.set(r, v); }
for (const s of sets) for (const c of s.cards) {
  const ja = c.kanji || c.kana, rd = c.kanji ? c.kana : '';
  cards++;
  if (c.verbGroup && /ます$/.test(PJ.pitchKeys(ja, rd)[0]?.split('|')[1] || '')) { verbs++; hit++; continue; }
  let found = false;
  for (const k of PJ.pitchKeys(ja, rd)) if (all.has(k)) { p[k] = all.get(k); hit++; found = true; break; }
  // kana-only card (きれい) that Kanjium lists only with kanji (綺麗): taken only when every entry with that reading agrees
  if (!found && !c.kanji) for (const k of PJ.pitchKeys(ja, rd)) {
    const v = byReading.get(k.split('|')[1]);
    if (v) { p[k] = v; hit++; kanaOnly++; break; }
  }
}
fs.writeFileSync(path.join(ROOT, 'site/data/pitch.json'), `{"source":"Kanjium (github.com/mifunetoshiro/kanjium)","license":"CC BY-SA 4.0","p":{\n${Object.entries(p).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')}\n}}\n`);
console.log(`lesson cards with pitch: ${hit} of ${cards} (ます-verbs by rule: ${verbs}, kana cards by an unambiguous reading: ${kanaOnly}); pitch.json ${Object.keys(p).length} keys`);

// dictionary shards
const shards = Array.from({ length: 16 }, () => []);
for (const [k, v] of all) shards[parseInt(PJ.pitchShard(k.split('|')[0]), 16)].push(`${JSON.stringify(k)}:${JSON.stringify(v)}`);
let size = 0;
shards.forEach((l, i) => { const s = `{"p":{\n${l.join(',\n')}\n}}\n`; fs.writeFileSync(path.join(ROOT, `site/data/dict/pitch-${i.toString(16)}.json`), s); size += s.length; });
console.log(`dictionary shards: 16, ${(size / 1e6).toFixed(1)} MB`);
