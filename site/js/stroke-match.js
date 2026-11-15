// Pure logic of the kanji writing mode (no DOM): stroke matching + review schedule.
// Coordinates are in the KanjiVG 109×109 space. Used by kanji-write.js and by node tests.

// ---------- tuning (all thresholds in one place) ----------
export const STROKE = {
  POINTS: 32,       // both strokes are resampled to this many points (equal arc-length steps)
  START_MAX: 20,    // max distance learner start ↔ expected start (≈18 % of the 109 box)
  END_MAX: 20,      // max distance learner end ↔ expected end
  AVG_MAX: 13,      // max mean distance between the 32 matching points (shape + position)
  MIN_LEN: 3,       // shorter strokes are taps → ignored, not counted as mistakes
  REVERSE_MARGIN: 2, // stroke counts as drawn backwards when the reversed fit is better by this much
};
export const WRONG_MS = 1000;   // a rejected stroke stays red this long

// ---------- geometry ----------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function pathLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }

/** Resample a polyline to n points spaced evenly along its length. */
export function resample(pts, n = STROKE.POINTS) {
  if (!pts.length) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => [...pts[0]]);
  const total = pathLength(pts);
  if (!total) return Array.from({ length: n }, () => [...pts[0]]);
  const step = total / (n - 1), out = [[...pts[0]]];
  let acc = 0, prev = pts[0], i = 1;
  while (i < pts.length && out.length < n) {
    const cur = pts[i], d = dist(prev, cur);
    if (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
      out.push(q); prev = q; acc = 0;
    } else { acc += d; prev = cur; i++; }
  }
  while (out.length < n) out.push([...pts[pts.length - 1]]);
  return out;
}
const avgDist = (a, b) => a.reduce((s, p, i) => s + dist(p, b[i]), 0) / a.length;

/** Compare one learner stroke with one expected stroke (both arrays of [x, y] in 109 space). */
export function compareStroke(user, expected, T = STROKE) {
  if (pathLength(user) < T.MIN_LEN) return { ok: false, reason: 'tap' };
  const u = resample(user, T.POINTS), e = resample(expected, T.POINTS);
  const start = dist(u[0], e[0]), end = dist(u[u.length - 1], e[e.length - 1]);
  const avg = avgDist(u, e), avgRev = avgDist(u, [...e].reverse());
  const m = { start, end, avg, avgRev };
  if (avgRev + T.REVERSE_MARGIN < avg && avgRev <= T.AVG_MAX) return { ok: false, reason: 'direction', ...m };
  if (start > T.START_MAX || end > T.END_MAX || avg > T.AVG_MAX) return { ok: false, reason: 'shape', ...m };
  return { ok: true, ...m };
}

/** Check a learner stroke against stroke `idx`; a match with a later stroke → reason 'order'. */
export function judgeStroke(user, strokes, idx, T = STROKE) {
  const r = compareStroke(user, strokes[idx], T);
  if (r.ok || r.reason === 'tap') return r;
  for (let j = idx + 1; j < strokes.length; j++) if (compareStroke(user, strokes[j], T).ok) return { ...r, ok: false, reason: 'order', later: j };
  return r;
}

// ---------- review schedule ----------
export const MIN = 60e3, DAY = 864e5;
export const RATINGS = [
  { key: 'again', label: 'Ще раз', cls: 'again' },
  { key: 'hard', label: 'Важко', cls: 'hard' },
  { key: 'good', label: 'Добре', cls: 'good' },
  { key: 'easy', label: 'Легко', cls: 'easy' },
];
// Learning steps (new or not yet graduated kanji) — as in the reference: 1m / 5m / 10m / 16d.
const LEARN = { again: 1 * MIN, hard: 5 * MIN, good: 10 * MIN, easy: 16 * DAY };

/** Interval (ms) that rating `r` gives to a kanji with schedule entry `s` (undefined = new). */
export function nextInterval(s, r) {
  const iv = s?.interval || 0;
  if (iv < DAY) return LEARN[r];             // learning: fixed steps
  if (r === 'again') return LEARN.again;      // lapse → back to learning
  if (r === 'hard') return Math.max(DAY, Math.round(iv * 1.2));
  if (r === 'good') return Math.round(iv * 2.5);
  return Math.round(iv * 3.5);
}
export function applyRating(s, r, mistakes, now = Date.now()) {
  const interval = nextInterval(s, r);
  return {
    due: now + interval, interval, rating: r, mistakes,
    totalMistakes: (s?.totalMistakes || 0) + mistakes, reps: (s?.reps || 0) + 1, last: now,
  };
}
/** Status of one kanji: new (never rated) / review (due now) / learning (short interval, not due) / known. */
export function status(s, now = Date.now()) {
  if (!s) return 'new';
  if (s.due <= now) return 'review';
  return s.interval < DAY ? 'learning' : 'known';
}
export function counts(ids, sched, now = Date.now()) {
  const c = { new: 0, learning: 0, review: 0, known: 0 };
  for (const id of ids) c[status(sched[id], now)]++;
  return c;
}
/** Due kanji first (oldest due first), then new ones in book order. */
export function buildQueue(ids, sched, now = Date.now()) {
  const due = ids.filter(id => status(sched[id], now) === 'review').sort((a, b) => sched[a].due - sched[b].due);
  return [...due, ...ids.filter(id => !sched[id])];
}
export function fmtInterval(ms) {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} хв`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} год`;
  if (ms < 60 * DAY) return `${Math.round(ms / DAY)} дн`;
  return `${Math.round(ms / (30 * DAY))} міс`;
}
