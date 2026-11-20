// Review schedule for grammar points — localStorage jp.grammarSrs { pointId: { due, ivl, ease, last, c, w, added } }.
// Same rules as the words (word-srs.js `schedule`: wrong → again in 10 min, first success 20 h, then ×ease, no growth
// before due). A point enters the schedule when the learner adds a lesson («Повторювати граматику уроку N», first
// review the next day) or answers an exam question of that point wrong (due the next day). Every exam answer of a
// scheduled point (exam.js persist → noteAnswer) moves it. Reviews = exam questions of the point (exam.js
// startGrammarReview / grammarReviewQuestions), on the grammar home page and in «Сьогодні». Synced (sync-merge.js,
// per point the newer `last` wins). The pure part takes the data object; the storage wrappers below use it.
import { schedule, DAY } from './word-srs.js';

export const GS_KEY = 'jp.grammarSrs';
export const FIRST_REVIEW = DAY; // a point added from a lesson or after an exam mistake: first review the next day

// ---------- pure ----------
/** Add points (not already there) with the first review after FIRST_REVIEW. Returns a new object. */
export function addTo(data, ids, now = Date.now()) {
  const out = { ...data };
  for (const id of ids) if (!out[id]) out[id] = { added: now, due: now + FIRST_REVIEW, ivl: 0, ease: 2.5, last: now, c: 0, w: 0 };
  return out;
}
export function removeFrom(data, ids) { const out = { ...data }; for (const id of ids) delete out[id]; return out; }
/** One answer of a point's question. Not scheduled: a wrong answer adds it (review tomorrow), a right one is ignored. */
export function applyAnswer(data, id, ok, now = Date.now()) {
  if (!id) return data;
  const p = data[id];
  if (!p) return ok ? data : addTo(data, [id], now);
  return { ...data, [id]: { ...p, ...schedule(p, ok, 'write', now), last: now, c: (+p.c || 0) + (ok ? 1 : 0), w: (+p.w || 0) + (ok ? 0 : 1) } };
}
/** Points due now, most overdue (relative to the interval) first, more mistakes first. */
export function dueIds(data, now = Date.now()) {
  return Object.entries(data).filter(([, p]) => p && now >= +p.due)
    .map(([id, p]) => [id, ((+p.w || 0) - (+p.c || 0)) * 5 + (now - p.due) / Math.max(+p.ivl || DAY, 6e5)])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(x => x[0]);
}
/** Next due time among the given points (or all), null if none is scheduled. */
export function nextDue(data, ids = Object.keys(data)) {
  const t = ids.map(id => data[id]?.due).filter(Boolean);
  return t.length ? Math.min(...t) : null;
}

// ---------- storage ----------
let mem = null;
export function gsLoad() {
  try { const v = JSON.parse(localStorage.getItem(GS_KEY) || 'null'); if (v && typeof v === 'object') return v; } catch { /* blocked */ }
  return mem || {};
}
function gsSave(d) {
  mem = d;
  try { localStorage.setItem(GS_KEY, JSON.stringify(d)); } catch { /* memory only */ }
  try { document.dispatchEvent(new CustomEvent('kotoba:grammar-srs')); } catch { /* not in a browser */ }
}
export const addPoints = ids => gsSave(addTo(gsLoad(), ids));
export const removePoints = ids => gsSave(removeFrom(gsLoad(), ids));
export const noteAnswer = (id, ok) => gsSave(applyAnswer(gsLoad(), id, ok));
export const grammarDue = (now = Date.now()) => dueIds(gsLoad(), now);
