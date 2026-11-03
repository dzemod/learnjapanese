// Free checking of a Japanese sentence written by the learner against the model answer (exam task
// «Переклад речень»). Pure module (no DOM) — used by exam.js and tools/test-sentcheck.mjs.
//
// Model answers come pre-tokenized from data/exam.json (Kuromoji at build time, readings aligned to the
// textbook furigana): k = [[surface, kana, cls]], cls: n word · v verb · a adjective · x auxiliary · p particle.
// 1) the learner's text is normalised (no spaces/punctuation, katakana → hiragana, full-width → normal);
// 2) every kanji word written exactly like in the model is replaced by its model reading, other kanji get
//    their Kuromoji reading (readings(), done by the caller in the Web Worker) → kana string;
// 3) the kana string is aligned with the model (LCS on characters) and the result is projected on model words:
//    correct / partly correct (wrong form) / missing, plus extra text, wrong particles, word order.
export const KANJI_RE = /[㐀-鿿々〆]/;
const hira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const PUNCT = /[\s　。、．，,.!?！？「」『』（）()［］[\]・…‥〜～—–\-:：;；"“”'‘’«»]/g;
export const normJa = s => hira(String(s || '').normalize('NFKC')).replace(PUNCT, '');
export const PARTICLE_SET = new Set(['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'の', 'から', 'まで', 'や', 'か', 'よ', 'ね', 'より', 'しか', 'でも', 'ので', 'のに', 'けど', 'けれど', 'し', 'ばかり', 'だけ', 'など', 'とか', 'って', 'な']);

const words = k => (k || []).filter(t => t[2] !== 's' && normJa(t[0]));

/** Replace model kanji words by their readings. Returns { text, kanjiLeft }. */
export function preKana(input, models) {
  const src = String(input || '').normalize('NFKC');
  // surface → readings in the order they occur in the model (人: にん, じん, ひと in one sentence)
  const read = new Map();
  models.forEach((k, mi) => {
    const seen = new Map();
    for (const t of words(k)) {
      if (!(KANJI_RE.test(t[0]) || /[0-9]/.test(t[0]))) continue;
      const f = t[0].normalize('NFKC'), n = seen.get(f) || 0;
      seen.set(f, n + 1);
      const list = read.get(f) || [];
      if (mi === 0 || list[n] == null) list[n] = list[n] ?? t[1];
      read.set(f, list);
    }
  });
  const keys = [...read.keys()].sort((a, b) => b.length - a.length);
  const used = new Map();
  let s = '';
  for (let i = 0; i < src.length;) {
    const f = keys.find(x => src.startsWith(x, i));
    if (!f) { s += src[i++]; continue; }
    const n = used.get(f) || 0, list = read.get(f).filter(x => x != null);
    used.set(f, n + 1);
    s += list[Math.min(n, list.length - 1)];
    i += f.length;
  }
  s = normJa(s);
  return { text: s, kanjiLeft: KANJI_RE.test(s) };
}

/** Characters LCS → array of [modelIndex, userIndex] pairs. */
function lcs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Compare the learner's kana string with one model (token list). Returns
 * { score 0..1, toks: [{ s, kana, cls, st: ok|part|miss|order }], user: [{ t, st: ok|bad }], issues: [...] }
 * issues: { kind: 'particle'|'form'|'word'|'missing'|'extra'|'order', exp, got, cls }
 */
export function compareKana(userKana, k) {
  const toks = words(k).map(t => ({ s: t[0], kana: normJa(t[1]) || normJa(t[0]), cls: t[2] }));
  const M = toks.map(t => t.kana).join(''), U = userKana;
  const owner = [];
  toks.forEach((t, i) => { for (let c = 0; c < t.kana.length; c++) owner.push(i); });
  const pairs = lcs(M, U);
  const hit = toks.map(() => []);
  const uOk = new Array(U.length).fill(false);
  for (const [mi, ui] of pairs) { hit[owner[mi]].push(ui); uOk[ui] = true; }
  toks.forEach((t, i) => { t.st = hit[i].length === t.kana.length ? 'ok' : hit[i].length ? 'part' : 'miss'; });
  // a fully matched word whose characters are scattered in the answer is not really correct
  toks.forEach((t, i) => { if (t.st === 'ok' && hit[i].length > 1 && hit[i][hit[i].length - 1] - hit[i][0] >= t.kana.length + 2) t.st = 'part'; });

  // regions between correct words
  const issues = [];
  let prevEnd = -1, run = [];
  const flush = (uEnd, prevTok) => {
    const seg = U.slice(prevEnd + 1, uEnd);
    if (!run.length && !seg) return;
    const exp = run.map(t => t.s).join(''), expK = run.map(t => t.kana).join('');
    if (!run.length) issues.push({ kind: 'extra', got: seg });
    else if (!seg) issues.push(run.length === 1 && run[0].cls === 'p' ? { kind: 'missing', exp, cls: 'p', expK } : { kind: 'missing', exp, expK });
    else if (run.length === 1 && run[0].cls === 'p' && PARTICLE_SET.has(seg)) issues.push({ kind: 'particle', exp, got: seg });
    else if (run.some(t => 'vax'.includes(t.cls))) {
      // show the whole word: the correct stem before + the wrong ending
      const stem = prevTok && 'vanx'.includes(prevTok.cls) && prevTok.st === 'ok' && run[0].cls === 'x' ? prevTok : null;
      issues.push({ kind: 'form', exp: (stem ? stem.s : '') + exp, got: (stem ? stem.kana : '') + seg, expK: (stem ? stem.kana : '') + expK });
    } else issues.push({ kind: 'word', exp, got: seg, expK });
    run.forEach(t => (t.region = issues.length - 1));
  };
  let prevTok = null, lastOk = null;
  toks.forEach((t, i) => {
    if (t.st === 'ok') {
      flush(hit[i][0], lastOk);
      prevEnd = hit[i][hit[i].length - 1];
      run = [];
      lastOk = t;
    } else run.push(t);
    prevTok = t;
  });
  flush(U.length, lastOk);

  // word order: a missing/wrong word that appears elsewhere as extra text
  for (const iss of issues) {
    if (!['missing', 'word'].includes(iss.kind)) continue;
    const kk = iss.expK || normJa(iss.exp);
    if (kk.length < 2) continue;
    const other = issues.find(o => o !== iss && (o.kind === 'extra' || o.kind === 'word') && o.got && o.got.includes(kk));
    if (other) {
      iss.kind = 'order';
      const rest = other.got.replace(kk, '');
      if (!rest || (other.kind === 'word' && rest === other.expK)) {
        if (other.kind === 'word') toks.forEach(t => { if (t.region === issues.indexOf(other)) t.st = 'ok'; });
        other.kind = 'skip';
      } else other.got = rest;
      toks.forEach(t => { if (t.region === issues.indexOf(iss)) t.st = 'order'; });
    }
  }
  const finalIssues = issues.filter(i => i.kind !== 'skip');

  const credit = toks.reduce((a, t) => a + (t.st === 'ok' ? 1 : t.st === 'part' || t.st === 'order' ? 0.5 : 0), 0);
  const extra = finalIssues.filter(i => i.kind === 'extra').reduce((a, i) => a + i.got.length, 0);
  let score = toks.length ? credit / toks.length - 0.5 * (extra / Math.max(M.length, 1)) : 0;
  score = Math.max(0, Math.min(1, score));
  // user string split into matched / unmatched runs (for colouring)
  const user = [];
  for (let i = 0; i < U.length; i++) {
    const st = uOk[i] ? 'ok' : 'bad';
    if (user.length && user[user.length - 1].st === st) user[user.length - 1].t += U[i];
    else user.push({ t: U[i], st });
  }
  return { score, toks, user, issues: finalIssues, model: k };
}

/**
 * Full check. models: [main tokens, ...alternative token lists]; userKana: result of preKana (+ Kuromoji readings).
 * Returns the best comparison + verdict.
 */
export function checkSentence(userKana, models) {
  if (!userKana) return { score: 0, verdict: 'bad', toks: words(models[0]).map(t => ({ s: t[0], kana: t[1], cls: t[2], st: 'miss' })), user: [], issues: [{ kind: 'empty' }], alt: 0 };
  let best = null;
  models.forEach((k, i) => {
    const exact = normJa(words(k).map(t => t[1] || t[0]).join('')) === userKana;
    const r = exact ? { ...compareKana(userKana, k), score: 1, issues: [] } : compareKana(userKana, k);
    r.alt = i;
    if (!best || r.score > best.score) best = r;
  });
  // «Правильно» only without any mistake; a mistake in a long sentence is still «Майже правильно»
  best.verdict = best.issues.length ? (best.score >= 0.6 ? 'almost' : 'bad') : verdictOf(best.score);
  return best;
}
export const verdictOf = s => (s >= 0.9 ? 'ok' : s >= 0.6 ? 'almost' : 'bad');
export const VERDICT = { ok: 'Правильно', almost: 'Майже правильно', bad: 'Є помилки' };
