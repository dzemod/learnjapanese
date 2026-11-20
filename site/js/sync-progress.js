// Progress sync between devices through the learner's own free Puter account (puter.kv: a private key-value store
// of this site inside the learner's account; "user-pays" — nothing is billed to the site, no key, no server).
// What is synced (localStorage): word progress, kanji writing schedule, study days, saved exam mistakes (+ when the
// list was cleared), exam history, best match times, Сенсей level, heatmap counts, achievement dates, kanji associations. Merge rules: sync-merge.js (newer answer wins,
// unions; symmetric, so devices may sync in any order). Lessons themselves are not synced here (they go to GitHub).
// Remote layout: head key HEAD = { v, at, id, n, hash } + parts `${HEAD}.${id}.${i}` (the JSON split into strings, so
// one value never reaches puter.kv.MAX_VALUE_SIZE, 399 KB); a new head is written after its parts, old parts deleted.
// Sync runs: «Увімкнути синхронізацію» / «Синхронізувати зараз» (a click: may open Puter's sign-in), on start and when
// the page is hidden (only if already signed in — never a popup without a click). Errors never break the page.
import { $, esc, toast } from './util.js';
import { puterReady } from './ai-helper.js';
import { mergeAll } from './sync-merge.js';
import { reloadProgressFromStorage } from './store.js';

export const HEAD = 'kotoba.progress.v1';
const PART_CHARS = 60000; // ≤ 180 KB even if every character takes 3 bytes of UTF-8
const STATE_KEY = 'jp.sync';
const AUTO_GAP_MS = 2 * 60e3; // automatic syncs at most every 2 minutes
export const LS = { progress: 'jp.progress', kanji: 'jp.kanjiWrite', days: 'jp.days', mistakes: 'jp.examMistakes', cleared: 'jp.examMistakes.clearedAt', history: 'jp.examHistory', best: 'jp.best', level: 'jp.sensei.level', activity: 'jp.activity', time: 'jp.studyTime', unlocked: 'jp.achievements', notes: 'jp.kanjiNotes', grammar: 'jp.grammarSrs' };
export const MSG = {
  signin: 'Щоб синхронізувати прогрес, увійдіть у безкоштовний акаунт Puter',
  fail: 'Не вдалося синхронізувати, спробуйте ще раз',
  offline: 'Немає з’єднання з Puter. Прогрес збережено на цьому пристрої',
};

const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const getRaw = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const setRaw = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* blocked */ } };
export const syncState = () => ({ on: false, last: 0, error: '', ...(get(STATE_KEY, {}) || {}) });
const saveState = patch => set(STATE_KEY, { ...syncState(), ...patch });

/** This device's data in the shape of sync-merge.js. */
export function localData() {
  return {
    progress: get(LS.progress, {}), kanji: get(LS.kanji, {}), days: get(LS.days, []),
    mistakes: { items: get(LS.mistakes, []), clearedAt: +get(LS.cleared, 0) || 0 },
    history: get(LS.history, []), best: get(LS.best, {}), level: getRaw(LS.level),
    activity: get(LS.activity, {}), time: get(LS.time, {}), unlocked: get(LS.unlocked, {}), notes: get(LS.notes, {}), grammar: get(LS.grammar, {}),
  };
}
function writeLocal(d) {
  set(LS.progress, d.progress); set(LS.kanji, d.kanji); set(LS.days, d.days);
  set(LS.mistakes, d.mistakes.items); set(LS.cleared, d.mistakes.clearedAt);
  set(LS.history, d.history); set(LS.best, d.best);
  set(LS.activity, d.activity); set(LS.time, d.time); set(LS.unlocked, d.unlocked); set(LS.notes, d.notes); set(LS.grammar, d.grammar);
  if (d.level != null) setRaw(LS.level, String(d.level));
  reloadProgressFromStorage();
}
// small, stable fingerprint of the data (detects "nothing changed")
export function fingerprint(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return `${s.length}:${(h >>> 0).toString(36)}`; }

async function readRemote(kv) {
  const head = await kv.get(HEAD);
  if (!head || typeof head !== 'object' || !head.id || !head.n) return { head: null, data: null };
  const parts = await Promise.all(Array.from({ length: head.n }, (_, i) => kv.get(`${HEAD}.${head.id}.${i}`)));
  if (parts.some(p => typeof p !== 'string')) throw new Error('remote parts missing');
  return { head, data: JSON.parse(parts.join('')) };
}
async function writeRemote(kv, json, hash, oldHead) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const parts = [];
  for (let i = 0; i < json.length; i += PART_CHARS) parts.push(json.slice(i, i + PART_CHARS));
  if (!parts.length) parts.push('{}');
  for (let i = 0; i < parts.length; i++) await kv.set(`${HEAD}.${id}.${i}`, parts[i]);
  await kv.set(HEAD, { v: 1, at: Date.now(), id, n: parts.length, hash });
  if (oldHead?.id) for (let i = 0; i < oldHead.n; i++) kv.del(`${HEAD}.${oldHead.id}.${i}`).catch?.(() => {}); // best effort
}

let running = null;
/**
 * One sync: read the account's copy, merge with this device, store the result on both sides.
 * Resolves to { ok, changed (this device got new data), uploaded, error }. Never throws.
 */
export function syncNow({ interactive = false } = {}) {
  if (running) return running;
  running = (async () => {
    let puter;
    try { puter = await puterReady({ interactive }); } catch (e) { console.warn('sync: Puter.js not available', e?.message || e); saveState({ error: MSG.offline }); return { ok: false, error: MSG.offline }; }
    if (!puter) { if (interactive) saveState({ error: MSG.signin }); return { ok: false, error: MSG.signin }; }
    try {
      const kv = puter.kv;
      const { head, data } = await readRemote(kv);
      const local = localData();
      const merged = mergeAll(local, data || {});
      const before = JSON.stringify({ ...local, level: null }), after = JSON.stringify({ ...merged, level: null });
      const changed = before !== after || (merged.level ?? null) !== (local.level ?? null);
      if (changed) writeLocal(merged);
      const json = JSON.stringify(merged), hash = fingerprint(json);
      const uploaded = !head || head.hash !== hash;
      if (uploaded) await writeRemote(kv, json, hash, head);
      saveState({ on: true, last: Date.now(), error: '' });
      if (changed) document.dispatchEvent(new CustomEvent('kotoba:progress-synced'));
      return { ok: true, changed, uploaded };
    } catch (e) {
      console.error('sync failed:', e?.error?.code || e?.code || '', e?.message || e?.error?.message || String(e).slice(0, 200));
      saveState({ error: MSG.fail });
      return { ok: false, error: MSG.fail };
    }
  })().finally(() => { running = null; });
  return running;
}
export function disableSync() { saveState({ on: false, error: '' }); }

/** On start and when the page is hidden: sync quietly if the learner turned sync on (no popup without a click). */
export function initProgressSync() {
  const auto = () => { const s = syncState(); if (s.on && Date.now() - (s.last || 0) > AUTO_GAP_MS) syncNow(); };
  if (syncState().on) setTimeout(() => syncNow(), 1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') auto(); });
  document.addEventListener('kotoba:progress-synced', () => toast('Прогрес оновлено з іншого пристрою', { duration: 6000, action: { label: 'Показати', fn: () => dispatchEvent(new HashChangeEvent('hashchange')) } }));
}

// ---------- the block in «Резервна копія і дані» (home page) ----------
const when = t => (t ? new Date(t).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');
export function syncBlockHTML() {
  return '<div class="sync-progress" aria-live="polite"></div>';
}
export function mountSyncBlock(root) {
  const box = $('.sync-progress', root);
  if (!box) return;
  let busy = false;
  const draw = () => {
    const s = syncState();
    box.innerHTML = `<h3 class="sp-title">Синхронізація між пристроями</h3>
      <p class="muted small">Прогрес слів і канджі, дні навчання, досягнення, асоціації до канджі, збережені помилки й історія екзаменів зберігаються у вашому безкоштовному акаунті Puter (той самий, що для Сенсея) і з’єднуються на всіх пристроях, де ви увійшли. Якщо вчилися на двох пристроях без інтернету, нічого не загубиться: для кожного слова береться новіша відповідь.</p>
      <p class="sp-status small">${busy ? '<span class="spinner"></span> Синхронізую…' : s.error ? `<span class="ask-err">${esc(s.error)}</span>` : s.on ? `Увімкнено${s.last ? ` · остання синхронізація: ${esc(when(s.last))}` : ''}` : 'Вимкнено: прогрес зберігається лише в цьому браузері.'}</p>
      <div class="btn-row">${s.on ? '<button type="button" class="btn primary sm" data-sync-now>Синхронізувати зараз</button><button type="button" class="btn ghost sm" data-sync-off>Вимкнути</button>' : '<button type="button" class="btn primary sm" data-sync-on>Увімкнути синхронізацію</button>'}</div>`;
    const run = async () => {
      busy = true; draw();
      const r = await syncNow({ interactive: true });
      busy = false; draw();
      if (r.ok && !r.changed) toast('Синхронізовано'); // with new data the «Прогрес оновлено… · Показати» toast is shown
    };
    $('[data-sync-on]', box)?.addEventListener('click', run);
    $('[data-sync-now]', box)?.addEventListener('click', run);
    $('[data-sync-off]', box)?.addEventListener('click', () => { disableSync(); draw(); });
  };
  draw();
}
