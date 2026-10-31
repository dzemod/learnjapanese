import { $, $$, esc, shuffle, speakCard, stopSpeech, check, I, onSwipe, justSwiped, isTyping, sizeClass, toast } from './util.js';
import { openWordModal } from './edit.js';
import { state, getSet, prog, record, toggleStar, saveOpts, studyCards, difficultCards, getBest, setBest } from './store.js';

export const MODES = {
  flashcards: { name: 'Картки', jp: '札', desc: 'Перегортай і сортуй', run: flashcards },
  learn: { name: 'Заучування', jp: '学', desc: 'Адаптивні раунди', run: learn },
  write: { name: 'Письмо', jp: '書', desc: 'Введи відповідь', run: write },
  test: { name: 'Тест', jp: '試', desc: 'Перевір себе', run: test },
  match: { name: 'Пари', jp: '合', desc: 'На швидкість', run: match, noAnswer: true },
  listen: { name: 'Аудіювання', jp: '聴', desc: 'Слухай і відповідай', run: listen },
};
Object.entries(MODES).forEach(([k, v]) => (v.key = k));

let curSetId = null;
const PRAISE = ['Правильно!', 'Чудово!', 'Молодець!', 'Так тримати!', 'Ідеально!', 'その通り!', 'すごい!'];
const pickOne = a => a[(Math.random() * a.length) | 0];

// ---------- Sides & rendering ----------
const ansSide = () => (state.opts.answer === 'ja' ? 'ja' : 'uk');
const promptSide = () => (ansSide() === 'uk' ? 'ja' : 'uk');
const hasReading = c => c.reading && c.reading !== c.japanese;
const rd = c => (hasReading(c) ? `(${c.reading})` : '');
export function metaHTML(c) {
  const bits = [];
  if (c.hint) bits.push(`<span lang="ja">${esc(c.hint)}</span>`);
  if (c.verbGroup) bits.push(`<span class="vg">гр. ${esc(c.verbGroup)}</span>`);
  return bits.length ? `<div class="meta">${bits.join('')}</div>` : '';
}
export const answerText = (c, side = ansSide()) => (side === 'ja' ? c.japanese : c.ukrainian);

export function faceHTML(card, side) {
  if (side === 'ja')
    return `<div class="jp-big ${sizeClass(card.japanese)}" lang="ja">${esc(card.japanese)}</div>${hasReading(card) ? `<div class="reading" lang="ja">${esc(rd(card))}</div>` : ''}${metaHTML(card)}`;
  return `<div class="uk-big ${sizeClass(card.ukrainian)}">${esc(card.ukrainian)}</div>`;
}
function optionHTML(c, side) {
  return side === 'ja'
    ? `<span class="opt-main jp" lang="ja">${esc(c.japanese)}</span>${hasReading(c) ? `<small class="reading" lang="ja">${esc(rd(c))}</small>` : ''}`
    : `<span class="opt-main">${esc(c.ukrainian)}</span>`;
}
export function fullLine(c) {
  return `<div class="reveal" data-card="${esc(c.id)}"><span class="jp" lang="ja">${esc(c.japanese)}</span>${hasReading(c) ? `<span class="reading" lang="ja">${esc(rd(c))}</span>` : ''}<span class="dash">—</span><span class="uk">${esc(c.ukrainian)}</span><button class="icon-btn sm" data-say aria-label="Вимова">${I.speaker}</button><button class="icon-btn sm" data-edit aria-label="Редагувати слово">${I.edit}</button></div>`;
}
function promptHTML(c) {
  const side = promptSide();
  return `<div class="prompt-box">${faceHTML(c, side)}${side === 'ja' ? `<button class="icon-btn say" data-say aria-label="Вимова">${I.speaker}</button>` : ''}</div>`;
}
function wireSay(el, card) {
  $$('[data-say]', el).forEach(b => (b.onclick = e => { e.stopPropagation(); speakCard(card); }));
  $$('[data-edit]', el).forEach(b => (b.onclick = e => { e.stopPropagation(); editInMode(card, () => refreshReveals(el, card)); }));
}
/** Edit a word without leaving the mode; updates the card object in place. */
export function editInMode(card, after) {
  openWordModal(curSetId, card, (c, action) => {
    const fresh = getSet(curSetId)?.cards.find(x => x.id === card.id);
    if (fresh) Object.assign(card, fresh);
    card._deleted = !fresh;
    after?.(action);
  });
}
function refreshReveals(el, card) {
  $$(`.reveal[data-card="${CSS.escape(card.id)}"]`, el).forEach(r => {
    const tmp = document.createElement('div');
    tmp.innerHTML = fullLine(card);
    const n = tmp.firstElementChild;
    if (card._deleted) n.classList.add('deleted');
    r.replaceWith(n);
    wireSay(n, card);
  });
}
function distractors(card, set, side, n = 3) {
  const key = c => answerText(c, side).trim().toLowerCase();
  const seen = new Set([key(card)]);
  const out = [];
  for (const c of shuffle(set.cards)) {
    if (out.length >= n) break;
    const k = key(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// ---------- Mode shell (top bar + options) ----------
export function modeView(root, setId, mode, api) {
  const set = getSet(setId);
  const def = MODES[mode];
  if (!set || !def) { location.hash = '#/'; return; }
  curSetId = set.id;
  root.innerHTML = `<div class="mode-page">
    <div class="mode-top">
      <a class="icon-btn" href="#/set/${encodeURIComponent(set.id)}" aria-label="Назад до уроку">${I.close}</a>
      <div class="mode-title"><span class="mode-jp" lang="ja">${def.jp}</span><div><div class="mode-name">${def.name}</div><div class="mode-set">${esc(set.title)}</div></div></div>
      <button class="icon-btn opts-btn" data-opts aria-label="Налаштування">${I.sliders}<span>Налаштування</span></button>
    </div>
    <div class="opts-panel" hidden></div>
    <div class="mode-body"></div>
  </div>`;
  const panel = $('.opts-panel', root), body = $('.mode-body', root);
  $('[data-opts]', root).onclick = () => (panel.hidden = !panel.hidden);
  let sub = null;
  const start = () => {
    sub?.(); sub = null;
    api.clearTimers(); api.setKey(null); stopSpeech();
    const cards = studyCards(set);
    renderOpts(panel, def, set, start);
    if (!cards.length) {
      body.innerHTML = `<div class="empty fade-in"><div class="empty-jp" lang="ja">空</div><p>Немає слів за цим фільтром${state.opts.filter === 'starred' ? ' — спершу позначте слова ★' : state.opts.filter === 'difficult' ? ' — помилок ще немає' : ''}.</p><button class="btn primary" data-all>Вчити всі слова</button></div>`;
      $('[data-all]', body).onclick = () => { saveOpts({ filter: 'all' }); start(); };
      return;
    }
    sub = def.run(body, set, cards, api, start) || null;
  };
  start();
  return () => sub?.();
}

function seg(name, label, items, cur) {
  return `<div class="opt"><span class="opt-label">${label}</span><div class="seg" data-name="${name}">${items
    .map(([v, t]) => `<button class="${String(v) === String(cur) ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div></div>`;
}
function renderOpts(panel, def, set, restart) {
  const o = state.opts;
  const nStar = set.cards.filter(c => prog(set.id, c.id).star).length;
  const nDiff = difficultCards(set).length;
  panel.innerHTML =
    (def.noAnswer ? '' : def.key === 'listen'
      ? seg('answer', 'Відповідь', [['uk', 'Значення (UA)'], ['ja', '日本語 диктант']], o.answer)
      : seg('answer', 'Відповідь', [['uk', 'Українська'], ['ja', '日本語']], o.answer)) +
    (def.key === 'listen' ? seg('listenType', 'Спосіб', [['choose', 'Вибір'], ['type', 'Введення']], o.listenType) : '') +
    seg('filter', 'Слова', [['all', `Усі ${set.cards.length}`], ['starred', `★ Позначені ${nStar}`], ['difficult', `Важкі ${nDiff}`]], o.filter) +
    seg('shuffle', 'Порядок', [['false', 'По порядку'], ['true', 'Перемішати']], o.shuffle);
  $$('.seg', panel).forEach(s => (s.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    let v = b.dataset.v;
    if (s.dataset.name === 'shuffle') v = v === 'true';
    saveOpts({ [s.dataset.name]: v });
    restart();
  }));
}

// ---------- Question components ----------
function finish(el, api, card, ok, onDone, { auto = false, override = false, note = '' } = {}) {
  const foot = $('.q-foot', el);
  foot.innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}">${ok ? pickOne(PRAISE) : 'Не зовсім — запам’ятайте:'}${note ? ` <small>${note}</small>` : ''}</div>
    ${fullLine(card)}
    <div class="foot-btns">${override ? `<button class="btn ghost" data-over>Я мав(ла) рацію</button>` : ''}<button class="btn primary" data-next>Далі <kbd>Enter</kbd></button></div>`;
  foot.classList.add('fade-in');
  wireSay(foot, card);
  let gone = false, t = null;
  const go = res => { if (gone) return; gone = true; api.clear(t); api.setKey(null); onDone(res); };
  if (auto) t = api.later(() => go(ok), 1000);
  $('[data-next]', foot).onclick = () => go(ok);
  if (override) $('[data-over]', foot).onclick = () => go(true);
  api.setKey(e => {
    if (e.repeat) return;
    if (e.key === 'Enter') { e.preventDefault(); go(ok); }
    else if (override && (e.key === 'o' || e.key === 'O') && !isTyping(e)) go(true);
  });
  if (!auto) $('[data-next]', foot).focus({ preventScroll: true });
  foot.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

/** Multiple choice. onDone(ok) */
function mcQ(el, api, { card, set, side, prompt, label, onDone, onKey }) {
  const opts = shuffle([card, ...distractors(card, set, side)]);
  el.innerHTML = `<div class="q fade-in">
    <div class="q-label">${label || 'Виберіть правильну відповідь'}</div>
    ${prompt}
    <div class="choices">${opts.map((c, i) => `<button class="choice" data-i="${i}"><kbd>${i + 1}</kbd>${optionHTML(c, side)}</button>`).join('')}</div>
    <div class="q-foot"></div></div>`;
  wireSay(el, card);
  let done = false;
  const pick = i => {
    if (done) return;
    done = true;
    const ok = opts[i].id === card.id;
    const btns = $$('.choice', el);
    btns.forEach(b => (b.disabled = true));
    btns[opts.indexOf(card)].classList.add('correct');
    btns[i].classList.add(ok ? 'glow' : 'wrong');
    if (!ok) btns[i].classList.add('shake');
    finish(el, api, card, ok, onDone, { auto: ok });
  };
  $$('.choice', el).forEach(b => (b.onclick = () => pick(+b.dataset.i)));
  api.setKey(e => {
    if (onKey?.(e)) return;
    if (!done && /^[1-9]$/.test(e.key) && +e.key <= opts.length) pick(+e.key - 1);
  });
}

/** Written answer. onDone(ok, given) */
function writeQ(el, api, { card, side, prompt, label, onDone }) {
  el.innerHTML = `<div class="q fade-in">
    <div class="q-label">${label || (side === 'uk' ? 'Напишіть значення українською' : 'Напишіть японською')}</div>
    ${prompt}
    <form class="write-form" autocomplete="off">
      <input class="answer-input" lang="${side === 'ja' ? 'ja' : 'uk'}" placeholder="${side === 'ja' ? '日本語で…' : 'Українською…'}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
      <div class="write-btns"><button type="button" class="btn ghost" data-dk>Не знаю</button><button class="btn primary" type="submit">Перевірити</button></div>
    </form>
    <div class="q-foot"></div></div>`;
  wireSay(el, card);
  const input = $('input', el);
  api.later(() => input.focus({ preventScroll: true }), 60);
  let done = false;
  const submit = dontKnow => {
    if (done) return;
    const val = input.value;
    if (!dontKnow && !val.trim()) {
      input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
      return;
    }
    done = true;
    input.disabled = true;
    $$('.write-btns button', el).forEach(b => (b.disabled = true));
    const r = dontKnow ? { ok: false } : check(val, card, side);
    input.classList.add(r.ok ? 'good' : 'bad');
    if (r.ok) input.classList.add('glow'); else input.classList.add('shake');
    finish(el, api, card, r.ok, ok => onDone(ok, dontKnow ? '' : val), {
      auto: r.ok && !r.typo, override: !r.ok && !dontKnow, note: r.typo ? '(дрібну помилку зараховано)' : '',
    });
  };
  $('form', el).onsubmit = e => { e.preventDefault(); submit(false); };
  $('[data-dk]', el).onclick = () => submit(true);
}

function showResults(body, api, { title, results, onRetry, onRestart }) {
  api.setKey(null);
  const n = results.length, ok = results.filter(r => r.ok).length, pct = n ? Math.round((ok / n) * 100) : 0;
  const missed = results.filter(r => !r.ok);
  body.innerHTML = `<div class="results fade-in">
    <div class="score-ring" style="--p:${pct}"><span>${pct}<small>%</small></span></div>
    <h2>${title}</h2>
    <p class="muted">${ok} з ${n} правильно</p>
    ${missed.length ? `<h3 class="sec-title">Помилки</h3><div class="miss-list">${missed.map(r => `<div class="miss">${fullLine(r.card)}${r.given ? `<div class="given">Ви написали: <s>${esc(r.given)}</s></div>` : ''}</div>`).join('')}</div>` : `<p class="perfect" lang="ja">完璧 — ідеально!</p>`}
    <div class="res-btns">${missed.length && onRetry ? `<button class="btn primary" data-retry>Повторити помилки (${missed.length})</button>` : ''}<button class="btn ${missed.length && onRetry ? 'ghost' : 'primary'}" data-restart>Почати знову</button></div>
  </div>`;
  $$('.miss', body).forEach((m, i) => wireSay(m, missed[i].card));
  $('[data-retry]', body)?.addEventListener('click', onRetry);
  $('[data-restart]', body).onclick = onRestart;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Ask each card once, then show results. ask(stageEl, card, done(ok, given)) */
function sequence(body, api, cards, { title, ask }) {
  const run = list => {
    let i = 0;
    const res = [];
    body.innerHTML = `<div class="seq"><div class="seq-top"><div class="bar"><i></i></div><span class="seq-pos"></span></div><div class="seq-stage"></div></div>`;
    const bar = $('.bar i', body), pos = $('.seq-pos', body), stage = $('.seq-stage', body);
    const step = () => {
      if (i >= list.length)
        return showResults(body, api, {
          title, results: res,
          onRetry: () => run(res.filter(r => !r.ok).map(r => r.card)),
          onRestart: () => run(state.opts.shuffle ? shuffle(cards) : cards),
        });
      bar.style.width = (i / list.length) * 100 + '%';
      pos.textContent = `${i + 1} / ${list.length}`;
      const c = list[i];
      ask(stage, c, (ok, given) => { res.push({ card: c, ok, given }); i++; step(); });
    };
    step();
  };
  run(cards);
}

// =====================================================================
// 1. FLASHCARDS
// =====================================================================
function flashcards(body, set, allCards, api, restart) {
  const sorting = state.opts.fcSort !== false;
  let auto = null;
  const stopAuto = () => { api.clear(auto); auto = null; $('[data-t="auto"]', body)?.classList.remove('on'); };

  const begin = deck => {
    let i = 0, know = [], still = [], hist = [], ended = false;
    stopAuto();
    body.innerHTML = `<div class="fc">
      <div class="fc-top">
        ${sorting ? `<div class="fc-count bad"><b data-n-still>0</b><span>Ще вчу</span></div>` : '<span></span>'}
        <div class="fc-pos"></div>
        ${sorting ? `<div class="fc-count good"><span>Знаю</span><b data-n-know>0</b></div>` : '<span></span>'}
      </div>
      <div class="bar thin"><i class="fc-bar"></i></div>
      <div class="fc-stage">
        <div class="flip-wrap">
          <div class="flip" tabindex="0" aria-label="Картка, пробіл — перевернути"><div class="face front"></div><div class="face back"></div></div>
          <div class="card-tools"><button class="icon-btn star" data-star aria-label="Позначити">${I.star}</button><button class="icon-btn" data-say aria-label="Вимова">${I.speaker}</button><button class="icon-btn" data-fedit aria-label="Редагувати слово">${I.edit}</button></div>
          <div class="tap-hint">Торкніться, щоб перевернути</div>
        </div>
        <div class="fc-ctrl"></div>
      </div>
      <div class="fc-tools">
        <button class="tool ${sorting ? 'on' : ''}" data-t="sort"><span class="sw"></span>Відстежувати прогрес</button>
        <button class="tool ${state.opts.shuffle ? 'on' : ''}" data-t="shuffle">${I.shuffle}<span>Перемішати</span></button>
        <button class="tool" data-t="auto">${I.play}<span>Автопрогравання</span></button>
      </div>
      <p class="kbd-hint">Пробіл — перевернути · ${sorting ? '← ще вчу · → знаю · Backspace — скасувати' : '← → назад / далі'} · S — позначити · V — звук · E — редагувати</p>
    </div>`;
    const flip = $('.flip', body), front = $('.front', body), back = $('.back', body), wrap = $('.flip-wrap', body);
    const cur = () => deck[i];

    const backHTML = c => (ansSide() === 'uk'
      ? `${faceHTML(c, 'uk')}<div class="back-sub"><span class="jp" lang="ja">${esc(c.japanese)}</span>${hasReading(c) ? ` <span lang="ja">${esc(rd(c))}</span>` : ''}</div>`
      : faceHTML(c, 'ja'));

    const show = anim => {
      if (i >= deck.length) return summary();
      const c = cur();
      flip.classList.add('no-anim'); flip.classList.remove('flipped'); void flip.offsetWidth; flip.classList.remove('no-anim');
      front.innerHTML = faceHTML(c, promptSide());
      back.innerHTML = backHTML(c);
      if (anim) { wrap.classList.remove('enter-l', 'enter-r'); void wrap.offsetWidth; wrap.classList.add(anim); }
      $('.fc-pos', body).textContent = `${i + 1} / ${deck.length}`;
      $('.fc-bar', body).style.width = (i / deck.length) * 100 + '%';
      $('[data-star]', body).classList.toggle('on', prog(set.id, c.id).star);
      if (sorting) { $('[data-n-still]', body).textContent = still.length; $('[data-n-know]', body).textContent = know.length; }
      ctrl();
      if (auto && promptSide() === 'ja') speakCard(c);
    };
    const ctrl = () => {
      $('.fc-ctrl', body).innerHTML = sorting
        ? `<button class="big-btn bad" data-a="still">${I.close}<span>Ще вчу</span></button>
           <button class="icon-btn" data-a="undo" ${hist.length ? '' : 'disabled'} aria-label="Скасувати">${I.undo}</button>
           <button class="big-btn good" data-a="know">${I.check}<span>Знаю</span></button>`
        : `<button class="round-btn" data-a="prev" ${i ? '' : 'disabled'} aria-label="Назад">${I.left}</button>
           <span class="fc-pos2">${i + 1} / ${deck.length}</span>
           <button class="round-btn" data-a="next" aria-label="Далі">${I.right}</button>`;
    };
    const doFlip = () => {
      if (ended) return;
      flip.classList.toggle('flipped');
      $('.tap-hint', body)?.remove();
    };
    const sort = kind => {
      if (ended || i >= deck.length) return;
      const c = cur();
      (kind === 'know' ? know : still).push(c);
      hist.push(kind);
      record(set.id, c.id, kind === 'know', 'mc');
      i++;
      show(kind === 'know' ? 'enter-r' : 'enter-l');
    };
    const undo = () => {
      if (ended || !hist.length) return;
      const k = hist.pop();
      (k === 'know' ? know : still).pop();
      i--;
      show('enter-l');
    };
    const next = () => { if (ended) return; i++; show('enter-r'); };
    const prev = () => { if (ended || i === 0) return; i--; show('enter-l'); };
    const star = () => { if (ended) return; $('[data-star]', body).classList.toggle('on', toggleStar(set.id, cur().id)); };

    const summary = () => {
      ended = true;
      stopAuto();
      api.setKey(e => { if (e.key === 'Enter') $('.results .btn.primary', body)?.click(); });
      const allKnown = sorting && !still.length;
      $('.fc-stage', body).innerHTML = `<div class="results fade-in">
        <div class="big-jp" lang="ja">${allKnown ? '完' : '続'}</div>
        <h2>${!sorting ? 'Ви переглянули всі картки' : allKnown ? 'Ви знаєте всі слова!' : 'Добра робота — продовжуйте!'}</h2>
        ${sorting ? `<div class="sum-counts"><div class="good"><b>${know.length}</b>Знаю</div><div class="bad"><b>${still.length}</b>Ще вчу</div></div>` : ''}
        <div class="res-btns">
          ${sorting && still.length ? `<button class="btn primary" data-again>Повторити ще ${still.length}</button>` : ''}
          <button class="btn ${sorting && still.length ? 'ghost' : 'primary'}" data-restart>Почати картки знову</button>
          <a class="btn ghost" href="#/set/${encodeURIComponent(set.id)}/learn">Перейти до заучування</a>
        </div></div>`;
      $('.fc-bar', body).style.width = '100%';
      $('[data-again]', body)?.addEventListener('click', () => begin(state.opts.shuffle ? shuffle(still) : still));
      $('[data-restart]', body).onclick = () => begin(state.opts.shuffle ? shuffle(allCards) : allCards);
    };

    flip.onclick = () => { if (!justSwiped(wrap)) doFlip(); };
    onSwipe(wrap, { left: () => (sorting ? sort('still') : next()), right: () => (sorting ? sort('know') : prev()) });
    $('[data-star]', body).onclick = e => { e.stopPropagation(); star(); };
    $('[data-say]', body).onclick = e => { e.stopPropagation(); speakCard(cur()); };
    $('[data-fedit]', body).onclick = e => {
      e.stopPropagation();
      if (ended) return;
      stopAuto();
      const wasFlipped = flip.classList.contains('flipped');
      editInMode(cur(), () => {
        if (cur()?._deleted) { deck.splice(i, 1); show(); return; }
        front.innerHTML = faceHTML(cur(), promptSide());
        back.innerHTML = backHTML(cur());
        flip.classList.toggle('flipped', wasFlipped);
      });
    };
    $('.fc-ctrl', body).onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      ({ still: () => sort('still'), know: () => sort('know'), undo, next, prev })[a]?.();
    };
    $('.fc-tools', body).onclick = e => {
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (t === 'sort') { saveOpts({ fcSort: !sorting }); restart(); }
      else if (t === 'shuffle') { saveOpts({ shuffle: !state.opts.shuffle }); restart(); }
      else if (t === 'auto') {
        if (auto) return stopAuto();
        if (ended) return;
        e.target.closest('.tool').classList.add('on');
        if (promptSide() === 'ja') speakCard(cur());
        auto = api.every(() => {
          if (ended) return stopAuto();
          if (!flip.classList.contains('flipped')) { doFlip(); if (promptSide() === 'uk') speakCard(cur()); }
          else if (i < deck.length - 1) next();
          else { stopAuto(); i++; show(); }
        }, 2800);
      }
    };
    api.setKey(e => {
      if (ended || isTyping(e)) return;
      const k = e.key;
      if (k === 'e' || k === 'E') { $('[data-fedit]', body).click(); return; }
      if (k === ' ' || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); doFlip(); }
      else if (k === 'ArrowRight') sorting ? sort('know') : next();
      else if (k === 'ArrowLeft') sorting ? sort('still') : prev();
      else if (k === 's' || k === 'S') star();
      else if (k === 'v' || k === 'V') speakCard(cur());
      else if (sorting && (k === 'Backspace' || (e.ctrlKey && k === 'z'))) { e.preventDefault(); undo(); }
    });
    show();
  };
  begin(allCards);
  return stopAuto;
}

// =====================================================================
// 2. LEARN (adaptive)
// =====================================================================
function learn(body, set, cards, api) {
  const side = ansSide();
  const st = new Map(cards.map(c => [c.id, Math.min(2, prog(set.id, c.id).lvl || 0)]));
  let roundNo = 0, queue = [], roundCards = [], missed = new Set();

  body.innerHTML = `<div class="learn"><div class="learn-prog"></div><div class="learn-stage"></div></div>`;
  const progEl = $('.learn-prog', body), stage = $('.learn-stage', body);

  const counts = () => {
    let n = 0, f = 0, m = 0;
    cards.forEach(c => { const s = st.get(c.id); s >= 2 ? m++ : s === 1 ? f++ : n++; });
    return { n, f, m, t: cards.length };
  };
  const drawProg = () => {
    const { n, f, m, t } = counts();
    progEl.innerHTML = `<div class="stack-bar"><i class="m" style="width:${(m / t) * 100}%"></i><i class="l" style="width:${(f / t) * 100}%"></i></div>
      <div class="legend"><span><i class="dot n"></i>Нові ${n}</span><span><i class="dot l"></i>Знайомі ${f}</span><span><i class="dot m"></i>Вивчені ${m}</span>${roundNo ? `<span class="round-tag">Раунд ${roundNo}</span>` : ''}</div>`;
  };

  const nextRound = () => {
    const pend = cards.filter(c => st.get(c.id) < 2);
    if (!pend.length) return done();
    roundCards = pend.slice(0, 7);
    queue = [...roundCards];
    missed = new Set();
    roundNo++;
    ask();
  };
  const ask = () => {
    drawProg();
    if (!queue.length) return summary();
    const c = queue[0], s = st.get(c.id);
    const onDone = ok => {
      record(set.id, c.id, ok, s === 0 ? 'mc' : 'write');
      queue.shift();
      if (ok) st.set(c.id, s + 1);
      else { missed.add(c.id); queue.splice(Math.min(queue.length, 3), 0, c); }
      ask();
    };
    if (s === 0) mcQ(stage, api, { card: c, set, side, prompt: promptHTML(c), onDone });
    else writeQ(stage, api, { card: c, side, prompt: promptHTML(c), onDone, label: side === 'uk' ? 'Тепер напишіть — українською' : 'Тепер напишіть — японською' });
  };
  const summary = () => {
    drawProg();
    const { m, t } = counts();
    const label = s => ['Нові', 'Знайомі', 'Вивчені'][s];
    stage.innerHTML = `<div class="results fade-in">
      <div class="round-badge">Раунд ${roundNo} завершено</div>
      <h2>${m === t ? 'Усе вивчено!' : missed.size ? 'Добре — продовжуйте' : 'Чудовий раунд!'}</h2>
      <p class="muted">Вивчено ${m} з ${t}</p>
      <div class="round-list">${roundCards.map(c => `<div class="round-item"><span class="jp" lang="ja">${esc(c.japanese)} <small class="reading">${esc(rd(c))}</small></span><span class="uk">${esc(c.ukrainian)}</span><span class="chip lvl${st.get(c.id)}">${label(st.get(c.id))}</span><button class="icon-btn sm" data-ledit="${esc(c.id)}" aria-label="Редагувати">${I.edit}</button></div>`).join('')}</div>
      <div class="res-btns"><button class="btn primary" data-go>${m === t ? 'Завершити' : 'Далі'} <kbd>Enter</kbd></button></div>
    </div>`;
    $('[data-go]', stage).onclick = nextRound;
    $$('[data-ledit]', stage).forEach(b => (b.onclick = () => {
      const c = roundCards.find(x => x.id === b.dataset.ledit);
      editInMode(c, () => summary());
    }));
    $('[data-go]', stage).focus({ preventScroll: true });
    api.setKey(e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); nextRound(); } });
  };
  const done = (fresh = false) => {
    drawProg();
    api.setKey(null);
    stage.innerHTML = `<div class="results fade-in">
      <div class="big-jp" lang="ja">完</div>
      <h2>${fresh ? 'Ви вже вивчили всі ці слова' : `Ви вивчили всі слова (${cards.length})!`}</h2>
      <p class="muted">${fresh ? 'Повторіть їх з початку або пройдіть тест.' : 'お疲れさまでした — чудова робота.'}</p>
      <div class="res-btns"><button class="btn primary" data-again>Вчити знову</button><a class="btn ghost" href="#/set/${encodeURIComponent(set.id)}/test">Пройти тест</a><a class="btn ghost" href="#/set/${encodeURIComponent(set.id)}">До уроку</a></div>
    </div>`;
    $('[data-again]', stage).onclick = () => { cards.forEach(c => st.set(c.id, 0)); roundNo = 0; nextRound(); };
  };

  if (cards.every(c => st.get(c.id) >= 2)) done(true);
  else nextRound();
}

// =====================================================================
// 3. WRITE
// =====================================================================
function write(body, set, cards, api) {
  const side = ansSide();
  sequence(body, api, cards, {
    title: 'Письмо — результати',
    ask: (el, c, done) => writeQ(el, api, {
      card: c, side, prompt: promptHTML(c),
      onDone: (ok, given) => { record(set.id, c.id, ok, 'write'); done(ok, given); },
    }),
  });
}

// =====================================================================
// 6. LISTENING
// =====================================================================
function listen(body, set, cards, api) {
  const side = ansSide();
  const type = state.opts.listenType === 'type' ? 'type' : 'choose';
  sequence(body, api, cards, {
    title: 'Аудіювання — результати',
    ask: (el, c, done) => {
      const prompt = `<div class="listen-prompt">
        <button class="listen-btn" data-play aria-label="Відтворити">${I.speaker}</button>
        <button class="btn ghost sm" data-slow>Повільно</button>
        <div class="listen-hint">${side === 'uk' ? 'Слухайте — що це означає?' : 'Слухайте — напишіть, що чуєте'}${type === 'choose' ? ' · R — повторити' : ''}</div>
      </div>`;
      const args = {
        card: c, set, side, prompt, label: ' ',
        onDone: (ok, given) => { record(set.id, c.id, ok, type === 'type' ? 'write' : 'mc'); done(ok, given); },
        onKey: e => { if (e.key === 'r' || e.key === 'R') { speakCard(c); return true; } },
      };
      type === 'choose' ? mcQ(el, api, args) : writeQ(el, api, args);
      $('[data-play]', el).onclick = () => speakCard(c);
      $('[data-slow]', el).onclick = () => speakCard(c, true);
      api.later(() => speakCard(c), 250);
    },
  });
}

// =====================================================================
// 4. TEST
// =====================================================================
function test(body, set, cards, api) {
  const side = ansSide();
  const TYPES = [['written', 'Письмові'], ['match', 'Відповідність'], ['mc', 'Вибір відповіді'], ['tf', 'Правда / неправда']];
  let lastTypes = ['written', 'match', 'mc', 'tf'];

  const setup = () => {
    api.setKey(null);
    const n = cards.length, def = Math.min(n, 20);
    body.innerHTML = `<div class="panel test-setup fade-in">
      <div class="big-jp" lang="ja">試</div>
      <h2>Створити тест</h2>
      <label class="field"><span class="field-label">Питань <b class="qn">${def}</b> <span class="muted">з ${n}</span></span>
        <input type="range" min="1" max="${n}" value="${def}" class="range"></label>
      <div class="field"><span class="field-label">Типи питань</span>
        <div class="checks">${TYPES.map(([k, t]) => `<label class="check"><input type="checkbox" value="${k}" ${lastTypes.includes(k) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
      <button class="btn primary wide" data-go>Почати тест</button>
    </div>`;
    const range = $('.range', body);
    range.oninput = () => ($('.qn', body).textContent = range.value);
    $('[data-go]', body).onclick = () => {
      const types = $$('.checks input:checked', body).map(i => i.value);
      if (!types.length) return toast('Виберіть хоча б один тип питань');
      lastTypes = types;
      generate(+range.value, types);
    };
  };

  const generate = (count, types) => {
    const pick = shuffle(cards).slice(0, count);
    const buckets = {};
    const order = shuffle(types);
    pick.forEach((c, i) => (buckets[order[i % order.length]] ||= []).push(c));
    if (buckets.match && buckets.match.length < 2) {
      const fb = types.find(t => t !== 'match') || 'mc';
      (buckets[fb] ||= []).push(...buckets.match);
      delete buckets.match;
    }
    const qs = [];
    for (const [type] of TYPES) {
      const list = buckets[type];
      if (!list) continue;
      if (type === 'match') {
        for (let k = 0; k < list.length; k += 6) {
          let group = list.slice(k, k + 6);
          if (group.length === 1 && qs.length) { qs.push({ type: 'mc', card: group[0], opts: shuffle([group[0], ...distractors(group[0], set, side)]) }); continue; }
          qs.push({ type: 'match', group, answers: shuffle(group) });
        }
      } else for (const c of list) {
        if (type === 'tf') {
          const other = distractors(c, set, side, 1)[0];
          const truth = !other || Math.random() < 0.5;
          qs.push({ type, card: c, shown: truth ? c : other, truth });
        } else if (type === 'mc') qs.push({ type, card: c, opts: shuffle([c, ...distractors(c, set, side)]) });
        else qs.push({ type, card: c });
      }
    }
    render(qs);
  };

  const render = qs => {
    const total = qs.reduce((n, q) => n + (q.type === 'match' ? q.group.length : 1), 0);
    let num = 0;
    const titles = { written: 'Письмові відповіді', match: 'Відповідність', mc: 'Вибір відповіді', tf: 'Правда чи неправда' };
    let lastType = null;
    const html = qs.map((q, qi) => {
      const head = q.type !== lastType ? `<h3 class="sec-title tsec">${titles[q.type]}</h3>` : '';
      lastType = q.type;
      if (q.type === 'match') {
        const rows = q.group.map((c, ri) => `<div class="mrow" data-row="${ri}"><span class="tq-num">${++num}</span><div class="mprompt">${faceHTML(c, promptSide())}</div>
          <select class="select"><option value="">Виберіть…</option>${q.answers.map(a => `<option value="${esc(a.id)}">${esc(answerText(a, side))}</option>`).join('')}</select><div class="tq-correct"></div></div>`).join('');
        return `${head}<div class="tq match-q" data-q="${qi}"><div class="tq-label">Зіставте кожне слово з відповіддю</div>${rows}</div>`;
      }
      const n = ++num;
      const pr = `<div class="tq-prompt">${faceHTML(q.card, promptSide())}</div>`;
      let inner = '';
      if (q.type === 'written') inner = `<input class="answer-input" lang="${side === 'ja' ? 'ja' : 'uk'}" placeholder="${side === 'ja' ? '日本語で…' : 'Українською…'}" autocapitalize="off" autocorrect="off" spellcheck="false">`;
      if (q.type === 'mc') inner = `<div class="choices">${q.opts.map((c, i) => `<button class="choice" data-i="${i}">${optionHTML(c, side)}</button>`).join('')}</div>`;
      if (q.type === 'tf') inner = `<div class="tf-pair"><span class="tf-eq">=</span><div class="tf-ans">${optionHTML(q.shown, side)}</div></div><div class="choices two"><button class="choice" data-v="1">Правда</button><button class="choice" data-v="0">Неправда</button></div>`;
      return `${head}<div class="tq" data-q="${qi}"><div class="tq-label"><span class="tq-num">${n}</span><span class="muted">з ${total}</span></div>${pr}${inner}<div class="tq-correct"></div></div>`;
    }).join('');
    body.innerHTML = `<div class="test fade-in"><div class="test-score"></div>${html}
      <div class="test-submit"><button class="btn primary wide" data-submit>Завершити тест</button></div></div>`;
    // selection behaviour
    $$('.tq', body).forEach(el => {
      el.addEventListener('click', e => {
        const b = e.target.closest('.choice');
        if (!b || el.classList.contains('graded')) return;
        $$('.choice', el).forEach(x => x.classList.toggle('sel', x === b));
      });
    });
    $('[data-submit]', body).onclick = () => grade(qs, total);
    api.setKey(null);
  };

  const grade = (qs, total) => {
    const answered = $$('.tq', body).every(el => {
      if (el.classList.contains('match-q')) return $$('select', el).every(s => s.value);
      return $('.choice.sel', el) || $('input', el)?.value.trim();
    });
    if (!answered && !confirm('Є питання без відповіді. Все одно завершити?')) return;
    let ok = 0;
    const mark = (el, card, good, given) => {
      el.classList.add(good ? 'good' : 'bad');
      if (good) ok++;
      record(set.id, card.id, good, el.dataset.kind === 'write' ? 'write' : 'mc');
      if (!good) { const cc = $('.tq-correct', el); cc.innerHTML = fullLine(card); wireSay(cc, card); }
    };
    qs.forEach((q, qi) => {
      const el = $(`.tq[data-q="${qi}"]`, body);
      el.classList.add('graded');
      if (q.type === 'match') {
        q.group.forEach((c, ri) => {
          const row = $(`.mrow[data-row="${ri}"]`, el), s = $('select', row);
          s.disabled = true;
          mark(row, c, s.value === c.id);
        });
        return;
      }
      if (q.type === 'written') {
        const inp = $('input', el);
        inp.disabled = true;
        el.dataset.kind = 'write';
        mark(el, q.card, check(inp.value, q.card, side).ok);
      } else if (q.type === 'mc') {
        const sel = $('.choice.sel', el);
        const good = sel && q.opts[+sel.dataset.i].id === q.card.id;
        $$('.choice', el).forEach((b, i) => { b.disabled = true; if (q.opts[i].id === q.card.id) b.classList.add('correct'); });
        if (sel && !good) sel.classList.add('wrong');
        mark(el, q.card, !!good);
      } else if (q.type === 'tf') {
        const sel = $('.choice.sel', el);
        const good = sel && (sel.dataset.v === '1') === q.truth;
        $$('.choice', el).forEach(b => { b.disabled = true; if ((b.dataset.v === '1') === q.truth) b.classList.add('correct'); });
        if (sel && !good) sel.classList.add('wrong');
        mark(el, q.card, !!good);
      }
    });
    const pct = Math.round((ok / total) * 100);
    $('.test-score', body).innerHTML = `<div class="results fade-in">
      <div class="score-ring" style="--p:${pct}"><span>${pct}<small>%</small></span></div>
      <h2>${pct === 100 ? '完璧 — ідеальний результат!' : pct >= 80 ? 'Чудовий результат!' : pct >= 50 ? 'Непогано, ще трохи!' : 'Тренуйтеся далі'}</h2>
      <p class="muted">${ok} з ${total} правильно · помилок: ${total - ok} (правильні відповіді — нижче)</p>
      <div class="res-btns"><button class="btn primary" data-new>Новий тест</button>${total - ok ? `<a class="btn ghost" href="#/set/${encodeURIComponent(set.id)}/learn">Вчити в «Заучуванні»</a>` : ''}</div></div>`;
    $('[data-new]', body).onclick = setup;
    $('.test-submit', body).innerHTML = `<button class="btn primary wide" data-new2>Новий тест</button>`;
    $('[data-new2]', body).onclick = () => { setup(); window.scrollTo({ top: 0 }); };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  setup();
}

// =====================================================================
// 5. MATCH
// =====================================================================
const fmtTime = s => s.toFixed(1) + ' с';
function match(body, set, cards, api) {
  if (cards.length < 2) {
    body.innerHTML = `<div class="empty"><div class="empty-jp" lang="ja">合</div><p>Для гри потрібно щонайменше 2 слова.</p></div>`;
    return;
  }
  const intro = () => {
    const best = getBest(set.id);
    body.innerHTML = `<div class="panel match-intro fade-in">
      <div class="big-jp" lang="ja">合</div>
      <h2>Готові?</h2>
      <p class="muted">З’єднайте всі пари (${Math.min(6, cards.length)}) якнайшвидше — японське з українським.</p>
      ${best ? `<p class="best">Найкращий час <b>${fmtTime(best)}</b></p>` : ''}
      <button class="btn primary wide" data-start>Почати гру <kbd>Enter</kbd></button></div>`;
    $('[data-start]', body).onclick = play;
    api.setKey(e => { if (e.key === 'Enter') play(); });
  };
  const play = () => {
    api.setKey(null);
    const best = getBest(set.id);
    const pairs = shuffle(cards).slice(0, 6);
    const tiles = shuffle(pairs.flatMap(c => [{ id: c.id, kind: 'ja', c }, { id: c.id, kind: 'uk', c }]));
    body.innerHTML = `<div class="match fade-in">
      <div class="match-top"><span class="timer">0.0</span>${best ? `<span class="muted">Рекорд ${fmtTime(best)}</span>` : ''}</div>
      <div class="tiles">${tiles.map((t, i) => `<button class="tile ${t.kind}" data-i="${i}">${t.kind === 'ja'
        ? `<span class="jp ${sizeClass(t.c.japanese)}" lang="ja">${esc(t.c.japanese)}</span>${hasReading(t.c) ? `<small class="reading" lang="ja">${esc(rd(t.c))}</small>` : ''}`
        : `<span class="${sizeClass(t.c.ukrainian)}">${esc(t.c.ukrainian)}</span>`}</button>`).join('')}</div></div>`;
    const timer = $('.timer', body), t0 = performance.now();
    const iv = api.every(() => (timer.textContent = ((performance.now() - t0) / 1000).toFixed(1)), 100);
    let sel = null, left = pairs.length;
    const els = $$('.tile', body);
    $('.tiles', body).onclick = e => {
      const b = e.target.closest('.tile');
      if (!b || b.classList.contains('matched')) return;
      const i = +b.dataset.i, t = tiles[i];
      if (t.kind === 'ja') speakCard(t.c);
      if (sel === null) { sel = i; b.classList.add('sel'); return; }
      if (sel === i) { b.classList.remove('sel'); sel = null; return; }
      const a = tiles[sel], aEl = els[sel];
      if (a.kind === t.kind) { aEl.classList.remove('sel'); sel = i; b.classList.add('sel'); return; }
      aEl.classList.remove('sel');
      sel = null;
      if (a.id === t.id) {
        [aEl, b].forEach(x => x.classList.add('matched'));
        record(set.id, t.id, true, 'mc');
        if (--left === 0) win();
      } else {
        [aEl, b].forEach(x => { x.classList.remove('wrong'); void x.offsetWidth; x.classList.add('wrong'); });
        api.later(() => [aEl, b].forEach(x => x.classList.remove('wrong')), 450);
      }
    };
    const win = () => {
      api.clear(iv);
      const time = (performance.now() - t0) / 1000;
      const record_ = !best || time < best;
      if (record_) setBest(set.id, time);
      api.later(() => {
        body.innerHTML = `<div class="panel match-intro fade-in">
          <div class="big-jp" lang="ja">${record_ ? '祝' : '合'}</div>
          <div class="win-time">${fmtTime(time)}</div>
          <h2>${record_ ? (best ? 'Новий рекорд!' : 'Перший рекорд!') : 'Чудово!'}</h2>
          <p class="muted">${record_ && best ? `Попередній рекорд ${fmtTime(best)}` : `Найкращий час ${fmtTime(Math.min(time, best || time))}`}</p>
          <div class="res-btns"><button class="btn primary" data-start>Ще раз <kbd>Enter</kbd></button><a class="btn ghost" href="#/set/${encodeURIComponent(set.id)}">До уроку</a></div></div>`;
        $('[data-start]', body).onclick = play;
        api.setKey(e => { if (e.key === 'Enter') play(); });
      }, 450);
    };
  };
  intro();
}
