// Draft machine translation for Перекладач: MyMemory (free, no key, ≈ 5000 words/day per user).
// Only called when the user presses «Розібрати» / «Перекласти». Results are cached on this device
// (localStorage jp.mt.cache) so the same sentence never spends the daily quota twice.
const API = 'https://api.mymemory.translated.net/get';
const CACHE_KEY = 'jp.mt.cache', LIMIT_KEY = 'jp.mt.limit', MAX_CACHE = 200, MAX_BYTES = 480;

const today = () => new Date().toISOString().slice(0, 10);
const load = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } };
function save(key, text) {
  try {
    const c = load();
    delete c[key];
    c[key] = text;
    const keys = Object.keys(c);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_CACHE))) delete c[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* storage full or blocked — just no cache */ }
}
export class MtLimitError extends Error {}

/** True if MyMemory already said today's free quota is used up (we don't ask again until tomorrow). */
export const mtLimitReached = () => { try { return localStorage.getItem(LIMIT_KEY) === today(); } catch { return false; } };

const bytes = s => new TextEncoder().encode(s).length;
/** MyMemory accepts ≤ 500 bytes per request → split by sentences (and by length if needed). */
function chunks(text) {
  const parts = String(text).split(/(?<=[。！？!?.…\n])/u).map(s => s).filter(s => s.trim());
  const out = [];
  let cur = '';
  const push = s => { if (s.trim()) out.push(s); };
  for (let p of parts) {
    while (bytes(p) > MAX_BYTES) { // very long sentence without punctuation
      let n = p.length;
      while (bytes(p.slice(0, n)) > MAX_BYTES) n = Math.floor(n * 0.8);
      const cut = Math.max(p.lastIndexOf(' ', n), p.lastIndexOf('、', n), p.lastIndexOf(',', n));
      if (cut > n / 2) n = cut + 1;
      push(cur); cur = '';
      push(p.slice(0, n));
      p = p.slice(n);
    }
    if (bytes(cur + p) > MAX_BYTES) { push(cur); cur = p; } else cur += p;
  }
  push(cur);
  return out;
}
function decode(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

/**
 * Translate text (from/to: 'ja' | 'uk'). Returns { text, cached }.
 * Throws MtLimitError when the daily free quota is used up, Error on network problems.
 */
export async function machineTranslate(text, from, to) {
  const src = String(text || '').trim();
  if (!src) return { text: '', cached: true };
  const key = `${from}|${to}|${src}`;
  const hit = load()[key];
  if (hit != null) return { text: hit, cached: true };
  if (mtLimitReached()) throw new MtLimitError('limit');
  const out = [];
  for (const part of chunks(src)) {
    const url = `${API}?q=${encodeURIComponent(part.trim())}&langpair=${from}|${to}`;
    let res;
    try { res = await fetch(url, { credentials: 'omit' }); } catch { throw new Error('network'); }
    const j = res.ok || res.status === 429 ? await res.json().catch(() => null) : null;
    const tr = j?.responseData?.translatedText || '';
    if (res.status === 429 || String(j?.responseStatus) === '429' || j?.quotaFinished || /MYMEMORY WARNING|USED ALL AVAILABLE FREE/i.test(tr)) {
      try { localStorage.setItem(LIMIT_KEY, today()); } catch { /* ignore */ }
      throw new MtLimitError('limit');
    }
    if (!res.ok || !j || String(j.responseStatus) !== '200') throw new Error('http ' + res.status);
    out.push(decode(tr));
  }
  const result = out.join(to === 'ja' ? '' : ' ').replace(/\s+/g, ' ').trim();
  save(key, result);
  return { text: result, cached: false };
}

/** Forget today's limit flag (the «Спробувати ще раз» button). */
export function mtResetLimit() { try { localStorage.removeItem(LIMIT_KEY); } catch { /* ignore */ } }
