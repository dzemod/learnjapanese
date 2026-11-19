// Achievements: the rule table (pure: no DOM, no storage — tests: tools/test-achievements.mjs).
// Every achievement is computed from data the site already stores (see achievements.js gatherStats), so badges that
// were earned before this feature existed unlock the first time it runs. Only the unlock dates are stored
// (localStorage jp.achievements, synced: earliest date wins).
// Fields: id (never rename — the unlock date is keyed by it), g group, jp the badge character(s), t title, d what to do,
// goal + stat (progress = min(stats[stat], goal) / goal), tier 1–3 (bronze/silver/gold), hidden = shown only when
// unlocked; event = can only unlock right after a study action (time-of-day badges).
export const GROUPS = [
  ['streak', 'Серія днів', '継'],
  ['words', 'Слова', '言'],
  ['lessons', 'Уроки', '課'],
  ['kanji', 'Канджі', '漢'],
  ['assoc', 'Асоціації', '想'],
  ['exam', 'Екзамен', '試'],
  ['habits', 'Звички', '習'],
  ['secret', 'Таємні', '秘'],
];

const A = (id, g, jp, t, d, stat, goal, tier = 1, extra = {}) => ({ id, g, jp, t, d, stat, goal, tier, ...extra });
export const ACHIEVEMENTS = [
  A('streak-3', 'streak', '三日', 'Три дні поспіль', 'Вчіться 3 дні поспіль', 'best', 3, 1),
  A('streak-7', 'streak', '一週', 'Тиждень поспіль', 'Вчіться 7 днів поспіль', 'best', 7, 1),
  A('streak-30', 'streak', '一月', 'Місяць поспіль', 'Вчіться 30 днів поспіль', 'best', 30, 2),
  A('streak-100', 'streak', '百日', 'Сто днів', 'Вчіться 100 днів поспіль', 'best', 100, 3),
  A('days-10', 'streak', '十', '10 днів навчання', 'Навчайтеся 10 різних днів', 'days', 10, 1),
  A('days-50', 'streak', '五十', '50 днів навчання', 'Навчайтеся 50 різних днів', 'days', 50, 2),
  A('days-200', 'streak', '二百', '200 днів навчання', 'Навчайтеся 200 різних днів', 'days', 200, 3),
  A('freeze-1', 'streak', '氷', 'Заморозка врятувала серію', 'Пропустіть день, коли у вас є заморозка', 'freezeUsed', 1, 1),

  A('words-10', 'words', '初', 'Перші слова', 'Вивчіть 10 слів', 'words', 10, 1),
  A('words-100', 'words', '百', '100 слів', 'Вивчіть 100 слів', 'words', 100, 1),
  A('words-500', 'words', '五百', '500 слів', 'Вивчіть 500 слів', 'words', 500, 2),
  A('words-1000', 'words', '千', '1000 слів', 'Вивчіть 1000 слів', 'words', 1000, 2),
  A('words-2000', 'words', '二千', '2000 слів', 'Вивчіть 2000 слів', 'words', 2000, 3),
  A('mine-1', 'words', '私', 'Мій урок', 'Створіть власний урок і вивчіть 10 його слів', 'mineWords', 10, 1),

  A('lesson-1', 'lessons', '一課', 'Урок пройдено', 'Вивчіть усі слова одного уроку', 'lessonsDone', 1, 1),
  A('lesson-10', 'lessons', '十課', '10 уроків', 'Вивчіть усі слова 10 уроків', 'lessonsDone', 10, 2),
  A('part-1', 'lessons', '第一部', 'Частина I', 'Вивчіть усі слова Вступного уроку й уроків 1–25', 'part1', 26, 3),
  A('part-2', 'lessons', '第二部', 'Частина II', 'Вивчіть усі слова уроків 26–50', 'part2', 25, 3),

  A('kanji-1', 'kanji', '書', 'Перший канджі', 'Напишіть канджі в режимі «Писати канджі»', 'kanjiWritten', 1, 1),
  A('kanji-50', 'kanji', '五十字', '50 канджі', 'Напишіть 50 різних канджі', 'kanjiWritten', 50, 1),
  A('kanji-300', 'kanji', '三百字', 'Початковий 300', 'Напишіть 300 різних канджі', 'kanjiWritten', 300, 2),
  A('kanji-1000', 'kanji', '千字', 'Тисяча канджі', 'Напишіть усі 1000 канджі', 'kanjiWritten', 1000, 3),
  A('kanji-known-100', 'kanji', '覚', 'Пам’ять пензля', '100 канджі з інтервалом повторення від 1 дня', 'kanjiKnown', 100, 2),
  A('kanji-easy-25', 'kanji', '易', 'Легка рука', 'Оцініть 25 канджі як «Легко»', 'kanjiEasy', 25, 1),

  A('assoc-1', 'assoc', '想', 'Перша асоціація', 'Запишіть свою асоціацію до канджі', 'notes', 1, 1),
  A('assoc-10', 'assoc', '十想', '10 асоціацій', 'Запишіть асоціації до 10 канджі', 'notes', 10, 2),
  A('assoc-50', 'assoc', '五十想', '50 асоціацій', 'Запишіть асоціації до 50 канджі', 'notes', 50, 3),

  A('exam-1', 'exam', '試', 'Перший екзамен', 'Завершіть екзамен', 'exams', 1, 1),
  A('exam-10', 'exam', '十試', '10 екзаменів', 'Завершіть 10 екзаменів', 'exams', 10, 2),
  A('exam-90', 'exam', '優', 'Відмінно', 'Отримайте 90 % або більше (від 10 питань)', 'examBest', 90, 2),
  A('exam-100', 'exam', '完璧', 'Без жодної помилки', '100 % в екзамені від 10 питань', 'examBest', 100, 3),
  A('univ-80', 'exam', '学', 'Університетська версія', 'Наберіть 80 балів в університетській версії', 'univBest', 80, 2),
  A('univ-95', 'exam', '首席', 'Найкращий у групі', 'Наберіть 95 балів в університетській версії', 'univBest', 95, 3),
  A('ts-perfect', 'exam', '訳', 'Перекладач', 'Усі речення «Переклад речень» правильно (від 5 речень)', 'tsPerfect', 1, 2),
  A('mistakes-clear', 'exam', '直', 'Робота над помилками', 'Очистіть список «Мої помилки»', 'mistakesCleared', 1, 1),

  A('today-1', 'habits', '今日', 'Перша сесія', 'Завершіть сесію «Сьогодні»', 'todayDone', 1, 1),
  A('today-10', 'habits', '毎日', '10 сесій', 'Завершіть 10 сесій «Сьогодні»', 'todayDone', 10, 2),
  A('match-1', 'habits', '合', 'На швидкість', 'Поставте рекорд у грі «Пари»', 'records', 1, 1),
  A('match-10', 'habits', '速', 'Блискавка', 'Рекорди «Пар» у 10 уроках', 'records', 10, 2),
  A('sensei-1', 'habits', '先生', 'Перше запитання', 'Отримайте відповідь Сенсея', 'sensei', 1, 1),
  A('sensei-25', 'habits', '弟子', 'Учень Сенсея', 'Отримайте 25 відповідей Сенсея', 'sensei', 25, 2),

  A('owl', 'secret', '夜', 'Нічна сова', 'Вчіться між 00:00 і 04:59', 'night', 1, 1, { hidden: true, event: true }),
  A('early', 'secret', '朝', 'Рання пташка', 'Вчіться між 05:00 і 06:59', 'early', 1, 1, { hidden: true, event: true }),
  A('comeback', 'secret', '帰', 'Повернення', 'Поверніться до навчання після перерви від 7 днів', 'comeback', 7, 1, { hidden: true }),
];

export const value = (a, stats) => Math.max(0, +stats?.[a.stat] || 0);
export const progressOf = (a, stats) => Math.min(1, value(a, stats) / a.goal);
export const isMet = (a, stats) => value(a, stats) >= a.goal;

/**
 * Newly unlocked ids. unlocked = { id: time }; ctx.event = called right after a study action (time-of-day badges
 * may unlock only then — opening the page at night is not studying at night).
 */
export function newlyUnlocked(stats, unlocked = {}, { event = false } = {}) {
  return ACHIEVEMENTS.filter(a => !unlocked[a.id] && (!a.event || event) && isMet(a, stats)).map(a => a.id);
}

/** Time-of-day stats for an action at `date`. */
export const timeStats = date => { const h = date.getHours(); return { night: h < 5 ? 1 : 0, early: h >= 5 && h < 7 ? 1 : 0 }; };

/** Merge rule for sync: union, the earliest unlock date wins (symmetric + idempotent). */
export function mergeUnlocked(a, b) {
  const o = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  a = o(a); b = o(b);
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = +a[k] || 0, y = +b[k] || 0;
    const v = x && y ? Math.min(x, y) : x || y;
    if (v) out[k] = v;
  }
  return out;
}
