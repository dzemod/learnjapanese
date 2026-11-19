// «Говоріння» (#/speak): listen to a textbook sentence of lessons ≤ N, say it, see how close it was.
// Recognition: the browser's Web Speech API (Chrome, Edge, Safari; free, no key — the browser sends the audio to its
// own speech service, said on the page). Without it the page still works as shadowing (listen + repeat + «Далі»).
// Sentences: exam bank t:"ts" (read-core.js textFromBank); scoring: speak-core.js. Every attempt = a study action;
// a «good» one counts for the «Говоріння» achievements (bump('speak')). Settings jp.speak.conf.
import { $, esc, I, speak, toast } from './util.js';
import { markStudied } from './store.js';
import { textFromBank, hasKanji, plain } from './read-core.js';
import { scoreSpeech } from './speak-core.js';
import { bump } from './achievements.js';

const KC = 'jp.speak.conf';
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } };
const Rec = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const ERR = {
  'not-allowed': 'Дозвольте доступ до мікрофона в налаштуваннях браузера і спробуйте ще раз.',
  'service-not-allowed': 'Розпізнавання мовлення вимкнене в цьому браузері.',
  'no-speech': 'Нічого не почуто. Натисніть «Сказати» і говоріть після сигналу.',
  'audio-capture': 'Мікрофон не знайдено.',
  network: 'Немає зв’язку із сервісом розпізнавання. Перевірте інтернет.',
};
let bank = null;
const loadBank = () => (bank ||= fetch('data/exam.json').then(r => r.json()).then(j => j.lessons.flatMap(l => l.items.filter(it => it.t === 'ts'))).catch(e => { bank = null; throw e; }));

export function speakView(root) {
  const c = { upTo: 10, n: 10, ...(lget(KC, {}) || {}) };
  let S = null, rec = null;
  const stopRec = () => { try { rec?.abort(); } catch { /* ignore */ } rec = null; };

  function setup(msg = '') {
    const ok = !!Rec();
    root.innerHTML = `<div class="sp fade-in">
      <section class="hero"><div><p class="eyebrow" lang="ja">会話練習</p><h1>Говоріння</h1>
        <p class="muted">Послухайте речення з підручника, скажіть його вголос — і подивіться, що вийшло.</p></div></section>
      <form class="panel sp-setup">
        <label class="ex-range">Уроки 1 – <input class="input" type="number" name="upTo" min="1" max="50" value="${c.upTo}" inputmode="numeric"></label>
        <button class="btn primary" data-start>Почати (${c.n} речень)</button>
        <p class="muted small">${ok ? 'Розпізнавання мовлення робить ваш браузер: запис надсилається до його сервісу (у Chrome — Google) лише поки ви натискаєте «Сказати». Нічого не зберігається на сайті.' : 'Цей браузер не розпізнає мовлення (найкраще працює Chrome або Edge). Можна тренуватися повторюванням: послухати й повторити вголос.'}</p>
        ${msg ? `<p class="ask-err small" role="alert">${esc(msg)}</p>` : ''}
      </form></div>`;
    const f = $('form', root);
    f.onsubmit = async e => {
      e.preventDefault();
      c.upTo = Math.max(1, Math.min(50, +f.upTo.value || 10)); lset(KC, c);
      try { const items = await loadBank(); const text = textFromBank(items, c.upTo, c.n); if (!text.length) throw new Error('empty'); S = { text, i: 0, res: [] }; draw(); }
      catch { setup('Не вдалося завантажити речення. Перевірте з’єднання.'); }
    };
  }

  const sentHTML = (s, marks) => s.toks.map((t, j) => {
    const cls = marks ? (marks[j] >= 0.99 ? 'hit' : marks[j] > 0 ? 'part' : 'miss') : '';
    const inner = hasKanji(t[0]) && t[1] && t[1] !== t[0] ? `<ruby>${esc(t[0])}<rt>${esc(t[1])}</rt></ruby>` : esc(t[0]);
    return t[2] === 's' ? inner : `<span class="sp-t ${cls}">${inner}</span>`;
  }).join('');

  function draw(result = null, heard = '') {
    stopRec();
    if (S.i >= S.text.length) return results();
    const s = S.text[S.i], can = !!Rec();
    root.innerHTML = `<div class="sp fade-in">
      <div class="today-top"><a class="icon-btn" href="#/speak" data-quit aria-label="Завершити">${I.back}</a>
        <div class="bar today-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${S.text.length}" aria-valuenow="${S.i}" aria-label="Прогрес"><i style="width:${Math.round((S.i / S.text.length) * 100)}%"></i></div>
        <span class="muted small today-count">${S.i + 1} / ${S.text.length}</span></div>
      <section class="panel sp-card">
        <p class="sp-ja" lang="ja">${sentHTML(s, result?.tokMarks)}</p>
        <p class="muted sp-uk">${esc(s.uk)}</p>
        <div class="btn-row sp-btns"><button type="button" class="btn ghost" data-listen>${I.speaker}<span>Послухати</span></button><button type="button" class="btn ghost" data-slow><span>Повільно</span></button>
          ${can ? `<button type="button" class="btn primary sp-mic" data-mic><span class="sp-dot" aria-hidden="true"></span><span>${result ? 'Ще раз' : 'Сказати'}</span></button>` : ''}</div>
        <div class="sp-out" aria-live="polite">${result ? `<p class="sp-verdict ${result.verdict}">${result.verdict === 'good' ? 'Чудово!' : result.verdict === 'close' ? 'Майже — послухайте ще раз виділене червоним' : 'Спробуйте ще раз'} <b>${Math.round(result.score * 100)}%</b></p>
          <p class="small">Почуто: <span lang="ja">${esc(heard) || '—'}</span></p>` : ''}</div>
        <div class="btn-row sp-next"><button type="button" class="btn ${result || !can ? 'primary' : 'ghost'}" data-next>Далі</button></div>
      </section></div>`;
    $('[data-listen]', root).onclick = () => speak(plain(s.toks));
    $('[data-slow]', root).onclick = () => speak(plain(s.toks), true);
    $('[data-next]', root).onclick = () => { if (!can) markStudied(`speak:${plain(s.toks)}`); S.i++; draw(); };
    $('[data-quit]', root).onclick = e => { e.preventDefault(); stopRec(); setup(); };
    $('[data-mic]', root)?.addEventListener('click', listen);
  }

  function listen() {
    const s = S.text[S.i];
    const R = Rec();
    if (!R) return;
    stopRec();
    const r = new R();
    rec = r;
    r.lang = 'ja-JP'; r.interimResults = true; r.maxAlternatives = 3; r.continuous = false;
    const btn = $('[data-mic]', root), out = $('.sp-out', root);
    btn.classList.add('on'); btn.lastElementChild.textContent = 'Слухаю…';
    out.innerHTML = ''; // a new attempt: the previous message goes away
    let finalAlts = null, interim = '';
    r.onresult = e => {
      const res = e.results[e.results.length - 1];
      if (res.isFinal) finalAlts = [...res].map(a => a.transcript);
      else { interim = res[0].transcript; out.innerHTML = `<p class="small muted">Почуто: <span lang="ja">${esc(interim)}</span></p>`; }
    };
    r.onerror = e => { if (rec !== r) return; rec = null; btn.classList.remove('on'); btn.lastElementChild.textContent = 'Сказати'; out.innerHTML = `<p class="ask-err small" role="alert">${esc(ERR[e.error] || 'Не вдалося розпізнати мовлення. Спробуйте ще раз.')}</p>`; };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      const alts = finalAlts || (interim ? [interim] : null);
      if (!alts) { btn.classList.remove('on'); btn.lastElementChild.textContent = 'Сказати'; if (!out.querySelector('.ask-err')) out.innerHTML = `<p class="ask-err small">${ERR['no-speech']}</p>`; return; }
      const scored = alts.map(a => ({ a, r: scoreSpeech(s.toks, a) })).sort((x, y) => y.r.score - x.r.score)[0];
      S.res[S.i] = { score: scored.r.score, verdict: scored.r.verdict };
      markStudied(`speak:${plain(s.toks)}:${Date.now()}`);
      if (scored.r.verdict === 'good') bump('speak');
      draw(scored.r, scored.a);
    };
    try { r.start(); } catch { btn.classList.remove('on'); toast('Не вдалося увімкнути мікрофон'); }
  }

  function results() {
    const done = S.res.filter(Boolean);
    const avg = done.length ? Math.round((done.reduce((a, r) => a + r.score, 0) / done.length) * 100) : null;
    root.innerHTML = `<div class="sp fade-in"><div class="results">
      ${avg != null ? `<div class="score-ring" style="--p:${avg}"><span>${avg}<small>%</small></span></div>` : '<div class="big-jp" lang="ja">完</div>'}
      <h2>${avg == null ? 'Готово!' : avg >= 85 ? 'Чудова вимова!' : avg >= 60 ? 'Добре, є що підтягнути' : 'Тренуйтеся далі'}</h2>
      <p class="muted">${done.length ? `Сказано ${done.length} з ${S.text.length} речень, ${done.filter(r => r.verdict === 'good').length} — чудово.` : `Ви прослухали ${S.text.length} речень.`}</p>
      <div class="res-btns"><button class="btn primary" data-again>Нові речення</button><a class="btn ghost" href="#/">На головну</a></div></div></div>`;
    $('[data-again]', root).onclick = () => setup();
  }

  setup();
  return stopRec;
}
