// «Читання» (#/read): short texts with only what the learner has studied (lessons ≤ N).
//   «Речення з підручника» — textbook sentences of the exam bank (exam.json t:"ts": tokens with kana, translation,
//     grammar point), 2–3 lessons, in book order; works offline, no download.
//   «Нова історія від Сенсея» — a short story by the AI (shared Puter client chat(), only on click) with words and
//     grammar of lessons ≤ N; split into words by Kuromoji (tokenizer.js worker). Marked «ШІ, може містити помилки».
// Tap a word → its reading, meaning from my lessons / kanji books (wordindex.js), lesson link, the sentence's grammar
// point. Furigana on/off (jp.read.furi), per-sentence translation, speaker (click only). «Прочитано» = study action.
// Logic: read-core.js. Last text: sessionStorage jp.read; settings jp.read.conf.
import { $, $$, esc, I, modal, speak, toast } from './util.js';
import { getSets, markStudied } from './store.js';
import { textFromBank, tokensFromKuromoji, parseStory, wordCandidates, hasKanji, plain } from './read-core.js';
import { buildIndex, lookupWord } from './wordindex.js';
import { loadKanji, books as kanjiBooks } from './kanji.js';
import { loadGrammar, grammarLessons } from './grammar.js';
import { chat, TRANSLIT } from './ai-helper.js';
import { ensureTokenizer, tokenize, onTokProgress, tokProgressText } from './tokenizer.js';
import { bump } from './achievements.js';

const KC = 'jp.read.conf', KS = 'jp.read';
const lget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } };
let mem = null;
const sget = () => { try { return JSON.parse(sessionStorage.getItem(KS) || 'null'); } catch { return mem; } };
const sset = v => { mem = v; try { sessionStorage.setItem(KS, JSON.stringify(v)); } catch { /* memory */ } };
const conf = () => ({ upTo: 10, furi: true, ...(lget(KC, {}) || {}) });
export const MSG_SIGNIN = 'Щоб Сенсей написав історію, увійдіть у безкоштовний акаунт Puter';
let bank = null;
const loadBank = () => (bank ||= fetch('data/exam.json').then(r => r.json()).then(j => j.lessons.flatMap(l => l.items.filter(it => it.t === 'ts'))).catch(e => { bank = null; throw e; }));

export const STORY_SYSTEM = `You write very short, simple reading texts in Japanese for a Ukrainian-speaking learner of Minna no Nihongo.
Use ONLY words and grammar from the learner's lessons (lists below); numbers, times and simple names are fine. Natural, coherent mini-story (one situation), 6–8 short sentences, polite です/ます style. Write the Japanese with normal kanji as in the textbook; no romaji, no furigana, no brackets.
Output exactly one line per sentence: <Japanese sentence> ||| <Ukrainian translation>. Nothing else: no title, no numbering, no Markdown.
${TRANSLIT}`;

function storyPrompt(upTo, sets) {
  const words = [];
  for (const s of sets) { const m = /^mnn-(\d+)$/.exec(s.id); if (!m || +m[1] > upTo) continue; for (const c of s.cards) if (c.section === 'main') words.push(c.japanese.replace(/[～〜]/g, '')); }
  const pick = [];
  for (let i = 0; i < 160 && words.length; i++) pick.push(words.splice(Math.floor(Math.random() * words.length), 1)[0]);
  const gram = grammarLessons().filter(l => l.lesson <= upTo).slice(-6).flatMap(l => l.points.map(p => `${l.lesson}: ${p.title.replace(/\{([^|}]+)\|[^}]+\}/g, '$1')}`));
  return `Lessons 1–${upTo}.\nWords you may use: ${pick.join('、')}\nGrammar of the latest lessons: ${gram.join('; ')}\nWrite the story now.`;
}

export function readView(root) {
  const c = conf();
  let idx = null;
  const index = async () => { if (idx) return idx; await loadKanji(); idx = buildIndex(getSets(), kanjiBooks()); return idx; };
  const S0 = sget();

  function setup(msg = '') {
    root.innerHTML = `<div class="rd fade-in">
      <section class="hero"><div><p class="eyebrow" lang="ja">読み物</p><h1>Читання</h1>
        <p class="muted">Короткі тексти лише зі слів і граматики, які ви вже пройшли. Торкніться слова — побачите значення.</p></div></section>
      <form class="panel rd-setup">
        <label class="ex-range">Уроки 1 – <input class="input" type="number" name="upTo" min="1" max="50" value="${c.upTo}" inputmode="numeric"></label>
        <div class="btn-row"><button type="button" class="btn primary" data-book>Речення з підручника</button><button type="button" class="btn ghost" data-ai><span lang="ja">先生</span> Нова історія від Сенсея</button></div>
        <p class="muted small">Історію пише ШІ (безкоштовний акаунт Puter) — може містити помилки. Речення з підручника працюють і без інтернету.</p>
        ${msg ? `<p class="ask-err small" role="alert">${esc(msg)}</p>` : ''}
        ${S0 ? '<p><a class="link" href="#/read" data-last>Повернутися до останнього тексту</a></p>' : ''}
      </form></div>`;
    const f = $('form', root);
    const lim = () => { c.upTo = Math.max(1, Math.min(50, +f.upTo.value || 10)); lset(KC, c); };
    f.upTo.onchange = lim;
    $('[data-book]', root).onclick = async () => {
      lim();
      try { const items = await loadBank(); const text = textFromBank(items, c.upTo, 8); if (!text.length) throw new Error('empty'); sset({ src: 'book', upTo: c.upTo, text }); show(); }
      catch { setup('Не вдалося завантажити речення. Перевірте з’єднання і спробуйте ще раз.'); }
    };
    $('[data-ai]', root).onclick = () => { lim(); aiStory(); };
    $('[data-last]', root)?.addEventListener('click', e => { e.preventDefault(); show(); });
  }

  async function aiStory() {
    root.innerHTML = `<div class="rd fade-in"><section class="panel rd-wait"><span class="spinner"></span> <span data-st>Сенсей пише історію…</span></section></div>`;
    await loadGrammar();
    const r = await chat([{ role: 'system', content: STORY_SYSTEM }, { role: 'user', content: storyPrompt(c.upTo, getSets()) }], { signin: MSG_SIGNIN, maxTokens: 1500, timeoutMs: 90000 });
    if (!root.isConnected) return;
    if (!r.answer) return setup(r.error);
    const lines = parseStory(r.answer);
    if (lines.length < 2) return setup('Сенсей відповів не в тому форматі. Спробуйте ще раз.');
    const st = $('[data-st]', root);
    const off = onTokProgress(s => { if (st?.isConnected) st.textContent = `Готую розбір слів: ${tokProgressText(s)}`; });
    try {
      await ensureTokenizer();
      const text = [];
      for (const l of lines) text.push({ toks: tokensFromKuromoji(await tokenize(l.ja)), uk: l.uk, w: [] });
      sset({ src: 'ai', upTo: c.upTo, text });
      off();
      show();
    } catch { off(); setup('Не вдалося підготувати розбір слів (словник Kuromoji). Перевірте з’єднання.'); }
  }

  function show() {
    const S = sget();
    if (!S) return setup();
    const tokHTML = (t, i, j) => {
      if (t[2] === 's') return esc(t[0]);
      const ruby = hasKanji(t[0]) && t[1] && t[1] !== t[0] ? `<ruby>${esc(t[0])}<rt>${esc(t[1])}</rt></ruby>` : esc(t[0]);
      // inline span, not <button>: a button is an inline-block and breaks Japanese line breaking (。 at a line start)
      return `<span class="rd-w c-${t[2]}" role="button" tabindex="0" data-i="${i}" data-j="${j}">${ruby}</span>`;
    };
    root.innerHTML = `<div class="rd fade-in">
      <a class="back" href="#/read" data-new>${I.back}<span>Читання</span></a>
      <div class="rd-top"><span class="muted small">Уроки 1–${S.upTo} · ${S.src === 'ai' ? 'історія від Сенсея (ШІ, може містити помилки)' : 'речення з підручника'}</span>
        <label class="check"><input type="checkbox" data-furi ${c.furi ? 'checked' : ''}><span>Фурігана</span></label></div>
      <article class="panel rd-text ${c.furi ? '' : 'no-furi'}" lang="ja">${S.text.map((s, i) => `<div class="rd-s" data-s="${i}">
          <p class="rd-ja">${s.toks.map((t, j) => tokHTML(t, i, j)).join('')}</p>
          <div class="rd-tools"><button type="button" class="icon-btn sm" data-say="${i}" aria-label="Прослухати речення">${I.speaker}</button><button type="button" class="btn ghost sm" data-tr="${i}">Переклад</button></div>
          <p class="rd-uk" lang="uk" hidden>${esc(s.uk)}</p></div>`).join('')}</article>
      <div class="btn-row rd-end"><button type="button" class="btn ghost" data-all>Показати весь переклад</button><button type="button" class="btn primary" data-done>Прочитано</button><a class="btn ghost" href="#/read" data-new>Новий текст</a></div>
    </div>`;
    $('[data-furi]', root).onchange = e => { c.furi = e.target.checked; lset(KC, c); $('.rd-text', root).classList.toggle('no-furi', !c.furi); };
    $$('[data-tr]', root).forEach(b => (b.onclick = () => { const p = $(`.rd-s[data-s="${b.dataset.tr}"] .rd-uk`, root); p.hidden = !p.hidden; b.textContent = p.hidden ? 'Переклад' : 'Сховати'; }));
    $('[data-all]', root).onclick = () => $$('.rd-uk', root).forEach(p => (p.hidden = false));
    $$('[data-say]', root).forEach(b => (b.onclick = () => speak(plain(S.text[+b.dataset.say].toks))));
    $$('[data-new]', root).forEach(a => (a.onclick = e => { e.preventDefault(); setup(); }));
    $('[data-done]', root).onclick = () => { markStudied(`read:${plain(S.text[0].toks)}`); bump('read'); toast('Текст прочитано — так тримати!'); setup(); };
    $$('.rd-w', root).forEach(b => {
      const open = () => wordSheet(S.text[+b.dataset.i], S.text[+b.dataset.i].toks[+b.dataset.j]);
      b.onclick = open;
      b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  }

  async function wordSheet(sent, tok) {
    const ix = await index();
    let hit = null;
    for (const k of wordCandidates(tok, sent)) { hit = lookupWord(ix, k, tok[1]) || lookupWord(ix, k, ''); if (hit) break; }
    await loadGrammar();
    let gp = null;
    if (sent.pt) { const L = grammarLessons().find(l => l.lesson === +sent.pt.split('-')[0]); const i = L ? L.points.findIndex(p => p.id === sent.pt) : -1; if (i >= 0) gp = { l: L.lesson, no: i + 1, id: sent.pt, title: L.points[i].title.replace(/\{([^|}]+)\|[^}]+\}/g, '$1') }; }
    modal(`<div class="rd-sheet"><div class="rd-word"><span class="rd-big" lang="ja">${esc(tok[0])}</span>${tok[1] && tok[1] !== tok[0] ? `<span class="reading" lang="ja">${esc(tok[1])}</span>` : ''}<button type="button" class="icon-btn sm" data-say-w aria-label="Прослухати">${I.speaker}</button></div>
      ${hit ? `<p class="rd-mean"><b>${esc(hit.uk)}</b>${hit.japanese !== tok[0] ? ` <span class="muted small" lang="ja">(${esc(hit.japanese)})</span>` : ''}</p><p class="small"><a class="link" href="${esc(hit.href)}">${esc(hit.src)}</a></p>`
        : `<p class="muted">${tok[2] === 'p' ? 'Частка.' : tok[2] === 'x' ? 'Допоміжна форма (закінчення дієслова чи зв’язка).' : 'Цього слова немає у ваших уроках.'}</p>`}
      ${gp ? `<p class="small">Граматика речення: <a class="link" href="#/grammar/${gp.l}/${encodeURIComponent(gp.id)}">Урок ${gp.l}, пункт ${gp.no} «${esc(gp.title)}»</a></p>` : ''}
      <p class="small"><a class="link" href="#/translate/${encodeURIComponent(plain(sent.toks))}">Розібрати речення в Перекладачі</a></p>
      <div class="modal-btns"><button type="button" class="btn primary" data-close>Закрити</button></div></div>`, (m, close) => {
      m.classList.add('sheet');
      $('[data-close]', m).onclick = close;
      $('[data-say-w]', m).onclick = () => speak(tok[1] || tok[0]);
      $$('a', m).forEach(a => a.addEventListener('click', close));
    });
  }

  if (S0) show(); else setup();
}
