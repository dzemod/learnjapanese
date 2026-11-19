// Builds the «Словник» data in site/data/dict/ from jmdict-simplified (https://github.com/scriptin/jmdict-simplified):
//   node tools/build-dict.mjs <dir with jmdict-eng-*.json, kanjidic2-en-*.json, radkfile-*.json, kradfile-*.json>
// Output (one entry per line, loaded lazily by site/js/dict-worker.js and cached):
//   dict/meta.json         { version, source, license, chunks, words, kanji, pos: { tag: description } }
//   dict/words-NN.json     { e: [[id, "漢字|…", "かな|…", common 0/1, [[pos, "gloss; gloss"], …]], …] } — CHUNK entries each
//   dict/kanji.json        { k: [[kanji, strokes, grade, jlpt, freq, "オン|…", "くん|…", "meaning; …", "components"], …] }
//   dict/radicals.json     { r: [[radical, strokes, "kanji…"], …] }
// JMdict / KANJIDIC2 / RADKFILE / KRADFILE © Electronic Dictionary Research and Development Group, CC BY-SA 4.0.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-dict.mjs <source dir>'); process.exit(1); }
const pick = pre => JSON.parse(fs.readFileSync(path.join(SRC, fs.readdirSync(SRC).find(f => f.startsWith(pre) && f.endsWith('.json'))), 'utf8'));
const OUT = path.join(ROOT, 'site/data/dict');
fs.mkdirSync(OUT, { recursive: true });
const CHUNK = 20000, SENSES = 5, GLOSSES = 5;
const lines = (key, rows) => `{"${key}":[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]}\n`;

const J = pick('jmdict-eng');
const usedPos = new Set();
// common entries first (so a partial load already has the useful words), then the rest in JMdict order
const words = [...J.words].sort((a, b) => (b.kanji.some(k => k.common) || b.kana.some(k => k.common) ? 1 : 0) - (a.kanji.some(k => k.common) || a.kana.some(k => k.common) ? 1 : 0));
const rows = words.map(w => {
  const kanji = w.kanji.map(k => k.text), kana = w.kana.map(k => k.text);
  const common = w.kanji.some(k => k.common) || w.kana.some(k => k.common) ? 1 : 0;
  let lastPos = '';
  const senses = w.sense.slice(0, SENSES).map(s => {
    const pos = s.partOfSpeech.length ? s.partOfSpeech.join(',') : lastPos;
    lastPos = pos;
    s.partOfSpeech.forEach(p => usedPos.add(p));
    const extra = [...s.misc.filter(m => ['uk', 'hon', 'hum', 'pol', 'col', 'sl', 'arch', 'abbr', 'on-mim'].includes(m)), ...s.field.slice(0, 1)];
    extra.forEach(p => usedPos.add(p));
    return [pos + (extra.length ? '|' + extra.join(',') : ''), s.gloss.slice(0, GLOSSES).map(g => g.text).join('; ')];
  });
  return [w.id, kanji.join('|'), kana.join('|'), common, senses];
});
const chunks = Math.ceil(rows.length / CHUNK);
let bytes = 0;
for (let i = 0; i < chunks; i++) {
  const s = lines('e', rows.slice(i * CHUNK, (i + 1) * CHUNK));
  fs.writeFileSync(path.join(OUT, `words-${String(i).padStart(2, '0')}.json`), s);
  bytes += s.length;
}

const K = pick('kanjidic2-en'), KR = pick('kradfile'), RK = pick('radkfile');
const parts = KR.kanji || {};
const krows = K.characters.map(c => {
  const rm = c.readingMeaning?.groups?.[0] || { readings: [], meanings: [] };
  const on = rm.readings.filter(r => r.type === 'ja_on').map(r => r.value), kun = rm.readings.filter(r => r.type === 'ja_kun').map(r => r.value);
  const mean = rm.meanings.filter(m => m.lang === 'en').map(m => m.value).slice(0, 6);
  return [c.literal, c.misc.strokeCounts[0] || 0, c.misc.grade || 0, c.misc.jlptLevel || 0, c.misc.frequency || 0, on.join('|'), kun.join('|'), mean.join('; '), (parts[c.literal] || []).join('')];
}).sort((a, b) => (a[4] || 9999) - (b[4] || 9999)); // frequent kanji first
fs.writeFileSync(path.join(OUT, 'kanji.json'), lines('k', krows));
const rrows = Object.entries(RK.radicals).map(([r, v]) => [r, v.strokeCount, v.kanji.join('')]).sort((a, b) => a[1] - b[1]);
fs.writeFileSync(path.join(OUT, 'radicals.json'), lines('r', rrows));
const pos = Object.fromEntries([...usedPos].sort().map(p => [p, J.tags[p] || p]));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  version: J.version + '+' + J.dictDate, dictDate: J.dictDate, chunks, words: rows.length, kanji: krows.length, radicals: rrows.length,
  source: 'JMdict, KANJIDIC2, RADKFILE, KRADFILE via jmdict-simplified',
  license: 'JMdict / KANJIDIC2 / RADKFILE / KRADFILE © Electronic Dictionary Research and Development Group, CC BY-SA 4.0',
  pos,
}, null, 1));
const mb = n => (n / 1e6).toFixed(1) + ' MB';
console.log(`words ${rows.length} in ${chunks} chunks (${mb(bytes)}), kanji ${krows.length} (${mb(fs.statSync(path.join(OUT, 'kanji.json')).size)}), radicals ${rrows.length} (${mb(fs.statSync(path.join(OUT, 'radicals.json')).size)}), pos tags ${usedPos.size}`);
