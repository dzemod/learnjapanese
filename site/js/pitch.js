// Pitch accent (Tokyo standard) — Kanjium accents (CC BY-SA 4.0, tools/build-pitch.mjs).
//   data/pitch.json            { p: { "雨|あめ": "1", … } } — the words of my lessons (loaded with the lessons)
//   data/dict/pitch-0 … -f.json the whole list for the dictionary, shard = pitchShard(form) (loaded on demand)
// Value = downstep position(s), "0" = flat (heiban), "1" = high first mora, n = drop after mora n; "0,2" = variants.
// ます-form verbs are not looked up: the polite form always drops after ま (いきまꜜす).
// Shown as kana with a line over the high morae and a step down after the accent; setting jp.pitch ("off" hides it).

let P = null, loading = null;
const SH = {};
const lget = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const pitchOn = () => lget('jp.pitch', 'on') !== 'off';
export function setPitch(on) {
  try { localStorage.setItem('jp.pitch', on ? 'on' : 'off'); } catch { /* not kept */ }
  try { document.dispatchEvent(new CustomEvent('kotoba:pitch')); } catch { /* not in a browser */ }
}

const SMALL = /[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/;
/** Split kana into morae (きゃ = 1, っ / ん / ー = 1 each). */
export function morae(kana) {
  const out = [];
  for (const ch of String(kana || '')) { if (SMALL.test(ch) && out.length) out[out.length - 1] += ch; else out.push(ch); }
  return out;
}
const isKana = s => /^[ぁ-ゖァ-ヺー]+$/.test(s);
const clean = s => String(s || '').split(/[／、]/)[0].replace(/\[[^\]]*\]/g, '').replace(/\s*[（(][^）)]*[）)]/g, '').replace(/[～〜。！？\s]/g, '');
/** Keys to look up for a card, best first: "form|reading", kana words "かな|かな"; [お] tried with お too. */
export function pitchKeys(japanese, reading = '') {
  const f0 = String(japanese || ''), r0 = String(reading || '');
  const keys = [];
  const add = (f, r) => { f = clean(f); r = clean(r) || f; if (f && isKana(r) && !keys.includes(`${f}|${r}`)) keys.push(`${f}|${r}`); };
  add(f0, r0);
  add(f0.replace(/\[([^\]]*)\]/g, '$1'), r0.replace(/\[([^\]]*)\]/g, '$1'));
  return keys;
}
/** Shard of the dictionary pitch files (string hash of the written form, like the example sentences). */
export const pitchShard = form => { let h = 0; for (const c of String(form)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 16).toString(16); };

export function setPitchData(j) { P = (j && j.p) || {}; }
export function loadPitch() {
  return (loading ||= fetch('data/pitch.json').then(r => (r.ok ? r.json() : null)).then(setPitchData).catch(() => setPitchData(null)));
}
/** { kana, acc: [n, …] } for a lesson card, or null. */
export function pitchOf(japanese, reading = '', verbGroup = '') {
  const keys = pitchKeys(japanese, reading);
  if (!keys.length) return null;
  const kana = keys[0].split('|')[1];
  if (verbGroup && /ます$/.test(kana)) return { kana, acc: [morae(kana).length - 1] };
  if (!P) return null;
  for (const k of keys) if (P[k] != null) return { kana: k.split('|')[1], acc: String(P[k]).split(',').map(Number) };
  return null;
}
/** Dictionary: the whole list (one shard per lookup). */
export async function pitchDict(form, reading) {
  const s = pitchShard(form);
  const map = await (SH[s] ||= fetch(`data/dict/pitch-${s}.json`).then(r => (r.ok ? r.json() : { p: {} })).then(j => j.p || {}).catch(() => { delete SH[s]; return {}; }));
  const v = map[`${form}|${reading || form}`];
  return v == null ? null : { kana: reading || form, acc: String(v).split(',').map(Number) };
}

/** High (true) / low (false) for every mora: 0 flat L H H…, 1 H L L…, n L H…(to n) L… */
export function pattern(n, count) {
  return Array.from({ length: count }, (_, i) => (n === 0 ? i > 0 : n === 1 ? i === 0 : i > 0 && i < n));
}
const NAMES = n => (n === 0 ? 'рівний (без спаду)' : n === 1 ? 'високий перший склад' : `спад після ${n}-ї мори`);
/** Kana with the pitch line; empty when hidden by the setting or unknown. */
export function pitchHTML(p, { force = false } = {}) {
  if (!p || (!force && !pitchOn())) return '';
  const ms = morae(p.kana), n = p.acc[0];
  if (!ms.length || n > ms.length) return '';
  const hi = pattern(n, ms.length);
  const cells = ms.map((m, i) => {
    const cls = [hi[i] ? 'h' : 'l', hi[i] && !hi[i + 1] && (i < ms.length - 1 || n === ms.length) ? 'd' : '', i > 0 && hi[i] && !hi[i - 1] ? 'r' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}">${m}</span>`;
  }).join('');
  const alt = p.acc.length > 1 ? ` · також [${p.acc.slice(1).join('], [')}]` : '';
  return `<span class="pitch${n === 0 ? ' flat' : ''}" lang="ja" title="Наголос [${n}]: ${NAMES(n)}${alt}" aria-label="Наголос ${n}: ${NAMES(n)}">${cells}<small>${n}</small></span>`;
}
