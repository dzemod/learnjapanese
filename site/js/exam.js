// "Екзамен" tab: exam setup, presets, mixed question session, results, history and weak spots.
// Data: data/exam.json (pre-built bank: particles, verb forms, translations, error finding — every item has an
// explanation from IV. Граматика and a lesson/point reference) + words (sets.json), grammar.json, kanji.json.
// Everything runs in the browser; the only things sent anywhere are the optional preset sync to GitHub and
// questions the learner chooses to send to the AI helper (ai-helper.js → Puter.js in the browser).
import { $, $$, esc, shuffle, furi, furiT, furiPlain, gtext, furiSay, speak, norm, toast, I, check as checkWord, today } from './util.js';
import { state, getSets, markPresetsPending, registerPresetsPayload, syncAll } from './store.js';
import { loadGrammar, grammarLessons } from './grammar.js';
import { loadKanji, books as kanjiBooks, lessonWords } from './kanji.js';
import { conjugate, explainConj, detectForm, FORMS, formsUpTo } from './conjugate.js';
import { preKana, checkSentence, verdictOf, VERDICT, normJa, KANJI_RE } from './sentcheck.js';
import { ensureTokenizer, tokenize, onTokProgress, tokProgressText } from './tokenizer.js';
import { loadScript } from './importer.js';
import { addAskButton, mountAskBlock, contextText, htmlText } from './ai-helper.js';
import { paperView, paperResult, newPaper, availability as univAvail, SECTIONS as UNIV_SECTIONS, univGroups } from './exam-univ.js';

const K = { presets: 'jp.examPresets', history: 'jp.examHistory', session: 'jp.examSession', ret: 'jp.examReturn', mistakes: 'jp.examMistakes', romaji: 'jp.exam.romaji' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };
const sload = k => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
const ssave = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export const TYPES = {
  p: 'Частки', v: 'Форми дієслів', c: 'Відмінювання (дріл)', tj: 'Переклад: японська → українська', tu: 'Переклад: українська → японська (збери речення)',
  w: 'Слова', k: 'Канджі', g: 'Вибір граматики', l: 'Аудіювання', e: 'Пошук помилки',
  ts: 'Переклад речень: українська → японська (напишіть)',
  wt: 'Слово: напиши сам(а)',
};
// setup groups (checkboxes); names that must fit two lines of a card
const TYPE_SHORT = { ts: 'Напишіть речення: українська → японська' };
const TYPE_GROUPS = [['Граматика', ['p', 'v', 'c', 'g', 'e', 'tj', 'tu', 'ts']], ['Слова', ['w', 'wt', 'l']], ['Канджі', ['k']]];
// hints of «Переклад речень» and how much they lower the score
const HINTS = { w: ['Слова', 0.15], g: ['Граматика', 0.1], f: ['Перша частина', 0.25] };
// hint of «Слово: напиши сам(а)» (the first kana) and how much it lowers the score
const WT_HINT = 0.25;
const PARTICLES = ['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'の', 'から', 'まで', 'や', 'か', 'よ', 'ね'];
// What each particle does, summarised from IV. Граматика (used to explain a wrong choice).
const PART_GEN = {
  'は': 'тема речення (урок 1)', 'が': 'підмет з あります／います, わかります, すきです… (уроки 9, 10), «але» (урок 8)',
  'を': 'прямий додаток (урок 6), місце руху (урок 23), вихідне місце (урок 13)', 'に': 'час (урок 4), адресат (урок 7), місцезнаходження (урок 10), мета (урок 13)',
  'で': 'місце дії (урок 6), транспорт (урок 5), знаряддя чи спосіб (урок 7)', 'へ': 'напрямок руху (урок 5)',
  'と': '«і» між іменниками (урок 4), «разом з» (урок 5), цитата (урок 21)', 'も': '«також» (урок 1)', 'の': 'поєднує два іменники (уроки 1, 2)',
  'から': '«з» (час, місце — урок 4), причина (урок 9)', 'まで': '«до» (урок 4)', 'や': 'неповний перелік (урок 10)', 'か': 'питання (урок 1)',
  'よ': 'нова інформація (урок 5)', 'ね': 'сподівання на згоду (урок 4)',
};

let data = { bank: null, univ: null, remotePresets: [] };
async function loadAll() {
  await Promise.all([
    loadGrammar(), loadKanji(),
    data.bank ? null : fetch('data/exam.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { lessons: [] })).then(j => (data.bank = j.lessons || [])).catch(() => (data.bank = [])),
    data.univ ? null : fetch('data/exam-univ.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { lessons: [] })).then(j => (data.univ = j.lessons || [])).catch(() => (data.univ = [])),
    fetch('data/exam-presets.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { presets: [] })).then(j => (data.remotePresets = j.presets || [])).catch(() => {}),
  ]);
}

// ---------- presets (browser + GitHub through /api/save-set) ----------
const DEFAULT = { name: '', univ: false, part: 'I', from: 1, to: 25, mine: false, kanji: false, kbook: 'k300', kmode: 'lessons', kfrom: 1, kto: 2, krand: 30, types: Object.keys(TYPES), count: 20, mock: false, timer: 0 };
export function presets() {
  const local = load(K.presets, []);
  const names = new Set(local.map(p => p.name));
  return [...local, ...data.remotePresets.filter(p => !names.has(p.name) && !(load(K.presets + '.deleted', [])).includes(p.name))];
}
registerPresetsPayload(() => presets());
function savePreset(p) {
  const list = load(K.presets, []).filter(x => x.name !== p.name);
  list.unshift(p);
  save(K.presets, list);
  save(K.presets + '.deleted', load(K.presets + '.deleted', []).filter(n => n !== p.name));
  markPresetsPending();
  syncAll().then(r => toast(r.ok ? 'Пресет збережено в GitHub ✓' : 'Пресет збережено в цьому браузері'));
}
function deletePreset(name) {
  save(K.presets, load(K.presets, []).filter(x => x.name !== name));
  save(K.presets + '.deleted', [...new Set([...load(K.presets + '.deleted', []), name])]);
  markPresetsPending();
  syncAll();
}

// ---------- references ----------
const plainT = s => String(s || '').replace(/\{([^|}]+)\|[^}]+\}/g, '$1');
const gLesson = n => grammarLessons().find(l => l.lesson === n);
const gref = (pointId, lesson) => {
  const l = pointId ? +String(pointId).split('-')[0] : lesson;
  return { kind: 'g', lesson: l, point: pointId || null };
};
export function refText(r) {
  if (!r) return '';
  if (r.kind === 'g') {
    const L = gLesson(r.lesson), i = L ? L.points.findIndex(p => p.id === r.point) : -1;
    return `Minna no Nihongo, Урок ${r.lesson}` + (i >= 0 ? ` · Граматика, пункт ${i + 1} «${plainT(L.points[i].title)}»` : ' · Граматика');
  }
  if (r.kind === 'k') return `漢字 ${r.book === 'k700' ? '中級700' : '初級300'} · ${r.lno}課 · №${r.no} ${r.ch}`;
  if (r.kind === 'w') return `${r.title} · Нові слова`;
  return '';
}
const refUrl = r => (r.kind === 'g' ? `#/grammar/${r.lesson}${r.point ? '/' + encodeURIComponent(r.point) : ''}` : r.kind === 'k' ? `#/kanji/${r.lessonId}/${r.kanjiId}` : `#/set/${encodeURIComponent(r.setId)}`);
const refShort = r => (r.kind === 'g' ? `Урок ${r.lesson}${r.point && gLesson(r.lesson) ? ', пункт ' + (gLesson(r.lesson).points.findIndex(p => p.id === r.point) + 1) : ''}` : r.kind === 'k' ? `${r.lno}課 №${r.no} ${r.ch}` : r.title);
function refBtn(r, label) { return r ? `<button type="button" class="ex-ref" data-ref='${esc(JSON.stringify(r))}'>${I.back.replace('M19 12H5M11 6l-6 6 6 6', 'M5 12h14M13 6l6 6-6 6')}<span>${gtext(label || refText(r))}</span></button>` : ''; }
// «Додати до помилок»: questions kept on this device to repeat later (setup → «Повторити збережені помилки»)
const savedMistakes = () => load(K.mistakes, []);
function addSavedMistake(q) { save(K.mistakes, [q, ...savedMistakes().filter(x => x.uid !== q.uid)].slice(0, 100)); }
/** askOf(button) → the AI helper's context of the question the link belongs to; the grammar page's «Запитай ШІ»
 *  shows it while «Повернутися до екзамену» is active (ai-helper.js examQuestionFor). */
function wireRefs(root, askOf = null) {
  $$('[data-ref]', root).forEach(b => (b.onclick = () => {
    const r = JSON.parse(b.dataset.ref);
    let ask = '';
    try { ask = (r.kind === 'g' && askOf?.(b)) || ''; } catch (e) { console.error('ask context', e); }
    ssave(K.ret, { at: Date.now(), lesson: r.kind === 'g' ? r.lesson : null, ask });
    location.hash = refUrl(r);
  }));
}
/** Floating "back to exam" button on other pages (called by app.js on every route). */
export function returnButton(view) {
  let b = document.getElementById('exam-return');
  const active = sload(K.ret) && sload(K.session) && view !== 'exam';
  if (!active) { b?.remove(); return; }
  if (!b) {
    b = document.createElement('button');
    b.id = 'exam-return';
    b.className = 'btn primary exam-return';
    b.innerHTML = `${I.back}<span>Повернутися до екзамену</span>`;
    b.onclick = () => { const s = sload(K.session); ssave(K.ret, null); location.hash = s && (s.univ ? s.done : s.i >= s.qs.length) ? '#/exam/result' : '#/exam/run'; };
    document.body.append(b);
  }
}

// ---------- building the question pool ----------
const lessonRange = c => { const out = []; for (let l = Math.max(1, +c.from); l <= Math.min(50, +c.to); l++) out.push(l); return out; };
function wordCards(c) {
  const ls = new Set(lessonRange(c));
  const sets = getSets().filter(s => { const m = /^mnn-(\d+)$/.exec(s.id); return (m && ls.has(+m[1])) || (c.mine && s.source !== 'textbook'); });
  return sets.flatMap(s => s.cards.filter(cd => cd.japanese && cd.ukrainian && cd.section !== 'reading').map(cd => ({ ...cd, setId: s.id, setTitle: s.title, lesson: +(/^mnn-(\d+)$/.exec(s.id)?.[1] || 0) })));
}
function kanjiPool(c) {
  if (!c.kanji) return [];
  const b = kanjiBooks().find(x => x.id === c.kbook);
  if (!b) return [];
  let ks = b.lessons.flatMap(l => l.kanji.map(k => ({ ...k, lesson: l, book: b.id })));
  if (c.kmode === 'lessons') ks = ks.filter(k => k.lesson.no >= +c.kfrom && k.lesson.no <= +c.kto);
  else if (c.kmode === 'nums') ks = ks.filter(k => k.no >= +c.kfrom && k.no <= +c.kto);
  else ks = shuffle(ks).slice(0, Math.max(1, +c.krand || 20));
  return ks;
}
const bankItems = (c, t) => (data.bank || []).filter(l => lessonRange(c).includes(l.lesson)).flatMap(l => l.items.filter(i => i.t === t));
const kref = k => ({ kind: 'k', book: k.book, lessonId: k.lesson.id, kanjiId: k.id, lno: k.lesson.no, no: k.no, ch: k.kanji });
const wref = cd => ({ kind: 'w', setId: cd.setId, title: cd.setTitle });
const wordHTML = cd => `<span lang="ja">${esc(cd.japanese)}${cd.reading && cd.reading !== cd.japanese ? `<span class="fg">(${esc(cd.reading)})</span>` : ''}</span>`;
const pick = (arr, n, avoid = []) => shuffle(arr.filter(x => !avoid.includes(x))).slice(0, n);
const uniq = a => [...new Set(a)];

/** Count available questions per type for the setup screen. */
function availability(c) {
  const words = wordCards(c), ks = kanjiPool(c), verbs = words.filter(w => w.verbGroup && /ます$/.test(w.japanese));
  return {
    p: bankItems(c, 'p').length, v: bankItems(c, 'v').length, e: bankItems(c, 'e').length, g: bankItems(c, 'v').length,
    tj: bankItems(c, 'tr').length, tu: bankItems(c, 'tr').filter(okTiles).length, w: words.length, c: Math.max(0, +c.to >= 14 ? verbs.length : 0),
    k: ks.length, l: words.length + bankItems(c, 'tr').length, ts: bankItems(c, 'ts').length, wt: words.length,
  };
}
const okTiles = it => !/……|：|:/.test(it.ja) && it.ja.split(' ').length >= 3 && it.ja.split(' ').length <= 9;

function build(c) {
  const types = uniq([...c.types, ...(c.mock ? ['ts', 'wt'] : [])]).filter(t => TYPES[t]); // the full mock exam always has sentence translation + typed words
  const n = c.mock ? 60 : +c.count || 20;
  const words = wordCards(c), ks = kanjiPool(c);
  const verbs = words.filter(w => w.verbGroup && /ます$/.test(w.japanese) && conjugate(w.japanese, w.verbGroup, 'te'));
  const maxL = Math.max(...lessonRange(c));
  const pools = {
    p: () => qParticle(balancedPick(bankItems(c, 'p'), 'a')),
    v: () => qVerb(pickOne(bankItems(c, 'v'))),
    e: () => qError(pickOne(bankItems(c, 'e'))),
    g: () => qGrammar(pickOne(bankItems(c, 'v')), maxL),
    tj: () => qTransJ(pickOne(bankItems(c, 'tr')), bankItems(c, 'tr')),
    tu: () => qTiles(pickOne(bankItems(c, 'tr').filter(okTiles))),
    w: () => qWord(pickOne(words), words),
    wt: () => qWordType(pickOne(words), words),
    c: () => qConj(pickOne(verbs), maxL),
    k: () => qKanji(pickOne(ks), ks),
    l: () => qListen(words, bankItems(c, 'tr')),
    ts: () => qSent(balancedPick(bankItems(c, 'ts'), 'pt')),
  };
  const usable = types.filter(t => { try { return availability(c)[t] > 0; } catch { return false; } });
  const out = [], seen = new Set();
  let guard = 0;
  while (out.length < n && usable.length && guard++ < n * 30) {
    const t = usable[out.length % usable.length];
    let q = null;
    try { q = pools[t](); } catch (e) { console.warn(e); }
    if (!q || seen.has(q.uid)) continue;
    seen.add(q.uid);
    out.push(q);
  }
  return shuffle(out);
}
const pickOne = a => (a.length ? a[(Math.random() * a.length) | 0] : null);
/** Pick so that rare particles appear as often as は／を (one random particle first, then an item). */
function balancedPick(items, key) {
  const groups = {};
  items.forEach(i => (groups[i[key]] ||= []).push(i));
  return pickOne(groups[pickOne(Object.keys(groups))] || []);
}

// ---------- question builders (plain data → session is serialisable) ----------
const sentHTML = (pre, mid, post) => `<div class="ex-sent" lang="ja">${furi(pre)}${mid}${furi(post)}</div>`;
function qParticle(it) {
  if (!it) return null;
  const opts = shuffle([it.a, ...pick(PARTICLES, 3, [it.a, ...(it.alt || [])])]);
  return {
    uid: it.id, type: 'p', mode: 'choice', lesson: it.l, ref: gref(it.pt), weak: it.a, label: 'Вставте пропущену частку',
    prompt: sentHTML(it.pre, '<span class="ex-blank">（　）</span>', it.post) + `<div class="ex-uk">${esc(it.uk)}</div>`,
    options: opts.map(o => ({ v: o, h: `<span lang="ja">${esc(o)}</span>` })), answer: it.a,
    correct: sentHTML(it.pre, `<b class="ex-hl">${esc(it.a)}</b>`, it.post), x: it.x, say: furiSay(it.pre + it.a + it.post),
    src: it.src ? `${it.src}, урок ${it.l}` : `урок ${it.l}`,
  };
}
// The form named in a task: the form is the question there, but its bracketed note would give the answer away
// («вольова форма (～よう)» → «вольова форма»).
const formName = f => FORMS[f].label.replace(/\s*\([^)]*\)/g, '');
function qVerb(it) {
  if (!it) return null;
  const f = FORMS[it.f];
  return {
    uid: it.id, type: 'v', mode: 'type', lesson: it.l, ref: gref(it.pt), weak: f.label, label: 'Напишіть дієслово у потрібній формі',
    prompt: sentHTML(it.pre, `<span class="ex-blank">（${furi(it.base)} → ？）</span>`, it.post) + `<div class="ex-uk">${esc(it.uk)}</div>`,
    answers: [plainT(it.a), it.ak], answer: plainT(it.a), verb: { base: plainT(it.base), kana: it.base.replace(/\{([^|}]+)\|([^}]+)\}/g, '$2'), g: it.g, f: it.f },
    correct: sentHTML(it.pre, `<b class="ex-hl">${furi(it.a)}</b>`, it.post), x: it.x, link2: it.spt !== it.pt ? gref(it.spt) : null, say: furiSay(it.pre + it.a + it.post),
    src: it.src ? `${it.src}, урок ${it.l}` : `урок ${it.l}`,
  };
}
function qGrammar(it, maxL) {
  if (!it) return null;
  const base = plainT(it.base), kana = it.base.replace(/\{([^|}]+)\|([^}]+)\}/g, '$2');
  const alts = uniq(['te', 'ta', 'nai', 'dict', 'tara', 'temo', 'nakatta'].filter(f => f !== it.f && FORMS[f].lesson <= maxL).map(f => conjugate(base, it.g, f)).concat([base]).filter(Boolean)).filter(x => x !== plainT(it.a));
  if (alts.length < 2) return null;
  const opts = shuffle([plainT(it.a), ...shuffle(alts).slice(0, 3)]);
  return {
    uid: 'g' + it.id, type: 'g', mode: 'choice', lesson: it.l, ref: gref(it.spt || it.pt), weak: FORMS[it.f].label, label: 'Виберіть правильну форму для речення',
    prompt: sentHTML(it.pre, '<span class="ex-blank">（　　）</span>', it.post) + `<div class="ex-uk">${esc(it.uk)}</div>`,
    options: opts.map(o => ({ v: o, h: `<span lang="ja">${esc(o)}</span>` })), answer: plainT(it.a), verb: { base, kana, g: it.g, f: it.f },
    correct: sentHTML(it.pre, `<b class="ex-hl">${furi(it.a)}</b>`, it.post), x: it.x, link2: gref(it.pt), src: `урок ${it.l}`,
  };
}
function qError(it) {
  if (!it) return null;
  const chunks = [];
  const pre = it.pre.split(' ').filter(Boolean), post = it.post.split(' ').filter(Boolean);
  pre.forEach((c, i) => chunks.push({ h: c, glue: i === pre.length - 1 && !/ $/.test(it.pre) }));
  const wi = chunks.length;
  chunks.push({ h: it.w, bad: true, glue: !/^ /.test(it.post) });
  post.forEach(c => chunks.push({ h: c }));
  return {
    uid: it.id, type: 'e', mode: 'error', lesson: it.l, ref: gref(it.pt), weak: it.k === 'p' ? it.a : FORMS[it.f]?.label || '',
    label: 'Знайдіть помилку: торкніться неправильного слова й виправте його', kind: it.k, chunks, wrong: wi,
    prompt: `<div class="ex-uk">${esc(it.uk)}</div>`, answer: plainT(it.a), answers: [plainT(it.a), it.ak].filter(Boolean),
    options: it.k === 'p' ? shuffle([it.a, ...pick(PARTICLES, 3, [it.a, it.w, ...(it.alt || [])])]).map(o => ({ v: o, h: o })) : null,
    correct: sentHTML(it.pre, `<b class="ex-hl">${furi(it.a)}</b>`, it.post), x: `Помилка: «${it.w}» → правильно «${plainT(it.a)}». ${it.x}`, src: `урок ${it.l}`,
  };
}
function qTransJ(it, pool) {
  if (!it) return null;
  const others = uniq(pool.filter(o => o.uk !== it.uk).map(o => o.uk));
  const ds = uniq([...(it.d || []), ...pick(others, 3)]).filter(d => d !== it.uk).slice(0, 3);
  const L = gLesson(it.l), p = L?.points.find(x => x.id === it.pt);
  return {
    uid: it.id, type: 'tj', mode: 'choice', self: true, lesson: it.l, ref: gref(it.pt), weak: plainT(p?.title || ''), label: 'Виберіть правильний переклад або напишіть свій',
    prompt: `<div class="ex-sent" lang="ja">${furi(it.ja)}</div>`, options: shuffle([it.uk, ...ds]).map(o => ({ v: o, h: esc(o) })), answer: it.uk,
    correct: `<div lang="ja">${furi(it.ja)}</div><div>${esc(it.uk)}</div>`,
    x: `Речення ілюструє конструкцію «${plainT(p?.title || '')}»${it.src ? ` (${it.src})` : ''}. Переклад — з розділу «II. Переклад»${it.src ? '' : ' / IV. Граматика'}.`, say: furiSay(it.ja), src: `урок ${it.l}`,
  };
}
function qTiles(it) {
  if (!it) return null;
  const parts = it.ja.split(' ').filter(Boolean);
  const L = gLesson(it.l), p = L?.points.find(x => x.id === it.pt);
  return {
    uid: 'u' + it.id, type: 'tu', mode: 'tiles', lesson: it.l, ref: gref(it.pt), weak: plainT(p?.title || ''), label: 'Складіть японське речення з плиток',
    prompt: `<div class="ex-big-uk">${esc(it.uk)}</div>`, tiles: shuffle(parts.map((h, i) => ({ h, i }))), answer: parts.join(' '),
    correct: `<div lang="ja">${furi(it.ja)}</div>`, x: `Порядок слів: присудок у кінці речення; частки стоять після слів, до яких належать. Конструкція «${plainT(p?.title || '')}».`, say: furiSay(it.ja), src: `урок ${it.l}`,
  };
}
// «Переклад речень»: the learner types the whole Japanese sentence (checked by sentcheck.js)
/** Markup {漢字|かな} with the plain-text span [a, b) wrapped in a highlight (spans never cut a furigana group). */
function markupHL(mk, hl) {
  if (!hl) return furi(mk);
  const parts = [[], [], []]; // before, construction, after (offsets count plain text without spaces)
  const re = /\{([^{}|]+)\|[^{}]+\}|[^]/g;
  let pos = 0, m;
  while ((m = re.exec(mk))) {
    const t = m[1] || m[0];
    if (t === ' ') { parts[pos <= hl[0] ? 0 : pos >= hl[1] ? 2 : 1].push(m[0]); continue; }
    const a = pos;
    pos += t.length;
    parts[pos <= hl[0] ? 0 : a >= hl[1] ? 2 : 1].push(m[0]);
  }
  return `${furi(parts[0].join(''))}<b class="ex-hl">${furi(parts[1].join(''))}</b>${furi(parts[2].join(''))}`;
}
const pointOf = id => { const L = gLesson(+String(id).split('-')[0]); const i = L ? L.points.findIndex(p => p.id === id) : -1; return i >= 0 ? { p: L.points[i], n: i + 1, l: L.lesson } : null; };
const mnnRef = id => { const r = pointOf(id); return r ? `Minna no Nihongo, Урок ${r.l}, п. ${r.n}` : ''; };
function qSent(it) {
  if (!it) return null;
  const P = pointOf(it.pt);
  const title = P ? plainT(P.p.title) : '';
  const firstP = P?.p.blocks.find(b => b.p)?.p || '';
  return {
    uid: it.id, type: 'ts', mode: 'sent', lesson: it.l, ref: gref(it.pt), weak: title, label: 'Перекладіть речення японською: канджі або каною',
    prompt: `<div class="ex-big-uk">${esc(it.uk)}</div>`, answer: plainT(it.ja),
    it: { k: it.k, alt: it.alt || [], w: it.w || [], hl: it.hl || null, ja: it.ja, pt: it.pt, title: P?.p.title || '' },
    correct: `<div class="ex-sent" lang="ja">${markupHL(it.ja, it.hl)}</div>`, say: furiSay(it.ja),
    x: `Речення тренує конструкцію «${title}»${it.src && it.src !== 'Детальніше' ? ` (${it.src})` : ''}.${firstP ? ' ' + furiPlain(firstP).slice(0, 260) + (firstP.length > 260 ? '…' : '') : ''}`,
    src: it.src ? `${it.src}, урок ${it.l}` : `урок ${it.l}`,
  };
}
const ISSUE_ORDER = { particle: 0, form: 1, word: 2, missing: 3, extra: 4, order: 5, empty: 6 };
function issueHTML(i) {
  const j = x => `<span lang="ja">${esc(x)}</span>`;
  if (i.kind === 'particle') return `<b>Частка:</b> потрібна «${j(i.exp)}», а не «${j(i.got)}». ${PART_GEN[i.exp] ? `${j(i.exp)} — ${esc(PART_GEN[i.exp])}` : ''}${PART_GEN[i.got] ? `; ${j(i.got)} — ${esc(PART_GEN[i.got])}` : ''}.`;
  if (i.kind === 'form') return `<b>Форма:</b> потрібно «${j(i.exp)}» (${j(i.expK)}), а у вас «${j(i.got)}». Перевірте час, ввічливість і заперечення.`;
  if (i.kind === 'word') return `<b>Слово:</b> замість «${j(i.got)}» потрібно «${j(i.exp)}»${i.expK && i.expK !== i.exp ? ` (${j(i.expK)})` : ''}.`;
  if (i.kind === 'missing') return i.cls === 'p' ? `<b>Пропущено частку</b> «${j(i.exp)}»${PART_GEN[i.exp] ? ` — ${esc(PART_GEN[i.exp])}` : ''}.` : `<b>Пропущено:</b> «${j(i.exp)}»${i.expK && i.expK !== i.exp ? ` (${j(i.expK)})` : ''}.`;
  if (i.kind === 'extra') return `<b>Зайве:</b> «${j(i.got)}» — у еталоні цього немає.`;
  if (i.kind === 'order') return `<b>Порядок слів:</b> «${j(i.exp)}» стоїть не на своєму місці. У японському реченні присудок — у кінці, частка — одразу після слова, до якого належить.`;
  return 'Відповіді немає.';
}
/** Verb/adjective + auxiliaries (し+まし+た) → one chip for display; status = mixed → «інша форма». */
function groupToks(toks) {
  const out = [];
  for (const t of toks) {
    const last = out[out.length - 1];
    if (last && t.cls === 'x' && 'vax'.includes(last.cls || '-')) { last.s += t.s; if (last.st !== t.st) last.st = last.st === 'miss' && t.st === 'miss' ? 'miss' : 'part'; }
    else out.push({ ...t });
  }
  return out;
}
/** Coloured comparison + explanations (feedback and results page). */
function sentResultHTML(q, r) {
  const c = r.chk || {};
  const v = r.over ? 'ok' : c.verdict || 'bad';
  const pct = Math.round((r.pts ?? (r.ok ? 1 : 0)) * 100);
  const used = (r.hints || []).map(h => `${HINTS[h][0]} (−${HINTS[h][1] * 100}%)`);
  const toks = groupToks(c.toks || []).map(t => `<span class="sc-t sc-${t.st}" title="${{ ok: 'правильно', part: 'неправильна форма', miss: 'пропущено', order: 'не на своєму місці' }[t.st] || ''}">${esc(t.s)}</span>`).join('');
  const user = (c.user || []).map(u => `<span class="sc-u sc-${u.st}">${esc(u.t)}</span>`).join('');
  const issues = [...(c.issues || [])].sort((a, b) => ISSUE_ORDER[a.kind] - ISSUE_ORDER[b.kind]);
  return `<div class="feedback ${v === 'ok' ? 'good' : v === 'almost' ? 'almost' : 'bad'}">${VERDICT[v]} · ${pct}%${r.over ? ' <small>(ви позначили як правильну)</small>' : ''}</div>
    ${used.length ? `<p class="small muted">Підказки: ${esc(used.join(', '))}</p>` : ''}
    ${r.given ? `<div class="ex-given-ja">Ваша відповідь: <span lang="ja">${esc(r.given)}</span></div>` : ''}
    ${user ? `<div class="sc-row"><span class="muted small">Як прочитано (каною):</span><div class="sc-line" lang="ja">${user}</div></div>` : ''}
    ${toks ? `<div class="sc-row"><span class="muted small">Слова еталона:</span><div class="sc-line" lang="ja">${toks}</div>
      <p class="sc-legend small"><span class="sc-t sc-ok">правильно</span> <span class="sc-t sc-part">інша форма</span> <span class="sc-t sc-miss">пропущено</span> <span class="sc-t sc-order">порядок</span></p></div>` : ''}
    <div class="ex-correct"><span class="muted small">Еталон:</span> ${q.correct}<button type="button" class="icon-btn sm" data-say-c aria-label="Прослухати еталон">${I.speaker}</button></div>
    <p class="small"><span class="muted">Конструкція:</span> <b>${furiT(q.it.title)}</b> — <span class="ex-hl">виділено</span> в еталоні.</p>
    ${issues.length && v !== 'ok' || issues.length && pct < 100 ? `<ul class="sc-issues">${issues.map(i => `<li>${issueHTML(i)}</li>`).join('')}</ul>` : ''}
    <div class="ex-expl"><p>${gtext(q.x || '')}</p></div>`;
}
/** Result block of «Слово: напиши сам(а)» (feedback and results page). */
function wtResultHTML(q, r) {
  const pct = Math.round((r.pts ?? (r.ok ? 1 : 0)) * 100);
  return `<div class="feedback ${r.ok ? 'good' : 'bad'}">${r.ok ? 'Правильно!' : 'Неправильно'}${r.ok && pct < 100 ? ` · ${pct}%` : ''}${r.over ? ' <small>(ви позначили як правильну)</small>' : ''}</div>
    ${(r.hints || []).includes('k') ? `<p class="small muted">Підказка: перша кана (−${WT_HINT * 100}%)</p>` : ''}
    ${r.given ? `<div class="ex-given-ja">Ваша відповідь: ${r.ok ? '' : '<s>'}<span lang="ja">${esc(r.given)}</span>${r.ok ? '' : '</s>'}</div>` : '<div class="ex-given muted">Без відповіді</div>'}
    <div class="ex-correct"><span class="muted small">Правильна відповідь:</span> ${q.correct}<button type="button" class="icon-btn sm" data-say-c aria-label="Прослухати слово">${I.speaker}</button></div>
    <div class="ex-expl"><p>${gtext(q.x || '')}</p></div>`;
}
function qWord(cd, pool) {
  if (!cd) return null;
  const dir = Math.random() < 0.5 ? 'ja' : 'uk', typing = Math.random() < 0.4;
  const others = pick(pool.filter(o => o.id !== cd.id && o.ukrainian !== cd.ukrainian && o.japanese !== cd.japanese), 3);
  const base = { uid: 'w' + cd.setId + cd.id + dir, type: 'w', lesson: cd.lesson, ref: wref(cd), weak: cd.japanese, card: { japanese: cd.japanese, reading: cd.reading, ukrainian: cd.ukrainian }, say: cd.reading || cd.japanese, src: cd.setTitle };
  const x = `${cd.japanese}${cd.reading && cd.reading !== cd.japanese ? `(${cd.reading})` : ''} — ${cd.ukrainian}${cd.verbGroup ? `, дієслово ${cd.verbGroup} групи` : ''}${cd.hint ? ` ${cd.hint}` : ''}.`;
  const correct = `${wordHTML(cd)} — ${esc(cd.ukrainian)}`;
  if (dir === 'ja') return { ...base, mode: typing ? 'type' : 'choice', side: 'uk', label: typing ? 'Напишіть значення українською' : 'Виберіть значення', prompt: `<div class="ex-word">${wordHTML(cd)}</div>`, options: shuffle([cd, ...others]).map(o => ({ v: o.ukrainian, h: esc(o.ukrainian) })), answer: cd.ukrainian, correct, x };
  return { ...base, mode: typing ? 'type' : 'choice', side: 'ja', label: typing ? 'Напишіть японською: канджі або каною' : 'Виберіть японське слово', prompt: `<div class="ex-big-uk">${esc(cd.ukrainian)}</div>`, options: shuffle([cd, ...others]).map(o => ({ v: o.japanese, h: wordHTML(o) })), answer: cd.japanese, correct, x };
}
/** «Слово: напиши сам(а)»: Ukrainian → the learner types the Japanese word (kanji or kana; verbs: ます-form or dictionary form). */
function qWordType(cd, pool) {
  if (!cd) return null;
  // every word of the chosen lessons with the same Ukrainian meaning is accepted too
  const same = pool.filter(o => o.ukrainian.trim() === cd.ukrainian.trim());
  const cards = [];
  for (const o of same) {
    cards.push({ japanese: o.japanese, reading: o.reading });
    if (o.verbGroup && /ます$/.test(o.japanese)) {
      const d1 = conjugate(o.japanese, o.verbGroup, 'dict'), d2 = o.reading ? conjugate(o.reading, o.verbGroup, 'dict') : '';
      if (d1) cards.push({ japanese: d1, reading: d2 && d2 !== d1 ? d2 : '' });
    }
  }
  const kana = (cd.reading || cd.japanese).replace(/^[～〜~（(\s]+/, '');
  const dict = cd.verbGroup && /ます$/.test(cd.japanese) ? conjugate(cd.japanese, cd.verbGroup, 'dict') : '';
  const dictK = dict && cd.reading ? conjugate(cd.reading, cd.verbGroup, 'dict') : '';
  return {
    uid: 'wt' + cd.setId + cd.id, type: 'wt', mode: 'wtype', lesson: cd.lesson, ref: wref(cd), weak: cd.japanese, src: cd.setTitle,
    label: 'Напишіть японське слово: канджі або каною',
    prompt: `<div class="ex-big-uk">${esc(cd.ukrainian)}</div>${cd.verbGroup ? `<div class="ex-uk">дієслово, ${cd.verbGroup} група · можна ます-форму або словникову</div>` : ''}`,
    cards, answer: cd.japanese, first: kana.charAt(0), say: cd.reading || cd.japanese,
    correct: `${wordHTML(cd)}${dict ? ` <span class="muted small">· словникова форма</span> <span lang="ja">${esc(dict)}${dictK && dictK !== dict ? `<span class="fg">(${esc(dictK)})</span>` : ''}</span>` : ''}`,
    x: `${cd.japanese}${cd.reading && cd.reading !== cd.japanese ? `(${cd.reading})` : ''} — ${cd.ukrainian}${cd.verbGroup ? `, дієслово ${cd.verbGroup} групи` : ''}${cd.hint ? ` ${cd.hint}` : ''}.`,
  };
}
function qConj(cd, maxL) {
  if (!cd) return null;
  const bad = /^(あります|わかります|できます|いります)$/.test(cd.reading || cd.japanese);
  const forms = formsUpTo(maxL).filter(f => !(bad && ['pot', 'vol', 'imp', 'proh', 'pass', 'caus'].includes(f)));
  const f = pickOne(forms);
  const kana = cd.reading || cd.japanese;
  const a1 = conjugate(cd.japanese, cd.verbGroup, f), a2 = conjugate(kana, cd.verbGroup, f);
  if (!a1 || !a2) return null;
  const fp = FORMS[f].point;
  return {
    uid: 'c' + cd.setId + cd.id + f, type: 'c', mode: 'type', lesson: cd.lesson, ref: fp && gLesson(+fp.split('-')[0]) ? gref(fp) : gref(null, FORMS[f].lesson), weak: FORMS[f].label,
    label: `Поставте дієслово у форму: ${formName(f)}`, prompt: `<div class="ex-word">${wordHTML(cd)}</div><div class="ex-uk">${esc(cd.ukrainian)} · група ${cd.verbGroup}</div>`,
    answers: [a1, a2], answer: a1 === a2 ? a1 : `${a1} (${a2})`, verb: { base: cd.japanese, kana, g: cd.verbGroup, f },
    correct: `<span lang="ja">${esc(a1)}${a1 !== a2 ? `<span class="fg">(${esc(a2)})</span>` : ''}</span>`, x: explainConj(kana, cd.verbGroup, f), link2: wref(cd), src: cd.setTitle, say: a2,
  };
}
function qKanji(k, pool) {
  if (!k) return null;
  const sub = pickOne(['read', 'mean', 'pick', 'ctx']);
  const exs = (k.examples || []).filter(e => e.word && e.kana && /[一-鿿]/.test(e.word) && !/～/.test(e.word));
  const e = pickOne(exs);
  const base = { type: 'k', lesson: 0, ref: kref(k), weak: k.kanji, src: refText(kref(k)) };
  const kx = `${k.kanji}: он ${k.on.join('、') || '—'}; кун ${k.kun.join('、') || '—'}; значення: ${k.meaning}.`;
  if (sub === 'mean' || !e) {
    const others = pick(pool.filter(o => o.id !== k.id && o.meaning !== k.meaning), 3);
    return { ...base, uid: 'km' + k.id, mode: 'choice', label: 'Що означає цей канджі?', prompt: `<div class="ex-kanji" lang="ja">${esc(k.kanji)}</div>`,
      options: shuffle([k, ...others]).map(o => ({ v: o.meaning, h: esc(o.meaning) })), answer: k.meaning, correct: `<span lang="ja">${esc(k.kanji)}</span> — ${esc(k.meaning)}`, x: kx, say: k.kun[0]?.replace(/[-.]/, '') || k.on[0] };
  }
  const wordsAll = pool.flatMap(o => (o.examples || []).filter(x => x.word !== e.word && /[一-鿿]/.test(x.word) && !/～/.test(x.word)));
  const ex = `${e.word}(${e.kana}) — ${e.uk}. ${kx}`;
  if (sub === 'read') return { ...base, uid: 'kr' + e.id, mode: 'type', label: 'Напишіть читання хіраганою', prompt: `<div class="ex-kanji word" lang="ja">${esc(e.word)}</div><div class="ex-uk">${esc(e.uk)}</div>`, answers: e.kana.split('／'), answer: e.kana, correct: `<span lang="ja">${esc(e.word)}<span class="fg">(${esc(e.kana)})</span></span>`, x: ex, say: e.kana.split('／')[0] };
  if (sub === 'ctx') {
    const sent = findContext(e.word);
    if (sent) {
      const shown = sent.replace(new RegExp(`\\{${e.word}\\|([^}]+)\\}`), '<b class="ex-hl">$1</b>');
      const opts = shuffle([e, ...pick(wordsAll.filter(w => w.kana !== e.kana), 3)]);
      return { ...base, uid: 'kc' + e.id, mode: 'choice', label: 'Виберіть, як записати виділене слово канджі', prompt: `<div class="ex-sent" lang="ja">${furi(shown)}</div>`, options: opts.map(o => ({ v: o.word, h: `<span lang="ja">${esc(o.word)}</span>` })), answer: e.word, correct: `<span lang="ja">${esc(e.word)}<span class="fg">(${esc(e.kana)})</span></span>`, x: ex };
    }
  }
  const opts = shuffle([e, ...pick(wordsAll.filter(w => w.kana !== e.kana && w.word.length === e.word.length), 3).concat(pick(wordsAll, 3)).filter((w, i, a) => a.findIndex(z => z.word === w.word) === i).slice(0, 3)]);
  return { ...base, uid: 'kp' + e.id, mode: 'choice', label: 'Виберіть правильний запис канджі', prompt: `<div class="ex-word" lang="ja">${esc(e.kana)}</div><div class="ex-uk">${esc(e.uk)}</div>`, options: opts.map(o => ({ v: o.word, h: `<span lang="ja">${esc(o.word)}</span>` })), answer: e.word, correct: `<span lang="ja">${esc(e.word)}<span class="fg">(${esc(e.kana)})</span></span>`, x: ex, say: e.kana };
}
function findContext(word) {
  for (const L of shuffle(grammarLessons())) for (const p of L.points) for (const b of p.blocks) if (b.ex && b.ex.includes(`{${word}|`) && !/[×→]/.test(b.ex)) return b.ex;
  return null;
}
function qListen(words, tr) {
  if (Math.random() < 0.5 && tr.length) {
    const it = pickOne(tr);
    const q = qTransJ(it, tr);
    return { ...q, uid: 'l' + it.id, type: 'l', self: false, label: 'Послухайте речення і виберіть переклад', prompt: '<div class="ex-listen"><button type="button" class="btn primary listen-play" data-play>▶ Прослухати</button><button type="button" class="btn ghost sm" data-slow>Повільно</button></div>' };
  }
  const cd = pickOne(words);
  if (!cd) return null;
  const others = pick(words.filter(o => o.ukrainian !== cd.ukrainian), 3);
  return { uid: 'lw' + cd.setId + cd.id, type: 'l', mode: 'choice', lesson: cd.lesson, ref: wref(cd), weak: cd.japanese, label: 'Послухайте слово і виберіть значення',
    prompt: '<div class="ex-listen"><button type="button" class="btn primary listen-play" data-play>▶ Прослухати</button><button type="button" class="btn ghost sm" data-slow>Повільно</button></div>',
    options: shuffle([cd, ...others]).map(o => ({ v: o.ukrainian, h: esc(o.ukrainian) })), answer: cd.ukrainian, correct: `${wordHTML(cd)} — ${esc(cd.ukrainian)}`, x: `${cd.japanese}${cd.reading ? `(${cd.reading})` : ''} — ${cd.ukrainian}.`, say: cd.reading || cd.japanese, src: cd.setTitle };
}

// ---------- answer checking + explanations of wrong answers ----------
const kataToHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const njp = s => kataToHira(norm(s)).replace(/\s+/g, '');
function judge(q, given) {
  if (q.mode === 'choice') return given === q.answer;
  if (q.mode === 'tiles') return given === q.answer;
  if (q.type === 'w') return checkWord(given, q.card, q.side).ok;
  if (q.type === 'wt') return q.cards.some(cd => checkWord(given, cd, 'ja').ok);
  return (q.answers || [q.answer]).some(a => a && njp(a) === njp(given));
}
function whyWrong(q, given) {
  if (!given) return '';
  if (q.type === 'p' || (q.type === 'e' && q.kind === 'p')) return PART_GEN[given] ? `Ви вибрали «${given}»: ${given} — це ${PART_GEN[given]}. Тут потрібна «${q.answer}».` : '';
  if (q.verb) {
    const f = detectForm(q.verb.base, q.verb.g, given, q.verb.kana);
    if (f === 'masu') return `«${given}» — це ввічлива ます-форма, а потрібна ${FORMS[q.verb.f].label}.`;
    if (f && f !== q.verb.f) return `«${given}» — це ${FORMS[f].label}, а тут потрібна ${FORMS[q.verb.f].label}.`;
    if (!f) return `«${given}» не є правильною формою дієслова ${q.verb.base}.`;
  }
  return '';
}

/** What the AI helper sees about an answered question (read only). */
function askContext(q, a) {
  const options = q.mode === 'choice' || q.mode === 'error' ? (q.options || []).map(o => htmlText(o.h)) : q.mode === 'tiles' ? q.tiles.map(t => plainT(t.h)) : [];
  return contextText({
    section: TYPES[q.type], lesson: q.lesson ? String(q.lesson) : q.src,
    question: [q.label, htmlText(q.prompt), q.chunks ? q.chunks.map(c => plainT(c.h)).join(' ') : ''].filter(Boolean).join(' — '),
    options, given: plainT(a?.given), correct: htmlText(q.correct), ok: !!a?.ok, point: refText(q.ref), note: plainT(q.x),
  });
}

// ---------- session ----------
let S = null; // { conf, qs, i, res: [{ok, given}], start, deadline }
const persist = () => ssave(K.session, S);

export async function examView(root, sub) {
  root.innerHTML = '<div class="loading"><span class="sun pulse"></span></div>';
  await loadAll();
  S = S || sload(K.session);
  if (S?.univ) {
    if (sub === 'run' && !S.done) return paperView(root, univCtx());
    if ((sub === 'run' || sub === 'result') && S.done) return paperResult(root, univCtx());
    return setupView(root);
  }
  if (sub === 'run' && S && S.i < S.qs.length) return runView(root);
  if (sub === 'result' && S) return resultView(root);
  return setupView(root);
}

/** What the paper test (exam-univ.js) needs from this module. */
function startUniv(conf) {
  const paper = newPaper(data.univ, data.bank, conf);
  if (!paper.sections.some(x => x.blanks)) return false;
  S = { univ: true, conf: { ...conf }, paper, ua: {}, over: {}, qs: [], i: 0, res: [], start: Date.now(), deadline: conf.timer ? Date.now() + conf.timer * 60000 : 0 };
  persist();
  return true;
}
const univCtx = () => ({
  session: () => S, persist,
  load: (k, d) => load(K[k], d), save: (k, v) => save(K[k], v),
  refBtn, wireRefs, gref, mnnRef, pointOf, partGen: PART_GEN,
  again: () => { if (startUniv(S.conf)) location.hash = '#/exam/run'; },
});

// ---------- setup ----------
function setupView(root) {
  const last = load(K.presets + '.last', null);
  let c = { ...DEFAULT, ...(last || {}) };
  if (!c.tsAdded) { c.types = uniq([...c.types, 'ts']); c.tsAdded = true; }
  if (!c.wtAdded) { c.types = uniq([...c.types, 'wt']); c.wtAdded = true; }
  const draw = () => {
    const av = availability(c);
    const uav = univAvail(data.univ, data.bank, +c.from, +c.to);
    const kb = kanjiBooks();
    const hist = load(K.history, []);
    root.innerHTML = `<div class="exam fade-in">
      <section class="hero"><div><p class="eyebrow" lang="ja">試験</p><h1>Екзамен</h1><p class="muted">Підготовка до екзамену: частки, форми дієслів, переклад, слова, канджі.</p></div></section>
      ${S?.univ && !S.done ? `<div class="sync-box"><div><b>Є незавершена університетська версія</b> — уроки ${S.conf.from}–${S.conf.to}.</div><div class="sync-btns"><a class="btn sm primary" href="#/exam/run">Продовжити</a><button class="btn sm ghost" data-drop>Скасувати</button></div></div>` : ''}
      ${S && !S.univ && S.i < S.qs.length ? `<div class="sync-box"><div><b>Є незавершений екзамен</b> — питання ${S.i + 1} з ${S.qs.length}.</div><div class="sync-btns"><a class="btn sm primary" href="#/exam/run">Продовжити</a><button class="btn sm ghost" data-drop>Скасувати</button></div></div>` : ''}
      ${presets().length ? `<section class="panel"><h2 class="sec-title">Мої екзамени</h2><div class="ex-presets">${presets().map(p => `<div class="ex-preset"><button class="btn ghost sm" data-load="${esc(p.name)}">${esc(p.name)}</button><button class="icon-btn sm" data-del="${esc(p.name)}" aria-label="Видалити">${I.trash}</button></div>`).join('')}</div></section>` : ''}
      <form class="panel ex-setup">
        <h2 class="sec-title">Слова і граматика</h2>
        <div class="ex-row">
          <div class="seg" data-part>${[['I', 'Частина I'], ['II', 'Частина II'], ['all', 'Усі']].map(([v, t]) => `<button type="button" class="${c.part === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>
          <label class="ex-range">Уроки з <input class="input" type="number" name="from" min="1" max="50" value="${c.from}" inputmode="numeric"> по <input class="input" type="number" name="to" min="1" max="50" value="${c.to}" inputmode="numeric"></label>
        </div>
        <label class="check"><input type="checkbox" name="mine" ${c.mine ? 'checked' : ''}><span>Додати «Мої уроки» (слова)</span></label>

        <h2 class="sec-title">Канджі</h2>
        <label class="check"><input type="checkbox" name="kanji" ${c.kanji ? 'checked' : ''}><span>Включити канджі</span></label>
        <div class="ex-kanji-opts" ${c.kanji ? '' : 'hidden'}>
          <div class="seg" data-kbook>${kb.map(b => `<button type="button" class="${c.kbook === b.id ? 'on' : ''}" data-v="${b.id}" ${b.lessons.length ? '' : 'disabled'}>${esc(b.title)}</button>`).join('')}</div>
          <div class="seg" data-kmode>${[['lessons', 'За 課'], ['nums', 'За номерами'], ['rand', 'N випадкових']].map(([v, t]) => `<button type="button" class="${c.kmode === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>
          ${c.kmode === 'rand' ? `<label class="ex-range">Кількість <input class="input" type="number" name="krand" min="1" max="700" value="${c.krand}" inputmode="numeric"></label>`
            : `<label class="ex-range">${c.kmode === 'lessons' ? 'Уроки (課)' : 'Номери №'} з <input class="input" type="number" name="kfrom" min="1" value="${c.kfrom}" inputmode="numeric"> по <input class="input" type="number" name="kto" min="1" value="${c.kto}" inputmode="numeric"></label>`}
        </div>

        <h2 class="sec-title">Типи завдань</h2>
        <label class="ex-univ ${c.univ ? 'on' : ''}"><input type="checkbox" name="univ" ${c.univ ? 'checked' : ''}><span class="ex-univ-icon" aria-hidden="true">🎓</span><span class="ex-univ-text"><b>Університетська версія</b><small>Як паперовий тест <span lang="ja">復習</span>: 7 розділів, 100 балів, одна сторінка, «Перевірити» в кінці.</small></span><span class="ex-switch" aria-hidden="true"></span></label>
        ${c.univ ? `<ol class="ex-univ-list">${UNIV_SECTIONS.map(x => `<li class="${uav[x.s] ? '' : 'off'}"><span>${esc(x.title)}</span><small class="muted">${x.pts} б. · у банку ${uav[x.s]}</small></li>`).join('')}</ol>` : ''}
        <div class="ex-types ${c.univ ? 'off' : ''}">${TYPE_GROUPS.map(([g, ks]) => `<div class="ex-tgroup-wrap"><h3 class="ex-tgroup">${g}</h3><div class="ex-tgrid">${ks.map(k => {
    const noKanji = k === 'k' && !av.k;
    return `<label class="check ex-tcard"><input type="checkbox" value="${k}" ${c.types.includes(k) ? 'checked' : ''} ${c.univ || noKanji ? 'disabled' : ''}><span class="ex-tbody"><span class="ex-tname">${TYPE_SHORT[k] || TYPES[k]}</span>${noKanji ? '<small class="ex-thint">Оберіть книжку та діапазон канджі вище</small>' : `<small class="muted ex-tcount">${av[k] || 0}</small>`}</span></label>`;
  }).join('')}</div></div>`).join('')}</div>

        <h2 class="sec-title">Обсяг і час</h2>
        <div class="ex-row">
          ${c.univ ? '<p class="muted small ex-fixed">Обсяг фіксований: 100 балів (кількість питань залежить від уроків).</p>' : `<div class="seg" data-count>${[10, 20, 30, 50].map(v => `<button type="button" class="${!c.mock && +c.count === v ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}<button type="button" class="${c.mock ? 'on' : ''}" data-v="mock">Повний пробний (60)</button></div>`}
          <label class="ex-range">Таймер (хвилин) <input class="input" type="number" name="timer" min="0" max="180" value="${c.timer || 0}" inputmode="numeric"> <small class="muted">0 — без таймера</small></label>
        </div>
        <div class="ex-start">
          <button type="button" class="btn ghost" data-save>${I.download}<span>Зберегти як пресет</span></button>
          <button class="btn primary" data-start>Почати екзамен</button>
        </div>
      </form>
      ${savedMistakes().length ? `<section class="panel"><h2 class="sec-title">Збережені помилки</h2><p class="muted small">Питання, які ви позначили кнопкою «Додати до помилок» (на цьому пристрої).</p><div class="btn-row"><button type="button" class="btn primary sm" data-saved>Повторити мої помилки (${savedMistakes().length})</button><button type="button" class="btn ghost sm" data-saved-clear>Очистити</button></div></section>` : ''}
      ${historyHTML(hist)}
    </div>`;
    wire();
  };
  const read = () => {
    const f = $('.ex-setup', root);
    c.from = Math.max(1, Math.min(50, +f.from.value || 1)); c.to = Math.max(c.from, Math.min(50, +f.to.value || c.from));
    c.univ = f.univ.checked; c.mine = f.mine.checked; c.kanji = f.kanji.checked; c.timer = Math.max(0, +f.timer.value || 0);
    if (f.kfrom) { c.kfrom = +f.kfrom.value || 1; c.kto = Math.max(c.kfrom, +f.kto.value || c.kfrom); }
    if (f.krand) c.krand = +f.krand.value || 20;
    c.types = $$('.ex-types input:checked', root).map(i => i.value);
  };
  const wire = () => {
    const segs = { part: v => { c.part = v; if (v === 'I') { c.from = 1; c.to = 25; } else if (v === 'II') { c.from = 26; c.to = 50; } else { c.from = 1; c.to = 50; } },
      kbook: v => { c.kbook = v; c.kfrom = 1; c.kto = 2; }, kmode: v => (c.kmode = v), count: v => { if (v === 'mock') c.mock = true; else { c.mock = false; c.count = +v; } } };
    for (const [k, fn] of Object.entries(segs)) $(`[data-${k}]`, root)?.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; read(); fn(b.dataset.v); draw(); });
    $('.ex-setup', root).addEventListener('change', e => { if (e.target.name === 'kanji' || e.target.name === 'univ' || e.target.closest('.ex-types') || ['from', 'to', 'kfrom', 'kto', 'krand', 'mine'].includes(e.target.name)) { read(); draw(); } });
    $('[data-drop]', root)?.addEventListener('click', () => { S = null; persist(); draw(); });
    $('[data-saved]', root)?.addEventListener('click', () => { S = { conf: { ...c, name: 'Мої помилки', timer: 0 }, qs: shuffle(savedMistakes()), i: 0, res: [], start: Date.now(), deadline: 0, answered: null }; persist(); location.hash = '#/exam/run'; });
    $('[data-saved-clear]', root)?.addEventListener('click', () => { if (confirm('Очистити збережені помилки?')) { save(K.mistakes, []); draw(); } });
    $$('[data-load]', root).forEach(b => (b.onclick = () => { c = { ...DEFAULT, ...presets().find(p => p.name === b.dataset.load) }; draw(); toast(`Завантажено: ${c.name}`); }));
    $$('[data-del]', root).forEach(b => (b.onclick = () => { if (confirm(`Видалити пресет «${b.dataset.del}»?`)) { deletePreset(b.dataset.del); draw(); } }));
    $('[data-save]', root).onclick = () => {
      read();
      const name = prompt('Назва екзамену', c.name || `Екзамен ${today()}`);
      if (!name || !name.trim()) return;
      c.name = name.trim();
      savePreset({ ...c });
      draw();
    };
    $('.ex-setup', root).onsubmit = e => {
      e.preventDefault();
      read();
      save(K.presets + '.last', c);
      if (c.univ) {
        if (!startUniv(c)) return toast('Для вибраних уроків немає завдань');
        location.hash = '#/exam/run';
        return;
      }
      if (!c.types.length) return toast('Виберіть хоча б один тип завдань');
      const qs = build(c);
      if (!qs.length) return toast('Для вибраних уроків немає завдань цих типів');
      S = { conf: { ...c }, qs, i: 0, res: [], start: Date.now(), deadline: c.timer ? Date.now() + c.timer * 60000 : 0, answered: null };
      persist();
      location.hash = '#/exam/run';
    };
    wireHistory(root);
  };
  draw();
}

// ---------- running ----------
function runView(root, api) {
  let timerId = null;
  const draw = () => {
    if (S.i >= S.qs.length) return finish();
    const q = S.qs[S.i];
    const ans = S.answered; // { given, ok } if this question was answered (e.g. after visiting a reference)
    root.innerHTML = `<div class="exam-run fade-in">
      <div class="ex-top"><a class="icon-btn" href="#/exam" aria-label="Вийти">${I.close}</a>
        <div class="ex-progress"><div class="bar"><i style="width:${(S.i / S.qs.length) * 100}%"></i></div><span>${S.i + 1} / ${S.qs.length}</span></div>
        <span class="ex-timer"></span></div>
      <div class="ex-q">
        <div class="ex-type">${TYPES[q.type]}<span class="muted"> · ${esc(q.src || '')}</span></div>
        <div class="q-label">${esc(q.label)}</div>
        <div class="ex-prompt">${q.prompt}${q.say && !['l', 'k', 'wt'].includes(q.type) ? `<button type="button" class="icon-btn sm ex-say" data-say aria-label="Вимова">${I.speaker}</button>` : ''}</div>
        <div class="ex-answer"></div>
        <div class="ex-feedback"></div>
      </div></div>`;
    mountAskBlock($('.exam-run', root));
    $$('[data-play], [data-say]', root).forEach(b => (b.onclick = () => speak(q.say)));
    $('[data-slow]', root)?.addEventListener('click', () => speak(q.say, true));
    renderAnswer(q, $('.ex-answer', root), ans);
    if (ans) feedback(q, ans.given, ans.ok);
    tick();
  };
  const tick = () => {
    clearInterval(timerId);
    const el = $('.ex-timer', root);
    if (!S.deadline || !el) return;
    const up = () => {
      const left = Math.max(0, S.deadline - Date.now());
      el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      el.classList.toggle('low', left < 60000);
      if (!left) { clearInterval(timerId); toast('Час вийшов'); finish(); }
    };
    up();
    timerId = setInterval(up, 1000);
  };
  const submit = (q, given, okOverride) => {
    if (S.answered) return;
    const ok = okOverride ?? judge(q, given);
    S.answered = { given, ok };
    persist();
    feedback(q, given, ok);
  };
  const feedback = (q, given, ok) => {
    if (q.mode === 'sent') return feedbackSent(q);
    if (q.mode === 'wtype') return feedbackWT(q);
    $$('.ex-answer button, .ex-answer input, .ex-answer textarea', root).forEach(b => (b.disabled = true));
    $$('.ex-answer .choice', root).forEach(b => { if (b.dataset.v === q.answer) b.classList.add('correct'); else if (b.dataset.v === given && !ok) b.classList.add('wrong'); });
    const why = ok ? '' : whyWrong(q, given);
    $('.ex-feedback', root).innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}">${ok ? 'Правильно!' : 'Неправильно'}</div>
      ${!ok && given ? `<div class="ex-given">Ваша відповідь: <s lang="ja">${furi(given)}</s></div>` : ''}
      <div class="ex-correct"><span class="muted small">Правильна відповідь:</span> ${q.correct}</div>
      <div class="ex-expl">${why ? `<p class="ex-why">${gtext(why)}</p>` : ''}<p>${gtext(q.x || '')}</p></div>
      <div class="ex-refs">${refBtn(q.ref)}${q.link2 ? refBtn(q.link2) : ''}</div>
      <button class="btn primary wide" data-next>Далі <kbd>Enter</kbd></button>`;
    wireRefs(root, () => askContext(q, S.answered));
    const next = () => { S.res[S.i] = S.answered; S.answered = null; S.i++; persist(); draw(); window.scrollTo(0, 0); };
    $('[data-next]', root).onclick = next;
    addAskButton($('.ex-feedback', root), () => askContext(q, S.answered), $('[data-next]', root));
    $('[data-next]', root).focus({ preventScroll: true });
    $('.ex-feedback', root).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  // ----- «Переклад речень» -----
  const hintsOf = () => (S.hints ||= {})[S.i] || [];
  function hintHTML(q, h) {
    if (h === 'w') return `<div class="ex-hint"><b>Слова:</b> ${[...q.it.w].sort().map(w => `<span class="chip" lang="ja">${furi(w)}</span>`).join(' ') || '—'}</div>`;
    if (h === 'g') return `<div class="ex-hint"><b>Граматика:</b> ${furiT(q.it.title)} <span class="muted small">(${esc(mnnRef(q.it.pt))})</span></div>`;
    const toks = q.it.k.filter(t => t[2] !== 's'), total = toks.reduce((a, t) => a + t[0].length, 0);
    let n = 0, out = '';
    for (const t of toks) { if (n >= total / 3 && out) break; out += /[㐀-鿿々〆]/.test(t[0]) ? `${esc(t[0])}<span class="fg">(${esc(t[1])})</span>` : esc(t[0]); n += t[0].length; }
    return `<div class="ex-hint"><b>Перша частина:</b> <span lang="ja">${out}…</span></div>`;
  }
  async function bindRomaji(inp, on) {
    try {
      if (on) { await loadScript('https://cdn.jsdelivr.net/npm/wanakana@5.3.1/wanakana.min.js'); window.wanakana.bind(inp, { IMEMode: true }); }
      else if (window.wanakana && inp.dataset.wk) window.wanakana.unbind(inp);
      inp.dataset.wk = on ? '1' : '';
    } catch { toast('Не вдалося завантажити перетворювач ромаджі'); }
  }
  async function checkSent(q, given) {
    if (S.answered) return;
    const models = [q.it.k, ...(q.it.alt || [])];
    const pre = preKana(given, models);
    let kana = pre.text;
    const fb = $('.ex-feedback', root);
    $$('.ex-answer button, .ex-answer textarea', root).forEach(b => (b.disabled = true));
    if (pre.kanjiLeft) {
      // kanji that are not in the model answer → readings from Kuromoji (Web Worker, dictionary cached)
      fb.innerHTML = '<p class="muted small"><span class="spinner"></span> Перевіряю…</p>';
      const off = onTokProgress(st => { if (st.phase === 'download' || st.phase === 'build') fb.innerHTML = `<p class="muted small"><span class="spinner"></span> ${esc(tokProgressText(st).text)}</p>`; });
      try {
        const toks = await Promise.race([tokenize(kana), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000))]);
        kana = normJa(toks.map(t => (KANJI_RE.test(t.surface_form) ? t.reading || t.surface_form : t.surface_form)).join(''));
      } catch { /* compare without readings of unknown kanji */ }
      off();
    }
    if (S.answered || q !== S.qs[S.i]) return;
    const r = checkSentence(kana, models);
    const hints = hintsOf();
    const pts = Math.max(0, r.score - hints.reduce((a, h) => a + HINTS[h][1], 0));
    const verdict = r.verdict; // correctness; hints lower only the points
    S.answered = { given, ok: verdict === 'ok', pts, hints, chk: { verdict, score: r.score, toks: r.toks.map(t => ({ s: t.s, st: t.st, cls: t.cls })), user: r.user, issues: r.issues } };
    persist();
    feedbackSent(q);
  }
  function feedbackSent(q) {
    const a = S.answered;
    $$('.ex-answer button, .ex-answer textarea, .ex-answer input', root).forEach(b => (b.disabled = true));
    $('.ex-feedback', root).innerHTML = `${sentResultHTML(q, a)}
      <div class="ex-refs">${refBtn(q.ref, mnnRef(q.it.pt))}</div>
      <div class="btn-row ex-own">${a.ok ? '' : '<button type="button" class="btn ghost sm" data-right>Я мав(ла) рацію</button>'}
        <button type="button" class="btn ghost sm" data-flag ${a.flag ? 'disabled' : ''}>${a.flag ? 'Додано до помилок ✓' : 'Додати до помилок'}</button></div>
      <button class="btn primary wide" data-next>Далі <kbd>Enter</kbd></button>`;
    wireRefs(root, () => askContext(q, S.answered));
    $('[data-say-c]', root).onclick = () => speak(q.say);
    $('[data-right]', root)?.addEventListener('click', () => { Object.assign(S.answered, { ok: true, pts: 1, over: true }); persist(); feedbackSent(q); });
    $('[data-flag]', root).onclick = () => { S.answered.flag = true; persist(); addSavedMistake(q); feedbackSent(q); toast('Додано до помилок — їх можна повторити окремо'); };
    const next = () => { S.res[S.i] = S.answered; S.answered = null; S.i++; persist(); draw(); window.scrollTo(0, 0); };
    $('[data-next]', root).onclick = next;
    addAskButton($('.ex-feedback', root), () => askContext(q, S.answered), $('[data-next]', root));
    $('[data-next]', root).focus({ preventScroll: true });
    $('.ex-feedback', root).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function renderSent(q, el, ans) {
    const romaji = load(K.romaji, false);
    const used = ans ? ans.hints || [] : hintsOf();
    const ph = on => (on ? 'Латиницею: kyouto he ikimasu' : '日本語で…');
    el.innerHTML = `<form class="write-form ex-sentform" autocomplete="off">
        <label class="check sm ex-romaji"><input type="checkbox" data-romaji ${romaji ? 'checked' : ''}><span>Ромаджі → кана</span></label>
        <textarea class="answer-input" lang="ja" rows="2" placeholder="${ph(romaji)}" aria-label="Ваш переклад японською" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></textarea>
        <div class="ex-hints"><span class="muted small">Підказки (знижують оцінку):</span>${Object.entries(HINTS).map(([h, [t, p]]) => `<button type="button" class="btn ghost sm" data-hint="${h}" ${used.includes(h) ? 'disabled' : ''}>${t} −${p * 100}%</button>`).join('')}</div>
        <div class="ex-hint-out">${used.map(h => hintHTML(q, h)).join('')}</div>
        <div class="write-btns"><button type="button" class="btn ghost" data-dk>Не знаю</button><button class="btn primary">Перевірити</button></div></form>`;
    const inp = $('textarea', el), box = $('[data-romaji]', el);
    if (ans) { inp.value = ans.given || ''; return; }
    if (romaji) bindRomaji(inp, true);
    box.onchange = () => { save(K.romaji, box.checked); inp.placeholder = ph(box.checked); bindRomaji(inp, box.checked); inp.focus(); };
    inp.addEventListener('focus', () => ensureTokenizer().catch(() => {}), { once: true });
    setTimeout(() => inp.focus({ preventScroll: true }), 80);
    $$('[data-hint]', el).forEach(b => (b.onclick = () => {
      const h = b.dataset.hint, list = ((S.hints ||= {})[S.i] ||= []);
      if (!list.includes(h)) list.push(h);
      persist();
      b.disabled = true;
      $('.ex-hint-out', el).innerHTML = list.map(x => hintHTML(q, x)).join('');
    }));
    const go = () => {
      let v = inp.value.trim();
      // romaji mode: wanakana leaves a final «n» (and unfinished syllables) in Latin until the next key → convert all
      if (box.checked && window.wanakana && /[a-z]/i.test(v)) { v = window.wanakana.toKana(v.toLowerCase()); inp.value = v; }
      if (v) checkSent(q, v);
    };
    $('form', el).onsubmit = e => { e.preventDefault(); go(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); go(); } });
    $('[data-dk]', el).onclick = () => {
      S.answered = { given: '', ok: false, pts: 0, hints: hintsOf(), chk: { verdict: 'bad', score: 0, toks: q.it.k.filter(t => t[2] !== 's').map(t => ({ s: t[0], st: 'miss', cls: t[2] })), user: [], issues: [{ kind: 'empty' }] } };
      persist();
      feedbackSent(q);
    };
  }
  // ----- «Слово: напиши сам(а)» -----
  function feedbackWT(q) {
    const a = S.answered;
    $$('.ex-answer button, .ex-answer input', root).forEach(b => (b.disabled = true));
    $('.ex-feedback', root).innerHTML = `${wtResultHTML(q, a)}
      <div class="ex-refs">${refBtn(q.ref)}</div>
      <div class="btn-row ex-own">${a.ok ? '' : '<button type="button" class="btn ghost sm" data-right>Я мав(ла) рацію</button>'}
        <button type="button" class="btn ghost sm" data-flag ${a.flag ? 'disabled' : ''}>${a.flag ? 'Додано до помилок ✓' : 'Додати до помилок'}</button></div>
      <button class="btn primary wide" data-next>Далі <kbd>Enter</kbd></button>`;
    wireRefs(root, () => askContext(q, S.answered));
    $('[data-say-c]', root).onclick = () => speak(q.say);
    $('[data-right]', root)?.addEventListener('click', () => { Object.assign(S.answered, { ok: true, pts: 1, over: true }); persist(); feedbackWT(q); });
    $('[data-flag]', root).onclick = () => { S.answered.flag = true; persist(); addSavedMistake(q); feedbackWT(q); toast('Додано до помилок — їх можна повторити окремо'); };
    const next = () => { S.res[S.i] = S.answered; S.answered = null; S.i++; persist(); draw(); window.scrollTo(0, 0); };
    $('[data-next]', root).onclick = next;
    addAskButton($('.ex-feedback', root), () => askContext(q, S.answered), $('[data-next]', root));
    $('[data-next]', root).focus({ preventScroll: true });
    $('.ex-feedback', root).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function renderWT(q, el, ans) {
    const romaji = load(K.romaji, false);
    const used = ans ? ans.hints || [] : hintsOf();
    const ph = on => (on ? 'Латиницею: taberu' : '日本語で…');
    const hintOut = () => (used.includes('k') || hintsOf().includes('k') ? `<div class="ex-hint"><b>Перша кана:</b> <span lang="ja">${esc(q.first)}…</span></div>` : '');
    el.innerHTML = `<form class="write-form ex-sentform ex-wtform" autocomplete="off">
        <label class="check sm ex-romaji"><input type="checkbox" data-romaji ${romaji ? 'checked' : ''}><span>Ромаджі → кана</span></label>
        <input class="answer-input" lang="ja" placeholder="${ph(romaji)}" aria-label="Японське слово" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
        <div class="ex-hints"><span class="muted small">Підказка (знижує оцінку):</span><button type="button" class="btn ghost sm" data-hint="k" ${used.includes('k') ? 'disabled' : ''}>Перша кана −${WT_HINT * 100}%</button></div>
        <div class="ex-hint-out">${hintOut()}</div>
        <div class="write-btns"><button type="button" class="btn ghost" data-dk>Не знаю</button><button class="btn primary">Перевірити</button></div></form>`;
    const inp = $('input.answer-input', el), box = $('[data-romaji]', el);
    if (ans) { inp.value = ans.given || ''; return; }
    if (romaji) bindRomaji(inp, true);
    box.onchange = () => { save(K.romaji, box.checked); inp.placeholder = ph(box.checked); bindRomaji(inp, box.checked); inp.focus(); };
    setTimeout(() => inp.focus({ preventScroll: true }), 80);
    $('[data-hint]', el).onclick = e => {
      const list = ((S.hints ||= {})[S.i] ||= []);
      if (!list.includes('k')) list.push('k');
      persist();
      e.currentTarget.disabled = true;
      $('.ex-hint-out', el).innerHTML = hintOut();
      inp.focus();
    };
    const answer = given => {
      if (S.answered) return;
      const hints = hintsOf(), ok = !!given && judge(q, given);
      S.answered = { given, ok, pts: ok ? Math.max(0, 1 - (hints.includes('k') ? WT_HINT : 0)) : 0, hints: [...hints] };
      persist();
      feedbackWT(q);
    };
    $('form', el).onsubmit = e => {
      e.preventDefault();
      let v = inp.value.trim();
      // romaji mode: wanakana leaves a final «n» in Latin until the next key → convert everything
      if (box.checked && window.wanakana && /[a-z]/i.test(v)) { v = window.wanakana.toKana(v.toLowerCase()); inp.value = v; }
      if (v) answer(v);
    };
    $('[data-dk]', el).onclick = () => answer('');
  }
  function renderAnswer(q, el, ans) {
    if (q.mode === 'sent') renderSent(q, el, ans);
    else if (q.mode === 'wtype') renderWT(q, el, ans);
    else if (q.mode === 'choice') {
      el.innerHTML = `<div class="choices">${q.options.map((o, i) => `<button type="button" class="choice" data-v="${esc(o.v)}"><kbd>${i + 1}</kbd><span class="opt-main">${o.h}</span></button>`).join('')}</div>
        ${q.self && !ans ? `<details class="ex-self"><summary>Написати свій переклад</summary><textarea class="input" rows="2" placeholder="Ваш переклад…"></textarea><button type="button" class="btn ghost sm" data-compare>Порівняти з еталоном</button><div class="ex-self-res"></div></details>` : ''}`;
      $$('.choice', el).forEach(b => (b.onclick = () => submit(q, b.dataset.v)));
      $('[data-compare]', el)?.addEventListener('click', () => {
        const mine = $('textarea', el).value.trim();
        if (!mine) return;
        $('.ex-self-res', el).innerHTML = `<div class="ex-correct"><span class="muted small">Еталон:</span> ${esc(q.answer)}</div><div class="btn-row"><button type="button" class="btn ghost sm" data-me="1">Я відповів правильно</button><button type="button" class="btn ghost sm" data-me="0">Неправильно</button></div>`;
        $$('[data-me]', el).forEach(b => (b.onclick = () => submit(q, mine, b.dataset.me === '1')));
      });
    } else if (q.mode === 'type') {
      el.innerHTML = `<form class="write-form" autocomplete="off"><input class="answer-input" lang="${q.side === 'uk' ? 'uk' : 'ja'}" placeholder="${q.side === 'uk' ? 'Українською…' : '日本語で…'}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
        <div class="write-btns"><button type="button" class="btn ghost" data-dk>Не знаю</button><button class="btn primary">Перевірити</button></div></form>`;
      const inp = $('input', el);
      if (!ans) setTimeout(() => inp.focus({ preventScroll: true }), 80); else inp.value = ans.given || '';
      $('form', el).onsubmit = e => { e.preventDefault(); if (inp.value.trim()) submit(q, inp.value.trim()); };
      $('[data-dk]', el).onclick = () => submit(q, '', false);
    } else if (q.mode === 'tiles') {
      let picked = ans ? (ans.given ? ans.given.split(' ') : []) : [];
      const drawT = () => {
        el.innerHTML = `<div class="ex-built" lang="ja">${picked.map((h, i) => `<button type="button" class="tile-chip on" data-un="${i}">${furi(h)}</button>`).join('') || '<span class="muted small">Торкайтеся плиток у правильному порядку</span>'}</div>
          <div class="ex-tiles" lang="ja">${q.tiles.map((t, i) => (picked.filter(x => x === t.h).length > q.tiles.slice(0, i).filter(x => x.h === t.h).length ? '' : `<button type="button" class="tile-chip" data-t="${i}">${furi(t.h)}</button>`)).join('')}</div>
          <div class="write-btns"><button type="button" class="btn ghost" data-clear>Очистити</button><button type="button" class="btn primary" data-check ${picked.length === q.tiles.length ? '' : 'disabled'}>Перевірити</button></div>`;
        $$('[data-t]', el).forEach(b => (b.onclick = () => { picked.push(q.tiles[+b.dataset.t].h); drawT(); }));
        $$('[data-un]', el).forEach(b => (b.onclick = () => { picked.splice(+b.dataset.un, 1); drawT(); }));
        $('[data-clear]', el).onclick = () => { picked = []; drawT(); };
        $('[data-check]', el).onclick = () => submit(q, picked.join(' '));
      };
      drawT();
    } else if (q.mode === 'error') {
      el.innerHTML = `<div class="ex-chips" lang="ja">${q.chunks.map((c, i) => `<button type="button" class="tile-chip ${c.glue ? 'glue' : ''}" data-c="${i}">${furi(c.h)}</button>`).join('')}</div><div class="ex-fix"></div>`;
      $$('[data-c]', el).forEach(b => (b.onclick = () => {
        $$('[data-c]', el).forEach(x => x.classList.toggle('sel', x === b));
        if (+b.dataset.c !== q.wrong) return submit(q, plainT(q.chunks[+b.dataset.c].h), false);
        const fix = $('.ex-fix', el);
        fix.innerHTML = q.options
          ? `<p class="small muted">Правильно! Тепер виберіть, як виправити:</p><div class="choices">${q.options.map(o => `<button type="button" class="choice" data-v="${esc(o.v)}">${esc(o.h)}</button>`).join('')}</div>`
          : `<p class="small muted">Правильно! Тепер напишіть правильну форму:</p><form class="write-form"><input class="answer-input" lang="ja" placeholder="日本語で…" autocomplete="off"><div class="write-btns"><button class="btn primary">Перевірити</button></div></form>`;
        $$('.choice', fix).forEach(c => (c.onclick = () => submit(q, c.dataset.v)));
        $('form', fix)?.addEventListener('submit', e => { e.preventDefault(); const v = $('input', fix).value.trim(); if (v) submit(q, v); });
        $('input', fix)?.focus();
      }));
    }
  }
  const finish = () => {
    clearInterval(timerId);
    for (let i = S.i; i < S.qs.length; i++) S.res[i] ||= { given: '', ok: false, skipped: true };
    if (S.answered) { S.res[S.i] = S.answered; S.answered = null; }
    S.i = S.qs.length;
    if (!S.saved) { saveHistory(); S.saved = true; }
    persist();
    location.hash = '#/exam/result';
  };
  document.addEventListener('keydown', onKey);
  function onKey(e) {
    if (!location.hash.startsWith('#/exam/run')) return document.removeEventListener('keydown', onKey);
    if (e.target.closest?.('.ask-zone, .modal-back')) return; // typing to the helper or a dialog must not move the exam on
    if (e.key === 'Enter' && $('[data-next]', root) && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); $('[data-next]', root).click(); }
    else if (/^[1-4]$/.test(e.key) && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName) && !S.answered) $$('.ex-answer .choice', root)[+e.key - 1]?.click();
  }
  draw();
  return () => { clearInterval(timerId); document.removeEventListener('keydown', onKey); };
}

// ---------- results & history ----------
/** Points of one answer: «Переклад речень» gives partial credit (0…1), other tasks 0 or 1. */
const credit = r => (!r ? 0 : r.pts != null ? r.pts : r.ok ? 1 : 0);
const isMistake = r => !r?.ok || !!r?.flag;
function stats(qs, res) {
  const by = (keyFn, label) => {
    const m = {};
    qs.forEach((q, i) => { const k = keyFn(q); if (k == null) return; (m[k] ||= { n: 0, ok: 0, label: label(q) }); m[k].n++; m[k].ok += credit(res[i]); });
    return m;
  };
  return {
    byType: by(q => q.type, q => TYPES[q.type]),
    byLesson: by(q => (q.lesson ? 'L' + q.lesson : q.type === 'k' ? 'K' + q.ref.lno : null), q => (q.lesson ? `Урок ${q.lesson}` : `Канджі ${q.ref.lno}課`)),
  };
}
function saveHistory() {
  const ok = +S.res.reduce((a, r) => a + credit(r), 0).toFixed(1);
  const st = stats(S.qs, S.res);
  const mistakes = S.qs.map((q, i) => (isMistake(S.res[i]) ? { type: q.type, weak: q.weak, ref: q.ref } : null)).filter(Boolean);
  const h = load(K.history, []);
  h.push({ at: Date.now(), name: S.conf.name || `Уроки ${S.conf.from}–${S.conf.to}`, n: S.qs.length, ok, pct: Math.round((ok / S.qs.length) * 100), byType: st.byType, mistakes });
  save(K.history, h.slice(-60));
}
function resultView(root) {
  const ok = +S.res.reduce((a, r) => a + credit(r), 0).toFixed(1), n = S.qs.length, pct = n ? Math.round((ok / n) * 100) : 0;
  const st = stats(S.qs, S.res);
  const wrong = S.qs.map((q, i) => ({ q, r: S.res[i] || {} })).filter(x => isMistake(x.r));
  const table = m => `<div class="ex-stats">${Object.values(m).sort((a, b) => a.ok / a.n - b.ok / b.n).map(s => `<div class="ex-stat"><span>${esc(s.label)}</span><div class="stack-bar"><i class="m" style="width:${(s.ok / s.n) * 100}%"></i></div><b>${Math.round((s.ok / s.n) * 100)}%</b><small class="muted">${+s.ok.toFixed(1)}/${s.n}</small></div>`).join('')}</div>`;
  root.innerHTML = `<div class="exam fade-in">
    <a class="back" href="#/exam">${I.back}<span>Екзамен</span></a>
    <div class="results"><div class="score-ring" style="--p:${pct}"><span>${pct}<small>%</small></span></div>
      <h2>${pct >= 90 ? '完璧 — чудовий результат!' : pct >= 70 ? 'Добре!' : pct >= 50 ? 'Непогано, але є що повторити' : 'Варто повторити матеріал'}</h2>
      <p class="muted">${ok} з ${n} правильно</p>
      <div class="res-btns">${wrong.length ? `<button class="btn primary" data-repeat>Повторити мої помилки (${wrong.length})</button>` : ''}<a class="btn ghost" href="#/exam">Новий екзамен</a></div></div>
    <section class="panel"><h2 class="sec-title">За типами завдань</h2>${table(st.byType)}</section>
    <section class="panel"><h2 class="sec-title">За уроками</h2>${table(st.byLesson)}</section>
    ${wrong.length ? `<section class="panel"><h2 class="sec-title">Помилки (${wrong.length})</h2><div class="ex-mistakes">${wrong.map(({ q, r }, i) => `<div class="ex-mistake" data-i="${i}">
      <div class="ex-type">${TYPES[q.type]} · ${esc(q.src || '')}</div>
      <div class="ex-mprompt">${q.type === 'l' || q.type === 'k' ? '' : q.prompt}</div>
      ${q.mode === 'sent' ? `${sentResultHTML(q, r)}<div class="ex-refs">${refBtn(q.ref, mnnRef(q.it.pt))}</div></div>` : q.mode === 'wtype' ? `${wtResultHTML(q, r)}<div class="ex-refs">${refBtn(q.ref)}</div></div>` : `${r.given ? `<div class="ex-given">Ваша відповідь: <s lang="ja">${furi(r.given)}</s></div>` : '<div class="ex-given muted">Без відповіді</div>'}
      <div class="ex-correct"><span class="muted small">Правильно:</span> ${q.correct}</div>
      <div class="ex-expl">${(() => { const w = whyWrong(q, r.given); return w ? `<p class="ex-why">${gtext(w)}</p>` : ''; })()}<p>${gtext(q.x || '')}</p></div>
      <div class="ex-refs">${refBtn(q.ref)}</div></div>`}`).join('')}</div></section>` : ''}
    ${weakHTML(load(K.history, []))}
  </div>`;
  wireRefs(root, b => { const m = b.closest('.ex-mistake'); return m ? askContext(wrong[+m.dataset.i].q, wrong[+m.dataset.i].r) : ''; });
  $$('[data-say-c]', root).forEach(b => (b.onclick = () => speak(wrong[+b.closest('.ex-mistake').dataset.i]?.q.say)));
  $$('.ex-mistake', root).forEach(el => { const { q, r } = wrong[+el.dataset.i]; addAskButton(el, () => askContext(q, r)); });
  mountAskBlock($('.exam', root));
  $('[data-repeat]', root)?.addEventListener('click', () => {
    S = { conf: { ...S.conf, name: (S.conf.name || 'Екзамен') + ' — помилки', timer: 0 }, qs: shuffle(wrong.map(x => x.q)), i: 0, res: [], start: Date.now(), deadline: 0, answered: null };
    persist();
    location.hash = '#/exam/run';
  });
}
function historyHTML(h) {
  if (!h.length) return '';
  const last = h.slice(-20);
  const W = 300, H = 80, step = last.length > 1 ? W / (last.length - 1) : W;
  const pts = last.map((x, i) => `${(i * step).toFixed(1)},${(H - (x.pct / 100) * H).toFixed(1)}`).join(' ');
  return `<section class="panel"><h2 class="sec-title">Історія спроб</h2>
    <svg class="ex-chart" viewBox="-6 -6 ${W + 12} ${H + 12}" preserveAspectRatio="none" aria-label="Графік результатів"><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/><polyline points="${pts}"/>${last.map((x, i) => `<circle cx="${(i * step).toFixed(1)}" cy="${(H - (x.pct / 100) * H).toFixed(1)}" r="3"/>`).join('')}</svg>
    <div class="ex-hist">${h.slice(-8).reverse().map(x => `<div><span>${new Date(x.at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} · ${esc(x.name)}</span><b>${x.pct}%</b><small class="muted">${x.ok}/${x.n}</small></div>`).join('')}</div>
  </section>${weakHTML(h)}`;
}
function weakHTML(h) {
  const m = {};
  h.slice(-15).forEach(x => (x.mistakes || []).forEach(e => { if (!e.weak) return; const k = e.type + '|' + e.weak; (m[k] ||= { n: 0, e }).n++; }));
  const top = Object.values(m).sort((a, b) => b.n - a.n).slice(0, 10);
  if (!top.length) return '';
  const groupName = { ...univGroups, p: 'частка', e: 'помилка', v: 'форма', c: 'форма', g: 'граматика', k: 'канджі', w: 'слово', wt: 'слово (написати)', l: 'аудіювання', tj: 'переклад', tu: 'порядок слів', ts: 'конструкція' };
  return `<section class="panel"><h2 class="sec-title">Слабкі місця</h2><p class="muted small">Що ви плутаєте найчастіше (останні 15 спроб):</p>
    <div class="ex-weak">${top.map(({ n, e }) => `<div class="ex-weak-row"><span class="chip">${groupName[e.type] || ''}</span><b lang="ja">${esc(e.weak)}</b><span class="muted">✕ ${n}</span>${e.ref ? `<button type="button" class="ex-ref sm" data-ref='${esc(JSON.stringify(e.ref))}'>Повторити: ${esc(refShort(e.ref))}</button>` : ''}</div>`).join('')}</div></section>`;
}
function wireHistory(root) { wireRefs(root); }
