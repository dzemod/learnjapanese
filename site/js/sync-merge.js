// Merge rules for progress sync between devices (pure: no DOM, no storage — tests: tools/test-sync-merge.mjs).
// Every rule is symmetric: merging A into B and B into A gives the same result, and merging twice changes nothing,
// so two devices that sync in any order end up with the same data and nothing that was learned is lost.
//   progress   jp.progress      { "setId/cardId": { c, w, lvl, star, last } } → per card the newer answer (last) wins
//   kanji      jp.kanjiWrite    { kanjiId: { due, interval, rating, reps, last, … } } → per kanji the newer rating wins
//   days       jp.days          ["YYYY-MM-DD", …] → union (last 800 days)
//   mistakes   jp.examMistakes  [question with uid, savedAt] + clearedAt → union by uid, minus those saved before the
//                               latest «Очистити» on any device (max 100, newest first)
//   history    jp.examHistory   [{ at, name, … }] → union by at + name (last 60, oldest first)
//   best       jp.best          { setId: ms } → per set the faster time
//   level      jp.sensei.level  "N" → this device's value; another device's only if this one has none
//   activity   jp.activity      { "YYYY-MM-DD": n } → per day the larger count (last 800 days) — the heatmap
//   unlocked   jp.achievements  { id: time } → union, the earliest unlock wins (ach-rules.js mergeUnlocked)
//   time       jp.studyTime     { "YYYY-MM-DD": ms } → per day the larger value (daily goal)
//   notes      jp.kanjiNotes    { kanjiId: { t, at } } → per kanji the newer note wins (an emptied note has t: "")
//   grammar    jp.grammarSrs    { pointId: { due, ivl, ease, last, c, w, added } } → per point the newer answer (last) wins
import { mergeUnlocked } from './ach-rules.js';

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = v => (Array.isArray(v) ? v : []);
const newer = (a, b, tie) => {
  const ta = +a?.last || 0, tb = +b?.last || 0;
  if (ta !== tb) return ta > tb ? a : b;
  return tie(a, b);
};
const byJSON = (a, b) => (JSON.stringify(a) >= JSON.stringify(b) ? a : b); // deterministic tie-break

export function mergeProgress(a, b) {
  a = obj(a); b = obj(b);
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) { // sorted: both devices store identical data
    if (!(k in b)) out[k] = a[k];
    else if (!(k in a)) out[k] = b[k];
    else out[k] = newer(a[k], b[k], (x, y) => { const nx = (+x.c || 0) + (+x.w || 0), ny = (+y.c || 0) + (+y.w || 0); return nx !== ny ? (nx > ny ? x : y) : byJSON(x, y); });
  }
  return out;
}
export function mergeKanji(a, b) {
  a = obj(a); b = obj(b);
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) { // sorted: both devices store identical data
    if (!(k in b)) out[k] = a[k];
    else if (!(k in a)) out[k] = b[k];
    else out[k] = newer(a[k], b[k], (x, y) => ((+x.reps || 0) !== (+y.reps || 0) ? ((+x.reps || 0) > (+y.reps || 0) ? x : y) : byJSON(x, y)));
  }
  return out;
}
export const mergeDays = (a, b) => [...new Set([...arr(a), ...arr(b)].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-800);

/** a, b = { items, clearedAt } */
export function mergeMistakes(a, b, max = 100) {
  const clearedAt = Math.max(+a?.clearedAt || 0, +b?.clearedAt || 0);
  const seen = new Map();
  for (const q of [...arr(a?.items), ...arr(b?.items)]) {
    if (!q || !q.uid || (+q.savedAt || 0) <= clearedAt) continue;
    const prev = seen.get(q.uid);
    if (!prev || (+q.savedAt || 0) > (+prev.savedAt || 0) || ((+q.savedAt || 0) === (+prev.savedAt || 0) && byJSON(q, prev) === q)) seen.set(q.uid, q);
  }
  const items = [...seen.values()].sort((x, y) => (+y.savedAt || 0) - (+x.savedAt || 0) || (x.uid < y.uid ? -1 : 1)).slice(0, max);
  return { items, clearedAt };
}
export function mergeHistory(a, b, max = 60) {
  const m = new Map();
  for (const h of [...arr(a), ...arr(b)]) if (h && h.at) { const k = `${h.at}|${h.name || ''}`; if (!m.has(k) || byJSON(h, m.get(k)) === h) m.set(k, h); }
  return [...m.values()].sort((x, y) => x.at - y.at || (`${x.name}` < `${y.name}` ? -1 : 1)).slice(-max);
}
export function mergeBest(a, b) {
  a = obj(a); b = obj(b);
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = typeof a[k] === 'number' ? a[k] : null, y = typeof b[k] === 'number' ? b[k] : null;
    if (x != null || y != null) out[k] = x == null ? y : y == null ? x : Math.min(x, y);
  }
  return out;
}
export function mergeActivity(a, b) {
  a = obj(a); b = obj(b);
  const out = {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-800);
  for (const k of keys) { const v = Math.max(+a[k] || 0, +b[k] || 0); if (v) out[k] = v; }
  return out;
}
export function mergeNotes(a, b) {
  a = obj(a); b = obj(b);
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[k] && typeof a[k] === 'object' ? a[k] : null, y = b[k] && typeof b[k] === 'object' ? b[k] : null;
    const v = !x ? y : !y ? x : (+x.at || 0) !== (+y.at || 0) ? ((+x.at || 0) > (+y.at || 0) ? x : y) : byJSON(x, y);
    if (v) out[k] = v;
  }
  return out;
}
export { mergeUnlocked };
export const mergeLevel = (local, remote) => (local != null && local !== '' ? local : remote ?? null);

/** All datasets at once: { progress, kanji, days, mistakes, history, best, level, activity, time, unlocked, notes } (missing parts = empty). */
export function mergeAll(local, remote) {
  local = obj(local); remote = obj(remote);
  return {
    progress: mergeProgress(local.progress, remote.progress),
    kanji: mergeKanji(local.kanji, remote.kanji),
    days: mergeDays(local.days, remote.days),
    mistakes: mergeMistakes(local.mistakes, remote.mistakes),
    history: mergeHistory(local.history, remote.history),
    best: mergeBest(local.best, remote.best),
    level: mergeLevel(local.level, remote.level),
    activity: mergeActivity(local.activity, remote.activity),
    time: mergeActivity(local.time, remote.time),
    unlocked: mergeUnlocked(local.unlocked, remote.unlocked),
    notes: mergeNotes(local.notes, remote.notes),
    grammar: mergeProgress(local.grammar, remote.grammar), // grammar-srs.js: same rule as words
  };
}
