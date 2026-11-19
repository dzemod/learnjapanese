// Service worker — offline use and install (PWA).
//   Site files (same origin, not /api/): NETWORK FIRST — a fresh copy whenever the network answers (so a new deploy is
//     seen at once); the cached copy only when offline / the network fails (≤ NET_TIMEOUT for pages and data).
//     Pages answer with the cached index.html when offline (the app is one page with #/ routes).
//   CDN files: CACHE FIRST, downloaded once — Kuromoji + dictionary (≈ 18 MB, Перекладач; the worker also fills this
//     cache), KanjiVG stroke files, wanakana, Google Fonts.
//   Never cached: /api/ (save API), Puter.js and puter.com (AI, sync), MyMemory, anything not GET.
//   Message { type: 'warm', urls } from the page: fetch and cache those site files (everything the app needs offline).
const SITE = 'kotoba-site-v1';
const CDN = 'kotoba-cdn-v1';
const KEEP = [SITE, CDN];
const NET_TIMEOUT = 4000;
const CDN_FILES = [
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/(kuromoji@0\.1\.2|kuroshiro@1\.2\.0|kuroshiro-analyzer-kuromoji@1\.1\.0|wanakana@5\.3\.1)\//,
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/KanjiVG\/kanjivg@[^/]+\/kanji\//,
  /^https:\/\/raw\.githubusercontent\.com\/KanjiVG\/kanjivg\/[^/]+\/kanji\//,
  /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('kotoba-') && !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

const sameSite = url => url.origin === self.location.origin && !url.pathname.includes('/api/');
const keyOf = url => { const u = new URL(url); u.search = ''; return u.href; };

async function networkFirst(req, url) {
  const cache = await caches.open(SITE);
  const net = fetch(req).then(res => { if (res.ok && res.type === 'basic') cache.put(keyOf(url), res.clone()); return res; });
  const timeout = new Promise(res => setTimeout(res, NET_TIMEOUT, null));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch { /* offline: use the cache */ }
  const hit = await cache.match(keyOf(url)) || (req.mode === 'navigate' ? await cache.match(new URL('./', self.registration.scope).href) || await cache.match(new URL('index.html', self.registration.scope).href) : null);
  if (hit) return hit;
  return net; // nothing cached: the network's own answer or error
}
async function cacheFirst(req) {
  const cache = await caches.open(CDN);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
  if (res.ok) cache.put(req.url, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (sameSite(url)) return e.respondWith(networkFirst(req, url));
  if (CDN_FILES.some(r => r.test(req.url))) e.respondWith(cacheFirst(req));
});

self.addEventListener('message', e => {
  if (e.data?.type !== 'warm' || !Array.isArray(e.data.urls)) return;
  e.waitUntil(caches.open(SITE).then(cache => Promise.all(e.data.urls.slice(0, 200).map(async u => {
    const url = new URL(u, self.registration.scope);
    if (!sameSite(url)) return;
    try { const res = await fetch(url.href, { cache: 'no-cache' }); if (res.ok) await cache.put(keyOf(url.href), res); } catch { /* offline now */ }
  }))));
});
