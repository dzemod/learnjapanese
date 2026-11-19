// App icons for the PWA manifest (site/assets/icons/): the site's logo — a red sun on black.
//   node tools/make-icons.mjs   (needs sharp: npm i --no-save sharp)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.QA_MODULES ? path.join(process.env.QA_MODULES, 'x.js') : path.join(ROOT, 'x.js'));
const sharp = require('sharp');
const OUT = path.join(ROOT, 'site/assets/icons');
fs.mkdirSync(OUT, { recursive: true });
// any: rounded square; maskable: full bleed, the sun inside the 80 % safe zone
const svg = (maskable) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="60%" stop-color="#C8102E" stop-opacity=".55"/><stop offset="100%" stop-color="#C8102E" stop-opacity="0"/></radialGradient></defs>
  ${maskable ? '<rect width="512" height="512" fill="#0E0E0E"/>' : '<rect width="512" height="512" rx="112" fill="#0E0E0E"/>'}
  <circle cx="256" cy="256" r="${maskable ? 150 : 175}" fill="url(#g)"/>
  <circle cx="256" cy="256" r="${maskable ? 110 : 128}" fill="#C8102E"/></svg>`;
for (const [name, size, mask] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await sharp(Buffer.from(svg(mask))).resize(size, size).png().toFile(path.join(OUT, name));
  console.log('wrote', name);
}
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(false));
