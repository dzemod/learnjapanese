// Review schedule for words (pure — tests: tools/test-word-srs.mjs). Stored inside jp.progress next to the old fields:
//   { c, w, lvl, star, last, due, ivl, ease }   due/ivl in ms, ease = growth factor (SM-2 style).
// Rules: a wrong answer → due again in 10 min, ease −0.2 (≥ 1.3); a right answer when the word is due → the interval
// grows (first success 20 h; recall ×ease, recognition ×1.3); a right answer before it is due (e.g. a repeat inside one
// session) does not stretch the interval. Words answered before this schedule existed have no ivl: they are due by
// the old rules (LEGACY) and start the schedule on their next answer (a known word starts from 7 days).
export const DAY = 864e5;
export const SRS = { AGAIN: 10 * 6e4, FIRST: 20 * 36e5, EASE: 2.5, MIN_EASE: 1.3, EASE_DROP: 0.2, MC_GROW: 1.3, MAX: 365 * DAY, KNOWN_START: 7 * DAY };
export const LEGACY = { LEARNING_AFTER: 20 * 36e5, KNOWN_AFTER: 7 * DAY, WRONG_AFTER: 10 * 6e4 };

/** The schedule fields after one answer. p = stored progress (may be empty), kind = 'write' (recall) | 'mc'. */
export function schedule(p = {}, correct, kind = 'write', now = Date.now()) {
  const ease = +p.ease || SRS.EASE;
  let ivl = +p.ivl || 0;
  if (!ivl && p.last) ivl = p.lvl >= 2 ? SRS.KNOWN_START / SRS.EASE : 0; // legacy word: continue from its level
  if (!correct) {
    const e = Math.max(SRS.MIN_EASE, +(ease - SRS.EASE_DROP).toFixed(2));
    return { ivl: SRS.AGAIN, ease: e, due: now + SRS.AGAIN };
  }
  if (p.due && now < p.due && p.ivl) return { ivl: p.ivl, ease, due: p.due }; // not due yet: no growth
  let next;
  if (ivl < SRS.FIRST) next = SRS.FIRST;
  else next = Math.min(SRS.MAX, Math.round(ivl * (kind === 'mc' ? SRS.MC_GROW : ease)));
  return { ivl: next, ease, due: now + next };
}

/** Is a studied word due now? (new words never are) */
export function isDue(p, now = Date.now()) {
  if (!p || !p.last || !(p.lvl >= 1 || p.w > 0)) return false;
  if (p.due) return now >= p.due;
  const age = now - p.last; // legacy rules
  return (p.w > p.c && age >= LEGACY.WRONG_AFTER) || (p.lvl === 1 && age >= LEGACY.LEARNING_AFTER) || (p.lvl >= 2 && age >= LEGACY.KNOWN_AFTER);
}
/** Order: most overdue relative to the interval first, more mistakes first. */
export function dueScore(p, now = Date.now()) {
  const ivl = +p.ivl || DAY, over = now - (+p.due || +p.last || now);
  return ((+p.w || 0) - (+p.c || 0)) * 10 + over / ivl;
}
/** Short Ukrainian text of an interval: «10 хв», «20 год», «3 дн.», «2 міс.» */
export function fmtIvl(ms) {
  if (ms < 36e5) return `${Math.max(1, Math.round(ms / 6e4))} хв`;
  if (ms < DAY) return `${Math.round(ms / 36e5)} год`;
  if (ms < 60 * DAY) return `${Math.round(ms / DAY)} дн.`;
  return `${Math.round(ms / (30 * DAY))} міс.`;
}
