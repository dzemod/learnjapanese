import { uid, today, fmtDate, shuffle, hasKanji } from './util.js';

const K = { progress: 'jp.progress', custom: 'jp.custom', opts: 'jp.opts', days: 'jp.days', best: 'jp.best', pw: 'jp.pw' };
const DEFAULT_OPTS = { answer: 'uk', filter: 'all', shuffle: false, fcSort: true, listenType: 'choose', kanjiAns: 'both', termOrder: 'book' };

function load(k, def) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('Storage failed', e); }
}

export const state = {
  base: [],            // sets from data/sets.json (internal card format)
  loadError: false,
  custom: load(K.custom, { newSets: [], mods: {}, pending: {}, history: {} }), // local sets + local changes + unsynced lessons
  progress: load(K.progress, {}),
  opts: { ...DEFAULT_OPTS, ...load(K.opts, {}) },
  days: load(K.days, []),
  best: load(K.best, {}),
  sync: { configured: null, busy: false, error: '' },
};
state.custom.newSets ||= [];
state.custom.mods ||= {};
state.custom.pending ||= {};
state.custom.history ||= {};
state.custom.kanji ||= {}; // locally edited kanji lessons (until the deployed kanji.json matches)

const saveCustom = () => save(K.custom, state.custom);

// ---------- Card format ----------
// Stored (sets.json): { id, kanji, kana, ukrainian, verbGroup, hint, section, source, readingAuto? }
// Internal:           { id, japanese (kanji or kana), reading (kana if there is kanji), ukrainian, verbGroup, hint, section, source, readingAuto }
export function fromStored(c) {
  if ('japanese' in c && !('kana' in c) && !('kanji' in c)) {
    return { verbGroup: '', hint: '', section: 'main', source: 'my', ...c, reading: c.reading || '', check: !!c.check };
  }
  const kanji = (c.kanji || '').trim(), kana = (c.kana || '').trim();
  return {
    id: c.id, japanese: kanji || kana, reading: kanji ? kana : '', ukrainian: c.ukrainian || '',
    verbGroup: c.verbGroup || '', hint: c.hint || '', section: c.section || 'main', source: c.source || 'my',
    check: !!(c.check || c.readingAuto),
  };
}
export function toStored(c) {
  const k = hasKanji(c.japanese);
  const out = {
    id: c.id, kanji: k ? c.japanese : '', kana: k ? c.reading || '' : c.japanese, ukrainian: c.ukrainian,
    verbGroup: c.verbGroup || '', hint: c.hint || '', section: c.section || 'main', source: c.source || 'my',
  };
  if (c.check) out.check = true;
  return out;
}
const fromStoredSet = s => ({ ...s, source: s.source || 'my', cards: (s.cards || []).map(fromStored) });
export const toStoredSet = s => ({
  id: s.id, title: s.title, dateCreated: s.dateCreated || today(), source: s.source || 'my', cards: s.cards.map(toStored),
});

export async function loadBase() {
  try {
    const r = await fetch('data/sets.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    state.base = (Array.isArray(j.sets) ? j.sets : []).map(fromStoredSet);
  } catch (e) {
    console.error('Could not load data/sets.json', e);
    state.base = [];
    state.loadError = true;
  }
  // A local lesson copy is no longer needed once the deployed sets.json contains exactly the same lesson.
  const same = (a, b) => JSON.stringify(toStoredSet(a)) === JSON.stringify(toStoredSet({ ...b, dateCreated: a.dateCreated }));
  const before = state.custom.newSets.length;
  state.custom.newSets = state.custom.newSets.filter(s => {
    const b = state.base.find(x => x.id === s.id);
    return !b || state.custom.pending[s.id] || !same(s, b);
  });
  if (before !== state.custom.newSets.length) saveCustom();
}

// ---------- Sets (base + local layer) ----------
function applyMods(set, m) {
  const deleted = new Set(m.deleted || []);
  const edits = m.edits || {};
  const ids = new Set(set.cards.map(c => c.id));
  const cards = set.cards
    .filter(c => !deleted.has(c.id))
    .map(c => (edits[c.id] ? { ...c, ...edits[c.id], id: c.id } : c))
    .concat((m.added || []).filter(c => !ids.has(c.id) && !deleted.has(c.id)));
  return { ...set, title: m.title || set.title, cards };
}

export function getSets() {
  const out = [];
  const shown = new Set();
  // A local copy of a lesson wins over the deployed version (it is newer until Vercel redeploys).
  for (const s of state.custom.newSets) {
    if (state.base.some(b => b.id === s.id) && !state.custom.mods[s.id]?.hidden) { out.push({ ...s, source: s.source || 'my', origin: 'local' }); shown.add(s.id); }
  }
  for (const s of state.base) {
    if (shown.has(s.id)) continue;
    const m = state.custom.mods[s.id] || {};
    if (m.hidden) continue;
    out.push({ ...applyMods(s, m), origin: 'base' });
    shown.add(s.id);
  }
  for (const s of state.custom.newSets) if (!shown.has(s.id) && !state.base.some(b => b.id === s.id)) out.push({ ...s, source: s.source || 'my', origin: 'local' });
  return out;
}
// Extra (virtual) sets, e.g. kanji lessons — registered by kanji.js.
let extraProvider = () => null;
export const registerSetProvider = fn => (extraProvider = fn);
export const getSet = id => getSets().find(s => s.id === id) || extraProvider(id);
// Kanji lesson payloads for syncing (registered by kanji.js).
let kanjiPayload = () => null;
export const registerKanjiPayload = fn => (kanjiPayload = fn);
export function markKanjiPending(lessonId) {
  state.custom.pending[lessonId] = 'kanji';
  saveCustom();
  emit();
}
export const saveCustomNow = () => saveCustom();
// Exam presets (Екзамен tab) — synced as one file through the same API.
let presetsPayload = () => [];
export const registerPresetsPayload = fn => (presetsPayload = fn);
export function markPresetsPending() { state.custom.pending['exam-presets'] = 'presets'; saveCustom(); emit(); }
export const isMine = set => !!set && set.source !== 'textbook';

/**
 * Every edited set (my lessons AND textbook lessons) gets a full local copy in custom.newSets.
 * The local copy is shown immediately and pushed to GitHub through /api/save-set.
 * Card ids never change, so learning progress (keyed by setId/cardId) is kept.
 */
function ensureLocalCopy(setId) {
  if (localSet(setId)) return localSet(setId);
  const merged = getSet(setId);
  const copy = {
    id: merged.id, title: merged.title, dateCreated: merged.dateCreated, source: merged.source || 'my',
    cards: merged.cards.map(c => ({ ...c })),
  };
  state.custom.newSets.push(copy);
  delete state.custom.mods[setId];
  return copy;
}
const localSet = id => state.custom.newSets.find(s => s.id === id);
const mods = id => (state.custom.mods[id] ||= {});
const editable = setId => ensureLocalCopy(setId);
function touched(setId) {
  state.custom.pending[setId] = 'upsert';
  saveCustom();
  emit();
}

// ----- undo (last operation) & per-word history -----
let lastSnapshot = null;
function snapshot(setId, label) {
  const s = getSet(setId);
  if (s) lastSnapshot = { setId, label, title: s.title, cards: s.cards.map(c => ({ ...c })), at: Date.now() };
}
export const canUndo = () => !!lastSnapshot;
/** Restore the set as it was before the last edit operation. */
export function undoLast() {
  if (!lastSnapshot) return false;
  const { setId, title, cards } = lastSnapshot;
  lastSnapshot = null;
  const s = editable(setId);
  s.title = title;
  s.cards = cards;
  touched(setId);
  return true;
}
const hkey = (setId, cardId) => setId + '/' + cardId;
const FIELDS = ['japanese', 'reading', 'ukrainian', 'hint', 'verbGroup'];
const sameContent = (a, b) => FIELDS.every(f => (a[f] || '') === (b[f] || ''));
function pushHistory(setId, prev) {
  const h = (state.custom.history[hkey(setId, prev.id)] ||= []);
  h.unshift({ ...Object.fromEntries(FIELDS.map(f => [f, prev[f] || ''])), at: Date.now() });
  h.splice(5);
}
export const cardHistory = (setId, cardId) => state.custom.history[hkey(setId, cardId)] || [];

export function slugify(title) {
  const base = String(title).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const ascii = base.replace(/[^a-z0-9-]/g, ''); // ids must be ASCII-safe for the API
  return (ascii.length >= 3 ? ascii + '-' : 'lesson-') + uid().slice(-5);
}

const withId = c => ({
  id: c.id || 'c' + uid(), japanese: (c.japanese || '').trim(), reading: (c.reading || '').trim(), ukrainian: (c.ukrainian || '').trim(),
  verbGroup: ['I', 'II', 'III'].includes(c.verbGroup) ? c.verbGroup : '', hint: (c.hint || '').trim(),
  section: c.section || 'main', source: c.source || 'my', check: !!c.check,
});

export function createSet(title, cards) {
  title = title || today();
  const set = { id: 'my-' + slugify(title), title, dateCreated: today(), source: 'my', cards: cards.map(withId) };
  state.custom.newSets.push(set);
  touched(set.id);
  return set;
}

export function addCards(setId, cards) {
  snapshot(setId, 'add');
  const s = editable(setId);
  const src = s.source === 'textbook' ? 'my' : 'my';
  const list = cards.map(c => withId({ source: src, ...c }));
  s.cards.push(...list);
  touched(setId);
  return list;
}

/** Update one word. Keeps id (and therefore progress). Clears the "check" flag unless told otherwise. */
export function updateCard(setId, card, { keepCheck = false } = {}) {
  const s = editable(setId);
  const i = s.cards.findIndex(x => x.id === card.id);
  if (i < 0) return null;
  const prev = s.cards[i];
  const next = withId({ ...prev, ...card, check: keepCheck ? prev.check : false });
  snapshot(setId, 'edit');
  if (!sameContent(prev, next)) pushHistory(setId, prev);
  s.cards[i] = next;
  touched(setId);
  return next;
}

export function markChecked(setId, cardId) {
  const s = editable(setId);
  const c = s.cards.find(x => x.id === cardId);
  if (!c) return;
  snapshot(setId, 'check');
  c.check = false;
  touched(setId);
}

export function deleteCard(setId, cardId) {
  snapshot(setId, 'delete');
  const s = editable(setId);
  s.cards = s.cards.filter(x => x.id !== cardId);
  touched(setId);
}

/** Bulk edit: replace all cards (order matters). Unchanged cards keep their check flag. */
export function replaceCards(setId, cards, title) {
  snapshot(setId, 'bulk');
  const s = editable(setId);
  const old = new Map(s.cards.map(c => [c.id, c]));
  s.cards = cards.map(c => {
    const prev = c.id && old.get(c.id);
    const next = withId({ ...(prev || { source: 'my' }), ...c });
    if (prev) {
      if (sameContent(prev, next)) next.check = c.check ?? prev.check;
      else { pushHistory(setId, prev); next.check = false; }
    }
    return next;
  });
  if (title) s.title = title;
  touched(setId);
}

export function renameSet(setId, title) {
  snapshot(setId, 'rename');
  editable(setId).title = title;
  touched(setId);
}

export function deleteSet(setId) {
  const set = getSet(setId);
  const textbook = set && set.source === 'textbook';
  state.custom.newSets = state.custom.newSets.filter(s => s.id !== setId);
  if (state.base.some(s => s.id === setId)) mods(setId).hidden = true;
  if (textbook) delete state.custom.pending[setId]; // textbook lessons are only hidden on this device
  else state.custom.pending[setId] = 'delete';
  saveCustom();
  emit();
}

/** Count of local-only changes not yet in sets.json. */
export function localChangeCount() {
  let n = Object.keys(state.custom.pending).length;
  for (const [id, m] of Object.entries(state.custom.mods)) {
    const base = state.base.find(s => s.id === id);
    if (!base) continue;
    const baseIds = new Set(base.cards.map(c => c.id));
    n += (m.added || []).filter(c => !baseIds.has(c.id)).length;
    n += Object.keys(m.edits || {}).length + (m.deleted || []).filter(x => baseIds.has(x)).length;
    if (m.hidden && !state.custom.pending[id]) n++;
    if (m.title && m.title !== base.title) n++;
  }
  return n;
}

// ---------- GitHub sync via /api/save-set ----------
const listeners = new Set();
export const onSync = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });

export const getPassword = () => { try { return localStorage.getItem(K.pw) || ''; } catch { return ''; } };
export const setPassword = pw => { try { pw ? localStorage.setItem(K.pw, pw) : localStorage.removeItem(K.pw); } catch { /* ignore */ } };
let askPassword = async () => null; // set by the UI
export const setPasswordPrompt = fn => (askPassword = fn);
export const promptPassword = purpose => askPassword(purpose);

export async function checkSyncConfigured() {
  try {
    const r = await fetch('api/save-set', { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    state.sync.configured = !!(j && j.configured);
  } catch { state.sync.configured = false; }
  emit();
  return state.sync.configured;
}

async function call(payload) {
  const r = await fetch('api/save-set', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, password: getPassword() }),
  });
  let j = {};
  try { j = await r.json(); } catch { /* not JSON */ }
  if (r.status === 404) throw Object.assign(new Error('Функція збереження недоступна (сайт відкрито локально або ще не задеплоєно на Vercel). Зміни збережено в цьому браузері.'), { code: 'not_configured' });
  if (!r.ok) throw Object.assign(new Error(j.error || `Помилка сервера (${r.status})`), { code: j.code || 'error' });
  return j;
}

let syncTimer = null;
export function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncAll(), 400); }

/** Push all pending lessons. Returns { ok, saved, error }. */
export async function syncAll({ interactive = true } = {}) {
  const ids = Object.keys(state.custom.pending);
  if (!ids.length) return { ok: true, saved: 0 };
  if (state.sync.busy) return { ok: false, saved: 0 };
  if (state.sync.configured !== true) await checkSyncConfigured();
  if (!state.sync.configured) {
    state.sync.error = 'Збереження в GitHub ще не налаштоване — зміни збережено лише в цьому браузері (дивіться SETUP.md).';
    emit();
    return { ok: false, saved: 0, error: state.sync.error };
  }
  if (!getPassword()) {
    if (!interactive) return { ok: false, saved: 0 };
    const pw = await askPassword();
    if (!pw) { state.sync.error = 'Без пароля зміни збережено лише в цьому браузері.'; emit(); return { ok: false, saved: 0, error: state.sync.error }; }
    setPassword(pw);
  }
  state.sync.busy = true; state.sync.error = ''; emit();
  let saved = 0, error = '';
  try {
    for (const id of ids) {
      const action = state.custom.pending[id];
      if (action === 'delete') await call({ action: 'delete', setId: id });
      else if (action === 'presets') await call({ action: 'exam-presets', presets: presetsPayload() });
      else if (action === 'kanji') { const lesson = kanjiPayload(id); if (lesson) await call({ action: 'kanji-lesson', lesson }); }
      else {
        const set = getSet(id);
        if (set) await call({ action: 'upsert', set: toStoredSet(set) });
      }
      if (state.custom.pending[id] === action) delete state.custom.pending[id];
      saveCustom();
      saved++;
    }
  } catch (e) {
    error = e.message || 'Немає з’єднання з інтернетом. Зміни збережено в цьому браузері.';
    if (e instanceof TypeError) error = 'Немає з’єднання з сервером. Зміни збережено в цьому браузері.';
    if (e.code === 'bad_password') setPassword('');
    if (e.code === 'not_configured') state.sync.configured = false;
  }
  state.sync.busy = false; state.sync.error = error; emit();
  return { ok: !error, saved, error };
}

// ---------- Progress ----------
const pkey = (setId, cardId) => setId + '/' + cardId;
export const prog = (setId, cardId) => state.progress[pkey(setId, cardId)] || { c: 0, w: 0, lvl: 0, star: false };
function setProg(setId, cardId, patch) {
  state.progress[pkey(setId, cardId)] = { ...prog(setId, cardId), ...patch };
  save(K.progress, state.progress);
}

/** kind: 'mc' (recognition → familiar at most) | 'write' (recall → can reach mastered) */
export function record(setId, cardId, correct, kind = 'write') {
  const p = { ...prog(setId, cardId) };
  if (correct) {
    p.c++;
    p.lvl = kind === 'mc' ? Math.max(p.lvl, 1) : p.lvl >= 1 ? 2 : 1;
  } else {
    p.w++;
    p.lvl = 1;
  }
  p.last = Date.now();
  setProg(setId, cardId, p);
  markStudied();
}

export function toggleStar(setId, cardId) {
  const star = !prog(setId, cardId).star;
  setProg(setId, cardId, { star });
  return star;
}

export function setStats(set) {
  const s = { total: set.cards.length, n: 0, l: 0, m: 0, starred: 0 };
  for (const c of set.cards) {
    const p = prog(set.id, c.id);
    if (p.lvl >= 2) s.m++; else if (p.lvl === 1) s.l++; else s.n++;
    if (p.star) s.starred++;
  }
  s.pct = s.total ? Math.round((s.m / s.total) * 100) : 0;
  return s;
}

export function difficultCards(set) {
  const score = p => p.w - p.c * 0.5 + (p.star ? 1 : 0);
  return set.cards
    .map(c => ({ c, p: prog(set.id, c.id) }))
    .filter(({ p }) => p.w > 0 || p.star)
    .sort((a, b) => score(b.p) - score(a.p))
    .map(x => x.c);
}

export function mostMissed(set, n = 5) {
  return set.cards
    .map(c => ({ c, p: prog(set.id, c.id) }))
    .filter(x => x.p.w > 0)
    .sort((a, b) => b.p.w - a.p.w || a.p.c - b.p.c)
    .slice(0, n);
}

/** Cards for a study mode, according to the current options. */
export function studyCards(set) {
  let cs = set.cards;
  if (state.opts.filter === 'starred') cs = cs.filter(c => prog(set.id, c.id).star);
  else if (state.opts.filter === 'difficult') cs = difficultCards(set);
  return state.opts.shuffle ? shuffle(cs) : cs;
}

export function saveOpts(patch) {
  Object.assign(state.opts, patch);
  save(K.opts, state.opts);
}

// ---------- Streak ----------
export function markStudied() {
  const t = today();
  if (!state.days.includes(t)) {
    state.days.push(t);
    state.days = state.days.slice(-800);
    save(K.days, state.days);
  }
}
export function streak() {
  const days = new Set(state.days);
  const d = new Date();
  if (!days.has(fmtDate(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(fmtDate(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const studiedToday = () => state.days.includes(today());

// ---------- Match best times ----------
export const getBest = id => state.best[id] || null;
export function setBest(id, t) { state.best[id] = t; save(K.best, state.best); }

// ---------- Backup ----------
export function backupData() {
  return {
    app: 'kotoba', version: 2, exported: new Date().toISOString(),
    progress: state.progress, custom: state.custom, opts: state.opts, days: state.days, best: state.best,
  };
}
export function restoreBackup(obj) {
  if (!obj || typeof obj !== 'object' || !('progress' in obj || 'custom' in obj)) throw new Error('Це не файл резервної копії Kotoba');
  state.progress = obj.progress || {};
  state.custom = { newSets: [], mods: {}, pending: {}, history: {}, kanji: {}, ...(obj.custom || {}) };
  state.opts = { ...DEFAULT_OPTS, ...(obj.opts || {}) };
  state.days = obj.days || [];
  state.best = obj.best || {};
  save(K.progress, state.progress); saveCustom(); save(K.opts, state.opts); save(K.days, state.days); save(K.best, state.best);
}
/** Merged sets in sets.json format — for Claude to make permanent. */
export function setsExport() {
  return {
    sets: getSets().map(toStoredSet),
    hiddenSets: Object.entries(state.custom.mods).filter(([, m]) => m.hidden).map(([id]) => id),
  };
}
