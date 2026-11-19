// Conjugation drill — pure logic (tests: tools/test-drill.mjs). Uses conjugate.js only.
//   verbPool(sets, upTo, mine) → verbs (ます-form cards with a group) of lessons ≤ upTo (+ my lessons)
//   makeQuestions(pool, forms, n, stats, rnd) → [{ card, form, answers }] — weak forms come more often
//   checkAnswer(q, input) → { ok, detected } — kana or kanji, spaces ignored, katakana → hiragana
import { conjugate, formsUpTo, FORMS, detectForm } from './conjugate.js';

const lessonOf = id => { const m = /^mnn-(\d+)$/.exec(id); return m ? +m[1] : null; };
export const kanaOf = c => c.reading || c.japanese; // internal card format (store.js fromStored)

export function verbPool(sets, upTo, mine = false) {
  const out = [], seen = new Set();
  for (const s of sets) {
    const l = lessonOf(s.id);
    const ok = l != null ? l <= upTo : mine && s.source !== 'textbook' && !/^k(300|700)-/.test(s.id);
    if (!ok) continue;
    for (const c of s.cards) {
      if (!['I', 'II', 'III'].includes(c.verbGroup) || !/ます$/.test(c.japanese)) continue;
      if (!conjugate(c.japanese, c.verbGroup, 'te') || !conjugate(kanaOf(c), c.verbGroup, 'te')) continue;
      const key = c.japanese + '|' + c.verbGroup;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...c, setId: s.id, lesson: l });
    }
  }
  return out;
}

/** Forms the learner may be asked up to lesson `upTo`. */
export const formsFor = upTo => formsUpTo(upTo);

/** All accepted spellings of `card` in `form`. */
export function answersOf(card, form) {
  return [...new Set([conjugate(card.japanese, card.verbGroup, form), conjugate(kanaOf(card), card.verbGroup, form)].filter(Boolean))];
}

/** Weight of a form: unseen 2, then 1 + error rate × 3 (weak forms come back more often). */
export const formWeight = s => (!s || !s.n ? 2 : 1 + ((s.n - s.ok) / s.n) * 3);

export function makeQuestions(pool, forms, n, stats = {}, rnd = Math.random) {
  const qs = [];
  if (!pool.length || !forms.length) return qs;
  const ws = forms.map(f => formWeight(stats[f]));
  const total = ws.reduce((a, b) => a + b, 0);
  const pickForm = () => { let r = rnd() * total; for (let i = 0; i < forms.length; i++) { r -= ws[i]; if (r < 0) return forms[i]; } return forms.at(-1); };
  const used = new Set();
  for (let tries = 0; qs.length < n && tries < n * 20; tries++) {
    const card = pool[Math.floor(rnd() * pool.length)], form = pickForm();
    const key = card.japanese + form;
    if (used.has(key) && used.size < pool.length * forms.length) continue;
    const answers = answersOf(card, form);
    if (!answers.length) continue;
    used.add(key);
    qs.push({ card, form, answers });
  }
  return qs;
}

const toHira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
// vowel of a hiragana syllable: ー after it = that vowel (コピー typed as «kopii» → こぴい)
const VOWEL = {};
for (const [v, row] of Object.entries({ あ: 'あかさたなはまやらわがざだばぱぁゃゎ', い: 'いきしちにひみりぎじぢびぴぃ', う: 'うくすつぬふむゆるぐずづぶぷぅゅっ', え: 'えけせてねへめれげぜでべぺぇ', お: 'おこそとのほもよろをごぞどぼぽぉょ' })) for (const ch of row) VOWEL[ch] = v;
const longVowels = s => s.replace(/(.)ー/g, (m, ch) => ch + (VOWEL[ch] || 'ー'));
export const normJa = s => longVowels(toHira(String(s || '').normalize('NFKC').replace(/[\s。、.,!！?？]/g, '').replace(/[～〜]/g, '')));

export function checkAnswer(q, input) {
  const a = normJa(input);
  const ok = !!a && q.answers.some(x => normJa(x) === a);
  const detected = ok ? q.form : detectForm(q.card.japanese, q.card.verbGroup, a, kanaOf(q.card));
  return { ok, detected: detected && detected !== q.form ? detected : null };
}

export const formLabel = f => (f === 'masu' ? 'ます-форма' : FORMS[f]?.label || f);
export { FORMS };
