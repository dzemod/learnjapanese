// «Словник» tab (#/dict): JMdict (219 000 entries, English glosses) + KANJIDIC2 (10 000 kanji) + RADKFILE, with the
// learner's own Ukrainian data on top (my lessons via wordindex.js, kanji books + associations).
//   #/dict                 search box, favourites, recent searches, radical search link
//   #/dict/q/<query>       results: Japanese (kanji / kana, prefix), romaji → kana, English, Ukrainian (my lessons)
//   #/dict/w/<jmdictId>    word page: forms, readings, senses with parts of speech, «у ваших уроках», its kanji
//   #/dict/k/<kanji>       kanji page: stroke order (KanjiVG via kanji.js), readings, meanings (my Ukrainian one
//                          first), components, words with it, link to the kanji card when it is a book kanji
//   #/dict/radicals        pick components → matching kanji
// Data: data/dict/* (tools/build-dict.mjs), searched in dict-worker.js (chunk 00 = common words first, the rest in
// the background, cached by the service worker). Favourites jp.dict.fav, recent jp.dict.recent. Speech on click only.
import { $, $$, esc, I, speak, toast } from './util.js';
import { getSets } from './store.js';
import { buildIndex, lookupWord } from './wordindex.js';
import { loadKanji, books as kanjiBooks, strokeOrder } from './kanji.js';
import { getNote, defaultAssoc } from './kanji-assoc.js';
import { kunHTML } from './modes.js';

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
export const dictSearch = (q, mode, limit = 50) => ask({ type: 'search', q, mode, limit });
export const dictEntry = wid => ask({ type: 'entry', wid });
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
const glossHTML = (senses, metaP, max = 3) => `<ol class="dc-senses">${senses.slice(0, max).map(s => { const pos = posText(s[0], metaP); return `<li>${pos.length ? `<span class="dc-pos">${esc(pos.join(', '))}</span> ` : ''}<span lang="en">${esc(s[1])}</span></li>`; }).join('')}</ol>`;

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
      <p class="muted">JMdict — 219 000 японських слів з англійськими значеннями, 10 000 канджі. Ваші слова з уроків — українською.</p></div></section>
    ${searchBox()}
    <div class="dc-prog" aria-live="polite"></div>
    <div class="btn-row dc-links"><a class="btn ghost" href="#/dict/radicals"><span lang="ja">部首</span><span>Пошук канджі за ключами</span></a></div>
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
      if (kh.length) sections.push(`<h2 class="group-title">Канджі</h2><div class="dc-kanji-row">${kh.map(k => `<a class="dc-k" href="#/dict/k/${encodeURIComponent(k.kanji)}"><b lang="ja">${esc(k.kanji)}</b><small>${esc(k.meaning)}</small></a>`).join('')}</div>`);
    } else {
      const runs = ja ? [['ja', 'Японською']] : lat ? [['romaji', `Ромаджі → кана`], ['en', 'Англійською']] : [['ja', 'Японською']];
      for (const [mode, title] of runs) {
        const r = await dictSearch(q, mode, 60);
        partial ||= r.partial;
        if (!r.items.length && mode !== 'ja') continue;
        sections.push(`<h2 class="group-title">${title}${mode === 'romaji' && r.q ? ` <span class="muted small" lang="ja">${esc(r.q)}</span>` : ''} <span class="muted small">${r.items.length}${r.items.length >= 60 ? '+' : ''}</span></h2>
          ${r.items.length ? `<div class="dc-list">${r.items.map(it => { const h = lookupWord(my.words, (it.kanji || it.kana).split('|')[0], it.kana.split('|')[0], { strict: true }); return `<a class="dc-item" href="#/dict/w/${it.id}"><div>${formsHTML(it)}</div>${h ? `<div class="dc-mine">${esc(h.uk)} <span class="muted small">· ${esc(h.src)}</span></div>` : ''}${glossHTML(it.senses, m, 2)}</a>`; }).join('')}</div>` : '<p class="muted small">Нічого не знайдено.</p>'}`);
      }
      const kj = [...q].filter(ch => KANJI.test(ch));
      if (kj.length) { const K = await kanjiData(); sections.unshift(`<div class="dc-kanji-row">${[...new Set(kj)].map(ch => { const k = K.get(ch), b = my.book.get(ch); return `<a class="dc-k" href="#/dict/k/${encodeURIComponent(ch)}"><b lang="ja">${esc(ch)}</b><small>${esc(b?.meaning || k?.[7]?.split('; ')[0] || '')}</small></a>`; }).join('')}</div>`); }
    }
    if (box.isConnected) box.innerHTML = sections.join('') || '<p class="muted">Нічого не знайдено.</p>';
  };
  const off = onDictProgress(s => { if (!prog.isConnected) return; prog.innerHTML = progressHTML(s); if (partial && s.loaded >= s.total) { partial = false; draw(); } });
  prog.innerHTML = progressHTML(state);
  await draw();
  return off;
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
        <span class="dc-acts"><button type="button" class="icon-btn" data-say aria-label="Прослухати">${I.speaker}</button><button type="button" class="icon-btn star ${isFav(key) ? 'on' : ''}" data-fav aria-label="Обране">${I.star}</button></span></div>
      ${it.common ? '<span class="chip dc-common">поширене слово</span>' : ''}
      ${h ? `<div class="dc-mine big"><b>${esc(h.uk)}</b> <a class="link small" href="${esc(h.href)}">${esc(h.src)}</a></div>` : ''}
      ${glossHTML(it.senses, m, 10)}
      ${k.length > 1 || rd.length > 1 ? `<p class="small"><span class="muted">Інші написання:</span> <span lang="ja">${esc([...k.slice(1), ...rd.slice(k.length ? 1 : 1)].filter(Boolean).join('、'))}</span></p>` : ''}
    </section>
    ${[...new Set([...head].filter(ch => KANJI.test(ch)))].length ? `<h2 class="group-title">Канджі слова</h2><div class="dc-kanji-row">${[...new Set([...head].filter(ch => KANJI.test(ch)))].map(ch => { const kk = K.get(ch), b = my.book.get(ch); return `<a class="dc-k" href="#/dict/k/${encodeURIComponent(ch)}"><b lang="ja">${esc(ch)}</b><small>${esc(b?.meaning || kk?.[7]?.split('; ')[0] || '')}</small></a>`; }).join('')}</div>` : ''}
    <p class="small"><a class="link" href="#/translate/${encodeURIComponent(head)}">Розібрати в Перекладачі</a></p>
    <p class="muted small dc-lic">JMdict © EDRDG, CC BY-SA 4.0</p></div>`;
  $('[data-say]', root).onclick = () => speak(rd[0]);
  $('[data-fav]', root).onclick = e => { const on = toggleFav({ key, label: head, sub: h?.uk || it.senses[0]?.[1]?.split('; ')[0] || '', href: '#/dict/w/' + it.id }); e.currentTarget.classList.toggle('on', on); toast(on ? 'Додано до обраного' : 'Прибрано з обраного'); };
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
      <div class="kc-facts">${k ? `<span><b>${k[1]}</b> рис.</span>${k[2] ? `<span>клас школи <b>${k[2] <= 6 ? k[2] : 'старші'}</b></span>` : ''}${k[3] ? `<span>JLPT (стар.) <b>N${k[3]}</b></span>` : ''}${k[4] ? `<span>частотність <b>№${k[4]}</b></span>` : ''}` : ''}</div>
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

export function dictView(root, parts) {
  const [kind, arg] = parts;
  try {
    if (kind === 'q' && arg) return resultsView(root, arg);
    if (kind === 'w' && arg) return wordView(root, arg);
    if (kind === 'k' && arg) return kanjiView(root, arg);
    if (kind === 'radicals') return radicalsView(root);
  } catch (e) { console.error(e); }
  return homeView(root);
}
