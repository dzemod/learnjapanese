// Міні-ігри (#/play[/<from>-<to>[/<game>]]) — short optional games with the learner's own lesson material:
//   rain     «Дощ слів»        a word falls, pick its meaning before it lands (3 lives, faster every word)
//   memory   «Пам’ять»         flip tiles, find the pairs word ⇄ meaning (6 pairs)
//   particle «Частки-блискавка» 60 s of particle blanks from the exam bank, combo multiplier, mistakes → grammar point
//   mole     «Кроти»           a meaning on top, tap the word that pops out of a hole (45 s)
// Offered after a grammar lesson, after an exam, in the achievement pop-up and on the home page. Pure logic: games-core.js.
// Storage: jp.play.best { game: score }, jp.play.range "a-b"; sessionStorage jp.play.back (where the learner came from).
// Every right answer is a study action (markStudied); a finished game counts for the achievements (bump('play')).
import { $, $$, esc, I, furi, speak, plWord } from './util.js';
import { getSets, state, markStudied } from './store.js';
import { bump } from './achievements.js';
import { wordPool, particlePool, wordOptions, particleOptions, particleRight, comboMult, rainFall, memoryScore,
  parseRange, lastStudiedLesson, shuffled } from './games-core.js';

const K = { best: 'jp.play.best', range: 'jp.play.range', back: 'jp.play.back' };
const lget = (k, d, ss = false) => { try { const v = (ss ? sessionStorage : localStorage).getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lset = (k, v, ss = false) => { try { (ss ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

export const GAMES = {
  rain: { jp: '雨', name: 'Дощ слів', desc: 'Слово падає — встигніть вибрати значення, поки воно не впало. 3 життя, щоразу швидше.', data: 'words' },
  memory: { jp: '憶', name: 'Пам’ять', desc: 'Відкривайте плитки й знаходьте пари «слово — значення». Менше ходів — більше очок.', data: 'words' },
  particle: { jp: '助', name: 'Частки-блискавка', desc: '60 секунд: вставте правильну частку. Серія без помилок множить очки.', data: 'particles' },
  mole: { jp: '叩', name: 'Кроти', desc: 'Зверху значення — торкніться слова, яке вискочило з нірки. 45 секунд.', data: 'words' },
};
const MIN_WORDS = 8;

// Where the learner came from (shown as the way back on the hub and the result screen).
window.addEventListener('hashchange', e => {
  const isPlay = u => /#\/play(\/|$)/.test(u || '');
  if (isPlay(e.newURL) && !isPlay(e.oldURL)) { const h = (e.oldURL || '').split('#')[1]; lset(K.back, h ? '#' + h : '', true); }
});
function backLink() {
  const h = lget(K.back, '', true) || '';
  let m;
  const label = (m = /^#\/grammar\/(\d+)/.exec(h)) ? `До граматики уроку ${m[1]}` : /^#\/exam\/result/.test(h) ? 'До результатів екзамену'
    : /^#\/achievements/.test(h) ? 'До досягнень' : /^#\/set\//.test(h) ? 'До уроку' : '';
  return label ? { href: h, label } : null;
}

/** HTML of an optional «Міні-гра» offer for lessons from–to (grammar lesson, exam result). */
export function playOfferHTML(from, to, text = 'Відпочити й закріпити: міні-гра') {
  return `<a class="gm-offer" href="#/play/${from}-${to}"><span class="mode-ic" lang="ja">遊</span><span><b>${esc(text)}</b><small>${from === to ? `Слова й частки уроку ${from}` : `Слова й частки уроків ${from}–${to}`} · за бажанням</small></span><span class="today-ach-go" aria-hidden="true">›</span></a>`;
}

let EXAM = null;
const loadExam = () => (EXAM ||= fetch('data/exam.json').then(r => (r.ok ? r.json() : { lessons: [] })).then(j => j.lessons || []).catch(() => []));

function defaultRange() {
  const r = parseRange(lget(K.range, ''));
  if (r) return r;
  const to = Math.max(1, lastStudiedLesson(state.progress));
  return { from: Math.max(1, to - 4), to };
}
const bestOf = g => +(lget(K.best, {}) || {})[g] || 0;

export async function playView(root, parts) {
  const range = parseRange(parts[0]) || defaultRange();
  const game = GAMES[parts[1]] ? parts[1] : '';
  root.innerHTML = '<div class="loading"><span class="sun pulse"></span></div>';
  const exam = await loadExam();
  const words = wordPool(getSets(), range.from, range.to);
  const parts2 = particlePool(exam, range.from, range.to);
  const ctx = { ...range, words, particles: parts2 };
  if (!game) return hub(root, ctx);
  return runGame(root, game, ctx);
}

// ---------- Hub ----------
function hub(root, ctx) {
  const { from, to, words, particles } = ctx;
  const back = backLink();
  const opt = sel => Array.from({ length: 50 }, (_, i) => i + 1).map(n => `<option value="${n}"${n === sel ? ' selected' : ''}>${n}</option>`).join('');
  const ok = g => (GAMES[g].data === 'words' ? words.length >= MIN_WORDS : particles.length >= 4);
  root.innerHTML = `<div class="games fade-in">
    ${back ? `<a class="back" href="${esc(back.href)}">${I.back}<span>${esc(back.label)}</span></a>` : `<a class="back" href="#/">${I.back}<span>Головна</span></a>`}
    <section class="hero"><div><p class="eyebrow" lang="ja">遊び</p><h1>Міні-ігри</h1>
      <p class="muted">Коротка перерва з тими словами й частками, які ви вже пройшли. Грати не обов’язково — але корисно.</p></div></section>
    <div class="panel gm-range"><span>Уроки</span>
      <label><span class="sr-only">З уроку</span><select class="input" data-from>${opt(from)}</select></label><span>—</span>
      <label><span class="sr-only">До уроку</span><select class="input" data-to>${opt(to)}</select></label>
      <span class="muted small">${words.length} ${plWord(words.length, ['слово', 'слова', 'слів'])} · ${particles.length} ${plWord(particles.length, ['речення', 'речення', 'речень'])} з частками</span></div>
    <div class="gm-list">${Object.entries(GAMES).map(([id, g]) => `<a class="gm-card${ok(id) ? '' : ' off'}" ${ok(id) ? `href="#/play/${from}-${to}/${id}"` : 'aria-disabled="true"'}>
      <span class="gm-ic" lang="ja">${g.jp}</span><span class="gm-txt"><b>${g.name}</b><small>${g.desc}</small>
      ${ok(id) ? (bestOf(id) ? `<span class="gm-best">Рекорд: ${bestOf(id)}</span>` : '') : `<span class="gm-best">Замало ${g.data === 'words' ? 'слів' : 'речень'} у цих уроках — розширте діапазон</span>`}</span></a>`).join('')}</div>
  </div>`;
  const go = () => {
    const a = +$('[data-from]', root).value, b = +$('[data-to]', root).value;
    const r = parseRange(`${a}-${b}`);
    lset(K.range, `${r.from}-${r.to}`);
    location.replace(`#/play/${r.from}-${r.to}`);
  };
  $('[data-from]', root).onchange = go;
  $('[data-to]', root).onchange = go;
}

// ---------- Shared game shell ----------
/** Game clock that stops while the page is hidden (a game never runs out in a background tab). */
function makeClock() {
  let paused = 0, hiddenAt = 0;
  const start = performance.now();
  const vis = () => { if (document.hidden) hiddenAt = performance.now(); else if (hiddenAt) { paused += performance.now() - hiddenAt; hiddenAt = 0; } };
  document.addEventListener('visibilitychange', vis);
  return {
    now: () => (hiddenAt || performance.now()) - start - paused,
    stop: () => document.removeEventListener('visibilitychange', vis),
    get hidden() { return !!hiddenAt; },
  };
}

function runGame(root, id, ctx) {
  const g = GAMES[id];
  const timers = new Set();
  let raf = 0, keyFn = null, clock = null, over = false;
  const T = {
    later(fn, ms) { const t = setTimeout(() => { timers.delete(t); if (!over) fn(); }, ms); timers.add(t); return t; },
    frame(fn) { cancelAnimationFrame(raf); raf = requestAnimationFrame(t => { if (!over) fn(t); }); },
    key(fn) { keyFn = fn; },
  };
  const onKey = e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) keyFn?.(e); };
  document.addEventListener('keydown', onKey);
  const stopAll = () => { over = true; timers.forEach(clearTimeout); timers.clear(); cancelAnimationFrame(raf); clock?.stop(); keyFn = null; };
  const cleanup = () => { stopAll(); document.removeEventListener('keydown', onKey); };

  const start = () => {
    over = false; clock = makeClock();
    root.innerHTML = `<div class="games gm-run fade-in" data-game="${id}">
      <div class="gm-top"><a class="back" href="#/play/${ctx.from}-${ctx.to}">${I.back}<span>Ігри</span></a>
        <b class="gm-title"><span lang="ja">${g.jp}</span> ${g.name}</b><span class="gm-hud" aria-live="off"></span></div>
      <div class="gm-body"></div></div>`;
    const body = $('.gm-body', root), hud = $('.gm-hud', root);
    let n = 0;
    const api = {
      body, hud, clock, ...T,
      right(key) { markStudied(`play:${id}:${key}:${++n}`); },
      end(result) { stopAll(); finish(result); },
    };
    PLAY[id](api, ctx);
  };
  const finish = ({ score, lines = [], mistakes = [] }) => {
    const best = bestOf(id), rec = score > best;
    if (rec) { const b = lget(K.best, {}) || {}; b[id] = score; lset(K.best, b); }
    bump('play');
    const back = backLink();
    root.innerHTML = `<div class="games gm-end fade-in">
      <div class="results"><p class="eyebrow" lang="ja">${g.jp}</p><div class="gm-score">${score}<small>очок</small></div>
        <h2>${rec ? '新記録 — новий рекорд!' : score >= best * 0.8 && best ? 'Майже рекорд!' : 'Гру завершено'}</h2>
        <p class="muted">${lines.map(esc).join(' · ')}${best && !rec ? ` · рекорд ${best}` : ''}</p>
        <div class="res-btns"><button class="btn primary" data-again>Ще раз</button><a class="btn ghost" href="#/play/${ctx.from}-${ctx.to}">Інші ігри</a>
          ${back ? `<a class="btn ghost" href="${esc(back.href)}">${esc(back.label)}</a>` : ''}</div></div>
      ${mistakes.length ? `<section class="panel"><h2 class="sec-title">Варто повторити (${mistakes.length})</h2><div class="gm-miss">${mistakes.join('')}</div></section>` : ''}
    </div>`;
    $('[data-again]', root).onclick = start;
    T.key(e => { if (e.key === 'Enter') { e.preventDefault(); start(); } });
  };
  start();
  return cleanup;
}

const wordHTML = w => `<span class="gm-ja" lang="ja">${esc(w.ja)}</span>${w.kana ? `<span class="gm-kana" lang="ja">${esc(w.kana)}</span>` : ''}`;
const wordMiss = w => `<div class="gm-miss-row"><span lang="ja"><b>${esc(w.ja)}</b>${w.kana ? ` <small class="muted">${esc(w.kana)}</small>` : ''}</span><span>${esc(w.uk)}</span><a class="muted small" href="#/set/${esc(w.key.split('/')[0])}">урок ${w.lesson}</a></div>`;
const uniq = list => [...new Map(list.map(w => [w.key, w])).values()];
const hearts = n => `<span class="gm-lives" aria-label="Життя: ${n}">${'♥'.repeat(n)}<i>${'♥'.repeat(3 - n)}</i></span>`;
const flash = (el, cls, ms = 450) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };

const PLAY = {
  // ---------- 雨 Дощ слів ----------
  rain(G, { words }) {
    let lives = 3, score = 0, streak = 0, n = 0, cur = null, t0 = 0, fall = 0, busy = false;
    const missed = [];
    G.body.innerHTML = `<div class="gm-stage gm-sky"><div class="gm-drop" hidden></div><div class="gm-ground"></div></div><div class="gm-opts"></div>`;
    const stage = $('.gm-stage', G.body), drop = $('.gm-drop', G.body), opts = $('.gm-opts', G.body);
    const hud = () => (G.hud.innerHTML = `${hearts(lives)}<b>${score}</b>${streak >= 3 ? `<span class="gm-combo">×${comboMult(streak)}</span>` : ''}`);
    const next = () => {
      if (lives <= 0) return G.end({ score, lines: [`${n} ${plWord(n, ['слово', 'слова', 'слів'])}`, `пропущено ${missed.length}`], mistakes: uniq(missed).map(wordMiss) });
      busy = false;
      cur = words[Math.floor(Math.random() * words.length)];
      const o = wordOptions(cur, words);
      drop.innerHTML = wordHTML(cur); drop.hidden = false; drop.className = 'gm-drop';
      opts.innerHTML = o.map((w, i) => `<button type="button" class="gm-opt" data-i="${i}"><kbd>${i + 1}</kbd>${esc(w.uk)}</button>`).join('');
      $$('.gm-opt', opts).forEach((b, i) => (b.onclick = () => answer(o[i], b)));
      G.key(e => { const i = +e.key - 1; if (i >= 0 && i < o.length) { e.preventDefault(); answer(o[i], $$('.gm-opt', opts)[i]); } });
      fall = rainFall(n); t0 = G.clock.now();
      G.frame(tick); hud();
    };
    const tick = () => {
      const p = Math.min(1, (G.clock.now() - t0) / fall);
      const H = stage.clientHeight - drop.offsetHeight - 14;
      drop.style.transform = `translate(-50%, ${Math.round(p * H)}px)`;
      if (p >= 1 && !busy) return lose(null);
      if (!busy) G.frame(tick);
    };
    const show = ok => $$('.gm-opt', opts).forEach(b => { b.disabled = true; if (b.textContent.slice(1) === cur.uk) b.classList.add('ok'); });
    const lose = btn => {
      busy = true; lives--; streak = 0; missed.push(cur);
      btn?.classList.add('bad'); show(); drop.classList.add('splash'); flash(stage, 'gm-shake'); hud();
      G.later(next, 1300);
    };
    const answer = (w, btn) => {
      if (busy) return;
      if (w.uk !== cur.uk) return lose(btn);
      busy = true; streak++; n++; score += 10 * comboMult(streak);
      G.right(cur.key); speak(cur.kana || cur.ja);
      btn.classList.add('ok'); drop.classList.add('pop'); hud();
      G.later(next, 450);
    };
    next();
  },

  // ---------- 憶 Пам’ять ----------
  memory(G, { words }) {
    const pick = shuffled(words).slice(0, 6), PAIRS = pick.length;
    const tiles = shuffled(pick.flatMap((w, i) => [{ i, side: 'ja', w }, { i, side: 'uk', w }]));
    let open = [], moves = 0, found = 0, lock = false;
    const missed = new Map();
    G.body.innerHTML = `<p class="muted small center">Знайдіть ${PAIRS} пар: японське слово ⇄ значення.</p><div class="gm-grid">${tiles.map((t, k) => `<button type="button" class="gm-tile" data-k="${k}" aria-label="Закрита плитка ${k + 1}">
      <span class="gm-back" lang="ja">言</span><span class="gm-face ${t.side}">${t.side === 'ja' ? wordHTML(t.w) : esc(t.w.uk)}</span></button>`).join('')}</div>`;
    const els = $$('.gm-tile', G.body);
    const hud = () => (G.hud.innerHTML = `<span>Ходи <b>${moves}</b></span><span>${found}/${PAIRS}</span><span class="gm-time">${Math.floor(G.clock.now() / 1000)} с</span>`);
    const tickHud = () => { hud(); G.later(tickHud, 1000); };
    tickHud();
    els.forEach((el, k) => (el.onclick = () => {
      if (lock || el.classList.contains('up') || el.classList.contains('done')) return;
      el.classList.add('up'); el.setAttribute('aria-label', tiles[k].side === 'ja' ? tiles[k].w.ja : tiles[k].w.uk);
      open.push(k);
      if (open.length < 2) return;
      moves++;
      const [a, b] = open.map(x => tiles[x]);
      if (a.i === b.i) {
        found++; G.right(a.w.key); speak(a.w.kana || a.w.ja);
        open.forEach(x => els[x].classList.add('done'));
        open = []; hud();
        if (found === PAIRS) G.later(() => {
          const secs = G.clock.now() / 1000;
          G.end({ score: memoryScore(PAIRS, moves, secs), lines: [`${moves} ${plWord(moves, ['хід', 'ходи', 'ходів'])}`, `${Math.round(secs)} с`], mistakes: [...missed.values()].map(wordMiss) });
        }, 700);
      } else {
        // a pair opened twice without a match = the learner did not know it
        [a, b].forEach(t => { t.seen = (t.seen || 0) + 1; if (t.seen > 1) missed.set(t.w.key, t.w); });
        lock = true;
        open.forEach(x => els[x].classList.add('no'));
        G.later(() => { open.forEach(x => { els[x].classList.remove('up', 'no'); els[x].setAttribute('aria-label', 'Закрита плитка'); }); open = []; lock = false; }, 850);
        hud();
      }
    }));
  },

  // ---------- 助 Частки-блискавка ----------
  particle(G, { particles }) {
    const LEN = 60000;
    let score = 0, streak = 0, right = 0, total = 0, cur = null, busy = false, deck = shuffled(particles);
    const missed = new Map();
    G.body.innerHTML = `<div class="gm-bar"><i></i></div><div class="gm-sent panel"></div><div class="gm-opts gm-p"></div><p class="gm-why muted small" aria-live="polite"></p>`;
    const bar = $('.gm-bar i', G.body), sent = $('.gm-sent', G.body), opts = $('.gm-opts', G.body), why = $('.gm-why', G.body);
    const hud = () => (G.hud.innerHTML = `<b>${score}</b>${streak >= 3 ? `<span class="gm-combo">×${comboMult(streak)}</span>` : ''}`);
    const timeUp = () => G.end({ score, lines: [`${right} з ${total} правильно`], mistakes: [...missed.values()].map(it => `<div class="gm-miss-row p"><span lang="ja">${furi(it.pre)}<b class="gm-blank">${esc(it.a)}</b>${furi(it.post)}</span><span class="muted small">${esc(it.x || '')}</span><a class="small" href="#/grammar/${it.l}/${encodeURIComponent(it.pt)}">Урок ${it.l} · граматика</a></div>`) });
    const tick = () => {
      const left = Math.max(0, LEN - G.clock.now());
      bar.style.width = (left / LEN) * 100 + '%';
      bar.parentElement.classList.toggle('low', left < 10000);
      if (left <= 0) return timeUp();
      G.frame(tick);
    };
    const next = () => {
      if (!deck.length) deck = shuffled(particles);
      cur = deck.pop(); busy = false; why.textContent = '';
      const o = particleOptions(cur);
      sent.innerHTML = `<div class="gm-ja-sent" lang="ja">${furi(cur.pre)}<span class="gm-blank">？</span>${furi(cur.post)}</div><div class="muted small">${esc(cur.uk || '')}</div>`;
      opts.innerHTML = o.map((p, i) => `<button type="button" class="gm-opt" data-i="${i}" lang="ja"><kbd>${i + 1}</kbd>${esc(p)}</button>`).join('');
      $$('.gm-opt', opts).forEach((b, i) => (b.onclick = () => answer(o[i], b)));
      G.key(e => { const i = +e.key - 1; if (i >= 0 && i < o.length) { e.preventDefault(); answer(o[i], $$('.gm-opt', opts)[i]); } });
      hud();
    };
    const answer = (p, btn) => {
      if (busy) return;
      busy = true; total++;
      const ok = particleRight(cur, p);
      $('.gm-blank', sent).textContent = ok ? p : cur.a;
      $('.gm-blank', sent).classList.add(ok ? 'ok' : 'bad');
      $$('.gm-opt', opts).forEach(b => { b.disabled = true; if (particleRight(cur, b.textContent.slice(1))) b.classList.add('ok'); });
      if (ok) { streak++; right++; score += 10 * comboMult(streak); G.right(cur.id); }
      else { streak = 0; btn.classList.add('bad'); missed.set(cur.id, cur); why.textContent = cur.x || ''; flash(sent, 'gm-shake'); }
      hud();
      G.later(next, ok ? 500 : 1800);
    };
    next(); G.frame(tick);
  },

  // ---------- 叩 Кроти ----------
  mole(G, { words }) {
    const LEN = 45000, HOLES = 9;
    let score = 0, hits = 0, wrong = 0, target = null, lastTarget = 0;
    const up = new Map(); // hole → { w, until }
    const missed = new Map();
    G.body.innerHTML = `<div class="gm-bar"><i></i></div><div class="gm-target panel" aria-live="polite"></div><div class="gm-field">${Array.from({ length: HOLES }, (_, i) => `<div class="gm-hole"><button type="button" class="gm-mole" data-h="${i}" tabindex="-1"></button></div>`).join('')}</div>`;
    const bar = $('.gm-bar i', G.body), tgt = $('.gm-target', G.body), moles = $$('.gm-mole', G.body);
    const hud = () => (G.hud.innerHTML = `<b>${score}</b><span class="muted">✓ ${hits}</span>`);
    const newTarget = () => { target = words[Math.floor(Math.random() * words.length)]; lastTarget = G.clock.now(); tgt.innerHTML = `<small class="muted">Знайдіть слово:</small><b>${esc(target.uk)}</b>`; flash(tgt, 'gm-pulse'); };
    const hide = h => { const m = moles[h]; m.classList.remove('up', 'ok', 'bad'); m.tabIndex = -1; up.delete(h); };
    const visible = w => [...up.values()].some(x => x.w.key === w.key);
    const spawn = force => {
      const free = [...Array(HOLES).keys()].filter(h => !up.has(h));
      if (!free.length) return;
      const h = free[Math.floor(Math.random() * free.length)];
      const others = words.filter(w => w.uk !== target.uk && !visible(w));
      const w = force || (!visible(target) && Math.random() < 0.5) || !others.length ? target : others[Math.floor(Math.random() * others.length)];
      const life = Math.max(1300, 2400 - hits * 45);
      up.set(h, { w, until: G.clock.now() + life });
      const m = moles[h];
      m.innerHTML = wordHTML(w); m.tabIndex = 0; m.classList.add('up');
    };
    moles.forEach((m, h) => (m.onclick = () => {
      const x = up.get(h);
      if (!x || m.classList.contains('ok')) return;
      if (x.w.uk === target.uk) {
        hits++; score += 10 + Math.min(10, Math.floor(hits / 5) * 2); G.right(x.w.key);
        m.classList.add('ok'); up.get(h).until = G.clock.now() + 250;
        newTarget();
      } else {
        wrong++; score = Math.max(0, score - 5); missed.set(target.key, target);
        m.classList.add('bad'); up.get(h).until = G.clock.now() + 350; flash(tgt, 'gm-shake');
      }
      hud();
    }));
    let nextSpawn = 0;
    const tick = () => {
      const now = G.clock.now(), left = Math.max(0, LEN - now);
      bar.style.width = (left / LEN) * 100 + '%';
      bar.parentElement.classList.toggle('low', left < 10000);
      for (const [h, x] of up) if (now >= x.until) hide(h);
      if (now >= nextSpawn && up.size < 3) { spawn(!visible(target) && now - lastTarget > 1500); nextSpawn = now + 650; }
      if (left <= 0) return G.end({ score, lines: [`${hits} ${plWord(hits, ['влучання', 'влучання', 'влучань'])}`, `помилок ${wrong}`], mistakes: [...missed.values()].map(wordMiss) });
      G.frame(tick);
    };
    newTarget(); hud(); G.frame(tick);
  },
};
