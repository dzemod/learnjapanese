// «Словник» search worker: loads data/dict/words-NN.json (chunk 00 = common words first) and answers searches.
// Messages in:  { type: 'init' } · { type: 'search', id, q, mode: 'ja'|'en'|'romaji', limit }
//               { type: 'entry', id, wid } · { type: 'withKanji', id, ch, limit } · { type: 'exact', id, keys }
// Messages out: { type: 'progress', loaded, total } · { type: 'result', id, items } · { type: 'error', error }
// Entry (data): [jmdictId, "漢字|…", "かな|…", common, [[pos, glosses], …]]
// Ranking: exact form > form starts with the query > contains it (Japanese); English: a whole gloss equal to the
// query > a gloss starting with it > the word inside a gloss; common words first; shorter forms first.
/* global importScripts, wanakana */
let E = [];             // entries
let forms = [];         // [form, entryIndex] sorted by form (kanji and kana forms) — prefix search by binary search
let glossLC = [];       // lowercase glosses of the first 3 senses per entry
let total = 0, loaded = 0, loading = null;
const pending = [];

const send = m => postMessage(m);
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
      for (const f of (x[1] ? x[1].split('|') : [])) forms.push([f, base + j]);
      for (const f of x[2].split('|')) forms.push([f, base + j]);
      glossLC.push(x[4].slice(0, 3).map(s => s[1].toLowerCase()).join(' ; '));
    }
    forms.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    loaded = i + 1;
    send({ type: 'progress', loaded, total, words: E.length });
    flush(); // answer waiting searches with what is loaded (common words come first)
  }
}

const lower = (arr, key) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][0] < key) lo = m + 1; else hi = m; } return lo; };
const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const view = (i, score) => ({ i, id: E[i][0], kanji: E[i][1], kana: E[i][2], common: E[i][3], senses: E[i][4].slice(0, 3), score });

function searchJa(q, limit) {
  const keys = [...new Set([q, toHira(q)])];
  const seen = new Map();
  const add = (i, s) => { if (!seen.has(i) || seen.get(i) < s) seen.set(i, s); };
  for (const k of keys) {
    for (let p = lower(forms, k); p < forms.length && forms[p][0].startsWith(k) && seen.size < 4000; p++) add(forms[p][1], forms[p][0] === k ? 3 : 2);
  }
  if (seen.size < limit && q.length >= 2) { // contains (e.g. 勉強 in 勉強会) — linear, only when few prefix hits
    for (let p = 0; p < forms.length && seen.size < limit * 3; p++) if (forms[p][0].includes(q) && !forms[p][0].startsWith(q)) add(forms[p][1], 1);
  }
  return rank([...seen], limit, i => Math.min(...(E[i][1] + '|' + E[i][2]).split('|').filter(Boolean).map(f => f.length)));
}
function searchEn(q, limit) {
  const t = q.toLowerCase().trim();
  if (!t) return [];
  const re = new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
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
  return rank(out, limit, i => glossLC[i].length / 40);
}
function rank(pairs, limit, len) {
  return pairs.sort((a, b) => b[1] - a[1] || E[b[0]][3] - E[a[0]][3] || len(a[0]) - len(b[0]) || a[0] - b[0]).slice(0, limit).map(([i, s]) => view(i, s));
}

function answer(m) {
  if (m.type === 'search') {
    let q = String(m.q || '').trim();
    if (m.mode === 'romaji') {
      try { if (!self.wanakana) importScripts('https://cdn.jsdelivr.net/npm/wanakana@5.3.1/wanakana.min.js'); q = wanakana.toHiragana(q.toLowerCase()); } catch { /* offline without the converter */ }
    }
    const items = m.mode === 'en' ? searchEn(q, m.limit || 50) : searchJa(q, m.limit || 50);
    send({ type: 'result', id: m.id, items, q, partial: loaded < total });
  } else if (m.type === 'entry') {
    const i = E.findIndex(x => x[0] === m.wid);
    send({ type: 'result', id: m.id, items: i >= 0 ? [{ ...view(i, 0), senses: E[i][4] }] : [], partial: loaded < total });
  } else if (m.type === 'withKanji') {
    const out = [];
    for (let i = 0; i < E.length && out.length < 400; i++) if (E[i][1].includes(m.ch)) out.push([i, E[i][3]]);
    send({ type: 'result', id: m.id, items: rank(out, m.limit || 30, i => E[i][1].split('|')[0].length) });
  } else if (m.type === 'exact') {
    const items = [];
    for (const k of m.keys || []) { for (let p = lower(forms, k); p < forms.length && forms[p][0] === k; p++) if (!items.some(x => x.i === forms[p][1])) items.push(view(forms[p][1], 3)); }
    send({ type: 'result', id: m.id, items: items.sort((a, b) => b.common - a.common).slice(0, 5) });
  }
}
// searches wait for the first chunk (common words); entries / exact lookups wait for everything
function flush() {
  for (let k = pending.length - 1; k >= 0; k--) {
    const m = pending[k];
    const ready = loaded >= total || (loaded >= 1 && (m.type === 'search' || m.type === 'exact' || m.type === 'withKanji' || (m.type === 'entry' && E.some(x => x[0] === m.wid))));
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
