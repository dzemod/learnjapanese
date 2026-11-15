// Pure logic of the kanji writing mode (no DOM): stroke matching + review schedule.
// Coordinates are in the KanjiVG 109×109 space. Used by kanji-write.js and by node tests.

// ---------- tuning (all thresholds in one place) ----------
export const STROKE = {
  POINTS: 32,            // the expected stroke is resampled to this many points (equal arc-length steps)
  START_TOL: 18,         // learner start ↔ expected start (≈16 % of the 109 box)
  SHAPE_TOL: 10,         // an expected point is "covered" when the drawn path passes within this distance
  COVERAGE_MIN: 0.85,    // share of expected points that must be covered (catches undershooting)
  END_SLACK: 3,          // …and only up to this far past the end of the drawn line (measured with its start on the expected start)
  SHORT_LEN: 12, SHORT_SLACK: 4, // dots and other short strokes (< SHORT_LEN) get a larger end slack
  MAX_LENGTH_RATIO: 1.5, // drawn length ≤ ratio × expected length + LENGTH_MARGIN (overshoot ok, long wrong line not)
  LENGTH_MARGIN: 8,
  MIN_LEN: 3,            // shorter strokes are taps → ignored, not counted as mistakes
  REVERSE_MARGIN: 2,     // drawn backwards when the reversed point-by-point fit is better by this much
  GRACE_MS: 500,         // after lifting, wait this long before judging (the learner may continue the stroke)
  JOIN_DIST: 15,         // a new piece within GRACE_MS that starts this close to the last point continues the stroke
};

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

/** Nearest distance from p to the polyline pts, and how far p lies beyond its first/last point (along the line). */
export function polyNear(p, pts) {
  if (pts.length === 1) return { d: dist(p, pts[0]), beyond: dist(p, pts[0]) };
  let best = { d: Infinity, beyond: 0 };
  // first / last segments with a length (repeated points, e.g. the lift point, make zero-length segments)
  let first = 1, last = pts.length - 1;
  while (first < last && pts[first][0] === pts[first - 1][0] && pts[first][1] === pts[first - 1][1]) first++;
  while (last > first && pts[last][0] === pts[last - 1][0] && pts[last][1] === pts[last - 1][1]) last--;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
    if (!l2) continue;
    const raw = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2, t = Math.max(0, Math.min(1, raw));
    const d = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
    if (d < best.d) {
      const l = Math.sqrt(l2);
      const beyond = raw < 0 && i === first ? -raw * l : raw > 1 && i === last ? (raw - 1) * l : 0;
      best = { d, beyond };
    }
  }
  return best.d === Infinity ? { d: dist(p, pts[0]), beyond: dist(p, pts[0]) } : best;
}

/** Compare one learner stroke with one expected stroke (both arrays of [x, y] in 109 space).
 *  Accepted when: start within START_TOL, ≥ COVERAGE_MIN of the expected points within SHAPE_TOL of the drawn path
 *  (and not more than END_SLACK past its ends — so stopping short is caught),
 *  not drawn backwards, and not longer than MAX_LENGTH_RATIO × expected + LENGTH_MARGIN. */
export function compareStroke(user, expected, T = STROKE) {
  const len = pathLength(user), elen = pathLength(expected);
  if (len < T.MIN_LEN) return { ok: false, reason: 'tap' };
  const e = resample(expected, T.POINTS), u = resample(user, T.POINTS);
  const start = dist(user[0], e[0]);
  const slack = elen < T.SHORT_LEN ? T.SHORT_SLACK : T.END_SLACK;
  // position: the drawn line itself; completeness: the drawn line moved so that it starts on the expected start
  // (a hand that is a little off everywhere is not "short", a line that stops early is)
  const sx = e[0][0] - user[0][0], sy = e[0][1] - user[0][1], aligned = user.map(([x, y]) => [x + sx, y + sy]);
  const coverage = e.filter(p => polyNear(p, user).d <= T.SHAPE_TOL && polyNear(p, aligned).beyond <= slack).length / e.length;
  const avg = avgDist(u, e), avgRev = avgDist(u, [...e].reverse());
  const m = { start, coverage, len, elen, avg, avgRev };
  if (avgRev + T.REVERSE_MARGIN < avg && dist(user[0], e[e.length - 1]) < dist(user[0], e[0])) return { ok: false, reason: 'direction', ...m };
  if (start > T.START_TOL || coverage < T.COVERAGE_MIN) return { ok: false, reason: 'shape', ...m };
  if (len > T.MAX_LENGTH_RATIO * elen + T.LENGTH_MARGIN) return { ok: false, reason: 'long', ...m };
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
