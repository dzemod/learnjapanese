// Daily goal: study time per day and the ring in «Сьогодні» (pure part tested by tools/test-goal.mjs).
// Study time is measured from study actions (store.js markStudied): the gap since the previous action counts when it
// is at most GAP_MAX (2 min — you were working), otherwise a fresh start counts FIRST (20 s, the time of one answer).
// Storage: jp.studyTime { "YYYY-MM-DD": ms } (synced: per day the larger value), jp.studyTime.at (last action, this
// device only), goal minutes jp.goal (default 10).
export const GAP_MAX = 2 * 6e4;
export const FIRST = 20e3;
export const GOALS = [5, 10, 15, 30];
export const DEFAULT_GOAL = 10;

/** ms to add for an action at `now` after the previous action at `prevAt` (0 = none). */
export const timeFor = (prevAt, now) => (prevAt && now - prevAt >= 0 && now - prevAt <= GAP_MAX ? now - prevAt : FIRST);

/** Days (YYYY-MM-DD) on which the goal was reached. */
export const goalDays = (time, goalMin) => Object.keys(time || {}).filter(d => (+time[d] || 0) >= goalMin * 6e4).sort();

/** SVG ring: done 0…1. */
export function ringSVG(done, size = 64) {
  const r = 26, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, done));
  return `<svg class="goal-ring${p >= 1 ? ' done' : ''}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" class="gr-bg"/><circle cx="32" cy="32" r="${r}" class="gr-fg" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" transform="rotate(-90 32 32)"/></svg>`;
}
export const fmtMin = ms => `${Math.floor(ms / 6e4)}`;
