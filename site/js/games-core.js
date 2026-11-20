// Міні-ігри — pure logic (no DOM): word / particle pools from the learner's lessons, rounds, scoring.
// Used by games.js (views) and tools/test-games.mjs.

export const PARTICLES = ['は', 'が', 'を', 'に', 'へ', 'で', 'と', 'も', 'の', 'から', 'まで', 'や', 'か', 'ね', 'よ', 'より'];
export const MAX_UK = 34, MAX_JA = 9; // longer cards do not fit a falling tile / a mole at 320 px

const lessonOf = id => { const m = /^mnn-(\d+)$/.exec(id || ''); return m ? +m[1] : -1; };
export const cleanUk = s => String(s || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();

/** "3-7" → { from: 3, to: 7 } (clamped to 0–50, swapped if reversed); anything else → null. */
export function parseRange(s) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
  if (!m) return null;
  let a = Math.min(50, +m[1]), b = Math.min(50, +m[2]);
  if (a > b) [a, b] = [b, a];
  return { from: a, to: b };
}

/** Words of textbook lessons from–to (sets mnn-XX) that fit a game tile; one card per Ukrainian meaning. */
export function wordPool(sets, from, to) {
  const out = [], seen = new Set();
  for (const s of sets || []) {
    const n = lessonOf(s.id);
    if (n < from || n > to) continue;
    for (const c of s.cards || []) {
      const uk = cleanUk(c.ukrainian), ja = String(c.japanese || '').trim();
      if (!uk || !ja || uk.length > MAX_UK || ja.length > MAX_JA || /[～〜~…]/.test(ja)) continue;
      const k = uk.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: `${s.id}/${c.id}`, ja, kana: c.reading || '', uk, lesson: n });
    }
  }
  return out;
}

/** Particle blanks (exam.json t:"p") of lessons from–to; fewer than `min` → earlier lessons are added too. */
export function particlePool(examLessons, from, to, min = 12) {
  const items = (examLessons || []).flatMap(l => l.items || []).filter(i => i.t === 'p' && PARTICLES.includes(i.a));
  let pool = items.filter(i => i.l >= from && i.l <= to);
  if (pool.length < min) pool = items.filter(i => i.l <= to);
  return pool;
}

/** Seeded-or-not shuffle (rnd = Math.random by default) — returns a new array. */
export function shuffled(a, rnd = Math.random) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** 4 options for a word: the right meaning + 3 other meanings (never the same text). */
export function wordOptions(word, pool, n = 4, rnd = Math.random) {
  const others = shuffled(pool.filter(w => w.uk.toLowerCase() !== word.uk.toLowerCase()), rnd).slice(0, n - 1);
  return shuffled([word, ...others], rnd);
}

/** 4 particle options: the answer + 3 particles that are neither the answer nor an accepted alternative. */
export function particleOptions(item, rnd = Math.random) {
  const ok = new Set([item.a, ...(item.alt || [])]);
  const common = PARTICLES.slice(0, 10).filter(p => !ok.has(p));
  return shuffled([item.a, ...shuffled(common, rnd).slice(0, 3)], rnd);
}
export const particleRight = (item, given) => given === item.a || (item.alt || []).includes(given);

/** Combo multiplier: ×1 for the first 2 right answers in a row, then +1 every 3, at most ×5. */
export const comboMult = streak => Math.min(5, 1 + Math.floor(streak / 3));

/** Falling time of the n-th word in «Дощ слів» (ms): 9 s, 6 % faster after every right answer, never under 3.2 s. */
export const rainFall = n => Math.max(3200, Math.round(9000 * 0.94 ** n));

/** «Пам’ять» score: 6 pairs, fewer flips and seconds = more points (at least 50). */
export const memoryScore = (pairs, moves, secs) => Math.max(50, pairs * 100 - Math.max(0, moves - pairs) * 15 - Math.round(secs) * 2);

/** The highest textbook lesson with any progress (keys "mnn-XX/…"), else 0. */
export function lastStudiedLesson(progress) {
  let max = 0;
  for (const k of Object.keys(progress || {})) { const n = lessonOf(k.split('/')[0]); if (n > max) max = n; }
  return max;
}
