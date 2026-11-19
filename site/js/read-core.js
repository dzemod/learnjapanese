// Reading practice — pure logic (tests: tools/test-read.mjs).
// A text = [{ toks: [[surface, kana, cls]], uk, pt?, l? }]; cls n noun · v verb · a adjective · x auxiliary ·
// p particle · s symbol (the token format of the exam «Переклад речень» items, exam.json t:"ts").
//   textFromBank(items, upTo, n, rnd) → a reading text of n textbook sentences from lessons ≤ upTo (newest lessons
//     weighted more, kept in lesson order)
//   tokensFromKuromoji(tokens) → toks (for AI stories)
//   parseStory(answer) → [{ ja, uk }] from the model's «JA ||| UK» lines
//   wordCandidates(tok, sentence) → keys to look a tapped word up with (surface, dictionary forms of the sentence)
const KANJI = /[㐀-鿿々〆]/;
export const hasKanji = s => KANJI.test(String(s || ''));
export const toHira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const plain = toks => toks.map(t => t[0]).join('');

export function textFromBank(items, upTo, n = 8, rnd = Math.random) {
  const pool = items.filter(it => it && it.t === 'ts' && it.l <= upTo && Array.isArray(it.k) && it.uk);
  if (!pool.length) return [];
  // pick 2–3 lessons, newer lessons weighted more, then sentences of those lessons in book order
  const lessons = [...new Set(pool.map(it => it.l))];
  const w = lessons.map(l => 1 + (l / upTo) * 2);
  const pickL = () => { let r = rnd() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < lessons.length; i++) { r -= w[i]; if (r < 0) return lessons[i]; } return lessons.at(-1); };
  const chosen = new Set();
  for (let i = 0; i < 12 && chosen.size < Math.min(3, lessons.length); i++) chosen.add(pickL());
  let cand = pool.filter(it => chosen.has(it.l));
  if (cand.length < n) cand = pool;
  const picked = new Set();
  for (let i = 0; i < n * 10 && picked.size < Math.min(n, cand.length); i++) picked.add(cand[Math.floor(rnd() * cand.length)]);
  return [...picked].sort((a, b) => a.l - b.l || (a.id < b.id ? -1 : 1)).map(it => ({ toks: it.k, uk: it.uk, pt: it.pt, l: it.l, w: it.w || [], id: it.id }));
}

const CLS = { 名詞: 'n', 動詞: 'v', 形容詞: 'a', 形容動詞: 'a', 助動詞: 'x', 助詞: 'p', 記号: 's', 副詞: 'n', 連体詞: 'n', 接続詞: 'n', 感動詞: 'n', 接頭詞: 'n', フィラー: 'n' };
/** Kuromoji tokens → toks; the dictionary form is kept as the 4th field for the word lookup. */
export function tokensFromKuromoji(tokens) {
  return (tokens || []).filter(t => t && t.surface_form && !/^\s+$/.test(t.surface_form)).map(t => {
    const kana = t.reading && t.reading !== '*' ? toHira(t.reading) : toHira(t.surface_form);
    return [t.surface_form, kana, CLS[t.pos] || 'n', t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form];
  });
}

/** The model is asked for lines «<Japanese> ||| <Ukrainian>»; tolerant of numbering, quotes and Markdown. */
export function parseStory(text) {
  return String(text || '').split(/\n+/).map(l => l.replace(/\*\*/g, '').replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .map(l => { const m = /^(.+?)\s*\|\|\|\s*(.+)$/.exec(l); return m ? { ja: m[1].replace(/^[«"“]|[»"”]$/g, '').trim(), uk: m[2].replace(/^[«"“]|[»"”]$/g, '').trim() } : null; })
    .filter(x => x && /[぀-ヿ㐀-鿿]/.test(x.ja) && x.uk).slice(0, 15);
}

/** Lookup keys for a tapped token: its dictionary form (AI), its surface, and the sentence's dictionary forms that
 *  share its stem (exam items carry w: dictionary forms of the content words). */
export function wordCandidates(tok, sentence = {}) {
  const [surface, , cls, base] = tok;
  const keys = [];
  if (base && base !== surface) keys.push(base);
  keys.push(surface);
  if (cls === 'v' && !/ます$/.test(surface)) keys.push(surface + 'ます'); // 行き(ます) — cards are in the ます-form
  if (cls === 'v' || cls === 'a' || cls === 'n') {
    for (const raw of sentence.w || []) {
      const w = String(raw).replace(/\{([^|}]+)\|[^}]+\}/g, '$1'); // furigana markup {行|い}く → 行く
      const stem = hasKanji(w) ? w.replace(/[ぁ-ゖ]+$/, '') : w.slice(0, Math.max(1, w.length - 1));
      if (stem && surface.startsWith(stem) && !keys.includes(w)) keys.push(w);
    }
  }
  return keys;
}
