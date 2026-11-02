// Rule-based analysis of a Japanese sentence (Перекладач tab).
// Input: Kuromoji (IPADIC) tokens + data/analyzer.json (Ukrainian explanations) + a meaning lookup.
// Output: word blocks (with dictionary form, reading, part of speech, conjugation steps), particle
// explanations, constructions matched against the grammar points of Minna no Nihongo, sentence
// structure and politeness level. Pure functions — no DOM — so tools/test-analyzer.mjs can run it in Node.

export const toHira = s => String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const KANJI = /[㐀-鿿々〆]/;
const has = (list, x) => !!list && list.includes(x);

// ---------- tokens ----------
const FORM = { // conjugated_form → short key used in analyzer.json
  '基本形': '基本', '連用形': '連用', '連用タ接続': '連用タ', '連用テ接続': 'く', '連用デ接続': '連用', '未然形': '未然', '未然ウ接続': '未然ウ',
  '未然ヌ接続': '未然', '未然レル接続': '未然', '仮定形': '仮定', '仮定縮約１': '仮定', '命令ｅ': '命令', '命令ｒｏ': '命令', '命令ｙｏ': '命令', '命令ｉ': '命令',
  '体言接続': '体言', 'ガル接続': '語幹', '連用ゴザイ接続': 'う', '文語基本形': '基本', '音便基本形': '基本',
};
function prep(t, i) {
  const r = t.reading && t.reading !== '*' ? t.reading : t.surface_form;
  return { ...t, i, kana: toHira(r), base: t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form, form: FORM[t.conjugated_form] || '' };
}

/** Key of a token inside a conjugation chain (matched against analyzer.json "steps"). */
function chainKey(t) {
  const s = t.surface_form;
  if (t.conjugated_type === '特殊・タ') return t.conjugated_form === '仮定形' ? 'たら' : 'た';
  if (t.conjugated_type === '特殊・ダ' || t.conjugated_type === '特殊・デス') return s; // だ な で なら だっ だろ / です でし でしょ
  if (t.pos === '助詞') {
    if (s === 'て' || s === 'で') return 'て';
    if (s === 'たり' || s === 'だり') return 'たり';
    if (s === 'ちゃ' || s === 'じゃ') return 'ちゃ';
    return s;
  }
  if (t.base === 'ない' && (t.pos === '助動詞' || t.pos === '形容詞')) {
    return { 'く': 'なく', '連用タ': 'なかっ', '仮定': 'なけれ' }[t.form] || (s === 'なく' ? 'なく' : 'ない');
  }
  if (t.pos === '名詞') return s; // そう, さ
  return t.base;
}

// ---------- blocks ----------
const CHAIN_HEADS = new Set(['verb', 'adj']);
function classify(t, D) {
  const p = t.pos, d = t.pos_detail_1;
  if (p === '名詞') {
    if (d === '代名詞') return 'pron';
    if (d === '固有名詞') return 'name';
    if (d === '数') return 'num';
    if (d === '形容動詞語幹') return 'na';
    if (d === 'ナイ形容詞語幹') return 'noun';
    if (d === '非自立' || d === '特殊') return 'formal';
    return 'noun';
  }
  if (p === '動詞') return 'verb';
  if (p === '形容詞') return 'adj';
  if (p === '副詞') return 'adv';
  if (p === '連体詞') return 'adn';
  if (p === '接続詞') return 'conj';
  if (p === '感動詞' || p === 'フィラー') return 'interj';
  if (p === '助詞') return 'particle';
  if (p === '助動詞') return t.base === 'だ' || t.base === 'です' ? 'copula' : 'aux';
  if (p === '記号') return 'punct';
  return 'other';
}

function attaches(b, t, next) {
  const p = t.pos, d = t.pos_detail_1, s = t.surface_form;
  if (b.cls === 'punct') return false;
  if (CHAIN_HEADS.has(b.cls)) {
    if (p === '助動詞') return true;
    if (p === '助詞' && d === '接続助詞' && ['て', 'で', 'ば', 'ちゃ', 'じゃ'].includes(s)) return true;
    if (p === '助詞' && (s === 'たり' || s === 'だり')) return true;
    if (p === '動詞' && (d === '非自立' || d === '接尾')) return true;
    if (p === '形容詞' && (d === '非自立' || d === '接尾') && b.cls === 'verb') return true;
    if (p === '形容詞' && t.base === 'ない' && b.cls === 'adj') return true;
    if (p === '名詞' && d === '接尾' && (s === 'そう' || s === 'さ')) return true;
    return false;
  }
  if (b.cls === 'na') {
    if (p === '助動詞' && t.base === 'だ' && (t.form === '体言' || t.form === '連用')) return true;
    if (p === '助詞' && d === '副詞化') return true;
    if (p === '名詞' && d === '接尾' && (s === 'そう' || s === 'さ')) return true;
    return false;
  }
  if (b.cls === 'copula' || b.cls === 'copneg') return p === '助動詞' && t.base !== 'だ' || (b.cls === 'copneg' && p === '形容詞' && t.base === 'ない');
  if (['noun', 'pron', 'name', 'num', 'formal'].includes(b.cls)) {
    if (p === '名詞' && d === '接尾') return true;
    return false;
  }
  return false;
}

function buildBlocks(toks, D) {
  const blocks = [];
  let prefix = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], prev = blocks.at(-1), next = toks[i + 1];
    if (t.pos === '接頭詞' && next && next.pos !== '記号') { prefix.push(t); continue; }
    // する-noun + する → one verb: 勉強 + します → 勉強します (dictionary form 勉強する)
    if (prev && !prefix.length && prev.toks.length === prev.pre + 1 && prev.head.pos_detail_1 === 'サ変接続' && t.pos === '動詞' && (t.base === 'する' || t.pos_detail_1 === '非自立')) {
      prev.cls = 'verb'; prev.suru = t.base === 'する'; prev.toks.push(t); continue;
    }
    // じゃ／では + ありません／ない → negative copula
    if ((t.surface_form === 'じゃ' || t.surface_form === 'では') && t.pos === '助詞' && next && (next.base === 'ある' || (next.base === 'ない' && next.pos !== '動詞'))) {
      blocks.push({ cls: 'copneg', toks: [...prefix, t], head: t, pre: prefix.length }); prefix = []; continue;
    }
    if (prev && !prefix.length && attaches(prev, t, next)) { prev.toks.push(t); continue; }
    blocks.push({ cls: classify(t, D), toks: [...prefix, t], head: t, pre: prefix.length });
    prefix = [];
  }
  if (prefix.length) blocks.push({ cls: 'other', toks: prefix, head: prefix[0], pre: 0 });
  return blocks;
}

/** Kana of the dictionary form, derived from the reading of the inflected head token. */
function baseKanaOf(h) {
  const s = h.surface_form, b = h.base;
  if (/^カ変/.test(h.conjugated_type || '')) return b.replace(/^(来|く)る$/, 'くる').replace(/来る$/, 'くる');
  let p = 0;
  while (p < s.length && p < b.length && s[p] === b[p]) p++;
  const sufS = toHira(s.slice(p)), sufB = toHira(b.slice(p));
  if (KANJI.test(sufB)) return h.kana;
  return h.kana.endsWith(sufS) ? h.kana.slice(0, h.kana.length - sufS.length) + sufB : h.kana;
}

function matchSteps(keys, list) {
  const out = [];
  let i = 0;
  while (i < keys.length) {
    let best = null;
    for (const st of list) {
      const n = st.seq.length;
      if (n > keys.length - i || (best && n <= best.seq.length)) continue;
      if (st.seq.every((k, j) => k === keys[i + j])) best = st;
    }
    if (best) { out.push(best); i += best.seq.length; } else i++;
  }
  return out;
}

const VGROUP = ct => /^五段/.test(ct) ? 'I' : /^一段/.test(ct) ? 'II' : /^(カ変|サ変)/.test(ct) ? 'III' : '';
const E2U = { 'え': 'う', 'け': 'く', 'げ': 'ぐ', 'せ': 'す', 'て': 'つ', 'ね': 'ぬ', 'べ': 'ぶ', 'め': 'む', 'れ': 'る' };

function describeBlock(b, D, lookup) {
  const t0 = b.toks[b.pre] || b.toks[0];
  b.surface = b.toks.map(t => t.surface_form).join('');
  b.kana = b.toks.map(t => t.kana).join('');
  b.head = t0;
  b.q = has(D.lexicon.question, t0.base) || has(D.lexicon.question, b.surface) || /^何/.test(t0.surface_form);
  const pre = b.toks.slice(0, b.pre).map(t => t.surface_form).join('');
  const preK = b.toks.slice(0, b.pre).map(t => t.kana).join('');
  if (b.suru) { b.base = pre + t0.surface_form + 'する'; b.baseKana = preK + t0.kana + 'する'; }
  else if (b.cls === 'verb' && t0.pos === '名詞') { b.base = pre + t0.surface_form; b.baseKana = preK + t0.kana; } // お待ち + ください
  else if (['verb', 'adj'].includes(b.cls)) { b.base = pre + t0.base; b.baseKana = preK + baseKanaOf(t0); }
  else if (b.cls === 'copula' || b.cls === 'copneg') { b.base = b.cls === 'copneg' ? 'じゃ ありません' : t0.base; b.baseKana = b.base; }
  else { b.base = pre + t0.surface_form + b.toks.slice(b.pre + 1).filter(t => t.pos === '名詞').map(t => t.surface_form).join(''); b.baseKana = preK + b.toks.slice(b.pre).filter(t => t.pos !== '助動詞' && t.pos !== '助詞').map(t => t.kana).join(''); }
  if (b.cls === 'na') { b.base = pre + t0.surface_form; b.baseKana = preK + t0.kana; }

  // part of speech
  const posKey = b.cls === 'noun' && t0.pos_detail_1 === '副詞可能' ? 'time' : b.cls === 'noun' && b.toks.some(t => t.pos_detail_2 === '助数詞') ? 'num' : b.cls;
  b.pos = (D.pos[posKey] || D.pos.other).label;
  b.posKey = posKey;
  if (b.q) b.posNote = D.pos.question.label;

  // meaning (my data first)
  const NOLOOK = ['particle', 'punct', 'copula', 'copneg', 'aux'];
  b.meaning = lookup && !NOLOOK.includes(b.cls) ? lookup(b.base, b.baseKana, { strict: true }) : null;
  if (b.meaning?.reading && b.meaning.exact && !['verb', 'adj'].includes(b.cls) && b.toks.length === 1 && KANJI.test(b.surface)) b.kana = b.baseKana = b.meaning.reading;

  // conjugation steps
  b.steps = [];
  if (b.cls === 'verb' || b.cls === 'adj' || b.cls === 'copula' || b.cls === 'copneg' || b.cls === 'na') {
    const headIdx = b.suru || (b.cls === 'verb' && t0.pos === '名詞') ? b.pre + 1 : b.pre;
    const h = b.toks[headIdx] || t0;
    const keys = b.cls === 'copneg' ? ['@じゃ'] : b.cls === 'na' ? ['@語幹'] : b.cls === 'copula' ? ['@' + h.surface_form] : ['@' + (h.form || '基本')];
    b.toks.slice(headIdx + 1).forEach(t => keys.push(chainKey(t)));
    if (b.cls === 'verb' && keys.length > 1) keys.shift(); // verbs: the form is shown by what follows (ます, た, ない…); the head key only for a bare form
    const list = D.steps[b.cls === 'copneg' ? 'copula' : b.cls] || [];
    b.keys = keys;
    b.steps = matchSteps(keys, list);
    if (b.cls === 'verb') {
      b.group = b.suru ? 'III' : VGROUP(h.conjugated_type || '');
      // potential verb (書ける ← 書く): II-group verb unknown to my data whose I-group partner is known
      const bk = b.baseKana || '';
      const e = bk.slice(-2, -1);
      if (lookup && b.group === 'II' && !b.meaning && E2U[e] && bk.endsWith('る')) {
        const godanK = bk.slice(0, -2) + E2U[e];
        const godan = (b.base.endsWith('る') && E2U[toHira(b.base.slice(-2, -1))] ? b.base.slice(0, -2) + E2U[toHira(b.base.slice(-2, -1))] : godanK);
        const m = lookup(godan, godanK, { strict: true });
        if (m) { b.potentialOf = { base: godan, kana: godanK }; b.meaning = m; b.steps.unshift(D.potential); }
      }
    }
  }
  // last resort: the same word written in kana in my data (分かる ↔ わかります) — marked as approximate
  if (!b.meaning && lookup && !NOLOOK.includes(b.cls)) { const m = lookup(b.base, b.baseKana, { strict: false }); if (m) b.meaning = { ...m, approx: true }; }
  return b;
}

// ---------- particles ----------
const isNounish = b => b && ['noun', 'pron', 'name', 'num', 'formal', 'na'].includes(b.cls);
function nextPred(blocks, i) {
  for (let j = i + 1; j < blocks.length; j++) {
    const b = blocks[j];
    if (b.cls === 'punct' && /[。！？!?]/.test(b.surface)) return null;
    if (b.cls === 'verb' || b.cls === 'adj') return b;
    if (b.cls === 'na' && blocks[j + 1] && ['copula', 'copneg'].includes(blocks[j + 1].cls)) return b;
    if (b.cls === 'na' && (!blocks[j + 1] || blocks[j + 1].cls === 'punct' || blocks[j + 1].cls === 'particle')) return b;
  }
  return null;
}
function prevContent(blocks, i) { for (let j = i - 1; j >= 0; j--) if (blocks[j].cls !== 'punct') return blocks[j]; return null; }
const endsWithSuffix = (b, list) => b && list.some(s => b.surface.endsWith(s));

function chooseUse(blocks, i, D) {
  const b = blocks[i], s = b.surface, L = D.lexicon, t = b.head, d1 = t.pos_detail_1, d2 = t.pos_detail_2;
  const prev = prevContent(blocks, i), next = blocks[i + 1], pred = nextPred(blocks, i);
  const pb = pred?.base || '', isNeg = pred && pred.keys?.some(k => /^(ない|なかっ|ん|なく|なけれ)$/.test(k));
  const timeWord = prev && (has(L.time, prev.base) || prev.posKey === 'time' || endsWithSuffix(prev, L.timeSuffix));
  const numWord = prev && (prev.cls === 'num' || prev.posKey === 'num');
  const prevP = prev && prev.cls === 'particle' ? prev.surface : '';
  switch (s) {
    case 'は':
      if (prevP) return 'afterParticle';
      if (numWord) return 'number';
      if (blocks.slice(0, i).some(x => x.cls === 'particle' && x.surface === 'は' && x !== b)) return 'contrast';
      if (prev && blocks.slice(0, i).some(x => x.cls === 'particle' && x.surface === 'を')) return 'contrast';
      return 'topic';
    case 'が':
      if (d1 === '接続助詞') return 'but';
      if (prev?.q) return 'question';
      if (pred && (pb === 'ある' || pb === '有る') && !blocks.slice(0, i).some(x => x.cls === 'particle' && x.surface === 'に')) return 'object';
      if (pred && (has(L.gaObject, pb) || pred.potentialOf || pred.keys?.includes('たい'))) return 'object';
      if (pred && pred !== lastPred(blocks) && isClauseEnd(blocks, pred)) return 'clause';
      if (pred && has(L.exist, pb)) return 'exist';
      return 'subject';
    case 'を':
      if (pred && has(L.moveThrough, pb)) return 'through';
      if (pred && has(L.leave, pb)) return 'leave';
      return 'object';
    case 'に':
      if (prevP === 'まで') return 'byTime';
      if ((prev?.cls === 'verb' && prev.keys?.[0] === '@連用') || (prev?.cls === 'noun' && prev.head.pos_detail_1 === 'サ変接続' && pred && has(L.goCome, pb))) return 'purpose';
      if (pred && pred.keys?.some(k => k === 'れる' || k === 'られる') && !pred.potentialOf) return 'agent';
      if (pred && pred.keys?.some(k => k === 'せる' || k === 'させる')) return 'causee';
      if (timeWord) return 'time';
      if (numWord && blocks.slice(i + 1).some(x => /回/.test(x.surface))) return 'per';
      if (pred && (pb === 'なる' || pb === 'する')) return pb === 'なる' ? 'become' : 'decide';
      if (pred && has(L.exist, pb)) return 'exist';
      if (pred && has(L.give, pb)) return 'recipient';
      if (pred && has(L.receive, pb)) return 'source';
      if (pred && has(L.goCome, pb)) return 'destination';
      if (pred && has(L.enter, pb)) return 'target';
      if (pred && has(L.meet, pb)) return 'partner';
      return 'target';
    case 'へ':
      return 'direction';
    case 'で':
      if (numWord || has(L.total, prev?.base)) return 'total';
      if (prev && has(L.transport, prev.base)) return 'transport';
      if (prev && (has(L.tool, prev.base) || /語$/.test(prev.base))) return 'tool';
      if (prev && has(L.cause, prev.base)) return 'cause';
      if (prev && has(L.material, prev.base)) return 'material';
      if (blocks.some(x => /いちばん|一番/.test(x.surface))) return 'scope';
      if (pred && has(L.exist, pb) && prev && has(L.event, prev.base)) return 'event';
      if (pred && pb === 'ある') return 'event';
      return 'place';
    case 'と':
      if (d1 === '接続助詞') return 'if';
      if (d2 === '引用' || (pred && has(L.quote, pb) && (!prev || !isNounish(prev) || /[」』]/.test(prev.surface)))) return 'quote';
      if (d1 === '並立助詞' || (next && isNounish(next) && blocks[i + 2]?.cls === 'particle')) return 'and';
      return 'with';
    case 'も':
      if (prev?.q) return isNeg ? 'none' : 'every';
      if (numWord) return 'many';
      if (prevP) return 'afterParticle';
      if (prev && prev.cls === 'verb' && prev.keys?.at(-1) === 'て') return 'temo';
      return 'also';
    case 'の':
      return isNounish(next) ? 'attr' : 'pronoun';
    case 'か':
      if (prev?.q && next && next.cls !== 'punct') return 'some';
      if (!next || next.cls === 'punct' && /[。？?！!]/.test(next.surface) || (next.cls === 'particle' && /^(ね|よ)$/.test(next.surface))) return 'question';
      if (next && next.head.base === 'どう') return 'whether';
      if (blocks.slice(i + 1).some(x => x.cls === 'particle' && x.surface === 'か')) return 'or';
      if (prev && ['verb', 'adj', 'copula', 'na'].includes(prev.cls)) return 'embedded';
      return 'or';
    case 'から':
      if (d1 === '接続助詞') return 'because';
      if (prev?.cls === 'verb' && prev.keys?.at(-1) === 'て') return 'after';
      if (pred && has(L.make, pb)) return 'material';
      return 'from';
    case 'でも':
      return prev && isNounish(prev) ? 'example' : 'evenIf';
    default:
      return 'default';
  }
}
function lastPred(blocks) { for (let j = blocks.length - 1; j >= 0; j--) if (['verb', 'adj', 'copula', 'copneg', 'na'].includes(blocks[j].cls)) return blocks[j]; return null; }
function isClauseEnd(blocks, pred) {
  const j = blocks.indexOf(pred), n = blocks[j + 1];
  return n && (isNounish(n) || (n.cls === 'particle' && /^(と|から|ので|のに|けど|が|し|ば)$/.test(n.surface)));
}

function particleInfo(blocks, i, D) {
  const b = blocks[i];
  const def = D.particles[b.surface];
  if (!def) return null;
  const useId = chooseUse(blocks, i, D);
  const use = def.uses[useId] || def.uses.default || Object.values(def.uses)[0];
  if (!use) return null;
  // phrase the particle attaches to
  let j = i - 1;
  while (j >= 0 && blocks[j].cls === 'particle' && blocks[j].surface !== 'の') j--;
  const start = phraseStart(blocks, j);
  const phrase = blocks.slice(start, j + 1).map(x => x.surface).join('');
  const pred = nextPred(blocks, i);
  const fill = s => String(s || '').replace(/\{w\}/g, phrase || '…').replace(/\{v\}/g, pred ? pred.base : '…');
  return { i, p: b.surface, name: def.name, use: useId, label: use.label, text: fill(use.text), point: use.point || def.point || '', role: use.role || '', gloss: use.gloss || '', phrase, start, end: j };
}
function phraseStart(blocks, j) {
  let k = j;
  while (k > 0) {
    const pb = blocks[k - 1];
    if (pb.cls === 'punct' || pb.cls === 'conj' || pb.cls === 'interj') break;
    if (pb.cls === 'particle' && !(pb.surface === 'の' || pb.surface === 'や' || pb.surface === 'と' && isNounish(blocks[k - 2]))) break;
    if (['verb', 'adj', 'copula'].includes(pb.cls) && !isNounish(blocks[k])) break;
    k--;
  }
  return Math.max(0, k);
}

// ---------- constructions ----------
const TAGS = {
  V: 'vx?', VI: 'v', VX: 'vx', A: 'ax?', AX: 'ax', N: '(?:n|nx|nm|pr|q|nn)', NX: 'nx', NUM: 'nm', NA: 'na', P: 'p', X: 'x', D: 'd', Q: 'q', ADN: 'adn', C: 'c', S: 's', PRE: 'pre', ANY: '[a-z]+',
};
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = s => '(?:' + s.split('|').map(reEsc).join('|') + ')';
export function compilePattern(pattern) {
  const src = pattern.replace(/<([^<>]*)>/g, (_, body) => {
    if (body === '*') return '(?:‹[^›]*›)';
    let m = body.match(/^([A-Z]+)?(?::([^=~]+))?(?:=([^~]+))?(?:~(.+))?$/);
    if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) m = [null, null, null, null, body];
    const [, tag, form, base, kana] = m;
    if (tag && !TAGS[tag]) throw new Error('Unknown tag ' + tag + ' in ' + pattern);
    return `(?:‹${kana ? alt(kana) : '[^·›]*'}·${tag ? TAGS[tag] : '[a-z]+'}·${base ? alt(base) : '[^·›]*'}·${form ? alt(form) : '[^·›]*'}›)`;
  });
  return new RegExp(src, 'g');
}
function tokenTag(t, b, D) {
  const p = t.pos, d = t.pos_detail_1;
  if (has(D.lexicon.question, t.base) || /^何/.test(t.surface_form) && p === '名詞') return 'q';
  if (p === '名詞') return d === '数' ? 'nm' : d === '形容動詞語幹' ? 'na' : d === '非自立' || d === '接尾' || d === '特殊' ? 'nx' : d === '代名詞' ? 'pr' : 'n';
  if (p === '動詞') return d === '非自立' || d === '接尾' ? 'vx' : 'v';
  if (p === '形容詞') return d === '非自立' || d === '接尾' ? 'ax' : 'a';
  return { '助詞': 'p', '助動詞': 'x', '副詞': 'd', '連体詞': 'adn', '接続詞': 'c', '記号': 's', '接頭詞': 'pre', '感動詞': 'i', 'フィラー': 'i' }[p] || 'o';
}
function tokenString(toks, D) {
  let str = '';
  const at = [];
  for (const t of toks) {
    at.push(str.length);
    str += `‹${t.kana.replace(/[‹›·]/g, '')}·${tokenTag(t, null, D)}·${String(t.base).replace(/[‹›·]/g, '')}·${t.form || '-'}›`;
  }
  at.push(str.length);
  return { str, at };
}
const compiled = new WeakMap();
function findConstructions(toks, D) {
  const { str, at } = tokenString(toks, D);
  const out = [];
  let list = compiled.get(D);
  if (!list) {
    list = (D.constructions || []).map(c => { try { return { c, re: compilePattern(c.pattern) }; } catch (e) { console.warn(e.message); return null; } }).filter(Boolean);
    compiled.set(D, list);
  }
  for (const { c, re } of list) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(str))) {
      if (!m[0]) { re.lastIndex++; continue; }
      const from = at.findIndex(x => x >= m.index), to = at.findIndex(x => x >= m.index + m[0].length) - 1;
      out.push({ ...c, from, to, match: toks.slice(from, to + 1).map(t => t.surface_form).join('') });
      if (c.once !== false) break;
    }
  }
  // the same grammar point found twice (e.g. two patterns) → keep the longer match; drop constructions hidden by a "hides" list
  const hidden = new Set(out.flatMap(c => c.hides || []));
  return out.filter(c => !hidden.has(c.id)).sort((a, b) => a.from - b.from || b.to - a.to);
}

// ---------- structure & politeness ----------
function structure(blocks, parts, D) {
  const rows = [];
  for (const p of parts) {
    if (!p.role || p.start > p.end) continue;
    rows.push({ role: p.role, label: D.roles[p.role] || p.role, text: blocks.slice(p.start, p.end + 1).map(x => x.surface).join('') + p.p, from: p.start, to: p.i });
  }
  // time words without a particle (今日、毎朝、来週…)
  blocks.forEach((b, i) => {
    const n = blocks[i + 1];
    if ((b.posKey === 'time' || has(D.lexicon.time, b.base)) && (!n || n.cls !== 'particle') && !rows.some(r => i >= r.from && i <= r.to)) rows.push({ role: 'time', label: D.roles.time, text: b.surface, from: i, to: i });
  });
  // predicate: the last verb / adjective / copula chain (+ the noun or な-adjective before the copula)
  let e = blocks.length - 1;
  while (e >= 0 && (blocks[e].cls === 'punct' || (blocks[e].cls === 'particle' && /^(か|ね|よ|わ|な|かな|の|ぞ|ぜ)$/.test(blocks[e].surface)))) e--;
  let s = e;
  if (s >= 0 && ['copula', 'copneg'].includes(blocks[s].cls)) {
    while (s > 0 && (isNounish(blocks[s - 1]) || blocks[s - 1].cls === 'adj' || blocks[s - 1].cls === 'verb' || (blocks[s - 1].cls === 'particle' && blocks[s - 1].surface === 'の'))) {
      s--;
      if (blocks[s].cls === 'verb' || blocks[s].cls === 'adj') break;
    }
  }
  // ～く なります／～に なります: the adverbial adjective belongs to the predicate
  if (s > 0 && blocks[s].cls === 'verb' && ((blocks[s - 1].cls === 'adj' && blocks[s - 1].keys?.[0] === '@く' && blocks[s - 1].keys.length === 1) || (blocks[s - 1].cls === 'na' && blocks[s - 1].keys?.[1] === 'に'))) s--;
  if (e >= 0 && ['verb', 'adj', 'copula', 'copneg', 'na', 'noun', 'formal'].includes(blocks[e].cls)) {
    rows.push({ role: 'predicate', label: D.roles.predicate, text: blocks.slice(s, e + 1).map(x => x.surface).join(''), from: s, to: e });
  }
  return rows.sort((a, b) => a.from - b.from);
}

function politeness(blocks, D) {
  const L = D.lexicon;
  const hon = blocks.find(b => b.cls === 'verb' && (has(L.sonkei, b.base) || /^お.+になる$/.test(b.base)));
  const hum = blocks.find(b => b.cls === 'verb' && has(L.kenjo, b.base));
  const keys = blocks.flatMap(b => b.keys || []);
  const polite = keys.some(k => k === 'ます' || k === '@です' || k === 'です') || blocks.some(b => b.cls === 'copula' && b.base === 'です') || blocks.some(b => b.cls === 'copneg' && b.keys?.includes('ます'));
  const out = [];
  if (hon) out.push({ ...D.politeness.sonkei, word: hon.surface });
  if (hum) out.push({ ...D.politeness.kenjo, word: hum.surface });
  out.push(polite ? D.politeness.polite : D.politeness.plain);
  return out;
}

// ---------- literal (word-by-word) translation ----------
const firstMeaning = m => String(m || '').replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, '').split(/[;,；]/)[0].trim();
export function literal(res) {
  const out = [];
  res.blocks.forEach((b, i) => {
    if (b.cls === 'punct') { if (/[。！？!?]/.test(b.surface)) out.push(b.surface.replace('。', '.').replace('？', '?').replace('！', '!')); return; }
    if (b.cls === 'particle') { const p = res.particles.find(x => x.i === i); if (p?.gloss) out.push(p.gloss); return; }
    if (b.cls === 'copula' || b.cls === 'copneg') { const g = b.steps.map(s => s.gloss).filter(Boolean).join(', '); out.push(g || (b.cls === 'copneg' ? '(не є)' : '(є)')); return; }
    let w = b.meaning ? firstMeaning(b.meaning.uk) : '';
    if (!w) w = b.surface;
    const tags = b.steps.map(s => s.gloss).filter(Boolean);
    out.push(tags.length ? `${w} (${tags.join(', ')})` : w);
  });
  return out.join(' ').replace(/\s+([.?!])/g, '$1');
}

// ---------- main ----------
/** Split Kuromoji tokens into sentences and analyse each. */
export function analyzeText(rawTokens, D, lookup) {
  const toks = rawTokens.map(prep);
  const sentences = [];
  let cur = [];
  toks.forEach((t, i) => {
    cur.push(t);
    if (t.pos === '記号' && /^[。！？!?]+$/.test(t.surface_form)) { sentences.push(cur); cur = []; }
  });
  if (cur.some(t => t.pos !== '記号' || !/^\s+$/.test(t.surface_form))) sentences.push(cur);
  return sentences.filter(s => s.some(t => t.pos !== '記号')).map(s => analyzeSentence(s, D, lookup));
}

export function analyzeSentence(toks, D, lookup) {
  toks = toks.filter(t => !/^\s+$/.test(t.surface_form));
  const blocks = buildBlocks(toks, D).map(b => describeBlock(b, D, lookup));
  const particles = [];
  blocks.forEach((b, i) => {
    if (b.cls !== 'particle') return;
    const info = particleInfo(blocks, i, D);
    if (info) { particles.push(info); b.particle = info; }
  });
  const constructions = findConstructions(toks, D);
  // token index → block index (to highlight constructions)
  const tb = [];
  blocks.forEach((b, bi) => b.toks.forEach(t => (tb[toks.indexOf(t)] = bi)));
  constructions.forEach(c => { c.bFrom = tb[c.from]; c.bTo = tb[c.to]; });
  const text = toks.map(t => t.surface_form).join('');
  const res = { text, kana: blocks.map(b => b.kana).join(''), blocks, particles, constructions, structure: structure(blocks, particles, D), politeness: politeness(blocks, D) };
  res.literal = literal(res);
  return res;
}

/** Point id "17-3" → { lesson: 17, n: 3, ref: "Minna no Nihongo, Урок 17, п. 3", href } */
export function pointRef(id) {
  const m = /^(\d+)-(\d+)$/.exec(id || '');
  if (!m) return null;
  return { lesson: +m[1], n: +m[2], ref: `Minna no Nihongo, Урок ${m[1]}, п. ${m[2]}`, href: `#/grammar/${m[1]}/${id}` };
}
