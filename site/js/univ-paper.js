// «Університетська версія» of the exam: pure logic (no DOM) — composing a paper from the banks, checking answers, points.
// Bank data/exam-univ.json: items { id, s (section 1–7), l (lesson), pt?, pair?, parts: [text | blank], uk, x? };
// blank = { a: [markup] } typed particle, { b, a: [markup] } typed form or antonym, { o: [markup ×3], c } choice.
// Sections 1 and 3 are completed with the single-blank items of data/exam.json (t: "p", t: "v" — textbook sentences).

export const SECTIONS = [
  { s: 1, pts: 23, title: 'Частки', task: 'Впишіть у дужки пропущену частку.' },
  { s: 2, pts: 10, title: 'Антоніми', task: 'Напишіть слово з протилежним значенням.' },
  { s: 3, pts: 22, title: 'Форми в контексті', task: 'Слово в дужках подано у формі ます／です. Напишіть форму, потрібну в цьому реченні.' },
  { s: 4, pts: 16, title: 'Прислівники', task: 'Виберіть у дужках правильний прислівник.' },
  { s: 5, pts: 6, title: 'Розмовні фрази', task: 'Виберіть вираз, який підходить до ситуації.' },
  { s: 6, pts: 10, title: 'Слова та лічильники', task: 'Виберіть правильне слово або лічильник.' },
  { s: 7, pts: 13, title: 'Конструкції', task: 'Виберіть правильну форму або конструкцію.' },
];

const shuffled = (arr, rnd) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const plain = s => String(s || '').replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1');
const kana = s => String(s || '').replace(/\{[^{}|]+\|([^{}]+)\}/g, '$1');
const inRange = (l, from, to) => l >= from && l <= to;
const nospace = s => String(s || '').replace(/[ 　]+/g, '');
const blanksOf = it => it.parts.filter(p => typeof p !== 'string').length;
export const sentenceKey = it => plain(it.parts.map(p => (typeof p === 'string' ? p : p.o ? p.o[p.c] : p.a[0])).join('')).replace(/[\s　]/g, '');

// textbook items of exam.json → the same shape (no spaces between words, as on the paper test)
const fromBankP = it => ({ id: it.id, s: 1, l: it.l, pt: it.pt, spt: it.spt, bank: true, uk: it.uk, x: it.x, parts: [nospace(it.pre), { a: [it.a, ...(it.alt || [])] }, nospace(it.post)].filter(p => p !== '') });
const fromBankV = it => ({ id: it.id, s: 3, l: it.l, pt: it.pt, spt: it.spt, bank: true, uk: it.uk, x: it.x, parts: [nospace(it.pre), { b: it.base, a: [it.a] }, nospace(it.post)].filter(p => p !== '') });

/** All questions of the range, by section. */
export function poolFor(bank, textbook, from, to) {
  const out = {};
  for (const sec of SECTIONS) out[sec.s] = [];
  for (const L of bank || []) if (inRange(L.lesson, from, to)) for (const it of L.items) out[it.s].push(it);
  for (const L of textbook || []) {
    if (!inRange(L.lesson, from, to)) continue;
    for (const it of L.items) {
      if (it.t === 'p' && !/……/.test(it.pre + it.post)) out[1].push(fromBankP(it));
      else if (it.t === 'v' && !/……/.test(it.pre + it.post)) out[3].push(fromBankV(it));
    }
  }
  return out;
}
/** Number of blanks available per section (setup screen). */
export function availability(bank, textbook, from, to) {
  const pool = poolFor(bank, textbook, from, to), res = {};
  for (const sec of SECTIONS) {
    const pairs = new Set();
    res[sec.s] = pool[sec.s].reduce((n, it) => {
      if (it.pair) { if (pairs.has(it.pair)) return n; pairs.add(it.pair); }
      return n + blanksOf(it);
    }, 0);
  }
  return res;
}

/** Take `target` blanks: lessons in turn so every lesson of the range is represented; own items before the textbook ones. */
/** Keys of an item for «no repeats»: the sentence; for antonyms both words (a word can be in two pairs). */
const keysOf = it => (it.pair ? ['w' + plain(it.parts[0].b).replace(/^\[[^\]]*\]/, ''), ...it.parts[0].a.map(a => 'w' + plain(a)), 'pair' + it.pair] : [sentenceKey(it)]);
/** The start of a sentence: textbook sentences of one lesson often differ only at the end, so they are a last resort. */
const stemOf = it => (it.pair ? '' : sentenceKey(it).slice(0, 5));
function takeItems(items, target, used, rnd) {
  const byLesson = new Map();
  const own = shuffled(items.filter(i => !i.bank), rnd), book = shuffled(items.filter(i => i.bank), rnd);
  for (const it of [...own, ...book]) { if (!byLesson.has(it.l)) byLesson.set(it.l, []); byLesson.get(it.l).push(it); }
  const lessons = shuffled([...byLesson.keys()], rnd);
  const picked = [];
  const stems = new Set();
  let blanks = 0;
  for (const strict of [true, false]) { // first without look-alike sentences, then whatever is left
    let progress = true;
    while (blanks < target && progress) {
      progress = false;
      for (const l of lessons) {
        if (blanks >= target) break;
        const list = byLesson.get(l);
        for (let i = 0; i < list.length; i++) {
          const it = list[i], keys = keysOf(it), n = blanksOf(it), stem = stemOf(it);
          if (keys.some(k => used.has(k)) || blanks + n > target) { list.splice(i--, 1); continue; }
          if (strict && stem && stems.has(stem)) continue;
          list.splice(i, 1);
          keys.forEach(k => used.add(k));
          if (stem) stems.add(stem);
          picked.push(it);
          blanks += n;
          progress = true;
          break;
        }
      }
    }
  }
  return { picked, blanks };
}

/** Whole paper: { sections: [{ s, title, task, pts, per, blanks, example, items }] }; the points always add up to 100. */
export function buildPaper(bank, textbook, from, to, rnd = Math.random) {
  const pool = poolFor(bank, textbook, from, to);
  const used = new Set();
  const secs = SECTIONS.map(sec => {
    const items = pool[sec.s];
    // the example (例) is one more question of the range, shown solved, like at the top of each section of the paper
    const own = shuffled(items.filter(i => !i.bank && blanksOf(i) === 1), rnd);
    const example = own[0] || shuffled(items.filter(i => blanksOf(i) === 1), rnd)[0] || null;
    if (example) keysOf(example).forEach(k => used.add(k));
    const { picked, blanks } = takeItems(items, sec.pts, used, rnd);
    return { ...sec, example, items: picked.map(i => ({ ...i, order: optionOrder(i, rnd) })), blanks, base: sec.pts };
  });
  // the points of an empty section go to the other sections, in proportion (largest remainder → exactly 100)
  const live = secs.filter(x => x.blanks);
  const sum = live.reduce((a, x) => a + x.base, 0) || 1;
  const raw = live.map(x => (x.base * 100) / sum);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - floors[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { floors[i]++; left--; } });
  live.forEach((x, i) => { x.pts = floors[i]; });
  for (const x of secs) { if (!x.blanks) x.pts = 0; x.per = x.blanks ? x.pts / x.blanks : 0; }
  return { from, to, sections: secs };
}
/** Choice options are shown in random order: blank index → option indexes. */
function optionOrder(it, rnd) {
  return it.parts.filter(p => typeof p !== 'string').map(p => (p.o ? shuffled(p.o.map((_, i) => i), rnd) : null));
}

// ---------- checking ----------
const toHira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const clean = s => toHira(String(s || '').normalize('NFKC')).replace(/[\s。、．.,]/g, '').replace(/[()（）～〜]/g, '');
/** Typed answer against a markup answer: kanji of the model may be typed as kanji or kana, in any mix. */
function typedOk(given, model) {
  let g = clean(given);
  if (!g) return false;
  const k = clean(kana(model));
  if (g === k || g === clean(plain(model))) return true;
  for (const m of String(model).matchAll(/\{([^{}|]+)\|([^{}]+)\}/g)) g = g.split(m[1]).join(toHira(m[2]));
  return clean(g) === k;
}
export const blankOk = (blank, value) => (blank.o ? +value === blank.c : (blank.a || []).some(a => typedOk(value, a)));

/** Answers key: "<itemId>:<blank index>". Result: per section { got, pts, wrong: [...] } + total. */
export function scorePaper(paper, answers, over = {}) {
  let total = 0, filled = 0, count = 0;
  const sections = paper.sections.map(sec => {
    let ok = 0;
    const rows = [];
    for (const it of sec.items) {
      const blanks = it.parts.filter(p => typeof p !== 'string');
      const res = blanks.map((b, i) => {
        const key = `${it.id}:${i}`, v = answers[key];
        count++;
        if (v !== undefined && v !== '') filled++;
        return { key, value: v, ok: blankOk(b, v) || !!over[key], over: !!over[key] };
      });
      ok += res.filter(r => r.ok).length;
      rows.push({ it, res, allOk: res.every(r => r.ok) });
    }
    const got = +(ok * sec.per).toFixed(1);
    total += ok * sec.per;
    return { s: sec.s, title: sec.title, pts: sec.pts, per: sec.per, blanks: sec.blanks, ok, got, rows };
  });
  return { sections, total: +total.toFixed(1), filled, count };
}
/** "(1 × 23 = 23)", "(1.5 × 4 = 6)" */
export function pointsLabel(sec) {
  if (!sec.blanks) return '';
  const p = sec.per, shown = Number.isInteger(p) ? String(p) : p.toFixed(p * 10 === Math.round(p * 10) ? 1 : 2).replace('.', ',');
  return `(${shown} × ${sec.blanks} = ${sec.pts})`;
}
export const plainText = plain;
export const kanaText = kana;
