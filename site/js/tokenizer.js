// Kuromoji in a Web Worker (js/kuromoji-worker.js): the page never blocks while the dictionary
// (≈ 18 МБ, cached after the first download) is loaded/built or while text is tokenized.
// Used by Перекладач (translate.js) and automatic readings (importer.js, via kuroshiroAnalyzer()).

let worker = null, readyP = null, seq = 0;
const pending = new Map(); // id → { res, rej }
const listeners = new Set();
export const tokState = { phase: 'idle', loaded: 0, total: 0, error: '' }; // idle | download | build | ready | error

const emit = () => listeners.forEach(fn => { try { fn(tokState); } catch { /* ignore */ } });
/** Subscribe to progress ({ phase, loaded, total }); returns an unsubscribe function. */
export function onTokProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const tokenizerReady = () => tokState.phase === 'ready';

function fail(msg) {
  tokState.phase = 'error';
  tokState.error = msg;
  emit();
  for (const p of pending.values()) p.rej(new Error(msg));
  pending.clear();
  readyP = null;
  try { worker?.terminate(); } catch { /* ignore */ }
  worker = null;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./kuromoji-worker.js', import.meta.url));
  worker.onmessage = ({ data: m }) => {
    if (m.type === 'progress') { Object.assign(tokState, { phase: m.phase, loaded: m.loaded, total: m.total, error: '' }); emit(); }
    else if (m.type === 'ready') { tokState.phase = 'ready'; emit(); }
    else if (m.type === 'tokens') { pending.get(m.id)?.res(m.tokens); pending.delete(m.id); }
    else if (m.type === 'error') {
      if (m.id != null) { pending.get(m.id)?.rej(new Error(m.message)); pending.delete(m.id); }
      else fail(m.message);
    }
  };
  worker.onerror = e => { e.preventDefault?.(); fail(e.message || 'worker error'); };
  return worker;
}

/** Start loading the dictionary (no-op if loaded). Resolves when the tokenizer is ready. */
export function ensureTokenizer() {
  if (tokState.phase === 'ready') return Promise.resolve();
  return (readyP ||= new Promise((res, rej) => {
    const off = onTokProgress(s => {
      if (s.phase === 'ready') { off(); res(); }
      else if (s.phase === 'error') { off(); rej(new Error(s.error)); }
    });
    if (tokState.phase !== 'download' && tokState.phase !== 'build') { tokState.phase = 'download'; tokState.loaded = 0; tokState.error = ''; emit(); }
    getWorker().postMessage({ type: 'init' });
  }));
}

/** Tokenize text in the worker → Kuromoji tokens (plain objects). */
export async function tokenize(text) {
  await ensureTokenizer();
  const id = ++seq;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    getWorker().postMessage({ type: 'tokenize', id, text: String(text || '') });
  });
}

/** Analyzer object for Kuroshiro (same token shape as kuroshiro-analyzer-kuromoji). */
export function kuroshiroAnalyzer() {
  return {
    init: () => ensureTokenizer(),
    parse: async (str = '') => {
      if (!String(str).trim()) return [];
      const toks = await tokenize(str);
      for (const t of toks) {
        t.verbose = { word_id: t.word_id, word_type: t.word_type, word_position: t.word_position };
        delete t.word_id; delete t.word_type; delete t.word_position;
      }
      return toks;
    },
  };
}

/** Progress as text + fraction for UI. */
export function tokProgressText(s = tokState) {
  if (s.phase === 'build') return { frac: 1, text: 'Готую словник для розбору…' };
  const mb = n => (n / 1048576).toFixed(1).replace('.', ',');
  const frac = s.total ? Math.min(1, s.loaded / s.total) : 0;
  return { frac, text: `Завантажую словник для розбору: ${mb(s.loaded)} / ${mb(s.total || 18e6)} МБ (лише перший раз, далі — з кешу)` };
}
