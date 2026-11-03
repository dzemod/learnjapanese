// node tools/review-words.js [fromLesson toLesson] — automatic checks of site/data/sets.json (no changes, prints issues).
// Checks: kanji/kana consistency (okurigana), stray chars (ー/一, Latin, Cyrillic in kana), katakana/hiragana mixing,
// verb groups by the ます-form rules, Russian letters / Polivanov transcription in Ukrainian text, punctuation style.
const fs = require('fs'), path = require('path');
const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../site/data/sets.json'), 'utf8'));
const [from, to] = [+process.argv[2] || 0, +process.argv[3] || 50];
const HIRA = /[ぁ-ゟ]/, KATA = /[ァ-ヺ]/, KAN = /[㐀-鿿々〆]/;
const issues = [];
const add = (c, kind, msg) => issues.push({ id: c.id, kind, msg, kanji: c.kanji, kana: c.kana, uk: c.ukrainian, vg: c.verbGroup });
// i-row ichidan verbs (group II) that a naive rule would call group I
const II_I = new Set(['みます', 'います', 'きます', 'おきます', 'できます', 'おります', 'あびます', 'かります', 'たります', 'いきます', 'しんじます', 'おちます', 'のびます', 'すぎます', 'にます', 'ねます', 'でます', 'へます', 'きます']);
const E_ROW = /[えけげせぜてでねへべぺめれ]ます$/;
for (const s of d.sets) {
  const m = /^mnn-(\d+)$/.exec(s.id);
  if (!m || +m[1] < from || +m[1] > to) continue;
  for (const c of s.cards) {
    const k = c.kanji || '', a = c.kana || '';
    if (/[一]/.test(a)) add(c, 'ja', 'kana містить канджі 一 (мабуть ー)');
    if (KAN.test(a)) add(c, 'ja', 'kana містить канджі');
    if (/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(a)) add(c, 'ja', 'kana містить латиницю/кирилицю');
    if (/ー/.test(k) && /[㐀-鿿]ー|ー[㐀-鿿]/.test(k)) add(c, 'ja', 'ー поруч із канджі (мабуть 一)');
    if (HIRA.test(a) && KATA.test(a) && !/[〜～]/.test(a)) {
      // a word mixing scripts: flag single katakana inside hiragana word (OCR) – allow loanword + hiragana particle combos
      const runs = a.match(/[ァ-ヺ]+/g) || [];
      if (runs.some(r => r.length === 1)) add(c, 'ja', 'одинична катакана серед хірагани: ' + runs.join(','));
    }
    if (k) {
      // okurigana: kana parts of kanji spelling must appear in the reading in the same order
      for (const variant of k.split(/[、,／/・]/)) {
        const parts = variant.replace(/\s+/g, '').split(/[㐀-鿿々〆]+/).filter(Boolean);
        let pos = 0, ok = true;
        const rd = a.replace(/\s+/g, '');
        for (const p of parts) { const i = rd.indexOf(p, pos); if (i < 0) { ok = false; break; } pos = i + p.length; }
        if (!ok) { add(c, 'ja', `кана в написанні «${variant}» не збігається з читанням`); break; }
      }
    }
    const verb = (a.split(/[、,\s]/).pop() || '');
    if (/ます$/.test(verb)) {
      let g = 'I';
      if (/します$/.test(verb) || /^(きます|[ぁ-ゟ]*きます)$/.test(verb) && /(^|て|に)きます$/.test(verb) && (verb === 'きます' || /てきます$/.test(verb))) g = 'III';
      if (/します$/.test(verb) && !/(さ|は|か|だ|た|わ|な|ま|ら|が|ば|や)します$/.test(verb.slice(-4)) === false) g = 'III';
      if (g !== 'III' && (E_ROW.test(verb) || II_I.has(verb) || [...II_I].some(x => verb.endsWith(x) && x.length > 3))) g = 'II';
      if (/します$/.test(verb)) g = /(か|さ|な|は|ま|だ|ら|わ|が)します$/.test(verb) && !/(ます|はなします|さがします|かします|だします|かえします|なおします|おします|まわします|わたします|けします|なくします|おこします|もどします|ひっこします|すごします|てつだ|ゆるします|あらわします|ためします|こわします|ぬらします|ちらかします|ころします|へらします|ふやします|のばします|うごかします|わかします|さします|はずします|みなおします|てらします)$/.test(verb) ? 'III' : (/[ぁ-ゟ]{2,}します$/.test(verb) && !/^(はな|さが|か|だ|かえ|なお|お|まわ|わた|け|なく|おこ|もど|ひっこ|すご|ゆる|あらわ|ため|こわ|さ|はず|てら|うご|わか|まわ|ぬら|ちらか|ころ|へら|ふや|のば)します$/.test(verb.replace(/^.*\s/, '')) ? 'III?' : 'I');
      if (c.verbGroup && g !== c.verbGroup && !(g === 'III?' && c.verbGroup)) add(c, 'ja', `група ${c.verbGroup}, за правилом ${g}`);
      if (!c.verbGroup) add(c, 'ja', 'дієслово без групи');
    }
    const uk = c.ukrainian || '';
    if (/[ыэёъЫЭЁЪ]/.test(uk)) add(c, 'uk', 'російські літери');
    if (/'/.test(uk)) add(c, 'uk', 'прямий апостроф \' (треба ’)');
    if (/"/.test(uk)) add(c, 'uk', 'прямі лапки " (треба «»)');
    if (/\s-\s/.test(uk)) add(c, 'uk', 'дефіс замість тире');
    if (/(^|[^а-яіїєґ’])(си|ти|ши|чи|дзи|цу)[а-яіїє]*/i.test(uk) && /[А-ЯІЇЄ][а-яіїє]*(си|ши|чи)[а-яіїє]*/.test(uk)) add(c, 'tr', 'можлива транскрипція Полівановим');
    if (/\s{2,}/.test(uk) || /\s[,.;:]/.test(uk)) add(c, 'uk', 'зайві пробіли');
  }
}
const by = {};
issues.forEach(i => (by[i.kind] = (by[i.kind] || 0) + 1));
console.log(JSON.stringify(by));
for (const i of issues) console.log(`${i.id}\t${i.kind}\t${i.msg}\t${i.kanji}|${i.kana}|${i.vg}|${i.uk}`);
