// Pitch accent rules (site/js/pitch.js) + data (site/data/pitch.json, site/data/dict/pitch-*.json from Kanjium).
//   node tools/test-pitch.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(pathToFileURL(path.join(ROOT, 'site/js/pitch.js')).href);
P.setPitchData(JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/pitch.json'), 'utf8')));
let passed = 0;
const fails = [];
const ok = (c, name) => { if (c) passed++; else { fails.push(name); console.log('FAIL', name); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

ok(eq(P.morae('きょうと'), ['きょ', 'う', 'と']), 'morae: small ょ joins');
ok(eq(P.morae('がっこう'), ['が', 'っ', 'こ', 'う']), 'morae: っ counts');
ok(eq(P.morae('コーヒー'), ['コ', 'ー', 'ヒ', 'ー']), 'morae: ー counts');
ok(eq(P.pattern(0, 3), [false, true, true]), 'heiban LHH');
ok(eq(P.pattern(1, 3), [true, false, false]), 'atamadaka HLL');
ok(eq(P.pattern(2, 3), [false, true, false]), 'nakadaka LHL');
ok(eq(P.pattern(3, 3), [false, true, true]), 'odaka LHH (drop after the word)');

ok(eq(P.pitchOf('雨', 'あめ'), { kana: 'あめ', acc: [1] }), '雨 あめ [1]');
ok(eq(P.pitchOf('行きます', 'いきます', 'I'), { kana: 'いきます', acc: [3] }), 'ます-verb: drop after ま');
ok(eq(P.pitchOf('食べます', 'たべます', 'II'), { kana: 'たべます', acc: [3] }), 'group II verb');
ok(P.pitchOf('先生', 'せんせい')?.acc[0] === 3, '先生 [3]');
ok(P.pitchOf('きれい[な]', '')?.acc[0] === 1, 'な-adjective without [な]');
ok(P.pitchOf('ニューヨークxyz', '') === null, 'unknown word → null');
ok(P.pitchKeys('[お]祭り', '[お]まつり').includes('お祭り|おまつり'), '[お] tried with お');

const h = P.pitchHTML({ kana: 'はし', acc: [2] }, { force: true });
ok(/<span class="l">は<\/span><span class="h d r">し<\/span>/.test(h), 'HTML: 橋 はし [2] = low, high + drop at the end');
ok(/<span class="h d">は<\/span><span class="l">し<\/span>/.test(P.pitchHTML({ kana: 'はし', acc: [1] }, { force: true })), 'HTML: 箸 はし [1] = high + drop, low');
ok(!/ d"/.test(P.pitchHTML({ kana: 'えき', acc: [0] }, { force: true })) && /class="pitch flat"/.test(P.pitchHTML({ kana: 'えき', acc: [0] }, { force: true })), 'HTML: heiban has no drop');
ok(P.pitchHTML({ kana: 'あ', acc: [5] }, { force: true }) === '', 'accent beyond the word → nothing');
ok(/також \[2\]/.test(P.pitchHTML({ kana: 'ひと', acc: [0, 2] }, { force: true })), 'variants in the title');

// dictionary shards: every key in the shard its form hashes to
let n = 0, wrong = 0;
for (let i = 0; i < 16; i++) {
  const s = i.toString(16), m = JSON.parse(fs.readFileSync(path.join(ROOT, `site/data/dict/pitch-${s}.json`), 'utf8')).p;
  for (const k of Object.keys(m)) { n++; if (P.pitchShard(k.split('|')[0]) !== s) wrong++; if (!/^\d+(,\d+)*$/.test(m[k])) wrong++; }
}
ok(n > 120000 && wrong === 0, `dictionary shards: ${n} entries, ${wrong} misplaced / bad`);
const m = JSON.parse(fs.readFileSync(path.join(ROOT, `site/data/dict/pitch-${P.pitchShard('雨')}.json`), 'utf8')).p;
ok(m['雨|あめ'] === '1' && JSON.parse(fs.readFileSync(path.join(ROOT, `site/data/dict/pitch-${P.pitchShard('飴')}.json`), 'utf8')).p['飴|あめ'] === '0', 'dictionary: 雨 [1] vs 飴 [0]');

console.log(`${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
