// «Словник» search worker: loads data/dict/words-NN.json (chunk 00 = common words first) and answers searches.
// Messages in:  { type: 'init' } · { type: 'search', id, q, mode: 'ja'|'en'|'romaji'|'uk', limit, offset }
//               { type: 'entry', id, wid } · { type: 'withKanji', id, ch, limit } · { type: 'exact', id, keys }
//               { type: 'browse', id, filter: 'common'|'all', pos: ''|'n'|'v'|'adj-i'|'adj-na'|'adv'|'exp',
//                 sort: 'freq'|'kana', offset, limit }
// Messages out: { type: 'progress', loaded, total } · { type: 'result', id, items, count } · { type: 'error', error }
// Entry (data): [jmdictId, "漢字|…", "かな|…", common, [[pos, glosses], …]]
// Ukrainian meanings: data/dict/uk.json { m: { jmdictId: "значення; …" } } (written by Claude → «перевірити»);
// priority of the common words: data/dict/order.json { ids: [...] } (tools/dict-order.mjs) — ranking ties + browse.
// Ranking: exact form > form starts with the query > contains it (Japanese); English / Ukrainian: a whole gloss equal
// to the query > a gloss starting with it > the word inside a gloss; common words first; shorter first; priority.
/* global importScripts, wanakana */
let E = [];             // entries
let forms = [];         // [form, entryIndex] sorted by form (kanji and kana forms) — prefix search by binary search
let glossLC = [];       // lowercase glosses of the first 3 senses per entry
let total = 0, loaded = 0, loading = null;
const pending = [];
const idToI = new Map();
let U = new Map();      // jmdictId → Ukrainian meaning
let ukLC = null;        // [entryIndex, lowercase Ukrainian]
const ORDER = new Map(); // jmdictId → priority
let extras = null;

const send = m => postMessage(m);
async function loadExtras() {
  try { const r = await fetch('../data/dict/order.json'); if (r.ok) (await r.json()).ids.forEach((id, n) => ORDER.set(id, n)); } catch { /* optional */ }
  try { const r = await fetch('../data/dict/uk.json', { cache: 'no-cache' }); if (r.ok) U = new Map(Object.entries((await r.json()).m)); } catch { /* optional */ }
}
async function load() {
  const meta = await (await fetch('../data/dict/meta.json')).json();
  total = meta.chunks;
  send({ type: 'progress', loaded, total, words: E.length });
  for (let i = 0; i < meta.chunks; i++) {
    const res = await fetch(`../data/dict/words-${String(i).padStart(2, '0')}.json`);
    if (!res.ok) throw new Error('chunk ' + i + ': ' + res.status);
    const { e } = await res.json();
    const base = E.length;
    for (let j = 0; j < e.length; j++) {
      const x = e[j];
      E.push(x);
      idToI.set(x[0], base + j);
      for (const f of (x[1] ? x[1].split('|') : [])) forms.push([f, base + j]);
      for (const f of x[2].split('|')) forms.push([f, base + j]);
      glossLC.push(x[4].slice(0, 3).map(s => s[1].toLowerCase()).join(' ; '));
    }
    forms.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (i === 0) await (extras ||= loadExtras());
    ukLC = null;
    loaded = i + 1;
    send({ type: 'progress', loaded, total, words: E.length });
    flush(); // answer waiting searches with what is loaded (common words come first)
  }
}

const lower = (arr, key) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][0] < key) lo = m + 1; else hi = m; } return lo; };
const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const view = (i, score) => ({ i, id: E[i][0], kanji: E[i][1], kana: E[i][2], common: E[i][3], senses: E[i][4].slice(0, 3), uk: U.get(E[i][0]) || '', score });
const pri = i => ORDER.get(E[i][0]) ?? 1e9;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rank(pairs, limit, len, offset = 0) {
  pairs.sort((a, b) => b[1] - a[1] || E[b[0]][3] - E[a[0]][3] || len(a[0]) - len(b[0]) || pri(a[0]) - pri(b[0]) || a[0] - b[0]);
  return { items: pairs.slice(offset, offset + limit).map(([i, s]) => view(i, s)), count: pairs.length };
}
function searchJa(q, limit, offset) {
  const keys = [...new Set([q, toHira(q)])];
  const seen = new Map();
  const add = (i, s) => { if (!seen.has(i) || seen.get(i) < s) seen.set(i, s); };
  for (const k of keys) {
    for (let p = lower(forms, k); p < forms.length && forms[p][0].startsWith(k) && seen.size < 4000; p++) add(forms[p][1], forms[p][0] === k ? 3 : 2);
  }
  if (seen.size < offset + limit && q.length >= 2) { // contains (e.g. 勉強 in 勉強会) — linear, only when few prefix hits
    for (let p = 0; p < forms.length && seen.size < (offset + limit) * 3; p++) if (forms[p][0].includes(q) && !forms[p][0].startsWith(q)) add(forms[p][1], 1);
  }
  return rank([...seen], limit, i => Math.min(...(E[i][1] + '|' + E[i][2]).split('|').filter(Boolean).map(f => f.length)), offset);
}
function searchEn(q, limit, offset) {
  const t = q.toLowerCase().trim();
  if (!t) return { items: [], count: 0 };
  const re = new RegExp(`(^|[^a-z])${escRe(t)}([^a-z]|$)`);
  const out = [];
  for (let i = 0; i < E.length; i++) {
    const g = glossLC[i];
    if (!g.includes(t)) continue;
    const glosses = g.split(/ ; |; /);
    let s = 0;
    if (glosses.some(x => x === t || x === 'to ' + t || x === 'a ' + t || x === 'the ' + t)) s = 3;
    else if (glosses.some(x => x.startsWith(t + ' ') || x.startsWith('to ' + t + ' '))) s = 2;
    else if (re.test(g)) s = 1;
    if (s) out.push([i, s]);
  }
  return rank(out, limit, i => glossLC[i].length / 40, offset);
}
function searchUk(q, limit, offset) {
  const t = q.toLowerCase().replace(/['ʼ`]/g, '’').trim();
  if (!t) return { items: [], count: 0 };
  if (!ukLC) { ukLC = []; for (const [id, g] of U) if (idToI.has(id)) ukLC.push([idToI.get(id), g.toLowerCase()]); }
  const L = 'а-яіїєґ’\\-';
  const re = new RegExp(`(^|[^${L}])${escRe(t)}([^${L}]|$)`);
  const out = [];
  for (const [i, g] of ukLC) {
    if (!g.includes(t)) continue;
    const parts = g.split(/\s*[;,]\s*/).map(x => x.replace(/\s*\(.*?\)\s*/g, ' ').trim());
    const s = parts.some(x => x === t) ? 3 : parts.some(x => x.startsWith(t + ' ') || x.startsWith(t)) ? 2 : re.test(g) ? 1 : 0.5;
    out.push([i, s]);
  }
  return rank(out, limit, i => (U.get(E[i][0]) || '').length / 20, offset);
}

// browse: every word (or only the common ones), filtered by the part of speech of the first sense
const POS_RE = { n: /^(n|pn|n-t|n-adv)(,|\||$)/, v: /^(v[15kz]|vs)/, 'adj-i': /^adj-ix?(,|\||$)/, 'adj-na': /^adj-na/, adv: /^adv/, exp: /^exp/ };
let kanaRank = null;
function browse(m) {
  const re = POS_RE[m.pos];
  const idx = [];
  for (let i = 0; i < E.length; i++) {
    if (m.filter !== 'all' && !E[i][3]) continue;
    if (re && !re.test(E[i][4][0]?.[0] || '')) continue;
    idx.push(i);
  }
  if (m.sort === 'kana') {
    if (!kanaRank) {
      const c = new Intl.Collator('ja');
      const k = E.map((x, i) => [i, toHira(x[2].split('|')[0])]).sort((a, b) => c.compare(a[1], b[1]));
      kanaRank = new Int32Array(E.length);
      k.forEach(([i], n) => (kanaRank[i] = n));
    }
    idx.sort((a, b) => kanaRank[a] - kanaRank[b]);
  } else idx.sort((a, b) => E[b][3] - E[a][3] || pri(a) - pri(b) || a - b);
  const off = m.offset || 0, lim = m.limit || 100;
  return { items: idx.slice(off, off + lim).map(i => view(i, 0)), count: idx.length };
}

function answer(m) {
  if (m.type === 'search') {
    let q = String(m.q || '').trim();
    if (m.mode === 'romaji') {
      try { if (!self.wanakana) importScripts('https://cdn.jsdelivr.net/npm/wanakana@5.3.1/wanakana.min.js'); q = wanakana.toHiragana(q.toLowerCase()); } catch { /* offline without the converter */ }
    }
    const lim = m.limit || 50, off = m.offset || 0;
    const r = m.mode === 'en' ? searchEn(q, lim, off) : m.mode === 'uk' ? searchUk(q, lim, off) : searchJa(q, lim, off);
    send({ type: 'result', id: m.id, items: r.items, count: r.count, q, partial: loaded < total });
  } else if (m.type === 'entry') {
    const i = idToI.get(m.wid) ?? -1;
    send({ type: 'result', id: m.id, items: i >= 0 ? [{ ...view(i, 0), senses: E[i][4] }] : [], partial: loaded < total });
  } else if (m.type === 'withKanji') {
    const out = [];
    for (let i = 0; i < E.length && out.length < 400; i++) if (E[i][1].includes(m.ch)) out.push([i, E[i][3]]);
    send({ type: 'result', id: m.id, items: rank(out, m.limit || 30, i => E[i][1].split('|')[0].length).items });
  } else if (m.type === 'browse') {
    const r = browse(m);
    send({ type: 'result', id: m.id, items: r.items, count: r.count });
  } else if (m.type === 'exact') {
    const items = [];
    for (const k of m.keys || []) { for (let p = lower(forms, k); p < forms.length && forms[p][0] === k; p++) if (!items.some(x => x.i === forms[p][1])) items.push(view(forms[p][1], 3)); }
    send({ type: 'result', id: m.id, items: items.sort((a, b) => b.common - a.common).slice(0, 5) });
  }
}
// searches wait for the first chunk (common words); browse waits for everything; entries until the word is in
function flush() {
  for (let k = pending.length - 1; k >= 0; k--) {
    const m = pending[k];
    const ready = loaded >= total || (loaded >= 1 && (m.type === 'search' || m.type === 'exact' || m.type === 'withKanji' || (m.type === 'browse' && m.filter !== 'all' && loaded >= 2) || (m.type === 'entry' && idToI.has(m.wid))));
    if (ready) { pending.splice(k, 1); answer(m); }
  }
}
onmessage = e => {
  const m = e.data;
  if (!loading) loading = load().catch(err => send({ type: 'error', error: String(err.message || err) }));
  if (m.type === 'init') return;
  pending.push(m);
  flush();
};
