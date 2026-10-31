import { $, stopSpeech, modal } from './util.js';
import { loadBase, streak, studiedToday, setPasswordPrompt, syncAll, state, onSync } from './store.js';
import { bulkEditView } from './edit.js';
import { homeView, setView, editorView } from './views.js';
import { modeView } from './modes.js';

const app = $('#app');
let cleanup = null;
let keyHandler = null;
const timers = new Set();

// API passed to views/modes: key handling + timers that are cleared on navigation.
const api = {
  setKey(fn) { keyHandler = fn; },
  later(fn, ms) { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; },
  every(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; },
  clear(id) { if (id == null) return; clearTimeout(id); clearInterval(id); timers.delete(id); },
  clearTimers() { timers.forEach(id => { clearTimeout(id); clearInterval(id); }); timers.clear(); },
};

document.addEventListener('keydown', e => {
  if (document.querySelector('.modal-back') || e.metaKey || e.altKey) return;
  keyHandler?.(e);
});

function refreshStreak() {
  const n = streak();
  const el = $('#streak');
  el.innerHTML = `<span class="streak-dot ${studiedToday() ? 'on' : ''}"></span><b>${n}</b><span class="streak-lbl">day${n === 1 ? '' : 's'}</span>`;
  el.title = studiedToday() ? 'Studied today' : 'Study today to keep your streak';
}

function route() {
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  keyHandler = null;
  api.clearTimers();
  stopSpeech();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  document.body.dataset.view = parts[2] && !['add', 'edit'].includes(parts[2]) ? 'mode' : parts[0] || 'home';
  if (!parts.length) cleanup = homeView(app, api);
  else if (parts[0] === 'new') cleanup = editorView(app, null, api);
  else if (parts[0] === 'set' && parts[1]) {
    if (!parts[2]) cleanup = setView(app, parts[1], api);
    else if (parts[2] === 'add') cleanup = editorView(app, parts[1], api);
    else if (parts[2] === 'edit') cleanup = bulkEditView(app, parts[1], api);
    else cleanup = modeView(app, parts[1], parts[2], api);
  } else { location.hash = '#/'; return; }
  refreshStreak();
}

// Refresh the streak badge whenever progress is recorded.
window.addEventListener('storage', refreshStreak);
document.addEventListener('click', () => setTimeout(refreshStreak, 0), true);

// Password for saving lessons to GitHub — asked once, remembered on this device.
setPasswordPrompt(() => new Promise(resolve => {
  let done = false;
  const finish = v => { if (!done) { done = true; resolve(v); } };
  const close = modal(`<h2>Пароль для збереження</h2>
    <p class="muted small">Щоб зберегти урок у GitHub назавжди, введіть пароль (APP_PASSWORD з налаштувань Vercel). Його буде запам’ятовано на цьому пристрої.</p>
    <form><label class="field"><input class="input" type="password" name="pw" autocomplete="current-password" required></label>
    <div class="modal-btns"><button type="button" class="btn ghost" data-cancel>Лише в браузері</button><button class="btn primary">Зберегти</button></div></form>`,
  (m, close) => {
    const f = m.querySelector('form');
    f.pw.focus();
    m.querySelector('[data-cancel]').onclick = () => { finish(null); close(); };
    f.onsubmit = e => { e.preventDefault(); finish(f.pw.value.trim() || null); close(); };
  });
  // resolve null if closed by Escape / backdrop
  const obs = new MutationObserver(() => { if (!document.querySelector('.modal-back')) { obs.disconnect(); finish(null); } });
  obs.observe(document.body, { childList: true });
  void close;
}));

// Global save status: visible on every page (also inside study modes).
let lastPending = 0, okTimer = null;
function drawSyncBar() {
  const bar = $('#syncbar');
  const pend = Object.keys(state.custom.pending).length;
  const s = state.sync;
  clearTimeout(okTimer);
  if (s.busy) { bar.className = 'show'; bar.innerHTML = '<span class="spinner"></span><span>Зберігаю в GitHub…</span>'; }
  else if (pend && s.error) {
    bar.className = 'show err';
    bar.innerHTML = `<span>${s.error.replace(/[<>&]/g, '')}</span><button type="button" data-retry>Спробувати ще</button><button type="button" data-hide aria-label="Сховати">✕</button>`;
    bar.querySelector('[data-retry]').onclick = () => syncAll();
    bar.querySelector('[data-hide]').onclick = () => (bar.className = '');
  } else if (!pend && lastPending) {
    bar.className = 'show ok';
    bar.innerHTML = '<span>☁ Збережено в GitHub ✓ — на всіх пристроях за ~1 хв</span>';
    okTimer = setTimeout(() => (bar.className = ''), 3500);
  } else if (!pend) bar.className = '';
  lastPending = pend;
}
onSync(drawSyncBar);

(async function init() {
  await loadBase();
  // Retry unsaved lessons quietly (without asking for the password).
  if (Object.keys(state.custom.pending).length) syncAll({ interactive: false });
  window.addEventListener('hashchange', route);
  route();
})();
