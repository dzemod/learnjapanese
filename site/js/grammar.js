// Grammar tab: explanations from "IV. Граматика" + 文型 / 例文 with Ukrainian translations.
// Data: data/grammar.json → { lessons: [{ lesson, points: [{ id, title, blocks: [...] }] }] }
// point.blocks = textbook (IV. Граматика, 文型, 例文 — never changed by extra work); point.details = «Детальніше» (optional extra blocks).
// Blocks: { h } subheading · { p } paragraph · { note } note · { ex, uk, src? } example · { table: [[...]] }
// Japanese text uses furigana markup {漢字|かんじ}, shown as 漢字(かんじ).
import { $, $$, esc, I, furi, furiT, furiPlain, furiSay, furiBase, speak, norm, toast, plWord, modal } from './util.js';
import { mountAskBlock, examQuestionFor } from './ai-helper.js';
import { playOfferHTML } from './games.js';
import { gsLoad, addPoints, removePoints, grammarDue, grammarNextDue, dueAt } from './grammar-srs.js';
import { RTYPES, RTYPE_HINT, COUNTS, SCHEDS, DEFAULTS, LESSONS, loadConf, saveConf, storageOk, quizTypes, typeName, inLessons, fixedMs, schedText } from './grammar-review-conf.js';
import { fmtIvl } from './word-srs.js';

// ---------- grammar review (grammar-srs.js; questions + runner from exam.js, loaded on demand: exam.js imports this file) ----------
// Settings (gear in the panel): grammar-review-conf.js — exercise types, items per session, schedule, lessons.
const exam = () => import('./exam.js');
const PUNKT = ['пункт', 'пункти', 'пунктів'];
const pl = n => `${n} ${plWord(n, PUNKT)}`;
// «зараз» / «через 3 дн.» (from 20 h on in days, so a review due tomorrow is never «через 24 год»)
const whenTxt = t => { if (t == null) return ''; const ms = t - Date.now(); return ms <= 0 ? 'зараз' : `через ${fmtIvl(ms >= 20 * 36e5 ? Math.max(ms, 864e5) : ms)}`; };
const GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>';
const gearBtn = () => `<button type="button" class="icon-btn g-conf-btn" data-g-conf aria-label="Налаштування повторення" title="Налаштування повторення">${GEAR}</button>`;
function confLine(c) {
  const ls = c.lessons.length === LESSONS ? 'усі уроки' : c.lessons.length ? `уроків: ${c.lessons.length} з ${LESSONS}` : 'жодного уроку';
  return `<p class="muted small g-conf-line" data-g-conf-line>Вправи: ${c.types.length ? esc(c.types.map(t => typeName(t).toLowerCase()).join(', ')) : '<b>не вибрано</b>'} · ${c.count} завдань · розклад ${schedText(c)} · ${ls}</p>`;
}
const msgBox = () => '<p class="g-review-msg" data-g-msg role="status" aria-live="polite" hidden></p>';
function showMsg(root, text) { const m = $('[data-g-msg]', root); if (m) { m.textContent = text; m.hidden = !text; } }
const rangeOf = ids => { const ls = ids.map(id => +String(id).split('-')[0]).filter(Boolean); return ls.length ? [Math.min(...ls), Math.max(...ls)] : [1, 1]; };

/** Start a review of these points with the panel settings; a message in `root` when it cannot start. */
async function startReview(root, ids, name, range) {
  const c = loadConf(), qt = quizTypes(c);
  showMsg(root, '');
  if (!c.types.length) { showMsg(root, 'Оберіть хоча б один тип вправи'); return false; }
  if (!ids.length) { showMsg(root, c.lessons.length ? 'Немає пунктів граматики для вибраних уроків' : 'Оберіть хоча б один урок у налаштуваннях'); return false; }
  if (!qt.length) { location.hash = `#/play/${range[0]}-${range[1]}`; return true; } // only the mini-game is chosen
  const res = await (await exam()).startGrammarReview(ids, name, [], { types: qt, count: c.count, game: c.types.includes('game') });
  if (!res) { showMsg(root, `Для цих уроків немає завдань вибраних типів: ${qt.map(typeName).join(', ')}`); return false; }
  if (res.skipped.length) toast(`Пропущено (немає завдань для цих уроків): ${res.skipped.map(typeName).join(', ')}`, { duration: 5000 });
  return true;
}

function reviewHomeHTML() {
  const d = gsLoad(), c = loadConf(), mine = Object.keys(d).filter(id => inLessons(c, id)), due = grammarDue();
  return `<section class="panel g-review" aria-labelledby="g-rev-t"><div class="g-review-txt"><div class="g-review-head"><h2 class="sec-title" id="g-rev-t">Повторення граматики</h2>${gearBtn()}</div>
    <p class="muted small">${mine.length ? `<b data-g-due>${due.length}</b> ${plWord(due.length, PUNKT)} на повторення зараз · ${pl(mine.length)} у розкладі${!due.length ? ` · наступне ${whenTxt(grammarNextDue(mine, d))}` : ''}`
      : 'Додайте урок до повторення (кнопка внизу уроку) — його пункти повертатимуться короткими завданнями: завтра, потім через кілька днів, тижнів. Помилки з екзамену додаються самі.'}</p>
    ${confLine(c)}${msgBox()}</div>
    <div class="g-review-btns">${due.length ? `<button type="button" class="btn primary" data-g-review>Повторити ${pl(due.length)}</button>` : ''}
      <button type="button" class="btn ghost" data-g-now>Перевірити себе зараз</button></div></section>`;
}
function wireReviewHome(root) {
  const panel = $('.g-review', root);
  if (!panel) return;
  const redraw = () => { if (!panel.isConnected) return; panel.outerHTML = reviewHomeHTML(); wireReviewHome(root); };
  $('[data-g-conf]', panel).addEventListener('click', () => openReviewSettings(redraw));
  $('[data-g-review]', panel)?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    const ids = grammarDue();
    if (!(await startReview(panel, ids, 'Повторення граматики', rangeOf(ids)))) b.disabled = false;
  });
  $('[data-g-now]', panel).addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    // ignores the schedule: scheduled points of the chosen lessons (soonest first), else any points of those lessons
    const c = loadConf(), d = gsLoad(), fx = fixedMs(c);
    let ids = Object.keys(d).filter(id => inLessons(c, id)).sort((x, y) => dueAt(d[x], fx) - dueAt(d[y], fx));
    if (!ids.length && c.types.length && c.lessons.length) {
      const ok = await (await exam()).reviewablePoints();
      ids = [...ok].filter(id => inLessons(c, id)).sort(() => Math.random() - 0.5);
    }
    if (!(await startReview(panel, ids, 'Перевірка граматики', rangeOf(ids)))) b.disabled = false;
  });
}
async function drawLessonReview(slot, n, l) {
  const okIds = await (await exam()).reviewablePoints();
  if (!slot.isConnected) return;
  const ids = l.points.map(p => p.id).filter(id => okIds.has(id)), d = gsLoad(), inS = ids.filter(id => d[id]), c = loadConf();
  const offer = c.types.includes('game') ? playOfferHTML(n, n, `Прочитали урок ${n}? Міні-гра на закріплення`) : '';
  if (!ids.length) { slot.innerHTML = offer; return; }
  slot.innerHTML = `<section class="panel g-review g-review-l"><div class="g-review-txt"><div class="g-review-head"><h2 class="sec-title">Повторення граматики</h2>${gearBtn()}</div>
    <p class="muted small">${inS.length ? `У розкладі: ${inS.length} з ${pl(ids.length)} уроку · наступне повторення ${whenTxt(grammarNextDue(inS, d))}`
      : `Пункти уроку (${ids.length}) повертатимуться короткими завданнями: завтра, потім через дні й тижні. Відповіді в екзамені теж рухають розклад.`}</p>
    ${confLine(c)}${!inLessons(c, ids[0]) ? `<p class="muted small" data-g-off>Урок ${n} вимкнено в налаштуваннях: його немає в повторенні за розкладом, але перевірити себе тут можна.</p>` : ''}${msgBox()}</div>
    <div class="g-review-btns">${inS.length < ids.length ? `<button type="button" class="btn ${inS.length ? 'ghost' : 'primary'} sm" data-g-add>${inS.length ? 'Додати решту пунктів' : `Повторювати граматику уроку ${n}`}</button>` : ''}
      <button type="button" class="btn ghost sm" data-g-now>Перевірити себе зараз</button>
      ${inS.length ? '<button type="button" class="btn ghost sm" data-g-rm>Прибрати з повторення</button>' : ''}</div></section>${offer}`;
  const redraw = () => drawLessonReview(slot, n, l);
  $('[data-g-conf]', slot).addEventListener('click', () => openReviewSettings(redraw));
  $('[data-g-add]', slot)?.addEventListener('click', () => { addPoints(ids); toast(`Урок ${n} додано до повторення — перше завтра`); redraw(); });
  $('[data-g-rm]', slot)?.addEventListener('click', () => { removePoints(ids); toast(`Урок ${n} прибрано з повторення`); redraw(); });
  $('[data-g-now]', slot).addEventListener('click', async e => { const b = e.currentTarget; b.disabled = true; if (!(await startReview(slot, ids, `Урок ${n}: перевірка граматики`, [n, n]))) b.disabled = false; });
}

// ---------- the settings dialog (gear) ----------
function openReviewSettings(onSave) {
  const keep = storageOk();
  const groups = Array.from({ length: LESSONS / 10 }, (_, g) => g);
  modal(`<div class="modal-head grc-head"><h2>Налаштування повторення</h2><button type="button" class="icon-btn" data-close aria-label="Закрити">${I.close}</button></div>
    ${keep ? '' : '<p class="grc-note" data-grc-nostore>Сховище браузера недоступне — налаштування діятимуть лише до перезавантаження сторінки й не збережуться.</p>'}
    <form class="grc-form">
      <fieldset class="grc-fs"><legend>Типи вправ</legend>
        ${RTYPES.map(([id, name]) => `<label class="grc-check"><input type="checkbox" name="type" value="${id}"><span><b>${esc(name)}</b><small>${esc(RTYPE_HINT[id])}</small></span></label>`).join('')}
        <p class="grc-warn" data-grc-warn hidden>Оберіть хоча б один тип вправи</p></fieldset>
      <fieldset class="grc-fs"><legend>Завдань за сесію</legend><div class="grc-seg">
        ${COUNTS.map(n => `<label><input type="radio" name="count" value="${n}"><span>${n}</span></label>`).join('')}</div></fieldset>
      <fieldset class="grc-fs"><legend>Розклад повторень</legend>
        ${SCHEDS.map(([id, name]) => `<label class="grc-radio"><input type="radio" name="sched" value="${id}"><span>${esc(name)}</span></label>`).join('')}
        <label class="grc-days"><span>Кожні</span><input class="input" type="number" name="days" min="1" max="365" inputmode="numeric" aria-label="Інтервал, днів"><span>дн.</span></label>
        <p class="muted small">Правильна відповідь — наступне повторення через вибраний інтервал, помилка — завтра. «Автоматично» — інтервали ростуть з кожною правильною відповіддю.</p></fieldset>
      <fieldset class="grc-fs"><legend>Уроки</legend>
        <div class="grc-all"><button type="button" class="btn ghost sm" data-all>Усі</button><button type="button" class="btn ghost sm" data-none>Жодного</button></div>
        ${groups.map(g => `<div class="grc-group"><label class="grc-gl"><input type="checkbox" data-grp="${g}"><span>Уроки ${g * 10 + 1}–${g * 10 + 10}</span></label>
          <div class="grc-lessons">${Array.from({ length: 10 }, (_, i) => g * 10 + i + 1).map(n => `<label><input type="checkbox" name="lesson" value="${n}" aria-label="Урок ${n}"><span>${n}</span></label>`).join('')}</div></div>`).join('')}
        <p class="muted small">Стосується повторення за розкладом і «Перевірити себе зараз» на сторінці граматики; кнопка в уроці перевіряє саме цей урок.</p></fieldset>
      <div class="modal-btns grc-btns"><button type="button" class="btn ghost" data-reset>Скинути до стандартного</button><button class="btn primary" data-save>Зберегти</button></div>
    </form>`, (m, close) => {
    m.classList.add('sheet', 'grc');
    m.setAttribute('aria-label', 'Налаштування повторення');
    const f = $('form', m);
    const els = name => $$(`[name="${name}"]`, f);
    function sync() {
      $('[data-grc-warn]', m).hidden = els('type').some(x => x.checked);
      f.days.disabled = els('sched').find(x => x.checked)?.value !== 'custom';
      $$('[data-grp]', f).forEach(g => {
        const ls = $$('input[name="lesson"]', g.closest('.grc-group')), on = ls.filter(x => x.checked).length;
        g.checked = on === ls.length; g.indeterminate = on > 0 && on < ls.length;
      });
    }
    const fill = c => {
      els('type').forEach(x => (x.checked = c.types.includes(x.value)));
      els('count').forEach(x => (x.checked = +x.value === c.count));
      els('sched').forEach(x => (x.checked = x.value === c.sched));
      f.days.value = c.days;
      els('lesson').forEach(x => (x.checked = c.lessons.includes(+x.value)));
      sync();
    };
    const read = () => ({ v: 1, types: els('type').filter(x => x.checked).map(x => x.value), count: +(els('count').find(x => x.checked)?.value || DEFAULTS.count),
      sched: els('sched').find(x => x.checked)?.value || 'auto', days: Math.min(365, Math.max(1, Math.round(+f.days.value) || DEFAULTS.days)), lessons: els('lesson').filter(x => x.checked).map(x => +x.value) });
    f.addEventListener('change', e => {
      if (e.target.dataset.grp != null) $$('input[name="lesson"]', e.target.closest('.grc-group')).forEach(x => (x.checked = e.target.checked));
      sync();
    });
    $('[data-all]', f).onclick = () => { els('lesson').forEach(x => (x.checked = true)); sync(); };
    $('[data-none]', f).onclick = () => { els('lesson').forEach(x => (x.checked = false)); sync(); };
    $('[data-close]', m).onclick = close;
    $('[data-reset]', f).onclick = () => {
      fill(DEFAULTS);
      const ok = saveConf(DEFAULTS);
      toast(ok ? 'Відновлено стандартні налаштування' : 'Відновлено стандартні налаштування (не збережуться)');
      onSave?.();
    };
    f.onsubmit = e => {
      e.preventDefault();
      const ok = saveConf(read());
      close();
      toast(ok ? 'Налаштування повторення збережено' : 'Налаштування діятимуть до перезавантаження сторінки — сховище недоступне', { duration: ok ? 2600 : 5000 });
      onSave?.();
    };
    fill(loadConf());
  });
}

const G = { data: null, loading: null, error: false };
export function loadGrammar() {
  return (G.loading ||= fetch('data/grammar.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(j => { G.data = Array.isArray(j.lessons) ? j.lessons : []; })
    .catch(e => { console.error('Could not load data/grammar.json', e); G.data = []; G.error = true; }));
}
const byNo = n => G.data.find(l => l.lesson === n);
export const grammarLessons = () => G.data || [];
const pointsTxt = n => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? 'пункт' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'пункти' : 'пунктів'}`; };

function blockHTML(b) {
  if (b.h) return `<h4 class="g-h">${furi(b.h)}</h4>`;
  if (b.p) return `<p class="g-p">${furi(b.p)}</p>`;
  if (b.note) return `<p class="g-note">${furi(b.note)}</p>`;
  if (b.table) return `<div class="g-table-wrap"><table class="g-table">${b.table.map((r, i) => `<tr>${r.map(c => (i === 0 && b.head !== false ? `<th>${furi(c)}</th>` : `<td>${furi(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`;
  if (b.ex != null) return `<div class="g-ex">
      ${b.src ? `<span class="g-src" lang="ja">${esc(b.src)}</span>` : ''}
      <div class="g-ex-body"><div class="g-ja" lang="ja">${furi(b.ex)}</div>${b.uk ? `<div class="g-uk">${furi(b.uk)}${b.check ? ' <span class="check-badge" title="Переклад зроблено не з книжки (у перекладі інше речення) — перевірте">перевірити</span>' : ''}</div>` : ''}</div>
      <div class="g-ex-btns"><button class="icon-btn sm" data-say="${esc(furiSay(b.ex))}" aria-label="Вимова">${I.speaker}</button>
      ${/[～〜]|[Ａ-Ｚ]/.test(b.ex) ? '' : `<a class="icon-btn sm" href="#/translate/${encodeURIComponent(furiBase(b.ex))}" aria-label="Перекласти й розібрати в Перекладачі" title="Перекласти й розібрати">${I.translate}</a>`}</div>
    </div>`;
  return '';
}
const pointText = pt => [pt.title, ...[...pt.blocks, ...(pt.details || [])].flatMap(b => [b.h, b.p, b.note, b.ex, b.uk, ...(b.table || []).flat()])].filter(Boolean).map(furiPlain).join(' ');

// ---------- «Запитай ШІ»: the lesson's material for the helper (goes into its system prompt) ----------
// Plain text with readings as 漢字(かな): textbook blocks (explanation, 文型/例文 with translations) + «Детальніше».
const blockPlain = b => (b.h ? `■ ${furiPlain(b.h)}` : b.p ? furiPlain(b.p) : b.note ? `Примітка: ${furiPlain(b.note)}`
  : b.table ? b.table.map(r => r.map(furiPlain).join(' | ')).join('\n')
  : b.ex != null ? `${b.src || 'Приклад'}: ${furiPlain(b.ex)}${b.uk ? ' — ' + furiPlain(b.uk) : ''}` : '');
const pointMaterial = (n, pt, i) => [`Урок ${n}, пункт ${i + 1}: ${furiPlain(pt.title)}`, 'Підручник (IV. Граматика, 文型, 例文):', ...pt.blocks.map(blockPlain),
  ...(pt.details?.length ? ['Детальніше (додаткові пояснення на сайті):', ...pt.details.map(blockPlain)] : [])].filter(Boolean).join('\n');
const MAT_POINT = 6000, MAT_LESSON = 9000; // characters; the longest point (≈4400) and lesson (≈8000) fit whole
const capText = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** «Увесь урок» + one topic per point: { label, material (system prompt), note (what the AI sees, shown to the learner) }. */
function askTopics(n, l) {
  const all = {
    label: 'Увесь урок',
    material: capText([`Minna no Nihongo, урок ${n}. Пункти: ${l.points.map((p, i) => `${i + 1}. ${furiPlain(p.title)}`).join('; ')}`, ...l.points.map((pt, i) => pointMaterial(n, pt, i))].join('\n\n'), MAT_LESSON),
    note: `Урок ${n}, ${pointsTxt(l.points.length)}: назви, пояснення з підручника, приклади й «Детальніше».`,
  };
  return [all, ...l.points.map((pt, i) => ({
    label: `${i + 1}. ${furiPlain(pt.title)}`,
    material: capText(pointMaterial(n, pt, i), MAT_POINT),
    note: `Урок ${n}, пункт ${i + 1}: назва, пояснення з підручника, приклади${pt.details?.length ? ' й «Детальніше»' : ''}.`,
  }))];
}

function wireSay(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-say]');
    if (b) { e.preventDefault(); speak(b.dataset.say); }
  });
}

export async function grammarHome(root) {
  await loadGrammar();
  const groups = [['Частина I', '第一部', 1, 25], ['Частина II', '第二部', 26, 50]];
  const total = G.data.reduce((n, l) => n + l.points.length, 0);
  root.innerHTML = `<div class="grammar-home fade-in">
    <section class="hero"><div><p class="eyebrow" lang="ja">文法</p><h1>Граматика</h1>
      <p class="muted">${G.data.length} уроків · ${pointsTxt(total)}</p></div></section>
    ${reviewHomeHTML()}
    ${G.error ? '<div class="alert">Не вдалося завантажити <code>data/grammar.json</code>.</div>' : ''}
    <div class="home-tools"><label class="search">${I.search}<input type="search" placeholder="Пошук у граматиці: は, です, дієслово…" aria-label="Пошук у граматиці"></label></div>
    <details class="panel g-legend"><summary>Позначення</summary><dl>
      <dt>${furiT('іменник')}</dt><dd>іменник (слово-предмет: ${furi('{本|ほん}')}, ${furi('{学生|がくせい}')}, ${furi('{東京|とうきょう}')})</dd>
      <dt>${furiT('дієслово')}</dt><dd>дієслово (${furi('{行|い}きます')}, ${furi('{食|た}べます')}); форму позначено поруч: ます-форма, て-форма, ない-форма, словникова форма…</dd>
      <dt>${furiT('い-прикметник')}</dt><dd>い-прикметник (${furi('{大|おお}きい')}, ${furi('{高|たか}い')})</dd>
      <dt>${furiT('な-прикметник')}</dt><dd>な-прикметник (${furi('{元気|げんき}[な]')}, ${furi('{静|しず}か[な]')})</dd>
      <dt>${furiT('речення')}</dt><dd>речення (ціла думка з присудком)</dd>
      <dt>${furiT('іменник₁ は іменник₂')}</dt><dd>індекси <sub>1</sub> <sub>2</sub> <sub>3</sub> розрізняють слова одного типу в конструкції</dd>
      <dt lang="ja">～</dt><dd>місце для слова або частини речення</dd>
      <dt lang="ja">Ａ／Ｂ</dt><dd>варіанти: можна вжити будь-який</dd>
      <dt lang="ja">[ ]</dt><dd>частину в квадратних дужках можна пропустити</dd>
      <dt>( )</dt><dd>уточнення українською: (місце), (час), (людина)…</dd>
      <dt lang="ja">${furi('{漢字|かんじ}')}</dt><dd>читання канджі хіраганою в дужках</dd>
    </dl></details>
    <div class="g-results"></div>
    <div class="g-lessons">${groups.map(([t, jp, a, b]) => `<h2 class="group-title"><span lang="ja">${jp}</span> ${t}</h2>
      <div class="g-grid">${Array.from({ length: b - a + 1 }, (_, i) => a + i).map(n => {
        const l = byNo(n);
        return l ? `<a class="g-tile" href="#/grammar/${n}"><b>Урок ${n}</b><span class="muted small">${pointsTxt(l.points.length)}</span><span class="g-tile-t" lang="ja">${furiT(l.points[0]?.title || '')}</span></a>`
          : `<div class="g-tile off"><b>Урок ${n}</b><span class="muted small">ще не додано</span></div>`;
      }).join('')}</div>`).join('')}</div>
  </div>`;
  wireReviewHome(root);
  const res = $('.g-results', root), lessons = $('.g-lessons', root);
  $('.search input', root).oninput = e => {
    const q = norm(e.target.value);
    lessons.hidden = !!q;
    if (!q) { res.innerHTML = ''; return; }
    const hits = [];
    for (const l of G.data) for (const pt of l.points) {
      const txt = pointText(pt);
      const at = norm(txt).indexOf(q);
      if (at >= 0) hits.push({ l, pt, snip: txt });
    }
    res.innerHTML = hits.length ? `<p class="muted small">Знайдено: ${hits.length}</p><div class="g-hits">${hits.slice(0, 80).map(({ l, pt }) => `<a class="g-hit" href="#/grammar/${l.lesson}/${encodeURIComponent(pt.id)}"><span class="g-hit-l">Урок ${l.lesson}</span><span class="g-hit-t" lang="ja">${furiT(pt.title)}</span></a>`).join('')}</div>`
      : '<p class="muted center">Нічого не знайдено.</p>';
  };
}

export async function grammarLesson(root, n, pointId) {
  await loadGrammar();
  const l = byNo(n);
  const prev = G.data.filter(x => x.lesson < n).at(-1), next = G.data.find(x => x.lesson > n);
  const wordsId = `mnn-${String(n).padStart(2, '0')}`;
  if (!l) {
    root.innerHTML = `<div class="empty fade-in"><div class="empty-jp" lang="ja">文</div><p>Граматику уроку ${n} ще не додано.</p><a class="btn primary" href="#/grammar">Уся граматика</a></div>`;
    return;
  }
  root.innerHTML = `<div class="grammar-lesson fade-in">
    <a class="back" href="#/grammar">${I.back}<span>Уся граматика</span></a>
    <div class="set-head"><div><p class="eyebrow" lang="ja">第${n}課</p><h1 class="set-title">Урок ${n} — граматика</h1>
      <p class="muted">${pointsTxt(l.points.length)} · IV. Граматика, 文型 і 例文</p></div>
      <div class="set-actions"><a class="btn ghost sm" href="#/set/${wordsId}"><span lang="ja">言葉</span><span>Слова уроку</span></a>
      <button class="btn ghost sm" data-toggle>Згорнути все</button></div></div>
    <div class="g-cards">${l.points.map((pt, i) => `<details class="g-card" id="g-${esc(pt.id)}" open>
      <summary><span class="g-num">${i + 1}</span><span class="g-title" lang="ja">${furiT(pt.title)}</span><span class="g-chev" aria-hidden="true"></span></summary>
      <div class="g-body">${pt.blocks.map(blockHTML).join('')}${pt.details?.length ? `<details class="g-more"><summary>Детальніше</summary><div class="g-more-body">${pt.details.map(blockHTML).join('')}</div></details>` : ''}</div></details>`).join('')}</div>
    <div class="g-review-slot"></div>
    <div class="g-pager">${prev ? `<a class="btn ghost" href="#/grammar/${prev.lesson}">${I.left}<span>Урок ${prev.lesson}</span></a>` : '<span></span>'}
      ${next ? `<a class="btn ghost" href="#/grammar/${next.lesson}"><span>Урок ${next.lesson}</span>${I.right}</a>` : '<span></span>'}</div>
  </div>`;
  const lessonEl = $('.grammar-lesson', root);
  const pi = pointId ? l.points.findIndex(p => p.id === pointId) : -1;
  const ask = mountAskBlock(lessonEl, { kind: 'grammar', logKey: `jp.ask.grammar.${n}`, topics: askTopics(n, l), topic: pi + 1, context: examQuestionFor(n) });
  lessonEl.insertBefore(ask, $('.g-pager', lessonEl)); // at the bottom of the lesson content, above the lesson pager
  drawLessonReview($('.g-review-slot', root), n, l);
  wireSay($('.grammar-lesson', root)); // the lesson node is new on every render → one listener, never stacked on #app
  const tg = $('[data-toggle]', root);
  tg.onclick = () => {
    const anyOpen = $$('.g-card', root).some(d => d.open);
    $$('.g-card', root).forEach(d => (d.open = !anyOpen));
    tg.textContent = anyOpen ? 'Розгорнути все' : 'Згорнути все';
  };
  if (pointId) {
    const el = document.getElementById('g-' + pointId);
    if (el) { el.open = true; el.classList.add('hl'); setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
  }
}
