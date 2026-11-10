// AI helper of the Exam tab: «Чому так? Запитати ШІ» after an answer and the «Запитай ШІ» block at the bottom.
// Runs fully in the browser on Puter.js (https://docs.puter.com): every learner signs in to their own free Puter
// account ("user-pays" model), so there is no API key and no server function. It reads the exam session through the
// context the caller builds and never writes to it, so scoring, timers and results are not affected.
// The last messages live in sessionStorage (or memory if unavailable).
import { $, esc, toast } from './util.js';

const KEY = 'jp.examAsk';
const KEEP = 5; // messages
const MAX_INPUT = 1000; // characters: question + context
const MAX_CONTEXT = 800; // leaves room for the question
const MAX_OUTPUT_TOKENS = 700; // the prompt asks for ≈150 words; this only stops runaway answers
const TIMEOUT_MS = 45000;
const MSG_FAIL = 'Не вдалося отримати відповідь, спробуйте ще раз';
const MSG_SIGNIN = 'Щоб отримати пояснення, увійдіть у безкоштовний акаунт Puter';

export const PUTER_SRC = 'https://js.puter.com/v2/'; // docs.puter.com/getting-started
// Chosen from Puter's model list (2026-11): Claude Haiku 5.5 is the cheapest strong model there (0.10 / 0.50 USD per
// million tokens ≈ 0.03 ¢ per answer, so the free monthly allowance of a Puter account lasts long) and writes good
// Ukrainian and Japanese. If it fails, Puter's documented default model is tried once.
export const MODELS = ['claude-haiku-5-5', 'gpt-5.4-nano'];

export const SYSTEM = `You are a patient Japanese teacher for a Ukrainian-speaking learner who uses the Minna no Nihongo textbook.
Answer in Ukrainian. Explain why the learner's answer is wrong (if it is) and why the correct answer is right, and name the grammar point.
Keep the answer under about 150 words unless the learner asks for more. Use plain text without Markdown headings or tables.
Write Japanese readings only in kana: never romaji and never Cyrillic.
Do not invent facts beyond the textbook; if you are unsure, say so.
If the question is about the website itself and not about Japanese, tell the learner to contact the developer.`;

// ---------- context of a question (plain text, sent to the helper) ----------
/** HTML of a question → plain text; furigana stays as 漢字(かな). Parsed in an inert document, buttons dropped. */
export function htmlText(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('button, script, style').forEach(x => x.remove());
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
const cut = (s, n) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** Main facts first; the textbook reference and explanation are added only while they fit into MAX_CONTEXT. */
export function contextText({ section, lesson, question, options = [], given, correct, ok, point, note }) {
  const lines = [
    `Розділ: ${cut(section, 80)}`,
    lesson ? `Урок: ${cut(lesson, 60)}` : '',
    `Завдання: ${cut(question, 240)}`,
    options.length ? `Варіанти: ${options.map(o => cut(o, 60)).join('; ')}` : '',
    `Відповідь учня: ${cut(given, 120) || 'без відповіді'}`,
    `Правильна відповідь: ${cut(correct, 160)}`,
    `Результат: ${ok ? 'правильно' : 'неправильно'}`,
  ].filter(Boolean);
  let out = lines.join('\n');
  if (out.length > MAX_CONTEXT) out = cut(out, MAX_CONTEXT);
  for (const extra of [point && `Підручник: ${point}`, note && `Пояснення з підручника: ${note}`]) {
    if (!extra) continue;
    const room = MAX_CONTEXT - out.length - 1;
    if (room >= 40) out += '\n' + cut(extra, room);
  }
  return out;
}

// ---------- last messages ----------
let messages = null;
function readLog() {
  if (messages) return messages;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* unavailable */ }
  messages = (Array.isArray(saved) ? saved : []).filter(m => m && typeof m.t === 'string' && (m.r === 'u' || m.r === 'a')).slice(-KEEP);
  return messages;
}
function pushLog(...items) {
  messages = [...readLog(), ...items].slice(-KEEP);
  try { sessionStorage.setItem(KEY, JSON.stringify(messages)); } catch { /* the messages stay in memory */ }
}

// ---------- Puter.js ----------
let puterLoad = null;
/** Adds the Puter.js script once (only the Exam tab calls this). Resolves to window.puter. */
export function loadPuter() {
  if (window.puter?.ai) return Promise.resolve(window.puter);
  if (puterLoad) return puterLoad;
  puterLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PUTER_SRC;
    s.defer = true;
    s.onload = () => (window.puter?.ai ? resolve(window.puter) : reject(new Error('Puter.js loaded without puter.ai')));
    s.onerror = () => { puterLoad = null; s.remove(); reject(new Error('Puter.js could not be loaded')); };
    document.head.append(s);
  });
  puterLoad.catch(() => {}); // a failed preload is reported on the first question
  return puterLoad;
}

// For the console only: the error code and message, never the whole object (the SDK may attach request details).
const errInfo = e => {
  if (!e || typeof e !== 'object') return String(e);
  const code = e.error?.code || e.code || (typeof e.error === 'string' ? e.error : '');
  const msg = e.message || e.msg || e.error?.message || '';
  return [code, msg].filter(Boolean).join(': ').slice(0, 300) || 'unknown error';
};
const AUTH_CODES = /auth|sign|token|unauthori[sz]ed|permission|forbidden|401|403/i;
const isAuthError = e => AUTH_CODES.test(String(e?.error?.code || e?.code || (typeof e?.error === 'string' ? e.error : '') || e?.status || ''));

/** Text of a ChatResponse: message.content is a string or (for some providers) a list of parts. */
export function replyText(r) {
  const c = r?.message?.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('').trim();
  return typeof r === 'string' ? r.trim() : '';
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// ---------- request ----------
async function request(question, context) {
  let puter;
  try { puter = await loadPuter(); } catch (e) { console.error('ask:', errInfo(e)); return { error: MSG_FAIL }; }
  // Sign-in opens Puter's popup, so it runs here, right after the click on «Надіслати».
  try {
    if (!puter.auth.isSignedIn()) await puter.auth.signIn();
  } catch (e) { console.warn('ask: Puter sign-in did not finish:', errInfo(e)); return { error: MSG_SIGNIN }; }
  if (!puter.auth.isSignedIn()) return { error: MSG_SIGNIN };
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: context ? `${context}\n\nЗапитання учня: ${question}` : question },
  ];
  for (const model of MODELS) {
    try {
      const r = await withTimeout(puter.ai.chat(messages, false, { model, max_tokens: MAX_OUTPUT_TOKENS }), TIMEOUT_MS);
      const answer = replyText(r);
      if (answer) return { answer };
      console.error('ask: empty answer from', model);
    } catch (e) {
      console.error('ask: Puter AI failed with', model, '-', errInfo(e));
      if (isAuthError(e)) return { error: MSG_SIGNIN };
    }
  }
  return { error: MSG_FAIL };
}

// ---------- widgets ----------
let busy = false; // one request at a time, shared by all widgets on the page
let draft = ''; // text of the bottom block; survives moving to the next question
const widgets = new Set();
const syncAll = () => widgets.forEach(w => (w.el.isConnected ? w.sync() : widgets.delete(w)));

/** Escaped text; only **bold** of the model's plain text becomes markup. Line breaks are kept by CSS. */
const answerHTML = t => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
const msgHTML = m => `<div class="ask-msg ${m.r === 'u' ? 'me' : 'ai'}">${m.r === 'u' ? esc(m.t) : answerHTML(m.t)}</div>`;

function widget(el, { context = '', question = '', bottom = false }) {
  const limit = MAX_INPUT - context.length;
  el.innerHTML = `<form class="ask-form" autocomplete="off">
    ${context ? `<details class="ask-ctx" open><summary>Що побачить ШІ</summary><div class="ask-text">${esc(context)}</div></details>` : ''}
    <textarea class="input ask-input" rows="3" maxlength="${limit}" aria-label="Ваше запитання" placeholder="Ваше запитання…"></textarea>
    <div class="ask-row"><span class="muted small ask-count"></span><button class="btn primary ask-send"></button></div>
    <div class="ask-status" role="status"></div>
    <div class="ask-out" aria-live="polite"></div>
  </form>`;
  const form = $('form', el), input = $('textarea', el), send = $('.ask-send', el), status = $('.ask-status', el), out = $('.ask-out', el), count = $('.ask-count', el);
  input.value = bottom ? draft : question;
  let reply = null, error = '';
  const counter = () => { count.textContent = `${input.value.length} / ${limit}`; };
  const w = {
    el,
    sync() {
      send.disabled = busy;
      send.textContent = busy ? 'Надсилаю…' : 'Надіслати';
      status.innerHTML = busy ? '<span class="spinner"></span> <span>ШІ готує відповідь…</span>' : error ? `<span class="ask-err">${esc(error)}</span>` : '';
      if (bottom) {
        const log = readLog();
        out.innerHTML = log.length ? `<p class="muted small ask-log-title">Останні повідомлення</p>${log.map(msgHTML).join('')}` : '';
      } else out.innerHTML = reply ? msgHTML({ r: 'a', t: reply }) : '';
    },
  };
  input.addEventListener('input', () => { if (bottom) draft = input.value; counter(); });
  form.onsubmit = async e => {
    e.preventDefault();
    const question = input.value.trim();
    if (busy) return;
    if (!question) { input.focus(); return; }
    busy = true; error = '';
    syncAll();
    const r = await request(question, context);
    busy = false;
    if (r.answer) {
      pushLog({ r: 'u', t: question }, { r: 'a', t: r.answer });
      reply = r.answer;
      input.value = '';
      if (bottom) draft = '';
      counter();
    } else {
      error = r.error;
      if (!el.isConnected) toast(r.error); // the learner has moved on to another question
    }
    syncAll();
    if (el.isConnected) input.focus({ preventScroll: true });
  };
  counter();
  widgets.add(w);
  w.sync();
  return input;
}

/** The small button after an answer; opens the panel with the context right below it. getContext runs on the first click. */
export function addAskButton(parent, getContext, before = null, question = 'Поясни, будь ласка, чому правильна саме ця відповідь.') {
  const slot = document.createElement('div');
  slot.className = 'ask-zone ask-slot';
  slot.innerHTML = '<button type="button" class="btn ghost sm ask-open" aria-expanded="false">Чому так? Запитати ШІ</button><div class="ask-panel" hidden></div>';
  const btn = $('.ask-open', slot), panel = $('.ask-panel', slot);
  let input = null;
  btn.onclick = () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden) return;
    input ||= widget(panel, { context: getContext(), question });
    input.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  parent.insertBefore(slot, before);
}

/** The permanent «Запитай ШІ» block at the bottom of an exam page. */
export function mountAskBlock(container) {
  const box = document.createElement('section');
  box.className = 'panel ask-zone ask-block';
  box.innerHTML = '<h2 class="sec-title">Запитай ШІ</h2><p class="muted small">Відповідь ШІ може містити помилки, тому звіряйте її з підручником. На оцінку та час запитання не впливають. Відповідає ШІ сервісу Puter: при першому запитанні відкриється вікно входу в безкоштовний акаунт Puter.</p><div class="ask-body"></div>';
  container.append(box);
  loadPuter(); // preload, so the sign-in popup can open right on the first click
  widget($('.ask-body', box), { bottom: true });
}
