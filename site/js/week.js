// Weekly summary (pure — tests: tools/test-week.mjs). A week = Monday 00:00 … next Monday 00:00 (local time).
// Built only from stored data: jp.days, jp.studyTime, jp.activity, jp.progress (last answer + level),
// jp.kanjiWrite (last rating), jp.examHistory (date, score, mistakes with grammar refs).
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday 00:00 of the week containing `date` (local), shifted by `offset` weeks. */
export function weekStart(date = new Date(), offset = 0) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}
export const weekKey = start => ymd(start);

/**
 * data = { days, time, activity, progress, kanji, history }; start = Monday (Date).
 * → { from, to, days, minutes, actions, words: { reviewed, known }, kanji, exams: { n, avg }, weak: { lesson, point, n } | null }
 */
export function summarize(data, start) {
  const from = start.getTime(), toD = new Date(start); toD.setDate(toD.getDate() + 7);
  const to = toD.getTime();
  const inDay = d => d >= ymd(start) && d < ymd(toD);
  const inT = t => +t >= from && +t < to;
  const days = (data.days || []).filter(inDay).length;
  const minutes = Math.round(Object.entries(data.time || {}).filter(([d]) => inDay(d)).reduce((a, [, ms]) => a + (+ms || 0), 0) / 6e4);
  const actions = Object.entries(data.activity || {}).filter(([d]) => inDay(d)).reduce((a, [, n]) => a + (+n || 0), 0);
  let reviewed = 0, known = 0;
  for (const [k, p] of Object.entries(data.progress || {})) {
    if (/^k(300|700)-/.test(k) || !p || !inT(p.last)) continue;
    reviewed++;
    if (p.lvl >= 2) known++;
  }
  const kanji = Object.values(data.kanji || {}).filter(s => s && inT(s.last)).length;
  const ex = (data.history || []).filter(h => h && inT(h.at));
  const avg = ex.length ? Math.round(ex.reduce((a, h) => a + (+h.pct || 0), 0) / ex.length) : null;
  const cnt = new Map();
  for (const h of ex) for (const m of h.mistakes || []) {
    const r = m?.ref;
    if (!r || r.kind !== 'g' || !r.lesson) continue;
    const key = `${r.lesson}|${r.point || ''}`;
    cnt.set(key, (cnt.get(key) || 0) + 1);
  }
  let weak = null;
  for (const [key, n] of [...cnt].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) { const [l, p] = key.split('|'); weak = { lesson: +l, point: p || null, n }; break; }
  return { from: ymd(start), to: ymd(new Date(to - DAY)), days, minutes, actions, words: { reviewed, known }, kanji, exams: { n: ex.length, avg }, weak };
}

/** Show the summary card on the home page: Monday–Wednesday, last week had any study, not dismissed for that week. */
export const showCard = (now, lastWeek, seenKey) => ((now.getDay() + 6) % 7) <= 2 && lastWeek.days > 0 && seenKey !== lastWeek.from;
