// Speaking practice — scoring (pure, tests: tools/test-speak.mjs).
// The recognizer returns Japanese text, usually with kanji like the textbook, sometimes kana or other kanji.
// The said text is compared with the model twice — as written (surface) and in kana (the model's token readings vs
// the said text converted to hiragana) — by the longest common subsequence of characters; the better one counts.
// marks: for every token of the model, the share of its characters that were heard (to colour missed words).
export const VERDICT = { GOOD: 0.85, CLOSE: 0.6 };
const PUNCT = /[\s　。、，,.!！?？「」『』（）()・…〜～ー]/g;
export const toHira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const NUM = { '0': 'ゼロ', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八', '9': '九' };
export const norm = s => String(s || '').normalize('NFKC').replace(PUNCT, '');

/** LCS of two strings → boolean array: which characters of `a` are matched. */
export function lcsMarks(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const marks = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { marks[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return marks;
}

/**
 * toks = [[surface, kana, cls], …] (model sentence), said = recognized text.
 * → { score 0…1, verdict 'good'|'close'|'retry', tokMarks: [0…1 per token], via: 'surface'|'kana' }
 */
export function scoreSpeech(toks, said) {
  const words = toks.filter(t => t[2] !== 's');
  const digits = s => s.replace(/[0-9]/g, d => NUM[d]); // 9 / ９ / 九 → one spelling on both sides
  const s1 = digits(norm(said)), s2 = digits(toHira(norm(said)));
  const surf = words.map(t => digits(norm(t[0]))), kana = words.map(t => digits(toHira(norm(t[1] || t[0]))));
  const run = (parts, s) => {
    const all = parts.join('');
    if (!all.length) return { score: 0, per: [] };
    // recall of the model + a penalty for extra speech (length ratio)
    const marks = lcsMarks(all, s);
    const hit = marks.filter(Boolean).length;
    const extra = Math.max(0, s.length - hit);
    const score = Math.max(0, (hit - extra * 0.25) / all.length); // extra speech counts a quarter
    let k = 0;
    const per = parts.map(p => { const seg = marks.slice(k, k + p.length); k += p.length; return p.length ? seg.filter(Boolean).length / p.length : 1; });
    return { score: Math.min(1, score), per };
  };
  const a = run(surf, s1), b = run(kana, s2);
  const best = b.score > a.score ? { ...b, via: 'kana' } : { ...a, via: 'surface' };
  // the token marks are for all tokens (symbols = 1)
  let w = 0;
  const tokMarks = toks.map(t => (t[2] === 's' ? 1 : best.per[w++] ?? 0));
  const verdict = best.score >= VERDICT.GOOD ? 'good' : best.score >= VERDICT.CLOSE ? 'close' : 'retry';
  return { score: +best.score.toFixed(3), verdict, tokMarks, via: best.via };
}
