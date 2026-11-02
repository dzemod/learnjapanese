// Service worker: caches ONLY the free Kuromoji tokenizer + dictionary files from the CDN
// (≈ 12 МБ, used by Перекладач and automatic readings) so they are downloaded once.
// Site pages and data are never intercepted — they always come fresh from the network.
const CACHE = 'kotoba-cdn-v1';
const CACHED = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(kuromoji@0\.1\.2|kuroshiro@1\.2\.0|kuroshiro-analyzer-kuromoji@1\.1\.0)\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('kotoba-cdn-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !CACHED.test(req.url)) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req.url);
    if (hit) return hit;
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) cache.put(req.url, res.clone());
    return res;
  }));
});
