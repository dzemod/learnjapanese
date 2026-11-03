// Builds the exam items «Переклад речень» (t: "ts", Ukrainian → Japanese, typed by the learner) in site/data/exam.json.
//   npm i --no-save kuromoji@0.1.2   (or KUROMOJI=<path>)
//   node tools/build-exam-ts.mjs <fromLesson> <toLesson>      → upserts only the ts items of those lessons
// Sources: grammar.json — textbook blocks (文型, 例文, IV. Граматика examples with translations) and «Детальніше»
// examples (point.details) of each grammar point. Review files tools/exam-ts/L*.js (module.exports = { skip: [plain…],
// alt: { plain: [alt plain…] }, uk: { plain: "better Ukrainian" } }) are applied on top.
// Item: { id, t: "ts", l, pt, src?, ja (markup), uk, k: [[surface, kana, cls]], alt?: [[[…]]], w: [base forms markup], hl?: [a, b] }
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { analyzeText } from '../site/js/analyzer.js';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kuroPath = process.env.KUROMOJI || path.join(ROOT, 'node_modules', 'kuromoji');
const kuromoji = require(kuroPath);
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const [from, to] = [+process.argv[2] || 1, +process.argv[3] || +process.argv[2] || 50];
const G = read('site/data/grammar.json').lessons;
const D = read('site/data/analyzer.json');
const examFile = path.join(ROOT, 'site/data/exam.json');
const bank = read('site/data/exam.json');
const reviewDir = path.join(ROOT, 'tools/exam-ts');
const review = { skip: new Set(), alt: {}, uk: {} };
if (fs.existsSync(reviewDir)) for (const f of fs.readdirSync(reviewDir).filter(f => f.endsWith('.js')).sort()) {
  const r = require(path.join(reviewDir, f));
  (r.skip || []).forEach(s => review.skip.add(s));
  Object.assign(review.alt, r.alt || {});
  Object.assign(review.uk, r.uk || {});
}

// ---------- markup helpers ({漢字|かんじ}) ----------
function segs(markup) {
  const out = [], re = /\{([^{}|]+)\|([^{}]+)\}/g;
  let i = 0, m;
  while ((m = re.exec(markup))) {
    if (m.index > i) for (const ch of markup.slice(i, m.index)) out.push({ t: ch });
    out.push({ t: m[1], r: m[2] });
    i = re.lastIndex;
  }
  for (const ch of markup.slice(i)) out.push({ t: ch });
  return out;
}
const clean = s => String(s)
  .replace(/\((では|が|へ|から|↗|↘|に)\)/g, '').replace(/[[\]]/g, '').replace(/\b[AB]: ?/g, '')
  .replace(/……/g, ' ').replace(/\s+/g, ' ').trim();
const hira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const KANJI = /[㐀-鿿々〆]/;
// translation shown as the task: no cross-references «(урок 5)», optional words in [ ] are shown plainly
const cleanUk = s => String(s).replace(/\s*\(урок \d+\)/g, '').replace(/\[([^\]]+)\]/g, '$1').replace(/\s+/g, ' ').replace(/^(.)/, c => c.toUpperCase()).trim();
const plainOf = mk =>mk.replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1');

const tk = await new Promise((res, rej) => kuromoji.builder({ dicPath: path.join(kuroPath, 'dict') }).build((e, t) => (e ? rej(e) : res(t))));
const CLS = t => (t.pos === '記号' ? 's' : t.pos === '助詞' ? 'p' : t.pos === '動詞' ? 'v' : t.pos === '形容詞' ? 'a' : t.pos === '助動詞' ? 'x' : 'n');

/** markup (or plain) → tokens with readings aligned to furigana: tokens that cut a furigana group are merged. */
function tokensOf(mk, known = null) {
  const sg = segs(mk), plain = sg.map(s => s.t).join('').replace(/ /g, '');
  // segment boundaries (plain offsets without spaces) + readings
  const groups = [];
  let pos = 0;
  for (const s of sg) { if (s.t === ' ') continue; groups.push({ a: pos, b: pos + s.t.length, r: s.r }); pos += s.t.length; }
  const toks = tk.tokenize(plain);
  let off = 0;
  toks.forEach(t => { t.a = off; off += t.surface_form.length; t.b = off; });
  // merge tokens while a furigana group crosses the boundary
  const merged = [];
  for (const t of toks) {
    const last = merged[merged.length - 1];
    const cut = last && groups.some(g => g.r && g.a < last.b && g.b > last.b);
    if (cut) { last.basic_form = last.surface_form + (t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form); last.surface_form += t.surface_form; last.b = t.b; last.reading = (last.reading || '') + (t.reading || ''); if (CLS(last) === 'n' && CLS(t) !== 'n') last.pos = t.pos; }
    else merged.push({ ...t });
  }
  return { plain, toks: merged.map(t => {
    let kana = '';
    for (const g of groups) { if (g.b <= t.a || g.a >= t.b) continue; kana += g.r ? g.r : plain.slice(Math.max(g.a, t.a), Math.min(g.b, t.b)); }
    // no furigana for a kanji word (alternative answers, rare gaps) → Kuromoji reading
    if (KANJI.test(kana)) kana = known?.get(t.surface_form) || hira(t.reading || t.surface_form);
    return { s: t.surface_form, kana: hira(kana), cls: CLS(t), base: t.basic_form, pos: t.pos, a: t.a, b: t.b, reading: t.reading };
  }) };
}
/** dictionary forms with readings for the «Слова» hint (content words only). */
function baseForms(toks) {
  const out = [];
  for (const t of toks) {
    if (!['n', 'v', 'a'].includes(t.cls) || t.pos === '名詞' && !KANJI.test(t.s) && t.s.length < 2 || /[0-9０-９,，]/.test(t.s) || ['じゃ', 'では', 'ちゃん', 'さん'].includes(t.s)) continue;
    if (['する', 'ある', 'いる', 'なる', 'の', 'ん', 'こと', 'もの', 'よう', 'そう', 'ところ'].includes(t.base) && !KANJI.test(t.s)) continue;
    let base = t.base && t.base !== '*' && !['だれ', 'どれ', 'それ', 'これ', 'あれ'].includes(t.s) ? t.base : t.s;
    let mk;
    const pre = (base.match(/^[㐀-鿿々〆]+/) || [''])[0];
    if (!KANJI.test(base)) mk = base;
    else if (base === t.s) mk = `{${base}|${t.kana}}`;
    else if (pre && t.s.startsWith(pre)) {
      // reading of the kanji part = kana of the surface minus its okurigana
      const okuri = t.s.slice(pre.length), rk = okuri && t.kana.endsWith(hira(okuri)) ? t.kana.slice(0, -okuri.length) : null;
      mk = rk ? `{${pre}|${rk}}${base.slice(pre.length)}` : base;
    } else mk = base;
    if (!out.includes(mk)) out.push(mk);
  }
  return out;
}
const pack = toks => toks.map(t => [t.s, t.kana, t.cls]);

const report = [];
for (const L of G.filter(l => l.lesson >= from && l.lesson <= to)) {
  const items = [], seen = new Set();
  let n = 0, hl = 0;
  for (const pt of L.points) {
    const srcs = [...pt.blocks.map(b => ({ b, d: false })), ...(pt.details || []).map(b => ({ b, d: true }))];
    for (const { b, d } of srcs) {
      if (b.ex == null || !b.uk || /[×○→～〜]|[Ａ-Ｚ]|／|[（(：:]/.test(b.ex) || /^……/.test(b.ex) || /^[\s(–-]/.test(b.uk) || /…|\//.test(b.uk)) continue;
      const mk = clean(b.ex);
      const plain = plainOf(mk).replace(/ /g, '');
      if (!/[。？?！!]$/.test(plain) || plain.length < 4 || plain.length > 45 || seen.has(plain) || review.skip.has(plain)) continue;
      seen.add(plain);
      const { toks } = tokensOf(mk);
      if (toks.some(t => KANJI.test(t.kana))) continue;
      const item = { id: `ts${L.lesson}-${++n}`, t: 'ts', l: L.lesson, pt: pt.id, ...(b.src ? { src: b.src } : d ? { src: 'Детальніше' } : {}), ...(b.check ? { check: true } : {}), ja: mk, uk: review.uk[plain] || cleanUk(b.uk), k: pack(toks), w: baseForms(toks) };
      // construction of this grammar point (analyzer patterns) → highlight
      try {
        const res = analyzeText(tk.tokenize(plain), D, () => null);
        let off = 0;
        for (const r of res) {
          const c = r.constructions.find(c => c.point === pt.id);
          if (c) { const i = plain.indexOf(c.match, off); if (i >= 0) { item.hl = [i, i + c.match.length]; hl++; } break; }
          off += r.text.length;
        }
      } catch (e) { /* analysis is optional */ }
      // alternative correct answers
      const alts = [...(review.alt[plain] || [])];
      const m = /^(私|わたし)は/.exec(plain);
      // negative copula: じゃ ありません = じゃ ないです = では ありません (and the past forms)
      const NEG = [['じゃありませんでした', 'じゃなかったです', 'ではありませんでした'], ['じゃありません', 'じゃないです', 'ではありません'], ['ではありませんでした', 'じゃありませんでした', 'じゃなかったです'], ['ではありません', 'じゃありません', 'じゃないです']];
      for (const [a, ...bs] of NEG) if (plain.includes(a)) { bs.forEach(b2 => alts.push(plain.split(a).join(b2))); break; }
      // direction へ before a verb of movement may also be に (日本へ行きます = 日本に行きます)
      const MOVE = new Set(['行く', '来る', '帰る', '戻る', '出かける', 'いらっしゃる', '参る']);
      if (toks.some((t, i) => t.s === 'へ' && t.cls === 'p' && MOVE.has(toks[i + 1]?.base))) {
        const ni = toks.map((t, i) => (t.s === 'へ' && t.cls === 'p' && MOVE.has(toks[i + 1]?.base) ? 'に' : t.s)).join('');
        alts.push(ni);
        const mm = /^(私|わたし)は/.exec(ni);
        if (mm) alts.push(ni.slice(mm[0].length));
      }
      if (m) alts.push(plain.slice(m[0].length));
      else if (/^(Я|Ми) /.test(item.uk) && !/は/.test(plain) && !/わたし|私/.test(plain)) alts.push('わたしは' + plain);
      const known = new Map(toks.map(t => [t.s, t.kana]));
      if (alts.length) item.alt = [...new Set(alts)].map(a => pack(tokensOf(a, known).toks));
      items.push(item);
    }
  }
  const lesson = bank.lessons.find(x => x.lesson === L.lesson);
  if (lesson) lesson.items = lesson.items.filter(i => i.t !== 'ts').concat(items);
  else bank.lessons.push({ lesson: L.lesson, items });
  report.push(`L${L.lesson}: ${items.length} ts (${hl} with highlighted construction, points ${new Set(items.map(i => i.pt)).size}/${L.points.length})${items.length < 10 ? '  ← LESS THAN 10' : ''}`);
}
bank.lessons.sort((a, b) => a.lesson - b.lesson);
const J = JSON.stringify;
const out = '{\n  "lessons": [\n' + bank.lessons.map(l => '    {\n      "lesson": ' + l.lesson + ',\n      "items": [\n' + l.items.map(i => '        ' + J(i)).join(',\n') + '\n      ]\n    }').join(',\n') + '\n  ]\n}\n';
JSON.parse(out);
fs.writeFileSync(examFile, out);
console.log(report.join('\n'));
