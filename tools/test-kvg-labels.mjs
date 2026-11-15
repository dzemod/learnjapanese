// Stroke numbers of the stroke-order diagram must not overlap after spreadLabels() (site/js/kvg-labels.js).
//   node tools/test-kvg-labels.mjs <dir with KanjiVG .svg files>   (e.g. downloaded by the coverage check)
import fs from 'fs';
import { parseLabels, spreadLabels, overlaps } from '../site/js/kvg-labels.js';
const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/test-kvg-labels.mjs <svg dir>'); process.exit(2); }
let before = 0, after = 0, moved = 0, maxMove = 0, files = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.svg'))) {
  files++;
  const t = fs.readFileSync(`${dir}/${f}`, 'utf8');
  const nums = [...t.matchAll(/<text transform="([^"]+)">(\d+)<\/text>/g)].map(m => ({ tr: m[1], t: m[2] }));
  const L = parseLabels(nums), S = spreadLabels(L);
  const count = a => { let n = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (overlaps(a[i], a[j], 0)) n++; return n; };
  const b = count(L), c = count(S);
  before += b > 0; after += c > 0;
  if (c) console.log('still overlapping:', f);
  S.forEach((s, i) => { const d = Math.hypot(s.x - L[i].x, s.y - L[i].y); if (d > 0) { moved++; maxMove = Math.max(maxMove, d); } });
}
console.log(`${files} files · overlapping before ${before} · after ${after} · labels moved ${moved} · max move ${maxMove.toFixed(1)} units`);
process.exit(after ? 1 : 0);
