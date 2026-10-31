// node tools/review-furigana.js [from to] — compares every {漢字|かな} in site/data/grammar.json with Kuromoji's reading.
// Prints only mismatches (candidates for manual check); needs kuromoji (KUROMOJI=<path> or npm i --no-save kuromoji@0.1.2).
const fs = require('fs'), path = require('path');
const kuromoji = require(process.env.KUROMOJI || 'kuromoji');
const [from, to] = [+process.argv[2] || 1, +process.argv[3] || 50];
const g = JSON.parse(fs.readFileSync(path.join(__dirname, '../site/data/grammar.json'), 'utf8')).lessons;
const k2h = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
kuromoji.builder({ dicPath: path.join(path.dirname(require.resolve(process.env.KUROMOJI || 'kuromoji')), '..', 'dict') }).build((e, tk) => {
  if (e) throw e;
  const seen = new Set();
  let checked = 0;
  for (const L of g.filter(l => l.lesson >= from && l.lesson <= to)) for (const p of L.points) for (const b of p.blocks) {
    for (const text of [b.ex, b.h, b.p, b.note, ...(b.table || []).flat()].filter(Boolean)) {
      const re = /\{([^{}|]+)\|([^{}]+)\}/g;
      const plain = text.replace(re, '$1');
      const toks = tk.tokenize(plain);
      let off = 0; toks.forEach(t => { t.a = off; off += t.surface_form.length; });
      let m, pos = 0, delta = 0;
      while ((m = re.exec(text))) {
        const start = m.index - delta; // position in plain text
        delta += m[0].length - m[1].length;
        checked++;
        // reading of the plain span [start, start+len) from tokens fully inside / overlapping
        const end = start + m[1].length;
        const inside = toks.filter(t => t.a < end && t.a + t.surface_form.length > start);
        if (!inside.length || inside[0].a !== start || inside.at(-1).a + inside.at(-1).surface_form.length < end) continue; // token boundary mismatch → skip
        const span = inside.map(t => t.reading || t.surface_form).join('');
        const tail = inside.map(t => t.surface_form).join('').slice(m[1].length); // okurigana inside last token
        let rd = k2h(span);
        if (tail) rd = rd.slice(0, rd.length - tail.length);
        if (rd !== m[2] && !/\d/.test(m[1])) {
          const key = m[1] + '|' + m[2] + '|' + rd;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`L${L.lesson} ${p.id}\t${m[1]}\tдані: ${m[2]}\tkuromoji: ${rd}\t${plain.slice(Math.max(0, start - 8), end + 8)}`);
        }
      }
    }
  }
  console.error('checked', checked);
});
