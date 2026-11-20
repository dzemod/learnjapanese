// «Словник» tab (#/dict): JMdict (219 000 entries, English glosses) + KANJIDIC2 (10 000 kanji) + RADKFILE, with the
// learner's own Ukrainian data on top (my lessons via wordindex.js, kanji books + associations).
//   #/dict                 search box, favourites, recent searches, radical search link
//   #/dict/q/<query>       results: Japanese (kanji / kana, prefix), romaji → kana, English, Ukrainian (my lessons)
//   #/dict/w/<jmdictId>    word page: forms, readings, senses with parts of speech, «у ваших уроках», its kanji
//   #/dict/k/<kanji>       kanji page: stroke order (KanjiVG via kanji.js), readings, meanings (my Ukrainian one
//                          first), components, words with it, link to the kanji card when it is a book kanji
//   #/dict/radicals        pick components → matching kanji
//   #/dict/browse/<common|all>/<pos|->/<freq|kana>/<page>   every word, 100 per page, filters
// Ukrainian meanings of the common words: data/dict/uk.json (Claude → «перевірити»), searched as mode 'uk'.
// «До мого уроку» on the word page (add-word.js).
// Data: data/dict/* (tools/build-dict.mjs), searched in dict-worker.js (chunk 00 = common words first, the rest in
// the background, cached by the service worker). Favourites jp.dict.fav, recent jp.dict.recent. Speech on click only.
import { $, $$, esc, I, speak, toast } from './util.js';
import { wordLevel, kanjiLevel, jlptChip } from './jlpt.js';
import { getSets } from './store.js';
import { buildIndex, lookupWord } from './wordindex.js';
import { loadKanji, books as kanjiBooks, strokeOrder } from './kanji.js';
import { getNote, defaultAssoc } from './kanji-assoc.js';
import { kunHTML } from './modes.js';
import { addToLessonModal, toMasu } from './add-word.js';
import { machineTranslate } from './mt.js';

const KFAV = 'jp.dict.fav', KREC = 'jp.dict.recent';
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } };
const KANJI = /[㐀-鿿々〆]/, JA = /[぀-ヿ㐀-鿿々〆]/, CYR = /[а-яіїєґё]/i;

export const POS_UK = {
  n: 'іменник', pn: 'займенник', 'n-suf': 'іменник-суфікс', 'n-pref': 'іменник-префікс', 'n-t': 'іменник (час)', 'n-adv': 'іменник-прислівник',
  v1: 'дієслово II гр.', 'v1-s': 'дієслово II гр.', 'vs': 'дієслово з する (III гр.)', 'vs-i': 'дієслово する (III гр.)', 'vs-s': 'дієслово する (III гр.)', 'vs-c': 'дієслово す',
  vk: 'дієслово くる (III гр.)', vz: 'дієслово ずる', vi: 'неперехідне', vt: 'перехідне',
  'adj-i': 'い-прикметник', 'adj-ix': 'い-прикметник (いい)', 'adj-na': 'な-прикметник', 'adj-no': 'прикметник з の', 'adj-pn': 'означальне слово', 'adj-t': 'たる-прикметник', 'adj-f': 'означення',
  adv: 'прислівник', 'adv-to': 'прислівник (と)', prt: 'частка', conj: 'сполучник', int: 'вигук', exp: 'вираз', suf: 'суфікс', pref: 'префікс', ctr: 'лічильний суфікс',
  num: 'числівник', 'aux-v': 'допоміжне дієслово', 'aux-adj': 'допоміжний прикметник', aux: 'допоміжне', cop: 'зв’язка', unc: '',
  uk: 'зазвичай пишуть каною', hon: 'шанобливе', hum: 'скромне', pol: 'ввічливе', col: 'розмовне', sl: 'сленг', arch: 'застаріле', abbr: 'скорочення', 'on-mim': 'звуконаслідування',
};
const posText = (p, meta) => {
  const [pos, extra = ''] = p.split('|');
  const one = t => (/^v5/.test(t) ? 'дієслово I гр.' : POS_UK[t] ?? (meta?.pos?.[t] || t));
  return [...pos.split(',').filter(Boolean).map(one), ...extra.split(',').filter(Boolean).map(one)].filter(Boolean);
};

// ---------- worker ----------
let W = null, seq = 0, state = { loaded: 0, total: 0, words: 0, error: '' };
const waits = new Map(), progressFns = new Set();
function worker() {
  if (W) return W;
  W = new Worker(new URL('./dict-worker.js', import.meta.url));
  W.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') { state = { ...state, ...m, error: '' }; progressFns.forEach(f => f(state)); }
    else if (m.type === 'error') { state.error = m.error; progressFns.forEach(f => f(state)); }
    else if (m.type === 'result') { waits.get(m.id)?.(m); waits.delete(m.id); }
  };
  W.postMessage({ type: 'init' });
  return W;
}
const ask = msg => new Promise(res => { const id = ++seq; waits.set(id, res); worker().postMessage({ ...msg, id }); });
export const dictSearch = (q, mode, limit = 50, offset = 0) => ask({ type: 'search', q, mode, limit, offset });
/** One word by JMdict id (the worker answers when the word's chunk is in, or «not found» after the last chunk). */
export const dictEntry = wid => ask({ type: 'entry', wid });
/** Exact form lookup in the whole dictionary (common words first, ≤ 5 per call). */
export const dictExact = keys => ask({ type: 'exact', keys });
/** Verb group (I / II / III) from the JMdict part of speech of the first sense. */
export const groupOfPos = p => { const t = String(p || '').split(/[,|]/)[0]; return /^v5/.test(t) ? 'I' : /^v1/.test(t) ? 'II' : /^(vs|vk)/.test(t) ? 'III' : ''; };
export const onDictProgress = fn => { progressFns.add(fn); return () => progressFns.delete(fn); };

// ---------- kanji / radicals / my data ----------
let KJ = null, RAD = null, META = null, IDX = null;
const loadJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const kanjiData = () => (KJ ||= loadJSON('data/dict/kanji.json').then(j => new Map(j.k.map(r => [r[0], r]))).catch(e => { KJ = null; throw e; }));
const radData = () => (RAD ||= loadJSON('data/dict/radicals.json').then(j => j.r).catch(e => { RAD = null; throw e; }));
const meta = () => (META ||= loadJSON('data/dict/meta.json').catch(() => ({ pos: {} })));
async function mine() {
  if (IDX) return IDX;
  await loadKanji();
  const book = new Map();
  for (const b of kanjiBooks()) for (const l of b.lessons) for (const k of l.kanji) book.set(k.kanji, { ...k, lessonId: l.id, bookTitle: b.title });
  IDX = { words: buildIndex(getSets(), kanjiBooks()), book, sets: getSets() };
  return IDX;
}

// ---------- favourites / recent ----------
const favs = () => lget(KFAV, []) || [];
const isFav = key => favs().some(f => f.key === key);
function toggleFav(item) { const f = favs(); const i = f.findIndex(x => x.key === item.key); if (i >= 0) f.splice(i, 1); else f.unshift(item); lset(KFAV, f.slice(0, 200)); return i < 0; }
function addRecent(q) { const r = (lget(KREC, []) || []).filter(x => x !== q); r.unshift(q); lset(KREC, r.slice(0, 20)); }

// ---------- views ----------
const progressHTML = s => (s.error ? `<p class="ask-err small">Не вдалося завантажити словник: ${esc(s.error)}. Перевірте з’єднання.</p>`
  : s.total && s.loaded < s.total ? `<div class="dc-load"><div class="bar"><i style="width:${Math.round((s.loaded / s.total) * 100)}%"></i></div><span class="muted small">Словник завантажується: ${s.loaded} / ${s.total} частин · ${s.words.toLocaleString('uk-UA')} слів (уже можна шукати поширені слова)</span></div>` : '');
const formsHTML = it => {
  const k = it.kanji ? it.kanji.split('|') : [], r = it.kana.split('|');
  return `<span class="dc-main" lang="ja">${esc(k[0] || r[0])}</span>${k.length ? `<span class="reading" lang="ja">${esc(r[0])}</span>` : ''}${it.common ? '<span class="chip dc-common">поширене</span>' : ''}`;
};
const UK_NOTE = 'Переклад українською зроблено автоматично (Claude) з англійських значень JMdict — перевіряйте';
/** One result row: my lesson meaning > dictionary Ukrainian meaning > English. */
function itemHTML(it, my, m) {
  const h = my ? lookupWord(my.words, (it.kanji || it.kana).split('|')[0], it.kana.split('|')[0], { strict: true }) : null;
  const uk = h ? `<div class="dc-mine">${esc(h.uk)} <span class="muted small">· ${esc(h.src)}</span></div>` : it.uk ? `<div class="dc-uk" title="${UK_NOTE}">${esc(it.uk)}</div>` : '';
  return `<a class="dc-item" href="#/dict/w/${it.id}"><div>${formsHTML(it)}</div>${uk}${glossHTML(it.senses, m, uk ? 1 : 2, !!uk)}</a>`;
}
const glossHTML = (senses, metaP, max = 3, quiet = false) => `<ol class="dc-senses${quiet ? ' quiet' : ''}">${senses.slice(0, max).map(s => { const pos = posText(s[0], metaP); return `<li>${pos.length ? `<span class="dc-pos">${esc(pos.join(', '))}</span> ` : ''}<span lang="en">${esc(s[1])}</span></li>`; }).join('')}</ol>`;

function searchBox(q = '') {
  return `<form class="dc-search" role="search"><label class="search">${I.search}<input type="search" name="q" value="${esc(q)}" placeholder="Слово: 日本, にほん, nihon, Japan, Японія…" aria-label="Пошук у словнику" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn primary">Шукати</button></form>`;
}
function wireSearch(root) {
  const f = $('.dc-search', root);
  f.onsubmit = e => { e.preventDefault(); const q = f.q.value.trim(); if (q) location.hash = '#/dict/q/' + encodeURIComponent(q); };
}

function homeView(root) {
  const rec = lget(KREC, []) || [], fv = favs();
  root.innerHTML = `<div class="dc fade-in">
    <section class="hero"><div><p class="eyebrow" lang="ja">辞書</p><h1>Словник</h1>
      <p class="muted">Усі японські слова — 219 000 (JMdict), 10 000 канджі. Поширені слова мають український переклад, решта — англійський; ваші слова з уроків — завжди першими.</p></div></section>
    ${searchBox()}
    <div class="dc-prog" aria-live="polite"></div>
    <div class="btn-row dc-links"><a class="btn ghost" href="#/dict/browse"><span lang="ja">一覧</span><span>Усі слова</span></a><a class="btn ghost" href="#/dict/radicals"><span lang="ja">部首</span><span>Пошук канджі за ключами</span></a></div>
    ${fv.length ? `<section class="panel"><h2 class="sec-title">Обране</h2><div class="dc-favs">${fv.map(f => `<a class="chip dc-fav" href="${esc(f.href)}"><span lang="ja">${esc(f.label)}</span>${f.sub ? ` <small class="muted">${esc(f.sub)}</small>` : ''}</a>`).join('')}</div></section>` : ''}
    ${rec.length ? `<section class="panel"><h2 class="sec-title">Нещодавні пошуки</h2><div class="dc-favs">${rec.map(q => `<a class="chip" href="#/dict/q/${encodeURIComponent(q)}">${esc(q)}</a>`).join('')}</div></section>` : ''}
    <p class="muted small dc-lic">JMdict, KANJIDIC2, RADKFILE © Electronic Dictionary Research and Development Group, CC BY-SA 4.0 · порядок рисок: KanjiVG</p>
  </div>`;
  wireSearch(root);
  const prog = $('.dc-prog', root);
  const off = onDictProgress(s => { if (prog.isConnected) prog.innerHTML = progressHTML(s); });
  worker();
  prog.innerHTML = progressHTML(state);
  setTimeout(() => $('.dc-search input', root)?.focus({ preventScroll: true }), 50);
  return off;
}

const PAGE = 60;
function sectionHTML(mode, title, r, my, m, q2 = '') {
  const left = r.count - r.items.length;
  return `<section class="dc-sec" data-mode="${mode}"${q2 ? ` data-q="${esc(q2)}"` : ''}><h2 class="group-title">${title}${mode === 'romaji' && r.q ? ` <span class="muted small" lang="ja">${esc(r.q)}</span>` : ''} <span class="muted small">${r.count.toLocaleString('uk-UA')}</span>${mode === 'uk' ? ' <span class="check-badge" title="' + UK_NOTE + '">автоматичний переклад</span>' : ''}</h2>
    ${r.items.length ? `<div class="dc-list">${r.items.map(it => itemHTML(it, my, m)).join('')}</div>${left > 0 ? `<button type="button" class="btn ghost dc-more" data-more>Показати ще (${left.toLocaleString('uk-UA')})</button>` : ''}`
      : `<p class="muted small">${mode === 'uk' ? 'У словнику з українським перекладом такого слова немає. Спробуйте англійською.' : 'Нічого не знайдено.'}</p>`}</section>`;
}

async function resultsView(root, q) {
  addRecent(q);
  const ja = JA.test(q), cyr = CYR.test(q), lat = /[a-z]/i.test(q) && !ja && !cyr;
  root.innerHTML = `<div class="dc fade-in"><a class="back" href="#/dict">${I.back}<span>Словник</span></a>${searchBox(q)}<div class="dc-prog" aria-live="polite"></div><div class="dc-res"><div class="loading"><span class="sun pulse"></span></div></div></div>`;
  wireSearch(root);
  const prog = $('.dc-prog', root), box = $('.dc-res', root);
  let partial = false;
  const draw = async () => {
    const [m, my] = await Promise.all([meta(), mine()]);
    const sections = [];
    if (cyr) {
      const ql = q.toLowerCase();
      const hits = [];
      for (const s of my.sets) for (const c of s.cards) if (c.ukrainian.toLowerCase().includes(ql)) hits.push({ c, s });
      hits.sort((a, b) => (a.c.ukrainian.toLowerCase() === ql ? 0 : 1) - (b.c.ukrainian.toLowerCase() === ql ? 0 : 1) || a.c.ukrainian.length - b.c.ukrainian.length);
      const kh = [...my.book.values()].filter(k => (k.meaning || '').toLowerCase().includes(ql)).slice(0, 12);
      sections.push(`<h2 class="group-title">Ваші уроки <span class="muted small">${hits.length}</span></h2>${hits.length ? `<div class="dc-list">${hits.slice(0, 40).map(({ c, s }) => `<a class="dc-item" href="#/dict/q/${encodeURIComponent(c.japanese.replace(/[～〜[\]（）()]/g, '').replace(/\s.*$/, ''))}"><div><span class="dc-main" lang="ja">${esc(c.japanese)}</span>${c.reading ? `<span class="reading" lang="ja">${esc(c.reading)}</span>` : ''}</div><div>${esc(c.ukrainian)} <span class="muted small">· ${esc(s.title)}</span></div></a>`).join('')}</div>` : '<p class="muted small">У ваших уроках такого слова немає. Спробуйте англійською — словник JMdict англійсько-японський.</p>'}`);
      const ru = await dictSearch(q, 'uk', PAGE);
      partial ||= ru.partial;
      if (ru.count || hits.length) sections.push(sectionHTML('uk', 'Словник', ru, my, m));
      if (!ru.count) {
        // not among the Ukrainian meanings yet: draft translation → the Japanese word in the whole dictionary
        let ja = '';
        try { ja = (await machineTranslate(q, 'uk', 'ja')).text.replace(/[。．.！!？?\s]+$/u, '').trim(); } catch { /* offline / daily limit */ }
        const rj = ja && JA.test(ja) ? await dictSearch(ja, 'ja', PAGE) : null;
        if (rj?.count) sections.push(sectionHTML('ja', `Можливо, ви шукаєте <span lang="ja">${esc(ja)}</span> <span class="check-badge" title="Японське слово знайдено через машинний переклад MyMemory">машинний переклад</span>`, rj, my, m, ja));
        else sections.push('<p class="muted small">У словнику такого українського слова поки немає. Спробуйте японською або англійською (словник JMdict англійсько-японський).</p>');
      }
      if (kh.length) sections.push(`<h2 class="group-title">Канджі</h2><div class="dc-kanji-row">${kh.map(k => `<a class="dc-k" href="#/dict/k/${encodeURIComponent(k.kanji)}"><b lang="ja">${esc(k.kanji)}</b><small>${esc(k.meaning)}</small></a>`).join('')}</div>`);
    } else {
      const runs = ja ? [['ja', 'Японською']] : lat ? [['romaji', `Ромаджі → кана`], ['en', 'Англійською']] : [['ja', 'Японською']];
      for (const [mode, title] of runs) {
        const r = await dictSearch(q, mode, PAGE);
        partial ||= r.partial;
        if (!r.items.length && mode !== 'ja') continue;
        sections.push(sectionHTML(mode, title, r, my, m));
      }
      const kj = [...q].filter(ch => KANJI.test(ch));
      if (kj.length) { const K = await kanjiData(); sections.unshift(`<div class="dc-kanji-row">${[...new Set(kj)].map(ch => { const k = K.get(ch), b = my.book.get(ch); return `<a class="dc-k" href="#/dict/k/${encodeURIComponent(ch)}"><b lang="ja">${esc(ch)}</b><small>${esc(b?.meaning || k?.[7]?.split('; ')[0] || '')}</small></a>`; }).join('')}</div>`); }
    }
    if (box.isConnected) box.innerHTML = sections.join('') || '<p class="muted">Нічого не знайдено.</p>';
  };
  // «Показати ще»: the next page of one section, appended
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-more]');
    if (!b) return;
    b.disabled = true;
    const sec = b.closest('.dc-sec'), mode = sec.dataset.mode, list = $('.dc-list', sec);
    const off = list.children.length;
    const [r, m, my] = await Promise.all([dictSearch(sec.dataset.q || q, mode, PAGE, off), meta(), mine()]);
    list.insertAdjacentHTML('beforeend', r.items.map(it => itemHTML(it, my, m)).join(''));
    const left = r.count - list.children.length;
    if (left > 0) { b.disabled = false; b.textContent = `Показати ще (${left.toLocaleString('uk-UA')})`; } else b.remove();
  });
  const off = onDictProgress(s => { if (!prog.isConnected) return; prog.innerHTML = progressHTML(s); if (partial && s.loaded >= s.total) { partial = false; draw(); } });
  prog.innerHTML = progressHTML(state);
  await draw();
  return off;
}

// ---------- example sentences (Tatoeba, tools/build-dict-examples.mjs; data/dict/ex-<hash of the id, 0–f>.json) ----------
// rows: [sense (−1 = extra sentence with a Ukrainian translation), ja, form in the sentence, en, uk, tatoebaId]
const EX = {};
const exShard = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 16).toString(16); };
const exFor = id => { const s = exShard(id); return (EX[s] ||= fetch(`data/dict/ex-${s}.json`).then(r => (r.ok ? r.json() : { x: {} })).then(j => j.x || {}).catch(() => { delete EX[s]; return {}; }))
  .then(x => x[String(id)] || []); };
function exampleHTML([si, ja, form, en, uk, tid], senses) {
  const at = form ? ja.indexOf(form) : -1;
  const jaH = at >= 0 ? `${esc(ja.slice(0, at))}<b>${esc(form)}</b>${esc(ja.slice(at + form.length))}` : esc(ja);
  return `<div class="dc-exi"><p class="dc-exja" lang="ja">${jaH}</p>
    ${uk ? `<p class="dc-exuk">${esc(uk)}</p>` : ''}${en ? `<p class="dc-exen muted small" lang="en">${esc(en)}</p>` : ''}
    <div class="dc-exbar">${senses > 1 && si >= 0 ? `<span class="chip">значення ${si + 1}</span>` : ''}
      <button type="button" class="icon-btn sm" data-ex-say="${esc(ja)}" aria-label="Прослухати речення">${I.speaker}</button>
      <a class="link small" href="#/translate/${encodeURIComponent(ja)}">Розібрати</a>
      ${tid ? `<a class="link small muted" href="https://tatoeba.org/uk/sentences/show/${tid}" target="_blank" rel="noopener">Tatoeba №${tid}</a>` : ''}</div></div>`;
}
async function drawExamples(box, id, senses) {
  const rows = await exFor(id);
  if (!box.isConnected) return;
  if (!rows.length) { box.remove(); return; }
  box.hidden = false;
  box.innerHTML = `<h2 class="sec-title">Приклади речень <span class="muted small">${rows.length}</span></h2>${rows.map(r => exampleHTML(r, senses)).join('')}
    <p class="muted small dc-lic">Речення: <a class="link" href="https://tatoeba.org" target="_blank" rel="noopener">Tatoeba</a>, CC BY 2.0 FR. Український переклад — від авторів Tatoeba, якщо він є; англійський — з JMdict / Tatoeba.</p>`;
  box.addEventListener('click', e => { const b = e.target.closest('[data-ex-say]'); if (b) speak(b.dataset.exSay); });
}

async function wordView(root, wid) {
  root.innerHTML = '<div class="dc"><div class="loading"><span class="sun pulse"></span></div></div>';
  const [r, m, my, K] = await Promise.all([dictEntry(wid), meta(), mine(), kanjiData().catch(() => new Map())]);
  const it = r.items[0];
  if (!it) { root.innerHTML = `<div class="dc"><a class="back" href="#/dict">${I.back}<span>Словник</span></a><p class="muted">Слово не знайдено.</p></div>`; return; }
  const k = it.kanji ? it.kanji.split('|') : [], rd = it.kana.split('|');
  const head = k[0] || rd[0];
  const h = lookupWord(my.words, head, rd[0], { strict: true });
  const key = 'w:' + it.id;
  root.innerHTML = `<div class="dc fade-in"><a class="back" href="javascript:history.back()">${I.back}<span>Назад</span></a>
    <section class="panel dc-word">
      <div class="dc-whead"><span class="dc-big" lang="ja">${esc(head)}</span>${k.length ? `<span class="reading dc-rd" lang="ja">${esc(rd[0])}</span>` : ''}
        <span class="dc-acts"><button type="button" class="btn ghost sm" data-add title="До мого уроку" aria-label="Додати до мого уроку">${I.plus}<span>До мого уроку</span></button><button type="button" class="icon-btn" data-say aria-label="Прослухати">${I.speaker}</button><button type="button" class="icon-btn star ${isFav(key) ? 'on' : ''}" data-fav aria-label="Обране">${I.star}</button></span></div>
      ${it.common ? '<span class="chip dc-common">поширене слово</span>' : ''}${(() => { const n = wordLevel(head, rd[0]); return n ? ` <a href="#/jlpt" class="jl-link">${jlptChip(n)}</a>` : ''; })()}
      ${h ? `<div class="dc-mine big"><b>${esc(h.uk)}</b> <a class="link small" href="${esc(h.href)}">${esc(h.src)}</a></div>` : ''}
      ${it.uk ? `<div class="dc-ukb"><b>${esc(it.uk)}</b> <span class="check-badge" title="${UK_NOTE}">перевірити</span></div>` : ''}
      ${glossHTML(it.senses, m, 10)}
      ${k.length > 1 || rd.length > 1 ? `<p class="small"><span class="muted">Інші написання:</span> <span lang="ja">${esc([...k.slice(1), ...rd.slice(k.length ? 1 : 1)].filter(Boolean).join('、'))}</span></p>` : ''}
    </section>
    <section class="panel dc-ex" hidden></section>
    ${[...new Set([...head].filter(ch => KANJI.test(ch)))].length ? `<h2 class="group-title">Канджі слова</h2><div class="dc-kanji-row">${[...new Set([...head].filter(ch => KANJI.test(ch)))].map(ch => { const kk = K.get(ch), b = my.book.get(ch); return `<a class="dc-k" href="#/dict/k/${encodeURIComponent(ch)}"><b lang="ja">${esc(ch)}</b><small>${esc(b?.meaning || kk?.[7]?.split('; ')[0] || '')}</small></a>`; }).join('')}</div>` : ''}
    <p class="small"><a class="link" href="#/translate/${encodeURIComponent(head)}">Розібрати в Перекладачі</a></p>
    <p class="muted small dc-lic">JMdict © EDRDG, CC BY-SA 4.0</p></div>`;
  $('[data-say]', root).onclick = () => speak(rd[0]);
  drawExamples($('.dc-ex', root), it.id, it.senses.length);
  $('[data-add]', root).onclick = () => {
    const g = groupOfPos(it.senses[0]?.[0]);
    const jp = k[0] || '', kn = rd[0];
    const uk = h?.uk || it.uk.split('; ').slice(0, 3).join('; ');
    addToLessonModal({ kanji: g ? toMasu(jp, g) : jp, kana: g ? toMasu(kn, g) : kn, ukrainian: uk, verbGroup: g, title: 'Додати слово до мого уроку', newTitle: 'Словник' });
  };
  $('[data-fav]', root).onclick = e => { const on = toggleFav({ key, label: head, sub: h?.uk || it.uk.split('; ')[0] || it.senses[0]?.[1]?.split('; ')[0] || '', href: '#/dict/w/' + it.id }); e.currentTarget.classList.toggle('on', on); toast(on ? 'Додано до обраного' : 'Прибрано з обраного'); };
}

async function kanjiView(root, ch) {
  root.innerHTML = '<div class="dc"><div class="loading"><span class="sun pulse"></span></div></div>';
  const [K, my, m] = await Promise.all([kanjiData(), mine(), meta()]);
  const k = K.get(ch), b = my.book.get(ch);
  if (!k && !b) { root.innerHTML = `<div class="dc"><a class="back" href="#/dict">${I.back}<span>Словник</span></a><p class="muted">Канджі не знайдено.</p></div>`; return; }
  const key = 'k:' + ch, assoc = b ? getNote(b.id) || defaultAssoc(b.id)?.t || '' : '';
  const on = k?.[5] ? k[5].split('|') : b?.on || [], kun = k?.[6] ? k[6].split('|') : b?.kun || [];
  root.innerHTML = `<div class="dc fade-in"><a class="back" href="javascript:history.back()">${I.back}<span>Назад</span></a>
    <section class="panel dc-kpage">
      <div class="dc-khead"><span class="dc-kbig" lang="ja">${esc(ch)}</span><div class="so-box dc-so"></div>
        <span class="dc-acts"><button type="button" class="icon-btn star ${isFav(key) ? 'on' : ''}" data-fav aria-label="Обране">${I.star}</button></span></div>
      ${b ? `<p class="dc-kmean"><b>${esc(b.meaning)}</b> <a class="link small" href="#/kanji/${encodeURIComponent(b.lessonId)}/${encodeURIComponent(b.id)}">${esc(b.bookTitle)}, картка</a></p>` : ''}
      ${k?.[7] ? `<p class="muted" lang="en">${esc(k[7])}</p>` : ''}
      <div class="kc-readings">${on.length ? `<div><span class="kb-l">он</span><span lang="ja">${esc(on.join('、'))}</span></div>` : ''}${kun.length ? `<div><span class="kb-l">кун</span><span lang="ja">${kun.map(r => kunHTML(r.replace('.', '-'))).join('、')}</span></div>` : ''}</div>
      <div class="kc-facts">${k ? `<span><b>${k[1]}</b> рис.</span>${k[2] ? `<span>клас школи <b>${k[2] <= 6 ? k[2] : 'старші'}</b></span>` : ''}${kanjiLevel(ch) ? `<span>JLPT <a href="#/jlpt" class="jl-link">${jlptChip(kanjiLevel(ch))}</a></span>` : k[3] ? `<span>JLPT (стар.) <b>${k[3]}</b></span>` : ''}${k[4] ? `<span>частотність <b>№${k[4]}</b></span>` : ''}` : ''}</div>
      ${k?.[8] ? `<p class="small"><span class="muted">Складники:</span> <span lang="ja">${[...k[8]].map(c => `<a class="link" href="#/dict/k/${encodeURIComponent(c)}">${esc(c)}</a>`).join(' ')}</span></p>` : ''}
      ${assoc ? `<div class="as-note"><p>${esc(assoc)}</p></div>` : ''}
    </section>
    <h2 class="group-title">Слова з цим канджі</h2><div class="dc-list dc-with"><div class="loading"><span class="sun pulse"></span></div></div>
    <p class="muted small dc-lic">KANJIDIC2 © EDRDG, CC BY-SA 4.0 · порядок рисок: KanjiVG © Ulrich Apel, CC BY-SA 3.0</p></div>`;
  strokeOrder($('.dc-so', root), ch);
  $('[data-fav]', root).onclick = e => { const v = toggleFav({ key, label: ch, sub: b?.meaning || k?.[7]?.split('; ')[0] || '', href: '#/dict/k/' + encodeURIComponent(ch) }); e.currentTarget.classList.toggle('on', v); toast(v ? 'Додано до обраного' : 'Прибрано з обраного'); };
  const r = await ask({ type: 'withKanji', ch, limit: 30 });
  const box = $('.dc-with', root);
  if (box) box.innerHTML = r.items.map(it => `<a class="dc-item" href="#/dict/w/${it.id}"><div>${formsHTML(it)}</div>${glossHTML(it.senses, m, 1)}</a>`).join('') || '<p class="muted small">Немає слів.</p>';
}

async function radicalsView(root) {
  root.innerHTML = '<div class="dc"><div class="loading"><span class="sun pulse"></span></div></div>';
  const [R, K] = await Promise.all([radData(), kanjiData()]);
  const sel = new Set();
  const draw = () => {
    let match = null;
    for (const r of R) if (sel.has(r[0])) { const s = new Set([...r[2]]); match = match ? match.filter(c => s.has(c)) : [...s]; }
    const list = (match || []).filter(c => K.has(c)).sort((a, b) => (K.get(a)[1] - K.get(b)[1]) || ((K.get(a)[4] || 9999) - (K.get(b)[4] || 9999)));
    const possible = match ? new Set(list.flatMap(c => [...(K.get(c)?.[8] || '')])) : null;
    let lastStroke = 0;
    root.innerHTML = `<div class="dc fade-in"><a class="back" href="#/dict">${I.back}<span>Словник</span></a>
      <section class="hero"><div><p class="eyebrow" lang="ja">部首</p><h1>Канджі за ключами</h1><p class="muted">Виберіть складники, які бачите в канджі.</p></div></section>
      <div class="dc-radsel">${sel.size ? `<span class="muted small">Вибрано:</span> ${[...sel].map(r => `<b lang="ja">${esc(r)}</b>`).join(' ')} <button type="button" class="btn ghost sm" data-clear>Очистити</button>` : '<span class="muted small">Нічого не вибрано</span>'}</div>
      ${match ? `<div class="dc-kanji-row dc-found">${list.slice(0, 200).map(c => `<a class="dc-k" href="#/dict/k/${encodeURIComponent(c)}"><b lang="ja">${esc(c)}</b><small>${K.get(c)[1]} рис.</small></a>`).join('') || '<p class="muted small">Немає канджі з усіма вибраними складниками.</p>'}</div>` : ''}
      <div class="dc-rads">${R.map(r => { const head = r[1] !== lastStroke ? `<span class="dc-rs">${(lastStroke = r[1])}</span>` : ''; const dim = possible && !sel.has(r[0]) && !possible.has(r[0]); return `${head}<button type="button" class="dc-r ${sel.has(r[0]) ? 'on' : ''} ${dim ? 'dim' : ''}" data-r="${esc(r[0])}" lang="ja" ${dim ? 'disabled' : ''}>${esc(r[0])}</button>`; }).join('')}</div></div>`;
    $$('[data-r]', root).forEach(b => (b.onclick = () => { const r = b.dataset.r; sel.has(r) ? sel.delete(r) : sel.add(r); draw(); }));
    $('[data-clear]', root)?.addEventListener('click', () => { sel.clear(); draw(); });
  };
  draw();
}

// ---------- browse: every word ----------
const BROWSE_POS = [['-', 'Усі частини мови'], ['n', 'Іменники'], ['v', 'Дієслова'], ['adj-i', 'い-прикметники'], ['adj-na', 'な-прикметники'], ['adv', 'Прислівники'], ['exp', 'Вирази']];
const BROWSE_PAGE = 100;
async function browseView(root, [filter = 'common', pos = '-', sort = 'freq', page = '1']) {
  filter = filter === 'all' ? 'all' : 'common';
  sort = sort === 'kana' ? 'kana' : 'freq';
  pos = BROWSE_POS.some(p => p[0] === pos) ? pos : '-';
  let n = Math.max(1, parseInt(page, 10) || 1);
  const href = (o = {}) => `#/dict/browse/${o.filter || filter}/${o.pos || pos}/${o.sort || sort}/${o.page || 1}`;
  root.innerHTML = `<div class="dc fade-in"><a class="back" href="#/dict">${I.back}<span>Словник</span></a>
    <section class="hero"><div><p class="eyebrow" lang="ja">一覧</p><h1>Усі слова</h1><p class="muted">Гортайте весь словник: спершу найпоширеніші слова, або за абеткою あいうえお.</p></div></section>
    <div class="dc-bfilters">
      <div class="seg" role="group" aria-label="Які слова"><a class="${filter === 'common' ? 'on' : ''}" href="${href({ filter: 'common' })}">Поширені</a><a class="${filter === 'all' ? 'on' : ''}" href="${href({ filter: 'all' })}">Усі 219 000</a></div>
      <div class="seg" role="group" aria-label="Порядок"><a class="${sort === 'freq' ? 'on' : ''}" href="${href({ sort: 'freq' })}">За поширеністю</a><a class="${sort === 'kana' ? 'on' : ''}" href="${href({ sort: 'kana' })}" lang="ja">あいうえお</a></div>
      <select class="input dc-bpos" aria-label="Частина мови">${BROWSE_POS.map(([k, t]) => `<option value="${k}" ${k === pos ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <div class="dc-prog" aria-live="polite"></div>
    <div class="dc-bres"><div class="loading"><span class="sun pulse"></span></div></div></div>`;
  $('.dc-bpos', root).onchange = e => { location.hash = href({ pos: e.target.value }); };
  const prog = $('.dc-prog', root), box = $('.dc-bres', root);
  const off = onDictProgress(s => { if (prog.isConnected) prog.innerHTML = progressHTML(s); });
  prog.innerHTML = progressHTML(state);
  const [r, m, my] = await Promise.all([ask({ type: 'browse', filter, pos: pos === '-' ? '' : pos, sort, offset: (n - 1) * BROWSE_PAGE, limit: BROWSE_PAGE }), meta(), mine()]);
  if (!box.isConnected) return off;
  const pages = Math.max(1, Math.ceil(r.count / BROWSE_PAGE));
  if (n > pages) { location.replace(href({ page: pages })); return off; }
  const pager = `<nav class="dc-pager" aria-label="Сторінки">
      ${n > 1 ? `<a class="btn ghost sm" href="${href({ page: n - 1 })}">← Назад</a>` : '<span></span>'}
      <form class="dc-pjump"><span class="muted small">Сторінка</span><input class="input" name="p" type="number" min="1" max="${pages}" value="${n}" aria-label="Номер сторінки"><span class="muted small">з ${pages.toLocaleString('uk-UA')}</span></form>
      ${n < pages ? `<a class="btn ghost sm" href="${href({ page: n + 1 })}">Далі →</a>` : '<span></span>'}
    </nav>`;
  box.innerHTML = `<p class="muted small">${r.count.toLocaleString('uk-UA')} слів · ${((n - 1) * BROWSE_PAGE + 1).toLocaleString('uk-UA')}–${Math.min(n * BROWSE_PAGE, r.count).toLocaleString('uk-UA')}</p>
    ${pager}<div class="dc-list">${r.items.map(it => itemHTML(it, my, m)).join('')}</div>${pager}`;
  box.querySelectorAll('.dc-pjump').forEach(fm => (fm.onsubmit = e => { e.preventDefault(); const p = Math.min(pages, Math.max(1, parseInt(fm.p.value, 10) || 1)); location.hash = href({ page: p }); }));
  return off;
}

export function dictView(root, parts) {
  const [kind, arg] = parts;
  try {
    if (kind === 'q' && arg) return resultsView(root, arg);
    if (kind === 'w' && arg) return wordView(root, arg);
    if (kind === 'k' && arg) return kanjiView(root, arg);
    if (kind === 'radicals') return radicalsView(root);
    if (kind === 'browse') return browseView(root, parts.slice(1));
  } catch (e) { console.error(e); }
  return homeView(root);
}
