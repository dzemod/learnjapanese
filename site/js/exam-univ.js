// «Університетська версія»: the exam as one paper test (format of the 復習 test): 7 sections, 100 points, one page,
// «Перевірити» at the end. Logic lives in univ-paper.js; session + history helpers come from exam.js through `ctx`.
import { $, $$, esc, furi, gtext, I, toast } from './util.js';
import { loadScript } from './importer.js';
import { getSets } from './store.js';
import { addAskButton, mountAskBlock, contextText } from './exam-ask.js';
import { buildPaper, scorePaper, pointsLabel, availability, SECTIONS, plainText } from './univ-paper.js';

export { availability, SECTIONS };
export const newPaper = (bank, textbook, conf) => buildPaper(bank, textbook, +conf.from, +conf.to);
const RESULT_GROUP = { u1: 'частка', u2: 'антонім', u3: 'форма', u4: 'прислівник', u5: 'фраза', u6: 'слово', u7: 'конструкція' };
export const univGroups = RESULT_GROUP;

const multiline = html => html.replace(/\n/g, '<br>');
const textHTML = s => multiline(furi(s));
const keyOf = (it, i) => `${it.id}:${i}`;
const fmtPts = n => String(+(+n).toFixed(1)).replace('.', ',');

// ---------- blanks ----------
function blankHTML(it, b, i, ans, sec) {
  const key = keyOf(it, i);
  if (b.o) {
    const order = it.order?.[i] || b.o.map((_, x) => x);
    return `<span class="u-brace">｛</span>${order.map((oi, n) => `<button type="button" class="u-opt ${String(ans[key]) === String(oi) ? 'on' : ''}" data-k="${esc(key)}" data-v="${oi}" lang="ja">${furi(b.o[oi])}</button>${n < order.length - 1 ? '<span class="u-comma">，</span>' : ''}`).join('')}<span class="u-brace">｝</span>`;
  }
  const value = esc(ans[key] ?? '');
  const common = `class="u-in ${sec === 1 ? 'u-in-p' : 'u-in-f'}" data-k="${esc(key)}" value="${value}" lang="ja" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"`;
  if (sec === 2) return `<span class="u-word" lang="ja">${furi(b.b)}</span><span class="u-arrow" aria-hidden="true">↔</span><input ${common} aria-label="Антонім">`;
  if (b.b) return `<span class="u-form">（<span lang="ja">${furi(b.b)}</span>…<input ${common} aria-label="Потрібна форма">）</span>`;
  return `（<input ${common} aria-label="Частка">）`;
}
function itemHTML(it, ans, sec) {
  let i = 0;
  return it.parts.map(p => (typeof p === 'string' ? textHTML(p) : blankHTML(it, p, i++, ans, sec))).join('');
}
/** The example 例 of a section: the same item with its answers filled in. */
function exampleHTML(sec) {
  const it = sec.example;
  if (!it) return '';
  const body = it.parts.map(p => {
    if (typeof p === 'string') return textHTML(p);
    if (p.o) return `<span class="u-brace">｛</span>${p.o.map((o, n) => `<span class="u-opt static ${n === p.c ? 'on' : ''}">${furi(o)}</span>${n < p.o.length - 1 ? '<span class="u-comma">，</span>' : ''}`).join('')}<span class="u-brace">｝</span>`;
    if (sec.s === 2) return `<span class="u-word">${furi(p.b)}</span><span class="u-arrow" aria-hidden="true">↔</span><b class="u-ans">${furi(p.a[0])}</b>`;
    if (p.b) return `<span class="u-form">（${furi(p.b)}…<b class="u-ans">${furi(p.a[0])}</b>）</span>`;
    return `（<b class="u-ans">${furi(p.a[0])}</b>）`;
  }).join('');
  return `<div class="u-example" lang="ja"><span class="u-rei">例</span><div class="u-text">${body}</div></div>`;
}

// ---------- the paper ----------
export function paperView(root, ctx) {
  const S = ctx.session();
  const P = S.paper;
  let timerId = null;
  const countBlanks = P.sections.reduce((a, s) => a + s.items.reduce((b, it) => b + it.parts.filter(p => typeof p !== 'string').length, 0), 0);
  const filled = () => Object.values(S.ua).filter(v => v !== '' && v != null).length;
  const romaji = ctx.load('romaji', false);
  root.innerHTML = `<div class="u-paper fade-in">
    <div class="u-top">
      <a class="icon-btn" href="#/exam" aria-label="Вийти">${I.close}</a>
      <div class="ex-progress"><div class="bar"><i class="u-bar"></i></div><span class="u-count"></span></div>
      <span class="ex-timer"></span>
    </div>
    <header class="u-head"><div><p class="eyebrow">Університетська версія</p><h1 lang="ja">復習 <small>(${P.from}〜${P.to}課)</small></h1></div><div class="u-total" lang="ja">／100点</div></header>
    <label class="check sm u-romaji"><input type="checkbox" data-romaji ${romaji ? 'checked' : ''}><span>Ромаджі → кана</span></label>
    ${P.sections.map(sec => `<section class="u-sec" data-s="${sec.s}">
      <div class="u-sec-head"><h2><span class="u-num">${sec.s}.</span> ${esc(sec.title)}</h2><span class="u-pts">${esc(pointsLabel(sec))}</span></div>
      ${sec.blanks ? `<p class="u-task">${esc(sec.task)}</p>${exampleHTML(sec)}
      <ol class="u-items ${sec.s === 2 ? 'u-pairs' : ''}">${sec.items.map(it => `<li class="u-item"><div class="u-text" lang="ja">${itemHTML(it, S.ua, sec.s)}</div></li>`).join('')}</ol>`
    : `<p class="u-task muted">У вибраних уроках немає завдань цього розділу — його бали перерозподілено між іншими розділами.</p>`}
    </section>`).join('')}
    <div class="u-end"><button type="button" class="btn primary wide" data-check>Перевірити</button></div>
  </div>`;
  mountAskBlock($('.u-paper', root));
  const updateCount = () => {
    const f = filled();
    $('.u-count', root).textContent = `${f} / ${countBlanks}`;
    $('.u-bar', root).style.width = `${(f / (countBlanks || 1)) * 100}%`;
  };
  updateCount();
  let saveT = null;
  const persistSoon = () => { clearTimeout(saveT); saveT = setTimeout(ctx.persist, 250); };
  // typed answers
  const inputs = $$('.u-in', root);
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => { S.ua[inp.dataset.k] = inp.value.trim(); updateCount(); persistSoon(); });
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      finishRomaji(inp);
      (inputs[i + 1] || $('[data-check]', root)).focus();
    });
    inp.addEventListener('blur', () => finishRomaji(inp));
  });
  // wanakana leaves a final «n» (and unfinished syllables) in Latin until the next key → convert when leaving the field
  function finishRomaji(inp) {
    if (!$('[data-romaji]', root).checked || !window.wanakana || !/[a-z]/i.test(inp.value)) return;
    inp.value = window.wanakana.toKana(inp.value.toLowerCase());
    S.ua[inp.dataset.k] = inp.value.trim();
    persistSoon();
  }
  const bindRomaji = async on => {
    try {
      if (on) { await loadScript('https://cdn.jsdelivr.net/npm/wanakana@5.3.1/wanakana.min.js'); inputs.forEach(i => { if (!i.dataset.wk) { window.wanakana.bind(i, { IMEMode: true }); i.dataset.wk = '1'; } }); }
      else if (window.wanakana) inputs.forEach(i => { if (i.dataset.wk) { window.wanakana.unbind(i); i.dataset.wk = ''; } });
    } catch { toast('Не вдалося завантажити перетворювач ромаджі'); }
  };
  if (romaji) bindRomaji(true);
  $('[data-romaji]', root).onchange = e => { ctx.save('romaji', e.target.checked); bindRomaji(e.target.checked); };
  // choices: tap to circle, tap again to clear
  $$('.u-opt[data-k]', root).forEach(b => (b.onclick = () => {
    const k = b.dataset.k;
    const was = String(S.ua[k]) === b.dataset.v;
    $$(`.u-opt[data-k="${CSS.escape(k)}"]`, root).forEach(x => x.classList.remove('on'));
    if (was) delete S.ua[k]; else { S.ua[k] = b.dataset.v; b.classList.add('on'); }
    updateCount();
    persistSoon();
  }));
  const finish = () => {
    clearInterval(timerId);
    clearTimeout(saveT);
    inputs.forEach(finishRomaji);
    S.done = true;
    S.end = Date.now();
    saveHistory(ctx);
    ctx.persist();
    location.hash = '#/exam/result';
  };
  $('[data-check]', root).onclick = () => {
    const left = countBlanks - filled();
    if (left && !confirm(`Без відповіді: ${left}. Перевірити зараз?`)) return;
    finish();
  };
  if (S.deadline) {
    const el = $('.ex-timer', root);
    const up = () => {
      const t = Math.max(0, S.deadline - Date.now());
      el.textContent = `${Math.floor(t / 60000)}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}`;
      el.classList.toggle('low', t < 60000);
      if (!t) { clearInterval(timerId); toast('Час вийшов'); finish(); }
    };
    up();
    timerId = setInterval(up, 1000);
  }
  return () => clearInterval(timerId);
}

// ---------- results ----------
function setTitle(id) { return getSets().find(s => s.id === id)?.title || ''; }
const setRef = l => {
  const id = 'mnn-' + String(l).padStart(2, '0');
  return { kind: 'w', setId: id, title: setTitle(id) || `Урок ${l}` };
};
function firstAnswer(b) { return plainText(b.o ? b.o[b.c] : b.a[0]); }
function weakOf(it) {
  const b = it.parts.find(p => typeof p !== 'string');
  return b ? firstAnswer(b) : '';
}
function refsOf(it, ctx) {
  if (!it.pt) return ctx.refBtn(setRef(it.l), `Minna no Nihongo, Урок ${it.l} · Нові слова`);
  return ctx.refBtn(ctx.gref(it.pt), ctx.mnnRef(it.pt) || `Minna no Nihongo, Урок ${it.pt.split('-')[0]}`)
    + (it.spt && it.spt !== it.pt ? ctx.refBtn(ctx.gref(it.spt), ctx.mnnRef(it.spt)) : '');
}
function explanation(row, ctx) {
  const { it } = row;
  const out = [];
  if (it.x) out.push(it.x);
  if (it.s === 1 && !it.x) {
    for (const p of it.parts) {
      if (typeof p === 'string') continue;
      const gen = ctx.partGen[plainText(p.a[0])];
      if (gen) out.push(`${plainText(p.a[0])} — ${gen}.`);
    }
  }
  if (it.s === 3 && !it.x) {
    for (const p of it.parts) if (typeof p !== 'string') out.push(`${plainText(p.b)} → ${plainText(p.a[0])}: форма, яку вимагає конструкція речення.`);
  }
  const P = it.pt ? ctx.pointOf(it.pt) : null;
  if (P) out.push(`Конструкція: «${plainText(P.p.title)}».`);
  if (it.s === 2) {
    const b = it.parts[0];
    out.push(`${plainText(b.b)} ↔ ${b.a.map(plainText).join(' / ')}. Слова з уроку ${it.l}.`);
  }
  return out;
}
/** The whole sentence with the right answers, wrong answers struck through. */
function solvedHTML(row, sec) {
  const { it, res } = row;
  let i = 0;
  const html = it.parts.map(p => {
    if (typeof p === 'string') return textHTML(p);
    const r = res[i++];
    const given = r.value === undefined || r.value === '' ? null : p.o ? p.o[+r.value] : r.value;
    const right = furi(p.o ? p.o[p.c] : p.a[0]);
    const wrong = !r.ok && given != null ? `<s class="u-wrong">${p.o ? furi(given) : esc(given)}</s> ` : '';
    const empty = !r.ok && given == null ? '<span class="u-empty">без відповіді</span> ' : '';
    const alts = !p.o && p.a.length > 1 ? ` <small class="muted">(або ${p.a.slice(1).map(a => furi(a)).join(', ')})</small>` : '';
    if (sec === 2) return `<span class="u-word">${furi(p.b)}</span><span class="u-arrow" aria-hidden="true">↔</span>${wrong}${empty}<b class="${r.ok ? 'u-good' : 'ex-hl'}">${right}</b>${alts}`;
    return `${p.b ? `<span class="muted small">${furi(p.b)} → </span>` : ''}${wrong}${empty}<b class="${r.ok ? 'u-good' : 'ex-hl'}">${right}</b>${alts}`;
  }).join('');
  return `<div class="u-text" lang="ja">${html}</div>`;
}
/** What the AI helper sees about one item of the checked paper (read only). */
function askContext(row, sec, ctx) {
  const { it, res } = row;
  const blanks = it.parts.filter(p => typeof p !== 'string');
  const sentence = it.parts.map(p => (typeof p === 'string' ? plainText(p) : p.o ? `｛${p.o.map(plainText).join('，')}｝` : p.b ? `（${plainText(p.b)}…）` : '（　）')).join('');
  const given = blanks.map((b, i) => { const v = res[i]?.value; return v === undefined || v === '' ? '—' : b.o ? plainText(b.o[+v]) : v; });
  return contextText({
    section: `Університетська версія, розділ ${sec.s}: ${sec.title}`, lesson: String(it.l),
    question: [sentence, it.uk].filter(Boolean).join(' — '), given: given.join(', '), correct: blanks.map(firstAnswer).join(', '),
    ok: row.allOk, point: it.pt ? ctx.mnnRef(it.pt) : '', note: explanation(row, ctx).join(' '),
  });
}
function saveHistory(ctx) {
  const S = ctx.session();
  const r = scorePaper(S.paper, S.ua, S.over || {});
  const byType = {};
  r.sections.filter(s => s.blanks).forEach(s => { byType['u' + s.s] = { n: s.pts, ok: s.got, label: s.title }; });
  const mistakes = r.sections.flatMap(s => s.rows.filter(x => !x.allOk).map(x => ({ type: 'u' + s.s, weak: weakOf(x.it), ref: x.it.pt ? ctx.gref(x.it.pt) : setRef(x.it.l) })));
  const list = ctx.load('history', []);
  const entry = { at: S.start, name: `🎓 Уроки ${S.conf.from}–${S.conf.to}`, n: 100, ok: r.total, pct: Math.round(r.total), byType, mistakes, univ: true };
  const i = list.findIndex(x => x.at === S.start);
  if (i >= 0) list[i] = entry; else list.push(entry);
  ctx.save('history', list.slice(-60));
}
export function paperResult(root, ctx) {
  const S = ctx.session();
  const r = scorePaper(S.paper, S.ua, S.over || {});
  const pct = Math.round(r.total);
  const secsMistakes = r.sections.map(s => ({ s, rows: s.rows.filter(x => !x.allOk) })).filter(x => x.rows.length);
  const nMist = secsMistakes.reduce((a, x) => a + x.rows.length, 0);
  const took = S.end && S.start ? Math.max(1, Math.round((S.end - S.start) / 60000)) : 0;
  root.innerHTML = `<div class="exam fade-in u-result">
    <a class="back" href="#/exam">${I.back}<span>Екзамен</span></a>
    <div class="results"><div class="score-ring" style="--p:${pct}"><span>${fmtPts(r.total)}<small lang="ja">点</small></span></div>
      <h2>${pct >= 90 ? '完璧 — чудовий результат!' : pct >= 70 ? 'Добре!' : pct >= 50 ? 'Непогано, але є що повторити' : 'Варто повторити матеріал'}</h2>
      <p class="muted">${fmtPts(r.total)} із 100 балів · уроки ${S.paper.from}–${S.paper.to}${took ? ` · ${took} хв` : ''}</p>
      <div class="res-btns"><button class="btn primary" data-again>Новий варіант</button><a class="btn ghost" href="#/exam">До налаштувань</a></div></div>
    <section class="panel"><h2 class="sec-title">Бали за розділами</h2>
      <div class="u-table">${r.sections.map(s => `<div class="u-row ${s.blanks ? '' : 'off'}"><span class="u-rname"><b>${s.s}.</b> ${esc(s.title)}</span><div class="stack-bar"><i class="m" style="width:${s.pts ? (s.got / s.pts) * 100 : 0}%"></i></div><b class="u-rpts">${s.blanks ? `${fmtPts(s.got)} / ${s.pts}` : '—'}</b></div>`).join('')}
      <div class="u-row total"><span class="u-rname"><b>Разом</b></span><span></span><b class="u-rpts">${fmtPts(r.total)} / 100</b></div></div></section>
    ${nMist ? `<section class="panel"><h2 class="sec-title">Помилки (${nMist})</h2>
      ${secsMistakes.map(({ s, rows }) => `<h3 class="u-mh">${s.s}. ${esc(s.title)}</h3><div class="ex-mistakes">${rows.map(row => {
    const typedWrong = row.res.some((x, i) => !x.ok && !row.it.parts.filter(p => typeof p !== 'string')[i].o && x.value);
    return `<div class="ex-mistake" data-id="${esc(row.it.id)}">
        <div class="ex-type">Урок ${row.it.l}</div>
        ${solvedHTML(row, s.s)}
        ${row.it.uk ? `<p class="ex-uk">${esc(row.it.uk)}</p>` : ''}
        <div class="ex-expl">${explanation(row, ctx).map(t => `<p>${gtext(t)}</p>`).join('')}</div>
        <div class="ex-refs">${refsOf(row.it, ctx)}</div>
        ${typedWrong ? '<div class="btn-row ex-own"><button type="button" class="btn ghost sm" data-right>Я мав(ла) рацію</button></div>' : ''}
      </div>`;
  }).join('')}</div>`).join('')}</section>` : '<section class="panel"><p>Помилок немає 🎉</p></section>'}
  </div>`;
  ctx.wireRefs(root);
  $$('.ex-mistake', root).forEach(el => {
    const sec = r.sections.find(s => s.rows.some(x => x.it.id === el.dataset.id));
    const row = sec.rows.find(x => x.it.id === el.dataset.id);
    addAskButton(el, () => askContext(row, sec, ctx));
  });
  mountAskBlock($('.exam', root));
  $('[data-again]', root).onclick = () => ctx.again();
  $$('[data-right]', root).forEach(b => (b.onclick = () => {
    const id = b.closest('.ex-mistake').dataset.id;
    const row = r.sections.flatMap(s => s.rows).find(x => x.it.id === id);
    S.over ||= {};
    row.res.forEach(x => { if (!x.ok && x.value) S.over[x.key] = true; });
    saveHistory(ctx);
    ctx.persist();
    paperResult(root, ctx);
  }));
}
