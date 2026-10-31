// node tools/add-kanji.js <srcDir> — adds lessons from <srcDir>/k300-NN.js / k700-NN.js into site/data/kanji.json.
// Existing lessons are never overwritten (they may contain corrections made on the site).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srcDir = path.resolve(process.argv[2] || '.');
const file = path.join(root, 'site/data/kanji.json');
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { books: [] };
const BOOKS = [
  { id: 'k300', title: 'Початковий 300', titleJp: '初級漢字300', source: '漢字の教科書 初級300' },
  { id: 'k700', title: 'Середній 700', titleJp: '中級漢字700', source: '漢字の教科書 中級700' },
];
for (const b of BOOKS) if (!data.books.find(x => x.id === b.id)) data.books.push({ ...b, lessons: [] });
const KATA = /^[ァ-ヶー]+$/, HIRA = /^[ぁ-ゖー\-]+$/;
const added = [], kept = [];
for (const f of fs.readdirSync(srcDir).filter(f => /^k\d+-\d+\.js$/.test(f)).sort()) {
  const src = require(path.join(srcDir, f));
  const book = data.books.find(b => b.id === src.book);
  const id = `${src.book}-${String(src.no).padStart(2, '0')}`;
  if (book.lessons.some(l => l.id === id)) { kept.push(id); continue; }
  const kanji = src.kanji.map(([no, ch, strokes, radical, en, uk, on, kun, ex]) => {
    const kid = `${src.book}-${String(no).padStart(3, '0')}`;
    on.forEach(r => { if (!KATA.test(r)) throw new Error(`${kid} on not katakana: ${r}`); });
    kun.forEach(r => { if (!HIRA.test(r)) throw new Error(`${kid} kun not hiragana: ${r}`); });
    if (!ex.every(e => e.length === 4 && e[0].includes(ch.charAt(0)) || e[0].includes('々'))) console.warn('check example (kanji missing?)', kid, ex.filter(e => !e[0].includes(ch)).map(e => e[0]));
    return {
      id: kid, no, kanji: ch, strokes, radical, en, meaning: uk, on, kun, check: true,
      examples: ex.map(([word, kana, een, euk], i) => ({ id: `${kid}-${i + 1}`, word, kana, en: een, uk: euk, check: true })),
    };
  });
  book.lessons.push({ id, no: src.no, title: src.title, titleUk: src.titleUk, range: src.range, kanji });
  book.lessons.sort((a, b) => a.no - b.no);
  added.push(`${id}: ${kanji.length} kanji, ${kanji.reduce((n, k) => n + k.examples.length, 0)} examples`);
}
// same layout as the save API: one kanji per line
const J = JSON.stringify, NL = '\n';
const out = '{' + NL + '  "books": [' + NL + data.books.map(b => {
  const { lessons = [], ...meta } = b;
  return '    {' + NL + Object.entries(meta).map(([k, v]) => '      ' + J(k) + ': ' + J(v)).join(',' + NL) + ',' + NL + '      "lessons": [' + NL +
    lessons.map(l => { const { kanji = [], ...lm } = l; return '        {' + NL + Object.entries(lm).map(([k, v]) => '          ' + J(k) + ': ' + J(v)).join(',' + NL) + ',' + NL + '          "kanji": [' + NL + kanji.map(k => '            ' + J(k)).join(',' + NL) + NL + '          ]' + NL + '        }'; }).join(',' + NL) +
    NL + '      ]' + NL + '    }';
}).join(',' + NL) + NL + '  ]' + NL + '}' + NL;
JSON.parse(out);
fs.writeFileSync(file, out);
console.log('added:', added.length ? added.join(' | ') : 'none', kept.length ? '| kept existing: ' + kept.join(', ') : '');
