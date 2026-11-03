// Перекладач tab (#/translate, #/translate/<text>): analysis of a Japanese sentence with Ukrainian
// explanations (data/analyzer.json) and links to the grammar points of Minna no Nihongo.
// Tokenizer: Kuromoji (free, open-source, runs in the browser; dictionary from a CDN, cached by sw.js).
// Meanings: my sets + kanji books first, then a small JMdict subset (data/jmdict-mini.json, English).
import { $, $$, esc, I, furi, furiT, speak, toast, modal, JA, tightenJa, hasKanji } from './util.js';
import { getSets, isMine, createSet, addCards } from './store.js';
import { loadKanji, books as kanjiBooks } from './kanji.js';
import { loadGrammar, grammarLessons } from './grammar.js';
import { afterSave } from './edit.js';
import { ensureTokenizer, tokenize, onTokProgress, tokState, tokProgressText } from './tokenizer.js';
import { analyzeText, literal, pointRef, toHira } from './analyzer.js';
import { buildIndex, lookupWord, kanjiParts } from './wordindex.js';

const T = { D: null, dP: null, jm: null, jmP: null, idx: null, idxKey: '' };

function getRules() {
  return (T.dP ||= fetch('data/analyzer.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => (T.D = d)).catch(e => { T.dP = null; throw e; }));
}
async function getIndex() {
  await loadKanji().catch(() => {});
  const sets = getSets();
  const key = sets.length + ':' + sets.reduce((n, s) => n + s.cards.length, 0);
  if (!T.idx || T.idxKey !== key) { T.idx = buildIndex(sets, kanjiBooks()); T.idxKey = key; }
  return T.idx;
}
function getJmdict() {
  return (T.jmP ||= fetch('data/jmdict-mini.json').then(r => r.json()).then(j => {
    const map = new Map();
    for (const [k, r, g] of j.e) {
      const e = { k, r: r.split('|')[0], g };
      for (const x of k ? k.split('|') : []) if (!map.has(x)) map.set(x, e);
      for (const x of r.split('|')) if (!map.has('#' + x)) map.set('#' + x, e);
    }
    T.jm = { map, license: j.license };
    return T.jm;
  }).catch(e => { T.jmP = null; throw e; }));
}

// ---------- helpers ----------
const CLS = { noun: 'n', pron: 'n', name: 'n', num: 'n', time: 'n', formal: 'f', verb: 'v', adj: 'a', na: 'a', adv: 'd', adn: 'd', conj: 'd', interj: 'd', particle: 'p', copula: 'c', copneg: 'c', aux: 'c', other: 'f', punct: 's' };
const reading = (jp, kana) => (hasKanji(jp) && kana && kana !== jp ? `<span class="fg">(${esc(kana)})</span>` : '');
const jpWithReading = (jp, kana) => `<span lang="ja">${esc(jp)}</span>${reading(jp, kana)}`;
function refLink(id, D) {
  const r = pointRef(id);
  if (!r) return '';
  const title = grammarLessons().find(l => l.lesson === r.lesson)?.points.find(p => p.id === id)?.title;
  return `<a class="tr-ref" href="${r.href}" title="${esc(title ? title.replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1') : '')}">${esc(r.ref)}</a>`;
}
const langOf = s => (JA.test(s) ? 'ja' : /[А-Яа-яІіЇїЄєҐґ]/.test(s) ? 'uk' : '');
const cleanInput = s => tightenJa(String(s || '').replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1').replace(/\r/g, '').trim());
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопійовано'); }
  catch { toast('Не вдалося скопіювати'); }
}
/** Dictionary form → ます-form (my cards keep verbs in the ます-form). */
function toMasu(dict, group) {
  const d = String(dict || '');
  if (group === 'III') return d.replace(/する$/, 'します').replace(/(来|く)る$/, (m, k) => (k === '来' ? '来ます' : 'きます'));
  if (group === 'II') return d.replace(/る$/, 'ます');
  const U2I = { 'う': 'い', 'く': 'き', 'ぐ': 'ぎ', 'す': 'し', 'つ': 'ち', 'ぬ': 'に', 'ぶ': 'び', 'む': 'み', 'る': 'り' };
  const last = d.slice(-1);
  return U2I[last] ? d.slice(0, -1) + U2I[last] + 'ます' : d;
}

// ---------- add to my lesson ----------
export function addToLessonModal({ kanji = '', kana = '', ukrainian = '', verbGroup = '', title = 'Додати до мого уроку' }) {
  const mine = getSets().filter(isMine);
  const last = (() => { try { return localStorage.getItem('jp.translate.lastSet') || ''; } catch { return ''; } })();
  modal(`<div class="modal-head"><h2>${esc(title)}</h2></div>
    <form class="tr-add">
      <label class="field"><span>Урок</span><select class="input" name="set">
        ${mine.map(s => `<option value="${esc(s.id)}" ${s.id === last ? 'selected' : ''}>${esc(s.title)} (${s.cards.length})</option>`).join('')}
        <option value="" ${!mine.length ? 'selected' : ''}>+ Новий урок…</option></select></label>
      <label class="field" data-new hidden><span>Назва нового уроку</span><input class="input" name="title" placeholder="Наприклад: Перекладач"></label>
      <label class="field"><span>Кандзі (якщо є)</span><input class="input jp" name="kanji" lang="ja" value="${esc(kanji)}"></label>
      <label class="field"><span>Кана (читання)</span><input class="input jp" name="kana" lang="ja" value="${esc(kana)}"></label>
      <label class="field"><span>Переклад українською</span><textarea class="input" name="uk" rows="2">${esc(ukrainian)}</textarea></label>
      <p class="wf-error" hidden></p>
      <div class="modal-btns"><button type="button" class="btn ghost" data-cancel>Скасувати</button><button class="btn primary">Додати</button></div>
    </form>`, (m, close) => {
    m.classList.add('sheet');
    const f = $('form', m), err = $('.wf-error', m), nw = $('[data-new]', m);
    const sync = () => { nw.hidden = !!f.set.value; };
    sync();
    f.set.onchange = sync;
    $('[data-cancel]', m).onclick = close;
    f.onsubmit = e => {
      e.preventDefault();
      const k = f.kanji.value.trim(), kn = f.kana.value.trim(), uk = f.uk.value.trim();
      const show = msg => { err.textContent = msg; err.hidden = false; };
      if (!k && !kn) return show('Введіть японське слово або речення.');
      if (!uk) return show('Введіть переклад українською.');
      if (hasKanji(kn)) return show('У полі «Кана» мають бути лише хірагана або катакана.');
      const card = { japanese: hasKanji(k) ? k : (k || kn), reading: hasKanji(k) ? kn : '', ukrainian: uk, verbGroup, source: 'my' };
      let setId = f.set.value;
      if (setId) addCards(setId, [card]);
      else setId = createSet(f.title.value.trim() || 'Перекладач', [card]).id;
      try { localStorage.setItem('jp.translate.lastSet', setId); } catch { /* ignore */ }
      close();
      afterSave('Додано до уроку');
    };
  });
}

// ---------- rendering ----------
function blockBtn(b, i) {
  if (b.cls === 'punct') return `<span class="wb-punct" lang="ja">${esc(b.surface)}</span>`;
  return `<button type="button" class="wb wb-${CLS[b.cls] || 'f'}" data-b="${i}" aria-label="${esc(b.surface + ' — ' + b.pos)}">
    <span class="wb-jp" lang="ja">${esc(b.surface)}</span>${hasKanji(b.surface) ? `<span class="wb-kana" lang="ja">(${esc(b.kana)})</span>` : ''}
    <span class="wb-pos">${esc(b.particle ? b.particle.label : b.pos)}</span></button>`;
}

function meaningHTML(b, idx) {
  const m = b.meaning;
  let h = '';
  if (m?.uk) {
    h += `<p class="tr-mean"><b>${esc(m.uk)}</b>${m.approx ? ' <span class="check-badge" title="Знайдено за читанням у кані — перевірте, чи це те саме слово">можливо</span>' : ''}</p>
      <p class="muted small">з моїх слів: <a href="${esc(m.href)}">${esc(m.src)}</a>${m.japanese && m.japanese !== b.base ? ` · <span lang="ja">${esc(m.japanese)}</span>` : ''}</p>`;
    if (m.alts?.length) h += `<p class="muted small">Інші значення: ${m.alts.map(a => `<a href="${esc(a.href)}">${esc(a.uk)}</a>`).join('; ')}</p>`;
  } else if (b.jm) {
    h += `<p class="tr-mean"><b lang="en">${esc(b.jm.g)}</b></p><p class="muted small">Немає в моїх словах · значення англійською з JMdict (${jpWithReading(b.jm.k?.split('|')[0] || b.jm.r, b.jm.r)})</p>`;
  } else if (!['particle', 'copula', 'copneg', 'aux', 'punct'].includes(b.cls)) {
    h += '<p class="muted small">Цього слова немає в моїх словах.</p>';
  }
  const parts = kanjiParts(idx, b.base).filter(p => p.meaning);
  if (parts.length) h += `<p class="tr-kparts">${parts.map(p => `<a href="#/kanji/${esc(p.lessonId)}/${esc(p.id)}" title="Відкрити картку кандзі"><span lang="ja">${esc(p.ch)}</span> ${esc(p.meaning)}</a>`).join('')}</p>`;
  return h;
}

function detailHTML(b, D, idx) {
  if (!b) return '<p class="muted small center">Натисніть на слово, щоб побачити пояснення.</p>';
  const isVerb = b.cls === 'verb', grp = isVerb && b.group ? D.groups[b.group] : null;
  const head = b.potentialOf ? b.potentialOf.base : b.base, headK = b.potentialOf ? b.potentialOf.kana : b.baseKana;
  const word = b.meaning?.uk ? b.meaning.uk.split(/[;,(]/)[0].trim() : '';
  const chain = b.steps.length ? `<div class="tr-chain"><span class="tr-step base" lang="ja">${esc(head)}${word ? ` <span class="tr-step-uk">(${esc(word)})</span>` : ''}</span>${b.steps.flatMap(s => s.chain).map(c => `<span class="tr-arrow">→</span><span class="tr-step">${furi(c)}</span>`).join('')}</div>` : '';
  return `<div class="tr-detail-head">
      <div><div class="tr-word" lang="ja">${esc(b.surface)}</div>${hasKanji(b.surface) ? `<div class="tr-word-kana" lang="ja">(${esc(b.kana)})</div>` : ''}</div>
      <div class="tr-detail-btns"><button type="button" class="icon-btn" data-say="${esc(b.kana)}" aria-label="Вимова">${I.speaker}</button>
      ${!['particle', 'punct', 'copula', 'copneg', 'aux'].includes(b.cls) ? `<button type="button" class="btn ghost sm" data-addword>${I.plus}<span>До мого уроку</span></button>` : ''}</div>
    </div>
    <dl class="tr-dl">
      ${!['particle', 'punct'].includes(b.cls) ? `<dt>Словникова форма</dt><dd>${jpWithReading(head, headK)}</dd>` : ''}
      <dt>Частина мови</dt><dd>${esc(b.pos)}${b.posNote ? ` · ${esc(b.posNote)}` : ''}${grp ? ` · ${esc(grp.label)} ${refLink(grp.point, D)}` : ''}</dd>
    </dl>
    ${meaningHTML(b, idx)}
    ${chain}
    ${b.steps.length ? `<ol class="tr-steps">${b.steps.map(s => `<li>${furi(s.text)} ${refLink(s.point, D)}</li>`).join('')}</ol>` : ''}
    ${b.particle ? `<div class="tr-pinfo"><b lang="ja">${esc(b.particle.name)}</b> — ${esc(b.particle.label)}<p>${furi(b.particle.text)}</p>${refLink(b.particle.point, D)}</div>` : ''}`;
}

function sentenceHTML(r, si, D) {
  const pol = r.politeness;
  return `<section class="panel tr-sent" data-s="${si}">
    <div class="tr-sent-head"><h2 class="sec-title">Речення${si ? ' ' + (si + 1) : ''}</h2>
      <div class="tr-sent-btns"><button type="button" class="icon-btn" data-say="${esc(r.kana)}" aria-label="Прослухати речення">${I.speaker}</button>
      <button type="button" class="icon-btn" data-copy="${esc(r.text)}" aria-label="Копіювати речення">${I.copy}</button>
      <button type="button" class="btn ghost sm" data-addsent="${si}">${I.plus}<span>Речення до уроку</span></button></div></div>
    <div class="tr-blocks">${r.blocks.map(blockBtn).join('')}</div>
    <p class="tr-kana muted small" lang="ja">${esc(r.kana)}</p>
    <div class="tr-detail" aria-live="polite">${detailHTML(null, D)}</div>

    ${r.structure.length ? `<h3 class="sub-title">Будова речення</h3><div class="tr-struct">${r.structure.map(x => `<div class="tr-srow tr-r-${x.role}"><span class="tr-role">${esc(x.label)}</span><span class="tr-stext" lang="ja">${esc(x.text)}</span></div>`).join('')}</div>` : ''}

    <h3 class="sub-title">Рівень ввічливості</h3>
    <div class="tr-pol">${pol.map(p => `<div class="tr-polrow"><b>${furi(p.label)}</b>${p.word ? ` <span lang="ja">(${esc(p.word)})</span>` : ''}<p class="small">${furi(p.text)}</p>${refLink(p.point, D)}</div>`).join('')}</div>

    ${r.particles.length ? `<h3 class="sub-title">Частки в цьому реченні</h3><div class="tr-plist">${r.particles.map(p => `<div class="tr-prow"><span class="tr-pp" lang="ja">${esc(p.p)}</span><div><b>${esc(p.label)}</b>${p.phrase ? ` · <span lang="ja">${esc(p.phrase)}${esc(p.p)}</span>` : ''}<p class="small">${furi(p.text)}</p>${refLink(p.point, D)}</div></div>`).join('')}</div>` : ''}

    <h3 class="sub-title">Граматичні конструкції</h3>
    ${r.constructions.length ? `<div class="tr-clist">${r.constructions.map(c => `<div class="tr-crow"><div class="tr-ctitle" lang="ja">${furiT(c.title)}</div><div class="tr-cmatch" lang="ja">${esc(c.match)}</div><p class="small">${furi(c.text)} ${refLink(c.point, D)}</p></div>`).join('')}</div>`
      : '<p class="muted small">Конструкцій з підручника не знайдено (або вони ще не додані до правил).</p>'}

    <h3 class="sub-title">Дослівно</h3>
    <p class="tr-literal">${esc(r.literal)}</p>
  </section>`;
}

// ---------- view ----------
export function translateView(root, initial) {
  let results = [];
  root.innerHTML = `<div class="translate fade-in">
    <section class="hero"><div><p class="eyebrow" lang="ja">翻訳</p><h1>Перекладач</h1>
      <p class="muted">Розбір японського речення: кожне слово, форма, частка й конструкція — з посиланнями на уроки.</p></div></section>
    <div class="panel tr-input">
      <textarea class="input big" rows="3" placeholder="Введіть або вставте японське речення…" aria-label="Текст для аналізу"></textarea>
      <div class="tr-btns">
        <button type="button" class="btn primary" data-go>${I.search}<span>Розібрати</span></button>
        <button type="button" class="btn ghost" data-example>Приклад</button>
        <button type="button" class="btn ghost" data-clear>Очистити</button>
      </div>
      <div class="progress tr-load" hidden><div class="bar"><i></i></div><span class="progress-label small muted"></span></div>
      <p class="tr-status muted small" role="status"></p>
    </div>
    <div class="tr-legend small"><span class="wb-dot wb-n"></span>іменник <span class="wb-dot wb-v"></span>дієслово <span class="wb-dot wb-a"></span>прикметник <span class="wb-dot wb-p"></span>частка <span class="wb-dot wb-c"></span>зв’язка <span class="wb-dot wb-d"></span>інше</div>
    <div class="tr-out"></div>
    <p class="tr-credits muted small">Розбір: Kuromoji (IPADIC) у браузері · пояснення: правила за підручником Minna no Nihongo · значення: мої слова, кандзі; інакше JMdict © EDRDG (CC BY-SA 4.0).</p>
  </div>`;
  const ta = $('textarea', root), out = $('.tr-out', root), status = $('.tr-status', root);
  const setStatus = (msg, busy = false) => { status.innerHTML = busy ? `<span class="spinner"></span> ${esc(msg)}` : esc(msg); };
  let alive = true, runNo = 0;
  // Dictionary progress (the worker loads it in the background; the page stays responsive)
  const load = $('.tr-load', root), loadBar = $('.bar i', load), loadLbl = $('.progress-label', load);
  const drawLoad = s => {
    if (!alive) return;
    const busy = s.phase === 'download' || s.phase === 'build';
    load.hidden = !busy;
    if (!busy) return;
    const p = tokProgressText(s);
    loadBar.style.width = Math.round(p.frac * 100) + '%';
    load.classList.toggle('indet', s.phase === 'build');
    loadLbl.textContent = p.text;
  };
  const offLoad = onTokProgress(drawLoad);
  drawLoad(tokState);
  ensureTokenizer().catch(() => {}); // start loading as soon as the tab opens

  async function run() {
    const text = cleanInput(ta.value);
    if (!text) { out.innerHTML = ''; setStatus(''); return; }
    const lang = langOf(text);
    if (lang !== 'ja') { setStatus(lang === 'uk' ? 'Переклад з української буде доступний незабаром. Поки що введіть японське речення.' : 'Введіть японське речення.'); return; }
    const my = ++runNo;
    if (location.hash !== '#/translate/' + encodeURIComponent(text)) history.replaceState(null, '', '#/translate/' + encodeURIComponent(text));
    setStatus(tokState.phase === 'ready' ? 'Розбираю…' : 'Розбір почнеться, щойно словник буде готовий — сторінкою можна користуватися.', true);
    try {
      const [tokens, D, idx] = await Promise.all([tokenize(text), getRules(), getIndex(), loadGrammar()]);
      if (!alive || my !== runNo) return;
      results = analyzeText(tokens, D, (b, k, o) => lookupWord(idx, b, k, o));
      render(D, idx);
      setStatus('');
      // words missing from my data → JMdict (English), loaded only when needed
      const missing = results.flatMap(r => r.blocks).filter(b => !b.meaning && !['particle', 'punct', 'copula', 'copneg', 'aux', 'num'].includes(b.cls));
      if (missing.length) {
        const jm = await getJmdict().catch(() => null);
        if (!jm || !alive || my !== runNo) return;
        let found = 0;
        for (const b of missing) {
          const e = jm.map.get(b.base) || (!hasKanji(b.base) && jm.map.get('#' + toHira(b.base))) || jm.map.get(b.surface);
          if (e) { b.jm = e; found++; }
        }
        if (found) render(D, idx, true);
      }
    } catch (e) {
      console.error(e);
      if (alive && my === runNo) setStatus('Не вдалося завантажити словник для розбору. Перевірте інтернет-з’єднання і спробуйте ще раз.');
    }
  }

  function render(D, idx, keepSel = false) {
    const sel = keepSel ? $$('.wb.on', out).map(b => [b.closest('.tr-sent').dataset.s, b.dataset.b]) : [];
    out.innerHTML = results.map((r, i) => sentenceHTML(r, i, D)).join('');
    out.onclick = e => {
      const say = e.target.closest('[data-say]');
      if (say) { speak(say.dataset.say); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) { copy(cp.dataset.copy); return; }
      const sec = e.target.closest('.tr-sent');
      if (!sec) return;
      const r = results[+sec.dataset.s];
      const as = e.target.closest('[data-addsent]');
      if (as) { addToLessonModal({ kanji: hasKanji(r.text) ? r.text : '', kana: r.kana, ukrainian: '', title: 'Додати речення до мого уроку' }); return; }
      const aw = e.target.closest('[data-addword]');
      if (aw) {
        const b = r.blocks[+$('.wb.on', sec)?.dataset.b];
        if (!b) return;
        const base = b.potentialOf ? b.potentialOf.base : b.base, bk = b.potentialOf ? b.potentialOf.kana : b.baseKana;
        const verb = b.cls === 'verb';
        const jp = verb ? toMasu(base, b.group) : base, kn = verb ? toMasu(bk, b.group) : bk;
        addToLessonModal({ kanji: hasKanji(jp) ? jp : '', kana: kn, ukrainian: b.meaning?.uk || '', verbGroup: verb ? b.group : '', title: 'Додати слово до мого уроку' });
        return;
      }
      const wb = e.target.closest('.wb');
      if (wb) {
        const on = wb.classList.contains('on');
        $$('.wb', sec).forEach(x => x.classList.toggle('on', x === wb && !on));
        $('.tr-detail', sec).innerHTML = detailHTML(on ? null : r.blocks[+wb.dataset.b], D, idx);
      }
    };
    for (const [s, b] of sel) $(`.tr-sent[data-s="${s}"] .wb[data-b="${b}"]`, out)?.click();
  }

  $('[data-go]', root).onclick = run;
  $('[data-clear]', root).onclick = () => { ta.value = ''; out.innerHTML = ''; setStatus(''); history.replaceState(null, '', '#/translate'); ta.focus(); };
  $('[data-example]', root).onclick = async () => {
    await loadGrammar();
    const exs = grammarLessons().flatMap(l => l.points.flatMap(p => p.blocks.filter(b => b.ex && !/～|[Ａ-Ｚ]/.test(b.ex)).map(b => b.ex)));
    if (!exs.length) return;
    ta.value = cleanInput(exs[(Math.random() * exs.length) | 0]);
    run();
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
  if (initial) { ta.value = cleanInput(initial); run(); }
  else setTimeout(() => ta.focus({ preventScroll: true }), 50);
  return () => { alive = false; offLoad(); };
}
