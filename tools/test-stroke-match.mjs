// Unit test of the stroke matching rules (site/js/stroke-match.js) on real KanjiVG strokes, no browser.
//   node tools/test-stroke-match.mjs [svg dir]   (default: fetch the few SVGs needed from jsDelivr)
//   node tools/test-stroke-match.mjs <svg dir> --all   every kanji of data/kanji.json: each stroke drawn with the
//     human and the crooked hand must be accepted (an accepted stroke is what the writing mode swaps for the clean one)
// Checks: exact / overshoot 20 % / undershoot 25 % / two pieces / reversed / wrong place / later stroke (order),
// and that every stroke of the test kanji drawn with a "human" offset + wobble is accepted.
import fs from 'fs';
import { STROKE, judgeStroke, compareStroke, pathLength, resample } from '../site/js/stroke-match.js';

const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const ALL_MODE = process.argv.includes('--all');
const KVG = 'https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@r20260714/kanji/';
async function svg(ch) {
  const hex = ch.codePointAt(0).toString(16).padStart(5, '0');
  if (dir && fs.existsSync(`${dir}/${hex}.svg`)) return fs.readFileSync(`${dir}/${hex}.svg`, 'utf8');
  const r = await fetch(KVG + hex + '.svg');
  if (!r.ok) throw new Error(`${ch}: HTTP ${r.status}`);
  return r.text();
}
// minimal SVG path sampler for KanjiVG (M m C c S s L l)
function sample(d) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  let i = 0, cmd = '', x = 0, y = 0, lc = null;
  const pts = [], num = () => +toks[i++];
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let k = 1; k <= 16; k++) {
      const t = k / 16, m = 1 - t;
      pts.push([m * m * m * x + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3, m * m * m * y + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3]);
    }
    lc = [x2, y2]; x = x3; y = y3;
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toLowerCase()) {
      case 'm': x = ox + num(); y = oy + num(); pts.push([x, y]); lc = null; cmd = rel ? 'l' : 'L'; break;
      case 'l': x = ox + num(); y = oy + num(); pts.push([x, y]); lc = null; break;
      case 'c': { const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; cubic(...a); break; }
      case 's': { const r1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; const a = [ox + num(), oy + num(), ox + num(), oy + num()]; cubic(r1[0], r1[1], ...a); break; }
      default: i++;
    }
  }
  return pts;
}
const strokesOf = t => [...t.matchAll(/id="kvg:[0-9a-f]+-s\d+"[^>]*\sd="([^"]+)"/g)].map(m => sample(m[1]));
const human = pts => resample(pts, Math.max(8, Math.round(pathLength(pts) / 2))).map(([x, y], i) => [x + 2.5 + 1.5 * Math.sin(i * 0.9), y - 1.5 + Math.cos(i * 1.3) * 1.2]);
// part of a stroke from fraction a to b of its length (b > 1 = extended along the last direction)
function part(pts, a, b) {
  const r = resample(pts, 101);
  const out = r.slice(Math.round(a * 100), Math.round(Math.min(1, b) * 100) + 1);
  if (b > 1) {
    const [p, q] = [r[99], r[100]], L = pathLength(pts) * (b - 1), dx = q[0] - p[0], dy = q[1] - p[1], n = Math.hypot(dx, dy) || 1;
    for (let k = 1; k <= 10; k++) out.push([q[0] + (dx / n) * L * k / 10, q[1] + (dy / n) * L * k / 10]);
  }
  return out;
}

let fails = 0;
const t = (name, cond, info = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const fmt = r => `${r.reason || 'ok'} start ${r.start?.toFixed(1)} cov ${(r.coverage * 100)?.toFixed(0)}% len ${r.len?.toFixed(0)}/${r.elen?.toFixed(0)}`;

const tatami = strokesOf(await svg('畳'));
const s0 = tatami[0]; // 畳 stroke 1
// find the first horizontal-ish stroke (the issue was reported on «the horizontal stroke»)
const hi = tatami.findIndex(s => { const a = s[0], b = s[s.length - 1]; return Math.abs(b[0] - a[0]) > 3 * Math.abs(b[1] - a[1]); });
const H = tatami[hi];
console.log(`畳: ${tatami.length} strokes, first horizontal = stroke ${hi + 1}`);
let r;
for (const [name, S, idx] of [['stroke 1', s0, 0], [`horizontal stroke ${hi + 1}`, H, hi]]) {
  r = judgeStroke(human(S), tatami, idx); t(`畳 ${name}: human drawing accepted`, r.ok, fmt(r));
  r = judgeStroke(human(part(S, 0, 1.2)), tatami, idx); t(`畳 ${name}: overshoot 20 % accepted`, r.ok, fmt(r));
  r = judgeStroke(human(part(S, 0, 0.75)), tatami, idx); t(`畳 ${name}: undershoot 25 % rejected`, !r.ok && r.reason === 'shape', fmt(r));
  { const u = human(part(S, 0, 0.75)); u.push([...u.at(-1)], [...u.at(-1)]); r = judgeStroke(u, tatami, idx); t(`畳 ${name}: undershoot with repeated lift point rejected`, !r.ok, fmt(r)); }
  r = judgeStroke(human(part(S, 0, 0.9)), tatami, idx); t(`畳 ${name}: lifted 10 % early accepted`, r.ok, fmt(r));
  r = judgeStroke(human([...part(S, 0, 0.5), ...part(S, 0.52, 1)]), tatami, idx); t(`畳 ${name}: two pieces merged accepted`, r.ok, fmt(r));
  r = judgeStroke(human([...S].reverse()), tatami, idx); t(`畳 ${name}: reversed rejected (direction)`, !r.ok && r.reason === 'direction', fmt(r));
  r = judgeStroke(human(part(S, 0, 2.2)), tatami, idx); t(`畳 ${name}: far too long rejected`, !r.ok, fmt(r));
}
r = judgeStroke([[8, 70], [8, 80], [8, 90], [8, 100]], tatami, 0); t('畳: wrong place rejected (shape)', !r.ok && r.reason === 'shape', fmt(r));
r = judgeStroke(human(tatami[5]), tatami, 0); t('畳: later stroke first rejected (order)', !r.ok && r.reason === 'order', fmt(r));

// every stroke of a spread of kanji, human hand, in order
for (const ch of '畳妻議競警願療震書飛必左右人一難鬱') {
  let S2;
  try { S2 = strokesOf(await svg(ch)); } catch (e) { console.log('skip', ch, e.message); continue; }
  const bad = [];
  S2.forEach((s, i) => { const x = judgeStroke(human(s), S2, i); if (!x.ok) bad.push(`${i + 1}: ${fmt(x)}`); });
  t(`${ch} all ${S2.length} strokes accepted`, !bad.length, bad.join(' | '));
}
if (ALL_MODE) {
  const crooked = pts => resample(pts, Math.max(6, Math.round(pathLength(pts) / 2))).map(([x, y], i) => [x + 3 + 3 * Math.sin(i * 0.45), y + 2 + 2.6 * Math.cos(i * 0.35)]);
  const kj = JSON.parse(fs.readFileSync(new URL('../site/data/kanji.json', import.meta.url), 'utf8'));
  const failed = [];
  let n = 0, strokes = 0;
  for (const b of kj.books) for (const l of b.lessons) for (const k of l.kanji) {
    const S3 = strokesOf(await svg(k.kanji));
    n++; strokes += S3.length;
    for (const [hand, fn] of [['human', human], ['crooked', crooked]]) {
      S3.forEach((st, i) => { const x = judgeStroke(fn(st), S3, i); if (!x.ok) failed.push(`${k.id} ${k.kanji} stroke ${i + 1} (${hand}): ${fmt(x)}`); });
    }
  }
  t(`all ${n} kanji (${strokes} strokes, 2 hands): every stroke accepted`, !failed.length, `${failed.length} rejected`);
  if (failed.length) console.log(failed.join('\n'));
}
console.log(`\nthresholds ${JSON.stringify(STROKE)}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
