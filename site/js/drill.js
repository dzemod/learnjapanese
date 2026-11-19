// «Тренажер дієслів» (#/drill setup, #/drill/run): a verb of the chosen lessons + a form taught up to that lesson →
// the learner types the form (kana or kanji; optional romaji → kana like the exam). Logic: drill-core.js.
// Storage: settings jp.drill.conf, per-form accuracy jp.drill.stats { form: { n, ok } } (weak forms are asked more
// often), the running session in sessionStorage jp.drill. Every answer is a study action (markStudied) and a right
// one counts for the «Форми» achievements (bump('conj')).
import { $, $$, esc, I, plWord, speak, toast } from './util.js';
import { getSets, markStudied } from './store.js';
import { verbPool, formsFor, makeQuestions, checkAnswer, formLabel, kanaOf, FORMS } from './drill-core.js';
import { explainConj } from './conjugate.js';
import { loadScript } from './importer.js';
import { bump } from './achievements.js';

const K = { conf: 'jp.drill.conf', stats: 'jp.drill.stats', session: 'jp.drill' };
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } };
let memSession = null;
const sget = () => { try { return JSON.parse(sessionStorage.getItem(K.session) || 'null'); } catch { return memSession; } };
const sset = v => { memSession = v; try { v ? sessionStorage.setItem(K.session, JSON.stringify(v)) : sessionStorage.removeItem(K.session); } catch { /* memory */ } };
const MIN_LESSON = 14; // the first form (て) is taught in lesson 14
const conf = () => ({ upTo: 25, mine: false, n: 20, romaji: false, off: [], ...(lget(K.conf, {}) || {}) });
const refOf = f => (FORMS[f]?.point ? `#/grammar/${FORMS[f].lesson}/${FORMS[f].point}` : `#/grammar/${FORMS[f]?.lesson || ''}`);
const WK = 'https://cdn.jsdelivr.net/npm/wanakana@5.3.1/wanakana.min.js';

export function drillView(root, sub = '') {
  if (sub === 'run') return runView(root);
  return setupView(root);
}

function setupView(root) {
  const c = conf();
  const stats = lget(K.stats, {}) || {};
  const draw = () => {
    const forms = formsFor(c.upTo), pool = verbPool(getSets(), c.upTo, c.mine);
    const on = forms.filter(f => !c.off.includes(f));
    const S = sget();
    root.innerHTML = `<div class="drill fade-in">
      <section class="hero"><div><p class="eyebrow" lang="ja">活用</p><h1>Тренажер дієслів</h1>
        <p class="muted">Дієслово уроку → потрібна форма. Лише форми, які ви вже пройшли.</p></div></section>
      ${S && S.i < S.qs.length ? `<div class="sync-box"><div><b>Є незавершене тренування</b> — питання ${S.i + 1} з ${S.qs.length}.</div><div class="sync-btns"><a class="btn sm primary" href="#/drill/run">Продовжити</a><button class="btn sm ghost" data-drop>Скасувати</button></div></div>` : ''}
      <form class="panel dr-setup">
        <label class="ex-range">Дієслова з уроків 1 – <input class="input" type="number" name="upTo" min="${MIN_LESSON}" max="50" value="${c.upTo}" inputmode="numeric"></label>
        <label class="check"><input type="checkbox" name="mine" ${c.mine ? 'checked' : ''}><span>Додати дієслова з «Моїх уроків»</span></label>
        <p class="muted small">${pool.length} ${plWord(pool.length, ['дієслово', 'дієслова', 'дієслів'])}</p>
        <h2 class="sec-title">Форми</h2>
        <div class="dr-forms">${forms.map(f => {
          const s = stats[f];
          return `<label class="dr-form"><input type="checkbox" data-f="${f}" ${c.off.includes(f) ? '' : 'checked'}><span>${esc(formLabel(f))}<small class="muted">урок ${FORMS[f].lesson}${s?.n ? ` · ${Math.round((s.ok / s.n) * 100)}%` : ''}</small></span></label>`;
        }).join('')}</div>
        <div class="ex-row"><span class="muted small">Питань:</span><div class="seg" data-n>${[10, 20, 50].map(n => `<button type="button" class="${c.n === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" name="romaji" ${c.romaji ? 'checked' : ''}><span>Писати ромаджі (перетворюється на кану)</span></label>
        <button class="btn primary wide" data-start ${on.length && pool.length ? '' : 'disabled'}>Почати</button>
        ${!pool.length ? '<p class="muted small">У вибраних уроках немає дієслів.</p>' : ''}
      </form>
      ${Object.keys(stats).length ? `<section class="panel"><h2 class="sec-title">Ваша точність</h2><div class="ex-stats">${Object.entries(stats).filter(([f]) => FORMS[f]).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).map(([f, s]) => `<div class="ex-stat"><span>${esc(formLabel(f))}</span><div class="stack-bar"><i class="m" style="width:${(s.ok / s.n) * 100}%"></i></div><b>${Math.round((s.ok / s.n) * 100)}%</b><small class="muted">${s.ok}/${s.n}</small></div>`).join('')}</div></section>` : ''}
    </div>`;
    const f = $('form', root);
    const save = () => lset(K.conf, c);
    // change fires while the field is losing focus: redraw after the event, not inside it
    f.upTo.onchange = () => { c.upTo = Math.max(MIN_LESSON, Math.min(50, +f.upTo.value || 25)); save(); setTimeout(draw); };
    f.mine.onchange = () => { c.mine = f.mine.checked; save(); draw(); };
    f.romaji.onchange = () => { c.romaji = f.romaji.checked; save(); };
    $$('[data-f]', root).forEach(b => (b.onchange = () => { c.off = b.checked ? c.off.filter(x => x !== b.dataset.f) : [...c.off, b.dataset.f]; save(); draw(); }));
    $$('[data-n] button', root).forEach(b => (b.onclick = () => { c.n = +b.dataset.v; save(); draw(); }));
    $('[data-drop]', root)?.addEventListener('click', () => { sset(null); draw(); });
    f.onsubmit = e => {
      e.preventDefault();
      const qs = makeQuestions(pool, on, c.n, lget(K.stats, {}) || {});
      if (!qs.length) return toast('Немає питань для цього вибору');
      sset({ qs: qs.map(q => ({ ...q, card: { id: q.card.id, japanese: q.card.japanese, reading: q.card.reading, ukrainian: q.card.ukrainian, verbGroup: q.card.verbGroup, setId: q.card.setId } })), i: 0, res: [], start: Date.now() });
      location.hash = '#/drill/run';
    };
  };
  draw();
}

function runView(root) {
  const S = sget();
  if (!S || !S.qs?.length) { location.replace('#/drill'); return; }
  const c = conf();
  let keyFn = null;
  const onKey = e => keyFn?.(e);
  document.addEventListener('keydown', onKey);

  function draw() {
    if (S.i >= S.qs.length) return results();
    const q = S.qs[S.i], cd = q.card, prev = S.res[S.i];
    const pct = Math.round((S.i / S.qs.length) * 100);
    root.innerHTML = `<div class="drill fade-in">
      <div class="today-top"><a class="icon-btn" href="#/drill" aria-label="Завершити" title="Завершити">${I.back}</a>
        <div class="bar today-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${S.qs.length}" aria-valuenow="${S.i}" aria-label="Прогрес"><i style="width:${pct}%"></i></div>
        <span class="muted small today-count">${S.i + 1} / ${S.qs.length}</span></div>
      <section class="panel dr-card">
        <div class="dr-verb"><span class="dr-jp" lang="ja">${esc(cd.japanese)}</span>${cd.reading ? `<span class="reading" lang="ja">${esc(cd.reading)}</span>` : ''}</div>
        <div class="muted">${esc(cd.ukrainian)} · <span class="chip">група ${esc(cd.verbGroup)}</span></div>
        <div class="dr-arrow">→ <b>${esc(formLabel(q.form))}</b></div>
        <form class="write-form" autocomplete="off">
          <input class="answer-input" lang="ja" placeholder="${c.romaji ? 'romaji…' : '日本語で…'}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" ${prev ? 'disabled' : ''} value="${prev ? esc(prev.given) : ''}">
          <div class="write-btns"><button type="button" class="btn ghost" data-dk ${prev ? 'disabled' : ''}>Не знаю</button><button class="btn primary" type="submit" ${prev ? 'disabled' : ''}>Перевірити</button></div>
        </form>
        <div class="q-foot"></div>
      </section></div>`;
    const inp = $('.answer-input', root);
    if (c.romaji) loadScript(WK).then(() => { if (inp.isConnected && !inp.disabled) { window.wanakana.bind(inp, { IMEMode: true }); inp.dataset.wk = '1'; } }).catch(() => toast('Не вдалося завантажити перетворювач ромаджі'));
    if (prev) return feedback(prev);
    setTimeout(() => inp.focus({ preventScroll: true }), 60);
    const submit = dk => {
      let v = inp.value;
      if (c.romaji && window.wanakana && /[a-z]/i.test(v)) v = window.wanakana.toKana(v.toLowerCase());
      if (!dk && !v.trim()) { inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); return; }
      const r = dk ? { ok: false, detected: null } : checkAnswer(q, v);
      S.res[S.i] = { ok: r.ok, given: dk ? '' : v, detected: r.detected };
      const st = lget(K.stats, {}) || {};
      const s = (st[q.form] ||= { n: 0, ok: 0 });
      s.n++; if (r.ok) s.ok++;
      lset(K.stats, st);
      sset(S);
      markStudied(`drill:${S.start}:${S.i}`);
      if (r.ok) bump('conj');
      // romaji: unbind and blur first — wanakana's blur handler must not run while the page is redrawn
      if (inp.dataset.wk && window.wanakana) { window.wanakana.unbind(inp); inp.dataset.wk = ''; }
      inp.blur();
      draw();
    };
    $('form', root).onsubmit = e => { e.preventDefault(); submit(false); };
    $('[data-dk]', root).onclick = () => submit(true);
  }

  function feedback(r) {
    const q = S.qs[S.i], cd = q.card;
    const inp = $('.answer-input', root);
    inp.classList.add(r.ok ? 'good' : 'bad');
    const foot = $('.q-foot', root);
    foot.innerHTML = `<div class="feedback ${r.ok ? 'good' : 'bad'}">${r.ok ? 'Правильно!' : 'Не зовсім.'}</div>
      ${r.ok ? '' : `<div class="dr-ans"><span class="muted small">Правильно:</span> <b lang="ja">${q.answers.map(esc).join(' / ')}</b> <button type="button" class="icon-btn sm" data-say aria-label="Прослухати">${I.speaker}</button></div>`}
      ${r.detected ? `<p class="small">Ви написали форму «${esc(formLabel(r.detected))}».</p>` : ''}
      <p class="small dr-expl">${esc(explainConj(kanaOf(cd), cd.verbGroup, q.form))}</p>
      <div class="foot-btns"><a class="btn ghost sm" href="${refOf(q.form)}">Граматика: урок ${FORMS[q.form].lesson}</a><button class="btn primary" data-next>Далі <kbd>Enter</kbd></button></div>`;
    $('[data-say]', foot)?.addEventListener('click', () => speak(conjugateKana(q)));
    const go = () => { S.i++; sset(S); draw(); };
    $('[data-next]', foot).onclick = go;
    $('[data-next]', foot).focus({ preventScroll: true });
    keyFn = e => { if (e.key === 'Enter' && !e.repeat && $('[data-next]', root)) { e.preventDefault(); keyFn = null; go(); } };
  }
  const conjugateKana = q => q.answers[q.answers.length - 1];

  function results() {
    keyFn = null;
    const n = S.qs.length, ok = S.res.filter(r => r?.ok).length, pct = Math.round((ok / n) * 100);
    const wrong = S.qs.map((q, i) => ({ q, r: S.res[i] })).filter(x => !x.r?.ok);
    root.innerHTML = `<div class="drill fade-in"><div class="results">
      <div class="score-ring" style="--p:${pct}"><span>${pct}<small>%</small></span></div>
      <h2>${pct === 100 ? '完璧 — ідеально!' : pct >= 80 ? 'Добре!' : 'Ще трохи практики'}</h2>
      <p class="muted">${ok} з ${n} правильно</p>
      <div class="res-btns">${wrong.length ? `<button class="btn primary" data-retry>Повторити помилки (${wrong.length})</button>` : ''}<a class="btn ${wrong.length ? 'ghost' : 'primary'}" href="#/drill">Нове тренування</a></div></div>
      ${wrong.length ? `<section class="panel"><h2 class="sec-title">Помилки</h2>${wrong.map(({ q, r }) => `<div class="miss"><span lang="ja">${esc(q.card.japanese)}</span> → ${esc(formLabel(q.form))}: <b lang="ja">${q.answers.map(esc).join(' / ')}</b>${r?.given ? ` <span class="given">Ви написали: <s lang="ja">${esc(r.given)}</s></span>` : ''}</div>`).join('')}</section>` : ''}
    </div>`;
    $('[data-retry]', root)?.addEventListener('click', () => {
      sset({ qs: wrong.map(x => x.q), i: 0, res: [], start: Date.now() });
      dispatchEvent(new HashChangeEvent('hashchange')); // re-route: a fresh run view (and its key listener)
    });
  }
  draw();
  return () => document.removeEventListener('keydown', onKey);
}
