// QA: Cyrillic transcription of Japanese names/terms must follow the Hepburn-based Ukrainian system
// (し ші, ち чі, じ джі, しゃ ша, ちゃ ча, じゃ джа, ず з, つ цу…), never the old Kovalenko/Polivanov one
// (сі, ті, дзі, ся, тя, дзя, дзу…). Scans site data, interface code and the analyzer sources.
// Usage: node tools/qa-translit.js   → exit 1 if anything is found
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILES = [
  ...fs.readdirSync(path.join(ROOT, 'site/data')).filter(f => f.endsWith('.json') && f !== 'jmdict-mini.json').map(f => 'site/data/' + f),
  ...fs.readdirSync(path.join(ROOT, 'site/js')).map(f => 'site/js/' + f), 'site/index.html',
  ...fs.readdirSync(path.join(ROOT, 'tools/analyzer')).map(f => 'tools/analyzer/' + f),
];
// 1) known old spellings (whole words; * = stem)
const OLD = ['кандзі', 'фудзі', 'судзукі', 'хорюдзі', 'сіндзюку', 'ґендзі', 'міядзакі', 'мейдзі', 'ромадзі', 'дзюсьо', 'сінкансен*',
  'тіба', 'татіірі', 'кінсі', 'хіросім*', 'сікібу', 'сін-осак*', 'косіен*', 'кюсю', 'сасімі', 'сусі', 'сьоґі', 'патінко', 'хаясі',
  'ітіро', 'тадасі', 'сусі', 'тосі', 'сімідзу', 'сюдзі', 'тьонін', 'ніхонсю', 'сьоґун*', 'дзьорі'];
// 2) Ukrainian words that legitimately contain дз / сі / ті / ся / тя … (and established loanwords)
const UK_OK = new Set(('вітаюся бабусі готуюся десятому дідуся забуті займаюся капелюсі найзайнятіша п’ятій почалася сідайте сусіду сьомої тією хотілося дзюдо усі намагаюся офісі роботі почуваюся надзвичайно займаєтеся тій місяці місяця сідаю засідання сьомій досі ' +
  'бабуся кабінеті часі сім’я сім’ї сім’єю бабусю десята намагайтеся тіло сьому сьома ся десятій подобалося десятої тікай тіла ті ' +
  'усього тютюн сьоме десяте осіннє насіння уся боюся росія дієті багатій носіння гарантія зайняті усієї меті десяту дев’ятій ' +
  'тя потяга захотілося тієї сідаєте почалося пенсію комісія перетягуйте подавалося сайті').split(' '));
const UK_DZ = /дзв|дзеркал|надзвич|підзем|підзагол|відзнач|дзиґ|дзьоб|гудзик|ґудзик|кукурудз|дзюдо/;
const L = 'а-щьюяіїєґ’ʼА-ЩЬЮЯІЇЄҐ';
const oldRe = new RegExp(`(?<![${L}])(${OLD.map(k => (k.endsWith('*') ? k.slice(0, -1) + `[${L}]*` : k + `(?![${L}])`)).join('|')})`, 'gi');
const wordRe = new RegExp(`[${L}]+(?:-[${L}]+)*`, 'g');
// a word built only of Japanese-like syllables (CV, н, дз, сьо/тьо) — candidates for an old-system name
function japaneseLike(w) {
  if (/[иыщ]/.test(w)) return false;
  const x = w.replace(/дз/g, 'D').replace(/([ст])ь(?=[оу])/g, '$1').replace(/н(?=[бвгґджзйклмнпрстфхцчш])/g, '').replace(/[’ʼ-]/g, '');
  return !/[бвгґджзклмнпрстфхцчшщD]{2}/.test(x) && !/[бвгґджзклмпрстфхцчшщD]$/.test(x) && !/ь/.test(x);
}
const hits = [];
for (const f of FILES) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  text.split('\n').forEach((line, i) => {
    const at = (w, why) => hits.push(`${f}:${i + 1}  «${w}» — ${why}`);
    for (const m of line.matchAll(oldRe)) at(m[0], 'стара система (Коваленко) → див. tools/transcribe-hepburn.js');
    for (const m of line.matchAll(wordRe)) {
      const w = m[0].toLowerCase();
      if (UK_OK.has(w) || oldRe.test(w)) { oldRe.lastIndex = 0; continue; }
      oldRe.lastIndex = 0;
      if (/дз[аеєиіїоуюя]/.test(w) && !UK_DZ.test(w)) at(m[0], 'дз + голосний: じ = джі, ず = зу, じゃ/じゅ/じょ = джа/джу/джо');
      else if (/(сі|ті|ся|сю|сьо|тя|тю|тьо)/.test(w) && japaneseLike(w)) at(m[0], 'схоже на японське слово за старою системою (し ші, ち чі, しゃ ша, ちゃ ча)');
    }
  });
}
if (hits.length) {
  console.log(`Transcription: ${hits.length} suspicious word(s):\n` + hits.join('\n'));
  console.log('\nIf a word is ordinary Ukrainian, add it to UK_OK in tools/qa-translit.js.');
  process.exit(1);
}
console.log(`Transcription OK — ${FILES.length} files, no old-system (Kovalenko) spellings.`);
