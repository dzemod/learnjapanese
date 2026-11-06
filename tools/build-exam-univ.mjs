// Builds site/data/exam-univ.json — the question bank of the exam «Університетська версія» (format of the 復習 test).
//   node tools/build-exam-univ.mjs            → all lessons found in tools/exam-univ/L*.js
//   node tools/build-exam-univ.mjs --review   → also prints every reading taken from Kuromoji for single kanji
// Needs kuromoji (npm i --no-save kuromoji@0.1.2, or KUROMOJI=<path>).
//
// Source files tools/exam-univ/L01-10.js: module.exports = { <lesson>: { allow?, p, n, f, a, t, w, c } }
//   p  particles       ['わたし[は]学生です。', 'Я студент.', '1-1', 'x?']     blank [a] or [a|alt]
//   n  antonyms        '大きい=小さい', '高い=安い|低い', '[電源を]入れます=[電源を]切ります'
//   f  forms           ['いいえ、(食べます=食べません)。', uk, pt, x]         blank (base=answer|alt)
//   a/t/w/c  choice    ['<やっと|*上手に|なかなか>歌えます。', uk, pt|null, x]   blank <a|*b|c>, * = correct
//   allow              space-separated words accepted in this lesson although they are not vocabulary entries
// Plain Japanese is written in the sources; readings {漢字|かな} are added here (explicit markup is kept):
// numbers + counters by rule, words from sets.json / kanji.json / grammar.json, the rest by Kuromoji.
// Errors stop the build: unknown grammar point, not 3 options / not one correct, duplicates, kanji without reading.
// Warnings must be read: a word not known by that lesson (sets.json lessons ≤ l), a form not taught yet.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { conjugate } from '../site/js/conjugate.js';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kuroPath = process.env.KUROMOJI || path.join(ROOT, 'node_modules', 'kuromoji');
const kuromoji = require(kuroPath);
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const REVIEW = process.argv.includes('--review');
const G = read('site/data/grammar.json').lessons;
const SETS = read('site/data/sets.json').sets;
const K = read('site/data/kanji.json').books;
const tk = await new Promise((res, rej) => kuromoji.builder({ dicPath: path.join(kuroPath, 'dict') }).build((e, t) => (e ? rej(e) : res(t))));

const hira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const HAS_K = /[㐀-鿿々〆]/;
const plainOf = s => String(s).replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1');
const points = new Set(G.flatMap(l => l.points.map(p => p.id)));

// ---------- messages ----------
const errors = [], warns = [];
const err = (ctx, m) => errors.push(`${ctx}: ${m}`);
const warn = (ctx, m) => warns.push(`${ctx}: ${m}`);

// ---------- known readings ----------
const known = new Map();
const addK = (w, r) => { w = w.trim(); r = r.trim(); if (w.length >= 2 && /^[㐀-鿿々〆]+$/.test(w) && /^[ぁ-ゖー]+$/.test(r) && !known.has(w)) known.set(w, r); };
for (const s of SETS) for (const c of s.cards) if (c.kanji) addK(c.kanji.replace(/\[な\]/g, ''), c.kana.replace(/\[な\]/g, ''));
for (const L of G) for (const p of L.points) for (const b of [...p.blocks, ...(p.details || [])]) {
  for (const m of String(b.ex || '').matchAll(/\{([^{}|]+)\|([^{}]+)\}/g)) addK(m[1], m[2]);
}
for (const b of K) for (const l of b.lessons) for (const k of l.kanji) for (const e of k.examples || []) if (e.kana && !e.kana.includes('／')) addK(e.word, e.kana);
const FIXED = { 日本: 'にほん', 日本語: 'にほんご', 上手: 'じょうず', 下手: 'へた', 今日: 'きょう', 明日: 'あした', 昨日: 'きのう', 大人: 'おとな', 一人: 'ひとり', 二人: 'ふたり', 何人: 'なんにん', 何時: 'なんじ', 何時間: 'なんじかん', 何分: 'なんぷん', 何歳: 'なんさい', 何階: 'なんがい', 何本: 'なんぼん', 何枚: 'なんまい', 何台: 'なんだい', 何回: 'なんかい', 何冊: 'なんさつ', 何番: 'なんばん', 何杯: 'なんばい', 何匹: 'なんびき', 何度: 'なんど', 何年: 'なんねん', 何月: 'なんがつ', 何日: 'なんにち', 何週間: 'なんしゅうかん', 何曜日: 'なんようび', 何個: 'なんこ', 何語: 'なにご', 何色: 'なにいろ' };
for (const [w, r] of Object.entries(FIXED)) known.set(w, r);
// pairs checked by a person (the textbook markup): a reading from Kuromoji that is not among them goes to the review list
const verified = new Set();
for (const L of G) for (const p of L.points) for (const b of [...p.blocks, ...(p.details || [])]) for (const m of String(b.ex || '').matchAll(/\{([^{}|]+)\|([^{}]+)\}/g)) verified.add(m[1] + '|' + m[2]);
// Kuromoji is wrong on these
const TOK_FIX = { 国: 'くに', 金: 'かね', 弾き: 'ひき', 弾く: 'ひく', 弾い: 'ひい', 弾か: 'ひか', 弾け: 'ひけ', 方: 'ほう', 間: 'あいだ', 今: 'いま', 車: 'くるま', 辛い: 'からい', 辛: 'から', 角: 'かど', 行っ: 'いっ', 牛: 'ぎゅう', 様: 'さま', 米: 'こめ', 表: 'おもて', 弾ける: 'ひける', 通っ: 'かよっ', 通い: 'かよい', 通う: 'かよう', 通わ: 'かよわ' };
const longest = [...known.keys()].sort((a, b) => b.length - a.length);

// numbers + counters
const small = n => n % 10;
const NUM_RULE = {
  分: n => ([1, 3, 4, 6, 8, 0].includes(small(n)) ? 'ぷん' : 'ふん'),
  本: n => ([1, 6, 8, 0].includes(small(n)) ? 'ぽん' : small(n) === 3 ? 'ぼん' : 'ほん'),
  杯: n => ([1, 6, 8, 0].includes(small(n)) ? 'ぱい' : small(n) === 3 ? 'ばい' : 'はい'),
  匹: n => ([1, 6, 8, 0].includes(small(n)) ? 'ぴき' : small(n) === 3 ? 'びき' : 'ひき'),
  階: n => (small(n) === 3 ? 'がい' : 'かい'),
  回: () => 'かい', 枚: () => 'まい', 台: () => 'だい', 冊: () => 'さつ', 個: () => 'こ', 歳: () => 'さい', 時: () => 'じ', 時間: () => 'じかん', 月: () => 'がつ', 年: () => 'ねん', 週間: () => 'しゅうかん', 番: () => 'ばん', 円: () => 'えん', 度: () => 'ど', 倍: () => 'ばい', 人: () => 'にん', 万: () => 'まん', 千: () => 'せん', 百: () => 'ひゃく', 番線: () => 'ばんせん', 課: () => 'か', 号: () => 'ごう', 位: () => 'い', 番目: () => 'ばんめ', 段目: () => 'だんめ',
};
const DAY = { 1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか', 8: 'ようか', 9: 'ここのか', 10: 'とおか', 14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか' };
function preRules(t) {
  if (NUM_RULE[t]) return `{${t}|${NUM_RULE[t](5)}}`; // a counter on its own (an option)
  if (t === '日') return '{日|にち}';
  return t
    .replace(/(あの|この|その|どの)方/g, '$1{方|かた}')
    .replace(/の間/g, 'の{間|あいだ}').replace(/^間$/, '{間|あいだ}').replace(/^語$/, '{語|ご}').replace(/^屋$/, '{屋|や}').replace(/この辺/g, 'この{辺|へん}')
    .replace(/([ァ-ヶー]|[㐀-鿿])語/g, '$1{語|ご}')
    .replace(/(^|[^0-9])1人/g, '$1{1人|ひとり}').replace(/(^|[^0-9])2人/g, '$1{2人|ふたり}')
    .replace(/(\d+)日/g, (m, d) => (DAY[+d] ? `{${d}日|${DAY[+d]}}` : `${d}{日|にち}`))
    .replace(/(\d+)か月/g, '$1か{月|げつ}')
    .replace(/(\d+)(週間|時間|番線|番目|段目|分|本|杯|匹|階|回|枚|台|冊|個|歳|時|月|年|番|円|度|倍|人|万|千|百|課|号|位)/g, (m, d, c) => `${d}{${c}|${NUM_RULE[c](+d)}}`);
}
const reviewed = new Map();
function alignToken(surface, reading) {
  const parts = surface.split(/([㐀-鿿々〆]+)/).filter(Boolean);
  const re = new RegExp('^' + parts.map(p => (HAS_K.test(p) ? '(.+?)' : hira(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('') + '$');
  const m = re.exec(reading);
  if (!m) return `{${surface}|${reading}}`;
  let i = 1;
  return parts.map(p => (HAS_K.test(p) ? `{${p}|${m[i++]}}` : p)).join('');
}
function furiRun(run, ctx) {
  if (!HAS_K.test(run)) return run;
  for (const w of longest) { // known multi-kanji words first
    const i = run.indexOf(w);
    if (i >= 0) return furiRun(run.slice(0, i), ctx) + `{${w}|${known.get(w)}}` + furiRun(run.slice(i + w.length), ctx);
  }
  let out = '';
  const toks = tk.tokenize(run);
  toks.forEach((t, i) => {
    const s = t.surface_form;
    if (!HAS_K.test(s)) { out += s; return; }
    let r = hira(t.reading && t.reading !== '*' ? t.reading : '');
    const next = toks[i + 1]?.surface_form || '';
    if (TOK_FIX[s]) r = TOK_FIX[s];
    if (s === '来' && /^(ら|さ)/.test(next)) r = 'こ';
    if (s === '何') r = /^(で|の|と|だ)/.test(next) ? 'なん' : 'なに';
    if (!r) { err(ctx, `no reading for ${s}`); out += s; return; }
    const aligned = alignToken(s, r);
    if (REVIEW) for (const m of aligned.matchAll(/\{([^{}|]+)\|([^{}]+)\}/g)) if (!verified.has(m[1] + '|' + m[2]) && !reviewed.has(m[1] + '→' + m[2])) reviewed.set(m[1] + '→' + m[2], run);
    out += aligned;
  });
  return out;
}
/** Plain text with optional explicit markup → markup. */
function addFuri(text, ctx) {
  const MK = /(\{[^{}|]+\|[^{}]+\})/;
  return text.split(MK).map(p => (p.startsWith('{') ? p : preRules(p).split(MK).map(q => (q.startsWith('{') ? q : furiRun(q, ctx))).join(''))).join('');
}

// ---------- vocabulary known by lesson ----------
const vocabBy = {}; // lesson → Set of surface forms
const allVerbs = [];
const variants = str => String(str).replace(/\[[^\]]*\]/g, ' ').replace(/[()（）～〜－。？！、…]/g, ' ').split(/[\s／/]+/).filter(Boolean);
for (let l = 0; l <= 50; l++) {
  const s = SETS.find(x => x.id === 'mnn-' + String(l).padStart(2, '0'));
  const out = new Set(vocabBy[l - 1] || []);
  for (const c of s?.cards || []) {
    for (const f of [c.kanji, c.kana].filter(Boolean)) {
      const whole = f.replace(/\[([^\]]*)\]/g, '$1');
      for (const v of [...variants(f), ...variants(whole), ...variants(f.replace(/\s+/g, ''))]) {
        out.add(v); out.add(hira(v)); out.add(v.replace(/です$/, ''));
        if (c.verbGroup && v.endsWith('ます')) {
          const d = conjugate(v, c.verbGroup, 'dict');
          if (d) { out.add(d); out.add(hira(d)); }
          if (v.endsWith('します')) out.add(v.slice(0, -3));
        }
      }
    }
  }
  for (const c of s?.cards || []) if (c.verbGroup) allVerbs.push(c);
  if (l >= 27) for (const c of allVerbs) for (const f of [c.kanji, c.kana].filter(Boolean)) if (f.endsWith('ます')) { const p = conjugate(f, c.verbGroup, 'pot'); if (p) out.add(p); }
  vocabBy[l] = out;
}
// names of the textbook characters and grammar words that are not vocabulary entries
const ALLOW = new Set(`ない かる おはよう おやすみなさい する いる ある です ます こと もの ん の よう ため とき ところ ほう はず わけ つもり
 IMC ミラー サントス ワン マリア カリナ テレサ タロー グプタ シュミット イー ポン キム ジョン トム ハンス クララ ワット
 山田 田中 佐藤 鈴木 木村 松本 中村 吉田 渡辺 高橋 林 小川 太郎 一郎 伊藤 斎藤 野村 森 花子 東京 大阪 京都 奈良 北海道 沖縄 広島 富士山
 さん どこ いつ なに なん それ これ あれ ここ そこ あそこ どれ こちら そちら あちら どちら そう ああ こう あの その この どの
 一 二 三 四 五 六 七 八 九 十 百 千 万 半 時 分 人 日 月 年 円 歳 階 語 屋 中 目 前 後 上 下 方 ごろ ぐらい くらい など 達 たち お ご
 いい よい よく いく くる いらっしゃる なる できる おく 行く 来る`.split(/\s+/));
const OWN = {};
const LOOSE = new Set(['A', 'B', 'じゃ', 'まして', 'でし', 'まし', 'ませ', '何で', 'だめ', '客', 'より', 'どん', 'あと', '店', 'ない', '患者', 'どの人', 'やっ', 'かる', 'ほか', 'だし', 'お先に', '通る', '作れる', 'ろう', 'おう', '何と', 'きん', 'とおり', 'なら', 'ける', '木の葉', 'とおりに', 'つけ', '長ける', 'その間', 'ときを', 'ベル', '場合', 'そる', 'くい', '来す', 'おっしゃる', 'お送り', '作れる']);

// ---------- grammar guard: the lesson where a form is introduced ----------
// fixed phrases that are vocabulary entries of their lesson, whatever their form
const PHRASE_OK = ['見せてください', '歩いて', 'いらっしゃってください', 'お上がりください', '慣れました', '行っていらっしゃい', '行ってまいります', 'どうしようかな', 'お待たせしました'];
function guardForms(plain, l, ctx) {
  const toks = tk.tokenize(PHRASE_OK.reduce((a, w) => a.split(w).join('。'), plain).replace(/\n/g, '。'));
  toks.forEach((t, i) => {
    const prev = toks[i - 1];
    const flag = (min, what) => { if (l < min) warn(ctx, `${what} (from L${min}): ${plain}`); };
    if ((t.surface_form === 'て' || t.surface_form === 'で') && t.pos === '助詞' && prev?.pos === '動詞') flag(14, 'て-form');
    if (t.basic_form === 'ない' && t.pos === '助動詞' && prev?.pos === '動詞') flag(17, 'ない-form');
    if ((t.surface_form === 'た' || t.surface_form === 'だ') && t.pos === '助動詞' && prev?.pos === '動詞') flag(19, 'た-form');
    if (t.pos === '動詞' && t.conjugated_form === '基本形' && t.pos_detail_1 !== '接尾') flag(18, 'dictionary form');
    if (t.surface_form === 'ば' && t.pos === '助詞' && prev?.surface_form !== 'なけれ') flag(35, 'ば');
    if (t.basic_form === 'れる' || t.basic_form === 'られる') flag(27, 'れる／られる');
    if (t.basic_form === 'せる' || t.basic_form === 'させる') flag(48, 'causative');
    if (t.surface_form === 'う' && t.pos === '助動詞' && !['ましょ', 'でしょ'].includes(prev?.surface_form)) flag(31, 'volitional');
  });
}

// ---------- DSL ----------
/** split by | outside of {…} */
const splitBar = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '{') d++; if (ch === '}') d--; if (ch === '|' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
/** text with blanks → array of strings and blanks (still plain) */
function parseParts(src) {
  const parts = [], re = /\[([^\]]+)\]|\(([^()=]+)=([^()]+)\)|<([^<>]+)>/g;
  let i = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > i) parts.push(src.slice(i, m.index));
    if (m[1] !== undefined) parts.push({ kind: 'p', a: splitBar(m[1]) });
    else if (m[2] !== undefined) parts.push({ kind: 'f', b: m[2], a: splitBar(m[3]) });
    else parts.push({ kind: 'c', o: splitBar(m[4]) });
    i = re.lastIndex;
  }
  if (i < src.length) parts.push(src.slice(i));
  return parts;
}
const filled = parts => parts.map(p => (typeof p === 'string' ? p : p.kind === 'c' ? (p.o.find(x => x.startsWith('*')) || '*').slice(1) : p.a[0])).join('');

function checkVocab(text, l, ctx) {
  const v = vocabBy[l];
  for (const t of tk.tokenize(plainOf(text).replace(/\n/g, '。'))) {
    if (['助詞', '助動詞', '記号', 'フィラー'].includes(t.pos) || ['数', '接尾', '非自立'].includes(t.pos_detail_1)) continue;
    const s = t.surface_form, b = t.basic_form === '*' ? s : t.basic_form;
    if (/^[0-9０-９]+$/.test(s) || /^[ぁ-ん]$/.test(s) || LOOSE.has(s) || LOOSE.has(b)) continue;
    const ok = [s, b, hira(t.reading || ''), hira(b)].some(x => v.has(x) || ALLOW.has(x) || OWN[l]?.has(x));
    // a compound the tokenizer has split: the whole word exists in a card
    if (!ok && ![...v].some(w => w.length > s.length && w.includes(s) && (HAS_K.test(s) || s.length >= 3))) warn(ctx, `word «${b}» not in lessons ≤ ${l}`);
  }
}
function buildBlank(p, ctx) {
  if (p.kind === 'p') return { a: p.a.map(x => addFuri(x, ctx)) };
  if (p.kind === 'f') return { b: addFuri(p.b, ctx), a: p.a.map(x => addFuri(x, ctx)) };
  if (p.o.length !== 3) err(ctx, `need 3 options: ${p.o.join(' ')}`);
  if (p.o.filter(x => x.startsWith('*')).length !== 1) err(ctx, `need 1 correct option: ${p.o.join(' ')}`);
  return { o: p.o.map(x => addFuri(x.replace(/^\*/, ''), ctx)), c: p.o.findIndex(x => x.startsWith('*')) };
}

// ---------- compile ----------
const SEC = { p: 1, n: 2, f: 3, a: 4, t: 5, w: 6, c: 7 };
const dir = path.join(ROOT, 'tools/exam-univ');
const src = {};
for (const f of fs.readdirSync(dir).filter(f => /^L.*\.js$/.test(f)).sort()) Object.assign(src, require(path.join(dir, f)));

const out = [];
const seen = new Set();
for (const lk of Object.keys(src).map(Number).sort((a, b) => a - b)) {
  const L = src[lk];
  if (L.allow) OWN[lk] = new Set(L.allow.split(/\s+/));
  const items = [];
  (L.n || []).forEach((pair, i) => {
    const ctx = `L${lk} n${i + 1}`;
    const words = pair.split('=');
    if (words.length !== 2) return err(ctx, `bad pair ${pair}`);
    words.forEach((w, dirI) => {
      const answers = splitBar(words[1 - dirI]).map(x => x.replace(/^\[[^\]]+\]/, ''));
      const shown = splitBar(w)[0];
      checkVocab(shown.replace(/[[\]]/g, ''), lk, ctx);
      answers.forEach(x => checkVocab(x, lk, ctx));
      items.push({ id: `u2-${lk}-${i + 1}${'ab'[dirI]}`, s: 2, l: lk, pair: `${lk}-${i + 1}`, parts: [{ b: addFuri(shown, ctx), a: answers.map(x => addFuri(x, ctx)) }] });
    });
  });
  for (const key of ['p', 'f', 'a', 't', 'w', 'c']) {
    (L[key] || []).forEach((row, i) => {
      const [text, uk, pt, x] = row;
      const ctx = `L${lk} ${key}${i + 1}`;
      const parts = parseParts(text);
      const blanks = parts.filter(p => typeof p !== 'string');
      if (!blanks.length) err(ctx, `no blank: ${text}`);
      if (pt && !points.has(pt)) err(ctx, `no grammar point ${pt}`);
      if (pt && +pt.split('-')[0] > lk) err(ctx, `point ${pt} is later than the lesson`);
      if (!uk) err(ctx, 'no translation');
      const want = key === 'p' ? 'p' : key === 'f' ? 'f' : 'c';
      if (blanks.some(p => p.kind !== want)) err(ctx, `wrong kind of blank: ${text}`);
      const plain = filled(parts);
      if (seen.has(plain + key)) err(ctx, `duplicate: ${plain}`);
      seen.add(plain + key);
      checkVocab(plain, lk, ctx);
      guardForms(plainOf(plain), lk, ctx);
      blanks.filter(p => p.kind === 'c').forEach(p => p.o.forEach(o => { checkVocab(o.replace(/^\*/, ''), lk, ctx); if (!/^\*?ま/.test(o)) guardForms(plainOf(o.replace(/^\*/, '')), lk, ctx); }));
      blanks.filter(p => p.kind === 'f').forEach(p => { checkVocab(p.b, lk, ctx); if (p.a.includes(p.b)) err(ctx, `blank asks nothing: ${p.b}`); });
      const built = parts.map(p => (typeof p === 'string' ? addFuri(p, ctx) : buildBlank(p, ctx)));
      items.push({ id: `u${SEC[key]}-${lk}-${i + 1}`, s: SEC[key], l: lk, ...(pt ? { pt } : {}), parts: built, uk, ...(x ? { x } : {}) });
    });
  }
  out.push({ lesson: lk, items });
}

// every kanji of the output must have a reading
for (const L of out) for (const it of L.items) {
  const check = s => { if (HAS_K.test(String(s).replace(/\{[^{}|]+\|[^{}]+\}/g, ''))) err(it.id, `kanji without reading: ${s}`); };
  for (const p of it.parts) {
    if (typeof p === 'string') check(p);
    else [...(p.a || []), ...(p.o || []), p.b || ''].forEach(check);
  }
}

if (REVIEW) console.log([...reviewed.entries()].map(([k, v]) => `${k}   ${v}`).join('\n'));
warns.forEach(w => console.log('WARN', w));
errors.forEach(e => console.log('ERR ', e));
const body = out.map(L => `{"lesson":${L.lesson},"items":[\n${L.items.map(i => JSON.stringify(i)).join(',\n')}\n]}`).join(',\n');
const count = {};
out.forEach(L => L.items.forEach(i => { count[i.s] = (count[i.s] || 0) + 1; }));
console.log(`lessons ${out.length}, items by section:`, count, `errors ${errors.length}, warnings ${warns.length}`);
if (errors.length) process.exit(1);
fs.writeFileSync(path.join(ROOT, 'site/data/exam-univ.json'), `{"lessons":[\n${body}\n]}\n`);
