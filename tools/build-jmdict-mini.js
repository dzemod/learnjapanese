// Builds site/data/jmdict-mini.json — a small JMdict subset (common words only, English glosses)
// used by the Перекладач tab when a word is not in my own sets / kanji data.
// Source: jmdict-simplified "jmdict-eng-common-*.json" (https://github.com/scriptin/jmdict-simplified).
// JMdict © Electronic Dictionary Research and Development Group, CC BY-SA 4.0.
//   node tools/build-jmdict-mini.js <path/to/jmdict-eng-common.json>
const fs = require('fs'), path = require('path');
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const w of src.words) {
  const kanji = w.kanji.filter(k => k.common).map(k => k.text);
  const kana = w.kana.filter(k => k.common).map(k => k.text);
  if (!kana.length) kana.push(w.kana[0].text);
  const senses = w.sense.slice(0, 3).map(s => s.gloss.slice(0, 3).map(g => g.text).join(', '));
  out.push([kanji.join('|'), kana.join('|'), senses.join('; ')]);
}
const file = path.join(__dirname, '..', 'site', 'data', 'jmdict-mini.json');
fs.writeFileSync(file, JSON.stringify({
  source: 'JMdict (common words), ' + (src.dictDate || ''),
  license: 'JMdict © Electronic Dictionary Research and Development Group, CC BY-SA 4.0',
  e: out,
}).replace(/\],\[/g, '],\n['));
console.log(out.length, 'entries,', (fs.statSync(file).size / 1e6).toFixed(2), 'MB');
