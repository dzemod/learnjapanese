// Streak with freezes (pure: no DOM, no storage — tests: tools/test-achievements.mjs).
// Everything is derived from the study-day log jp.days, so nothing extra is stored or synced:
//   • every FREEZE.every studied days in a row earn one freeze (at most FREEZE.max kept);
//   • a missed day (not today) uses a freeze automatically, the streak goes on (the frozen day itself adds nothing);
//   • a missed day without a freeze ends the streak; today not studied yet never breaks it.
export const FREEZE = { every: 7, max: 2 };

const D = 864e5;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmt = t => new Date(t).toISOString().slice(0, 10);

/**
 * days: ["YYYY-MM-DD", …] (any order, duplicates ok), today: "YYYY-MM-DD".
 * → { streak, best, freezes, frozen: [dates of the current streak covered by a freeze], freezeUsed (ever), total, comeback,
 *     nextFreezeIn (studied days until the next freeze, 0 = already at the maximum) }
 *   comeback = the longest break (in days) before a studied day, used by the hidden «Повернення» achievement.
 */
export function streakInfo(days, today, R = FREEZE) {
  const set = new Set((Array.isArray(days) ? days : []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today));
  const sorted = [...set].sort();
  const out = { streak: 0, best: 0, freezes: 0, frozen: [], total: sorted.length, comeback: 0, freezeUsed: 0, nextFreezeIn: R.every };
  if (!sorted.length) return out;
  let run = 0, earn = 0, freezes = 0, frozen = [], gap = 0;
  const end = parse(today);
  for (let t = parse(sorted[0]); t <= end; t += D) {
    const d = fmt(t);
    if (set.has(d)) {
      if (gap) out.comeback = Math.max(out.comeback, gap);
      gap = 0;
      run++; earn++;
      if (earn >= R.every) { earn = 0; freezes = Math.min(R.max, freezes + 1); }
      out.best = Math.max(out.best, run);
    } else if (d === today) {
      // today is not over yet
    } else {
      gap++;
      if (run && freezes > 0) { freezes--; frozen.push(d); out.freezeUsed++; }
      else if (run) { run = 0; earn = 0; frozen = []; }
    }
  }
  return { ...out, streak: run, freezes, frozen: run ? frozen : [], nextFreezeIn: freezes >= R.max ? 0 : R.every - earn };
}
