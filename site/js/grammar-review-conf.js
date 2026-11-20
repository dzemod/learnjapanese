// Settings of the grammar review panel («Повторення граматики», gear icon) — localStorage jp.grammarReview.conf.
//   { v: 1, types: [RTYPES ids], count: 5|10|15|20, sched: 'auto'|'daily'|'alt'|'weekly'|'custom', days: 1–365, lessons: [1–50] }
// Exercise types reuse the Exam generators (exam.js grammarReviewQuestions):
//   tj → qTransJ (bank t:"tr"), uj → qTiles (t:"tr"), fill → qParticle (t:"p") + qVerb (t:"v"),
//   choose → qGrammar (t:"v", 3 options), build → qSent (t:"ts", sentcheck.js), game → games.js offer (#/play).
// sched 'auto' = the spaced schedule of grammar-srs.js (word-srs.js rules); the others override it with a fixed interval.
// Loading never throws: a broken or partly broken value is repaired field by field (unparseable → defaults).
export const GR_KEY = 'jp.grammarReview.conf';
export const RTYPES = [
  ['tj', 'Переклад з японської на українську'],
  ['uj', 'Переклад з української на японську'],
  ['fill', 'Заповнити пропуск'],
  ['choose', 'Вибрати правильну форму'],
  ['build', 'Скласти речення з граматичною конструкцією'],
  ['game', 'Міні-гра на закріплення'],
];
export const RTYPE_HINT = {
  tj: 'вибір перекладу', uj: 'зібрати речення з плиток', fill: 'частка або форма дієслова', choose: 'з 3 варіантів',
  build: 'напишіть речення, перевірка як в екзамені', game: 'після сесії, за бажанням',
};
export const COUNTS = [5, 10, 15, 20];
export const SCHEDS = [['auto', 'Автоматично (завтра, потім через дні й тижні)'], ['daily', 'Щодня'], ['alt', 'Через день'], ['weekly', 'Раз на тиждень'], ['custom', 'Свій інтервал']];
const FIXED_DAYS = { daily: 1, alt: 2, weekly: 7 };
export const LESSONS = 50;
export const DEFAULTS = Object.freeze({ v: 1, types: ['tj', 'fill', 'choose', 'game'], count: 10, sched: 'auto', days: 3, lessons: Array.from({ length: LESSONS }, (_, i) => i + 1) });
const DAY = 864e5;

// ---------- pure ----------
const fresh = () => ({ ...DEFAULTS, types: [...DEFAULTS.types], lessons: [...DEFAULTS.lessons] });
/** A valid settings object from anything (field by field; not an object → defaults). */
export function sanitize(raw) {
  const d = fresh();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const ids = RTYPES.map(t => t[0]);
  if (Array.isArray(raw.types)) d.types = ids.filter(id => raw.types.includes(id));
  if (COUNTS.includes(+raw.count)) d.count = +raw.count;
  if (SCHEDS.some(s => s[0] === raw.sched)) d.sched = raw.sched;
  const days = Math.round(+raw.days);
  if (days >= 1 && days <= 365) d.days = days;
  if (Array.isArray(raw.lessons)) d.lessons = [...new Set(raw.lessons.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= LESSONS))].sort((a, b) => a - b);
  return d;
}
/** Is a stored value exactly valid (no repair needed)? */
export const isValid = raw => !!raw && typeof raw === 'object' && JSON.stringify(sanitize(raw)) === JSON.stringify({ ...fresh(), ...raw });
/** Fixed interval in ms, or 0 for the spaced ('auto') schedule. */
export function fixedMs(c) {
  if (c.sched === 'custom') return c.days * DAY;
  return (FIXED_DAYS[c.sched] || 0) * DAY;
}
/** Exercise types that produce exam questions (without the mini-game). */
export const quizTypes = c => c.types.filter(t => t !== 'game');
export const typeName = id => (RTYPES.find(t => t[0] === id) || [id, id])[1];
export const lessonOf = pointId => +String(pointId).split('-')[0] || 0;
export const inLessons = (c, pointId) => c.lessons.includes(lessonOf(pointId));
export function schedText(c) {
  if (c.sched === 'custom') return `кожні ${c.days} дн.`;
  return { auto: 'автоматично', daily: 'щодня', alt: 'через день', weekly: 'раз на тиждень' }[c.sched];
}

// ---------- storage ----------
let mem = null;
/** Can settings be kept? (localStorage writable) */
export function storageOk() {
  try { const k = GR_KEY + '.test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; }
}
export function loadConf() {
  let raw = null, text = null;
  try { text = localStorage.getItem(GR_KEY); } catch { return mem ? sanitize(mem) : fresh(); }
  if (text == null) return mem ? sanitize(mem) : fresh();
  try { raw = JSON.parse(text); } catch { raw = null; }
  const c = sanitize(raw);
  if (!isValid(raw)) { try { localStorage.setItem(GR_KEY, JSON.stringify(c)); } catch { /* keep in memory */ } }
  return c;
}
/** Save; returns false when the browser storage is unavailable (kept for this page only). */
export function saveConf(c) {
  const v = sanitize(c);
  mem = v;
  try { localStorage.setItem(GR_KEY, JSON.stringify(v)); } catch { return false; }
  try { document.dispatchEvent(new CustomEvent('kotoba:grammar-srs')); } catch { /* not in a browser */ }
  return true;
}
