// Example sentences for the «Словник» word pages, from Tatoeba (https://tatoeba.org, CC BY 2.0 FR):
//   node tools/build-dict-examples.mjs <dir with jmdict-examples-eng-*.json, jpn_sentences.tsv, ukr_sentences.tsv, jpn-ukr_links.tsv>
// Sources: jmdict-simplified "jmdict-examples-eng" (JMdict senses with the Tanaka/Tatoeba example of each sense,
// Japanese + English) and Tatoeba's per-language exports (Ukrainian translations linked to a Japanese sentence).
// Output site/data/dict/ex-0.json … ex-f.json (shard = hash of the JMdict id, loaded on demand by dict.js):
//   { "x": { "<jmdictId>": [[sense, "ja", "form in the sentence", "en", "uk", tatoebaId], …] } }  — one word per line.
// Every curated example gets its Ukrainian translation when Tatoeba links one; words also get up to EXTRA more
// Tatoeba sentences that have a Ukrainian translation and contain the word (kanji form ≥ 2 characters, or kana ≥ 3 — a single kanji would match inside other words).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-dict-examples.mjs <source dir>'); process.exit(1); }
const file = pre => path.join(SRC, fs.readdirSync(SRC).find(f => f.startsWith(pre) && /\.(json|tsv)$/.test(f)));
const tsv = f => fs.readFileSync(file(f), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
const OUT = path.join(ROOT, 'site/data/dict');
const SHARDS = 16, PER_WORD = 4, EXTRA = 2;
// shard = string hash of the id (most JMdict ids end in 0, so a digit would not spread them) — same in site/js/dict.js
export const shardOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % SHARDS; };

const jpn = new Map(tsv('jpn_sentences').map(([id, , t]) => [id, t]));
const ukr = new Map(tsv('ukr_sentences').map(([id, , t]) => [id, t]));
const ukOf = new Map();
for (const [j, u] of tsv('jpn-ukr_links')) if (ukr.has(u) && !ukOf.has(j)) ukOf.set(j, ukr.get(u));
console.log(`Tatoeba: ${jpn.size} Japanese, ${ukr.size} Ukrainian sentences, ${ukOf.size} Japanese with a Ukrainian translation`);

const J = JSON.parse(fs.readFileSync(file('jmdict-examples-eng'), 'utf8'));
const byWord = new Map();
// Tatoeba ids of Japanese sentences by text (the JMdict example's source id may point to the English one)
const jpnId = new Map([...jpn].map(([id, t]) => [t, id]));
let curated = 0, withUk = 0;
for (const w of J.words) {
  const rows = [];
  w.sense.forEach((s, si) => {
    for (const ex of s.examples || []) {
      const ja = ex.sentences.find(x => x.lang === 'jpn')?.text, en = ex.sentences.find(x => x.lang === 'eng')?.text || '';
      if (!ja) continue;
      const tid = jpnId.get(ja) || (ex.source?.type === 'tatoeba' ? String(ex.source.value) : '');
      const uk = ukOf.get(tid) || '';
      if (uk) withUk++;
      rows.push([si, ja, ex.text || '', en, uk, tid ? +tid : 0]);
      curated++;
    }
  });
  if (rows.length) byWord.set(w.id, rows.slice(0, PER_WORD));
}
// extra sentences with a Ukrainian translation that contain the word
const ukSentences = [...ukOf.keys()].filter(id => jpn.has(id)).map(id => [id, jpn.get(id)]);
let extra = 0;
for (const w of J.words) {
  const forms = [...w.kanji.map(k => k.text).filter(t => t.length >= 2), ...(w.kanji.length ? [] : w.kana.map(k => k.text).filter(t => t.length >= 3))];
  if (!forms.length) continue;
  const have = byWord.get(w.id) || [];
  const add = [];
  for (const [id, t] of ukSentences) {
    if (add.length >= EXTRA) break;
    const f = forms.find(x => t.includes(x));
    if (f && !have.some(r => r[1] === t)) add.push([-1, t, f, '', ukOf.get(id), +id]);
  }
  if (add.length) { byWord.set(w.id, [...have, ...add]); extra += add.length; }
}
console.log(`curated examples ${curated} (Ukrainian ${withUk}), extra Ukrainian sentences ${extra}, words ${byWord.size}`);

const shards = Array.from({ length: SHARDS }, () => []);
for (const [id, rows] of byWord) shards[shardOf(id)].push(`${JSON.stringify(String(id))}:${JSON.stringify(rows)}`);
let total = 0;
shards.forEach((lines, i) => {
  const name = `ex-${i.toString(16)}.json`;
  if (!lines.length) { if (fs.existsSync(path.join(OUT, name))) fs.unlinkSync(path.join(OUT, name)); return; }
  const s = `{"x":{\n${lines.join(',\n')}\n}}\n`;
  fs.writeFileSync(path.join(OUT, name), s);
  total += s.length;
});
console.log(`written ${shards.filter(s => s.length).length} shards, ${(total / 1e6).toFixed(1)} MB`);
