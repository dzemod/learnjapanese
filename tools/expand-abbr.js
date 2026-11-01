// Replace textbook abbreviations with full words (QA request):
//   ІМ → іменник, ДІЄСЛ → дієслово, い-ПРИКМ → い-прикметник, な-ПРИКМ → な-прикметник,
//   ПРИКМ → прикметник, РЕЧ → речення (indexes ₁₂₃ are kept), напр. → наприклад,
//   див. → дивіться, букв. → дослівно, «підручник, с. N» → «підручник, сторінка N», та ін. → та інші.
// Labels stay lowercase (they are shown as chips by util.js `gram()`); in prose fields a label that
// starts a sentence and is followed by a Ukrainian word is capitalized.
//   node tools/expand-abbr.js <file.json|file.js> ...      (JSON: string values; JS: whole source)
const fs = require('fs');

const CYR = 'А-Яа-яІіЇїЄєҐґ’';
const B = `(?<![${CYR}A-Za-z])`, E = `(?![${CYR}A-Za-z])`;
const RULES = [
  [new RegExp(`${B}([いな])-ПРИКМ${E}`, 'g'), '$1-прикметник'],
  [new RegExp(`${B}ПРИКМ${E}`, 'g'), 'прикметник'],
  [new RegExp(`${B}ДІЄСЛ${E}`, 'g'), 'дієслово'],
  [new RegExp(`${B}(?:ІМ|IM)(?=[₁₂₃]|[^${CYR}A-Za-z]|$)`, 'g'), 'іменник'],
  [new RegExp(`${B}РЕЧ${E}`, 'g'), 'речення'],
  [new RegExp(`${B}напр\\.`, 'g'), 'наприклад'],
  [new RegExp(`${B}букв\\.`, 'g'), 'дослівно'],
  [new RegExp(`${B}див\\.`, 'g'), 'дивіться'],
  [new RegExp(`${B}Див\\.`, 'g'), 'Дивіться'],
  [/підручник, с\. (\d)/g, 'підручник, сторінка $1'],
  [/, с\. (\d+), вправа A ?(\d)/g, ', сторінка $1, вправа A$2'],
  [new RegExp(`${B}ур\\. (\\d)`, 'g'), 'урок $1'],
  [new RegExp(`${B}досл\\.`, 'g'), 'дослівно'],
  [new RegExp(`${B}Напр\\.`, 'g'), 'Наприклад'],
  [new RegExp(`${B}та ін\\.`, 'g'), 'та інші'],
];
const LABEL = '(?:[いな]-)?(?:іменник|дієслово|речення|прикметник)';
// capitalize only real prose («Дієслово₁ виражає…»), not formulas («дієслово словникова форма と…»)
const CAP = new RegExp(`(^|[.!?]\\s+)(${LABEL})([₁₂₃]?\\s+(?!(?:словникова|форма|проста|чи|або|і|та)[\\s,)])[${CYR}])`, 'g');
const PROSE = new Set(['p', 'note', 'h', 'x', 'uk', 'ukrainian', 'hint']);

function expand(s, prose) {
  let out = s;
  for (const [re, to] of RULES) out = out.replace(re, to);
  if (prose) out = out.replace(CAP, (_, pre, w, rest) => pre + (/^[いな]/.test(w) ? w : w[0].toUpperCase() + w.slice(1)) + rest);
  return out;
}
module.exports = { expand };

if (require.main === module) {
  for (const f of process.argv.slice(2)) {
    const src = fs.readFileSync(f, 'utf8');
    let n = 0;
    let out;
    if (f.endsWith('.json')) {
      // keep the file layout: rewrite only JSON string literals, remembering the last key
      out = '';
      let i = 0, lastKey = null;
      while (i < src.length) {
        const c = src[i];
        if (c !== '"') { out += c; i++; continue; }
        let j = i + 1;
        while (src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
        const lit = src.slice(i, j + 1);
        const after = src.slice(j + 1).match(/^\s*:/);
        if (after) { lastKey = JSON.parse(lit); out += lit; }
        else {
          const val = JSON.parse(lit);
          const nv = expand(val, PROSE.has(lastKey));
          if (nv !== val) n++;
          out += nv === val ? lit : JSON.stringify(nv);
        }
        i = j + 1;
      }
      JSON.parse(out);
    } else {
      out = expand(src, false);
      if (out !== src) n = (src.match(/ІМ|ДІЄСЛ|ПРИКМ|РЕЧ|напр\.|див\.|букв\./g) || []).length;
    }
    if (out !== src) fs.writeFileSync(f, out);
    console.log(f, n ? `${n} changed` : 'no changes');
  }
}
