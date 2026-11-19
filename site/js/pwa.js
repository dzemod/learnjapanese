// Offline use + install (with sw.js and manifest.webmanifest):
//   • registers the service worker (https; on localhost only with ?sw=1) and asks it to cache every site file the app needs
//     offline: the loaded scripts/styles (performance entries) + all data files + the page itself;
//   • #netbar «Немає інтернету…» while offline; back online → lessons waiting for GitHub and the progress sync
//     (if turned on) are sent again;
//   • «Встановити застосунок» (beforeinstallprompt, Chrome/Edge/Android) — a button in «Резервна копія і дані»;
//     on iPhone the hint «Поділитися → На початковий екран».
import { $ } from './util.js';
import { syncAll, state } from './store.js';
import { syncNow, syncState } from './sync-progress.js';

export const DATA_FILES = ['data/sets.json', 'data/grammar.json', 'data/kanji.json', 'data/kanji-assoc.json', 'data/exam.json', 'data/exam-univ.json', 'data/exam-presets.json', 'data/analyzer.json', 'data/jmdict-mini.json'];
let installEvent = null;

function warm() {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return;
  const own = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin) && !u.includes('/api/'));
  const urls = [...new Set(['./', 'index.html', 'manifest.webmanifest', 'css/style.css', ...DATA_FILES, 'assets/icons/icon-192.png', 'assets/sensei/sensei-cutout.webp', ...own.map(u => u.split('#')[0])])];
  sw.postMessage({ type: 'warm', urls });
}

function netbar() {
  const bar = $('#netbar');
  if (!bar) return;
  bar.hidden = navigator.onLine !== false;
}

export function initPWA() {
  // localhost: only with ?sw=1 (tools/qa-offline.mjs) — the other browser tests mock the network and need no worker
  const local = ['localhost', '127.0.0.1'].includes(location.hostname) && /[?&]sw=1/.test(location.search);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
      if (navigator.serviceWorker.controller) setTimeout(warm, 3000);
      else navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(warm, 1000), { once: true });
    }).catch(() => {});
  }
  addEventListener('offline', netbar);
  addEventListener('online', () => {
    netbar();
    if (Object.keys(state.custom.pending).length) syncAll({ interactive: false });
    if (syncState().on) syncNow();
  });
  netbar();
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; document.dispatchEvent(new CustomEvent('kotoba:installable')); });
  addEventListener('appinstalled', () => { installEvent = null; document.dispatchEvent(new CustomEvent('kotoba:installable')); });
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** «Встановити застосунок» block for the home page data panel. */
export function mountInstall(box) {
  if (!box) return;
  const draw = () => {
    if (standalone()) { box.innerHTML = '<p class="muted small">Kotoba встановлено як застосунок — працює і без інтернету.</p>'; return; }
    if (installEvent) {
      box.innerHTML = '<button type="button" class="btn ghost" data-install><span lang="ja">家</span><span>Встановити застосунок</span></button> <span class="muted small">Працює без інтернету; прогрес синхронізується, коли з’явиться зв’язок.</span>';
      $('[data-install]', box).onclick = async () => { const e = installEvent; installEvent = null; try { await e.prompt(); await e.userChoice; } catch { /* dismissed */ } draw(); };
    } else if (ios()) box.innerHTML = '<p class="muted small">Щоб установити на iPhone: «Поділитися» → «На початковий екран». Сайт працює і без інтернету.</p>';
    else box.innerHTML = '<p class="muted small">Сайт працює і без інтернету після першого відкриття. Встановити як застосунок можна в меню браузера («Встановити»/«Додати на головний екран»).</p>';
  };
  draw();
  document.addEventListener('kotoba:installable', () => { if (box.isConnected) draw(); });
}
