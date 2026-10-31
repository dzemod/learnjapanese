// ---------- DOM helpers ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const fmtDate = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => fmtDate(new Date());

export const isTyping = e => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/** Font-size class for a big card text, based on length. */
export function sizeClass(text) {
  const n = [...String(text || '')].length;
  return n > 40 ? 'xs' : n > 22 ? 'sm' : n > 10 ? 'md' : '';
}

// ---------- Speech (ja-JP) ----------
const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => /^ja([-_]|$)/i.test(v.lang));
  voice =
    vs.find(v => /google/i.test(v.name)) ||
    vs.find(v => /kyoko|nanami|haruka|ayumi|sayaka|otoya|o-ren/i.test(v.name)) ||
    vs[0] || null;
}
if (hasTTS) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}
export function speak(text, slow = false) {
  if (!hasTTS || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[〜~]/g, ''));
    u.lang = 'ja-JP';
    if (voice) u.voice = voice;
    u.rate = slow ? 0.55 : 0.9;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
export function stopSpeech() {
  if (hasTTS) try { speechSynthesis.cancel(); } catch { /* ignore */ }
}
const KANA_ONLY = /^[぀-ヿ\s・ー〜~]+$/;
/** Speak a card: prefer the kana reading (avoids kanji misreads), else the Japanese text. */
export function speakCard(card, slow = false) {
  if (!card) return;
  if (card.say) return speak(card.say, slow);
  speak(card.reading && KANA_ONLY.test(card.reading) ? card.reading : card.japanese, slow);
}

// ---------- Answer checking ----------
const kataToHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export function norm(s) {
  return kataToHira(
    String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ʼ’‘`´]/g, "'")
      .replace(/[.,!?;:"«»„“”()\[\]{}「」『』【】。、！？・…〜~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
function variants(str, out = new Set()) {
  const s = String(str || '');
  const add = x => {
    const n = norm(x);
    if (n) { out.add(n); out.add(n.replace(/ /g, '')); }
  };
  add(s);
  add(s.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ''));
  s.split(/[,;/、・]|\s+або\s+/).forEach(p => { add(p); add(p.replace(/\([^)]*\)|（[^）]*）/g, '')); });
  return out;
}
export function answerVariants(card, side) {
  if (side === 'uk') return variants(card.ukrainian);
  const v = variants(card.japanese);
  if (card.reading) {
    variants(card.reading, v);
    const both = norm(card.japanese + ' ' + card.reading);
    v.add(both); v.add(both.replace(/ /g, ''));
  }
  return v;
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** Tolerant check. side = the language the answer is written in ('uk' | 'ja'). */
export function check(input, card, side) {
  const n = norm(input);
  if (!n) return { ok: false };
  const vs = answerVariants(card, side);
  if (vs.has(n) || vs.has(n.replace(/ /g, ''))) return { ok: true };
  if (side === 'uk') for (const v of vs) if (v.length >= 5 && lev(n, v) <= 1) return { ok: true, typo: true };
  return { ok: false };
}

// ---------- Import parsing ----------
export const JA = /[぀-ヿ㐀-鿿ｦ-ﾟ々〆]/;
export const KANJI = /[㐀-鿿々〆]/;
export const hasKanji = s => KANJI.test(String(s || ''));
const KANA_TOKEN = /^[぀-ヿー・～〜~\s]+$/;
const CYR = /[Ѐ-ӿʼ’]/;
const JA_RUN = '[\\u3040-\\u30ff\\u3400-\\u9fff々〆ー～〜]';
/** Remove spaces OCR puts between Japanese characters. */
export const tightenJa = s => s.replace(new RegExp(`(${JA_RUN}) +(?=${JA_RUN})`, 'g'), '$1');

/** Split the Japanese part into { japanese (kanji or kana), reading, hint, verbGroup }. */
function parseJa(raw) {
  let s = raw.trim().replace(/[\s\-–—=:|]+$/, '').replace(/^[\s\-–—=:|]+/, '');
  let hint = '', verbGroup = '';
  // usage hint in square brackets: [じかんに～]
  s = s.replace(/[\[［【]([^\]］】]*)[\]］】]/g, (_, h) => { hint = `[${h.trim()}]`; return ' '; });
  // verb group mark: I, II, III (Latin or Roman numerals) as a separate token
  s = s.replace(/(^|\s)(III|II|I|Ⅲ|Ⅱ|Ⅰ)(?=\s|$)/, (_, a, g) => { verbGroup = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III' }[g] || g; return ' '; });
  let reading = '';
  // reading in round brackets: 見ます(みます)
  const rm = s.match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*(.*)$/);
  if (rm && JA.test(rm[2]) && rm[1].trim()) { s = (rm[1] + ' ' + rm[3]).trim(); reading = rm[2].trim(); }
  // tokens separated by spaces / column gaps: "みます 見ます"
  const tokens = s.split(/\s*\|\s*|\s{2,}|\t|\s+/).map(t => t.trim()).filter(Boolean);
  let japanese = '';
  const kanjiTok = tokens.filter(t => hasKanji(t));
  const kanaTok = tokens.filter(t => KANA_TOKEN.test(t) && !hasKanji(t));
  if (kanjiTok.length) {
    japanese = kanjiTok.join(' ');
    if (!reading && kanaTok.length) reading = kanaTok.join(' ');
  } else {
    japanese = tokens.join(' ');
  }
  japanese = tightenJa(japanese);
  reading = tightenJa(reading);
  if (!hasKanji(japanese)) reading = '';
  return { japanese, reading, hint, verbGroup };
}

/**
 * Parse one line into a card. Formats: "見ます - дивитися", "みます – дивитися", "見ます(みます) дивитися",
 * "みます 見ます дивитися", tab- or "|"-separated columns, and reversed "дивитися - 見ます".
 */
export function parseLine(line) {
  let s = String(line).replace(/ /g, ' ').trim();
  if (!s) return null;
  if (/^[※*]/.test(s)) return { skip: true, line }; // proper names
  s = s.replace(/^(\d+[.)]|[•·▪◦])\s*/, '').replace(/^-\s+/, '');
  if (!JA.test(s)) return { error: true, line };
  let ja = '', uk = '';
  const first = s.search(CYR);
  if (first > 0) {
    // Japanese first, Ukrainian from the first Cyrillic letter (allow an opening bracket/quote just before)
    let cut = first;
    while (cut > 0 && /[(«"'„]/.test(s[cut - 1])) cut--;
    ja = s.slice(0, cut); uk = s.slice(cut);
    // reversed? Japanese after Ukrainian
  } else if (first === 0) {
    const m = s.match(/\s*(?:\s[-–—=:]\s|[|\t])\s*/);
    if (m && JA.test(s.slice(m.index + m[0].length))) { uk = s.slice(0, m.index); ja = s.slice(m.index + m[0].length); }
    else { const j = s.search(JA); uk = s.slice(0, j); ja = s.slice(j); }
  } else {
    // no Cyrillic: maybe romaji/English meaning after a separator
    const m = s.match(/\s+[-–—=:]\s+|[|\t]/);
    if (!m) return { error: true, line };
    ja = s.slice(0, m.index); uk = s.slice(m.index + m[0].length);
  }
  uk = uk.replace(/^[\s\-–—=:|]+|[\s\-–—=:|]+$/g, '').replace(/\s*\|\s*/g, ', ').replace(/\s+/g, ' ');
  const j = parseJa(ja);
  if (!j.japanese || !uk) return { error: true, line };
  return { ...j, ukrainian: uk };
}

/** Parse many lines; returns { cards, bad, skipped }. */
export function parseText(text) {
  const cards = [], bad = [], skipped = [];
  for (const line of String(text).split(/\r?\n/)) {
    const r = parseLine(line);
    if (!r) continue;
    if (r.skip) skipped.push(r.line);
    else if (r.error) bad.push(r.line);
    else cards.push(r);
  }
  return { cards, bad, skipped };
}

// ---------- UI helpers ----------
/** toast(msg, { duration, action: { label, fn } }) */
export function toast(msg, { duration = 2600, action = null } = {}) {
  const t = $('#toast');
  if (!t) return;
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  t.classList.toggle('has-action', !!action);
  if (action) $('.toast-btn', t).onclick = () => { t.classList.remove('show'); clearTimeout(toast._t); action.fn(); };
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), duration);
}

export function modal(html, onMount) {
  $('#toast')?.classList.remove('show'); // never cover dialog buttons (bottom sheet on phones)
  const wrap = document.createElement('div');
  wrap.className = 'modal-back';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(wrap);
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  onMount?.(wrap.firstElementChild, close);
  return close;
}

export function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile() {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.json,application/json';
    i.onchange = () => { const f = i.files[0]; f ? f.text().then(res) : res(null); };
    i.click();
  });
}

export function onSwipe(el, { left, right }) {
  let x0 = null, y0 = 0, t0 = 0;
  el.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - t0 < 800) {
      el._swiped = Date.now();
      dx < 0 ? left?.() : right?.();
    }
  }, { passive: true });
}
export const justSwiped = el => el._swiped && Date.now() - el._swiped < 400;

// ---------- Icons ----------
const svg = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const I = {
  star: svg('<path d="M12 3.6l2.6 5.2 5.8.9-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.9z"/>'),
  speaker: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
  shuffle: svg('<path d="M3 6h3c5 0 7 12 12 12h3"/><path d="M3 18h3c2 0 3.5-2 4.5-4.5"/><path d="M13.5 9.5C14.5 7.5 16 6 18 6h3"/><path d="M18 3l3 3-3 3"/><path d="M18 15l3 3-3 3"/>'),
  play: svg('<path d="M7 4.5l12 7.5-12 7.5z"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
  upload: svg('<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 19h16"/>'),
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
};

// ---------- Furigana markup: {漢字|かんじ} ----------
const FG = /\{([^{}|]+)\|([^{}]+)\}/g;
/** HTML: kanji followed by the hiragana reading in brackets, e.g. 先生(せんせい). */
export const furi = s => esc(s).replace(FG, (_, k, r) => `${k}<span class="fg">(${r})</span>`);
/** Plain text with readings in brackets (for search). */
export const furiPlain = s => String(s ?? '').replace(FG, '$1($2)');
/** Text for speech: readings instead of kanji. */
export const furiSay = s => String(s ?? '').replace(FG, '$2');
