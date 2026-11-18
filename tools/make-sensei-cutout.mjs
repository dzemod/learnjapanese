// Sensei illustration → transparent cutout + WebP for the «Сенсей» tab.
//   npm i --no-save sharp playwright-core kuromoji@0.1.2   (install them together: npm prunes other --no-save packages)
//   node tools/make-sensei-cutout.mjs [source.png]
// Source (not committed if > 2 MB): reference/sensei/sensei.png (or sensei.png.png). Outputs:
//   site/assets/sensei/sensei.png          copy of the original
//   site/assets/sensei/sensei-cutout.png   white background removed, cropped to the figure
//   site/assets/sensei/sensei-cutout.webp  ≈ 800 px wide, with alpha
// Background = near-white pixels connected to the image border (flood fill), so white inside the figure (beard,
// eyes) stays. Edge pixels (next to the background) are anti-aliased mixes of the drawing and white: they are
// "un-mixed" (C = a·F + (1−a)·white) so no white halo remains. Colours of the drawing are not changed.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(import.meta.url)('sharp');
const src = process.argv[2] || ['reference/sensei/sensei.png', 'reference/sensei/sensei.png.png'].map(p => path.join(ROOT, p)).find(p => fs.existsSync(p));
if (!src || !fs.existsSync(src) || !fs.statSync(src).size) { console.error('Sensei image missing or empty:', src || 'reference/sensei/sensei.png'); process.exit(1); }
const OUT = path.join(ROOT, 'site/assets/sensei');
fs.mkdirSync(OUT, { recursive: true });

const BG_MIN = 232; // a background pixel: every channel ≥ this …
const BG_SPREAD = 18; // … and almost grey (max − min ≤ this)
const EDGE = 2; // px: band next to the background that is un-mixed

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const px = i => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
const isBg = i => { const [r, g, b] = px(i); const mn = Math.min(r, g, b); return mn >= BG_MIN && Math.max(r, g, b) - mn <= BG_SPREAD; };

// flood fill from the border
const bg = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const i = stack.pop();
  if (bg[i] || !isBg(i)) continue;
  bg[i] = 1;
  const x = i % W, y = (i / W) | 0;
  if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W);
}
// distance (in px, chessboard) to the background, up to EDGE
const dist = new Uint8Array(W * H).fill(255);
for (let i = 0; i < W * H; i++) if (bg[i]) dist[i] = 0;
for (let d = 1; d <= EDGE; d++) for (let i = 0; i < W * H; i++) {
  if (dist[i] !== 255) continue;
  const x = i % W, y = (i / W) | 0;
  let near = false;
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < W && yy < H && dist[yy * W + xx] === d - 1) { near = true; break; }
  }
  if (near) dist[i] = d;
}
const out = Buffer.alloc(W * H * 4);
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let i = 0; i < W * H; i++) {
  let [r, g, b] = px(i), a = 255;
  if (bg[i]) a = 0;
  else if (dist[i] <= EDGE) {
    // mix with white: the lightest channel tells how much white is in the pixel
    const al = Math.min(1, Math.max(0, (255 - Math.min(r, g, b)) / 255 * 1.15));
    a = Math.round(al * 255);
    if (al > 0.02) { const un = c => Math.round(Math.min(255, Math.max(0, (c - (1 - al) * 255) / al))); r = un(r); g = un(g); b = un(b); }
  }
  out.set([r, g, b, a], i * 4);
  if (a > 8) { const x = i % W, y = (i / W) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
}
const M = 4; // margin
const crop = { left: Math.max(0, minX - M), top: Math.max(0, minY - M) };
crop.width = Math.min(W, maxX + M + 1) - crop.left; crop.height = Math.min(H, maxY + M + 1) - crop.top;
const cut = sharp(out, { raw: { width: W, height: H, channels: 4 } }).extract(crop);
await cut.clone().png({ compressionLevel: 9 }).toFile(path.join(OUT, 'sensei-cutout.png'));
const webpW = 800; // ≈ 800 px as asked (the figure is 538 px wide in the source → upscaled with Lanczos, no new detail)
await cut.clone().resize({ width: webpW, kernel: "lanczos3" }).webp({ quality: 88, alphaQuality: 100 }).toFile(path.join(OUT, 'sensei-cutout.webp'));
fs.copyFileSync(src, path.join(OUT, 'sensei.png'));
console.log(`source ${W}×${H} · background ${bg.reduce((n, v) => n + v, 0)} px · cutout ${crop.width}×${crop.height} (crop at ${crop.left},${crop.top}) · webp ${webpW} px`);
for (const f of ['sensei.png', 'sensei-cutout.png', 'sensei-cutout.webp']) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024), 'KB');
