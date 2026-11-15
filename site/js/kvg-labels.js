// Stroke numbers of the KanjiVG diagram: KanjiVG’s own positions overlap or touch in a few of our 1000 kanji
// (e.g. 難 15/16). spreadLabels() pushes overlapping numbers apart. Pure, used by kanji.js and tests.
// Boxes match the 7-unit font of .so-num (measured with getBBox): 3.5 units per digit, digits 5.2 units high above
// the baseline; the 0.8 gap keeps baselines ≥ 6 units apart (clear gap on screen, also for the qa-site overlap check).
const DIGIT_W = 3.5, H = 5.2, PAD = 0.8;
const box = n => ({ x: n.x, y: n.y - H, w: DIGIT_W * String(n.t).length, h: H });
export function overlaps(a, b, pad = PAD) {
  const p = box(a), q = box(b);
  return p.x < q.x + q.w + pad && q.x < p.x + p.w + pad && p.y < q.y + q.h + pad && q.y < p.y + p.h + pad;
}
/** Parse KanjiVG `<text transform="matrix(1 0 0 1 x y)">n</text>` data → [{ t, x, y }]. */
export function parseLabels(nums) {
  return nums.map(n => {
    const m = /matrix\(\s*1\s+0\s+0\s+1\s+([-\d.]+)\s+([-\d.]+)\s*\)/.exec(n.tr || '');
    return { t: n.t, x: m ? +m[1] : 0, y: m ? +m[2] : 0, ok: !!m };
  });
}
/** Move later labels away from earlier ones (smallest push, inside the 109 box). */
export function spreadLabels(labels) {
  const out = labels.map(l => ({ ...l }));
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let j = 0; j < out.length; j++) for (let i = 0; i < j; i++) {
      const a = out[i], b = out[j];
      if (!a.ok || !b.ok || !overlaps(a, b)) continue;
      const pa = box(a), pb = box(b);
      const dx = b.x >= a.x ? pa.x + pa.w + PAD - pb.x : -(pb.x + pb.w + PAD - pa.x);
      const dy = b.y >= a.y ? pa.y + pa.h + PAD - pb.y : -(pb.y + pb.h + PAD - pa.y);
      if (Math.abs(dy) <= Math.abs(dx)) b.y += dy + Math.sign(dy) * 0.05; else b.x += dx + Math.sign(dx) * 0.05;
      b.x = Math.min(109 - pb.w, Math.max(0, b.x)); b.y = Math.min(109, Math.max(H, b.y));
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}
