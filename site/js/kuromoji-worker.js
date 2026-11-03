// Web Worker: Kuromoji (IPADIC) tokenizer off the main thread, so the page never freezes.
// - downloads the 12 dictionary files itself (with byte progress) and keeps them in the Cache API
//   ('kotoba-cdn-v1', shared with sw.js) → after the first visit nothing is downloaded again;
// - Kuromoji's own loader (XMLHttpRequest) is served from those buffers;
// - gunzip + building the tokenizer (the slow part, several seconds) happens here, not on the page.
// Messages in:  { type: 'init' } | { type: 'tokenize', id, text }
// Messages out: { type: 'progress', phase: 'download'|'build', loaded, total } | { type: 'ready' }
//               { type: 'tokens', id, tokens } | { type: 'error', id?, message }
/* eslint-env worker */
const BASE = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/';
const CACHE = 'kotoba-cdn-v1';
// gzip sizes of kuromoji@0.1.2/dict (for the progress bar when Content-Length is missing)
const FILES = {
  'base.dat.gz': 3956825, 'check.dat.gz': 3111633, 'tid.dat.gz': 1605820, 'tid_pos.dat.gz': 5916009,
  'tid_map.dat.gz': 1485576, 'cc.dat.gz': 1692067, 'unk.dat.gz': 10512, 'unk_pos.dat.gz': 10540,
  'unk_map.dat.gz': 1190, 'unk_char.dat.gz': 306, 'unk_compat.dat.gz': 338, 'unk_invoke.dat.gz': 1140,
};
const TOTAL = Object.values(FILES).reduce((a, b) => a + b, 0);
const buffers = new Map(); // file name → ArrayBuffer (only until the tokenizer is built)
let tokenizer = null, building = null;

const post = m => self.postMessage(m);

async function openCache() {
  try { return self.caches ? await self.caches.open(CACHE) : null; } catch { return null; }
}

async function getFile(cache, name, onBytes) {
  const url = BASE + 'dict/' + name;
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) { const buf = await hit.arrayBuffer(); onBytes(FILES[name]); return buf; }
    } catch { /* fall through to the network */ }
  }
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + name);
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onBytes(Math.min(got, FILES[name]), true);
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    buf = all.buffer;
  } else buf = await res.arrayBuffer();
  onBytes(FILES[name]);
  if (cache) cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  return buf;
}

// Kuromoji's BrowserDictionaryLoader uses XMLHttpRequest — answer it from the downloaded buffers.
class BufferXHR {
  open(method, url) { this.url = String(url); }
  send() {
    const name = this.url.split('/').pop();
    setTimeout(() => {
      const buf = buffers.get(name);
      if (!buf) { this.status = 404; this.statusText = 'missing ' + name; this.onerror?.(new Error(this.statusText)); return; }
      this.status = 200;
      this.response = buf;
      this.onload?.call(this);
    }, 0);
  }
}

function init() {
  if (tokenizer) { post({ type: 'ready' }); return Promise.resolve(); }
  return (building ||= (async () => {
    const cache = await openCache();
    const done = {};
    let last = 0;
    const report = (force) => {
      const now = Date.now();
      if (!force && now - last < 120) return;
      last = now;
      post({ type: 'progress', phase: 'download', loaded: Object.values(done).reduce((a, b) => a + b, 0), total: TOTAL });
    };
    const names = Object.keys(FILES);
    const bufs = await Promise.all(names.map(n => getFile(cache, n, (b, partial) => { done[n] = b; report(!partial); })));
    names.forEach((n, i) => buffers.set(n, bufs[i]));
    post({ type: 'progress', phase: 'build', loaded: TOTAL, total: TOTAL });
    self.importScripts(BASE + 'build/kuromoji.js');
    self.XMLHttpRequest = BufferXHR;
    tokenizer = await new Promise((res, rej) => self.kuromoji.builder({ dicPath: BASE + 'dict/' }).build((e, t) => (e ? rej(e) : res(t))));
    buffers.clear();
    post({ type: 'ready' });
  })().catch(e => {
    building = null;
    buffers.clear();
    post({ type: 'error', message: String(e && e.message || e) });
  }));
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') return init();
  if (data.type === 'tokenize') {
    try {
      if (!tokenizer) await init();
      if (!tokenizer) throw new Error('tokenizer not ready');
      post({ type: 'tokens', id: data.id, tokens: tokenizer.tokenize(String(data.text || '')) });
    } catch (e) {
      post({ type: 'error', id: data.id, message: String(e && e.message || e) });
    }
  }
};
