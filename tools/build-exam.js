// Builds the pre-made exam bank site/data/exam.json from site/data/grammar.json (examples, 文型, 例文 with translations).
//   npm i --no-save kuromoji@0.1.2      (free, open-source tokenizer — only needed to run this script)
//   node tools/build-exam.js <fromLesson> <toLesson>
// Lessons in the range are (re)generated; other lessons in exam.json are kept.
// Every item has: lesson (l), grammar point (pt), explanation (x) based on IV. Граматика, and a reference (shown by the site).
const fs = require('fs'), path = require('path');
const kuromoji = require(process.env.KUROMOJI || 'kuromoji');
const ROOT = path.join(__dirname, '..');
const [from, to] = [+process.argv[2] || 1, +process.argv[3] || 50];
const grammar = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/grammar.json'), 'utf8')).lessons;
const pointById = new Map();
for (const l of grammar) l.points.forEach((p, i) => pointById.set(p.id, { ...p, lesson: l.lesson, n: i + 1 }));
const has = id => pointById.has(id);

// ---------- markup helpers: {漢字|かんじ} ----------
function segs(markup) {
  const out = [], re = /\{([^{}|]+)\|([^{}]+)\}/g;
  let i = 0, m;
  while ((m = re.exec(markup))) {
    if (m.index > i) for (const ch of markup.slice(i, m.index)) out.push({ t: ch });
    out.push({ t: m[1], r: m[2] });
    i = re.lastIndex;
  }
  for (const ch of markup.slice(i)) out.push({ t: ch });
  return out;
}
/** Markup / plain / kana for the plain-text span [a, b). Spans that cut a {kanji|reading} group take the whole group. */
function span(sg, a, b) {
  let pos = 0, mk = '', pl = '', kana = '';
  for (const s of sg) {
    const s0 = pos, s1 = pos + s.t.length;
    pos = s1;
    if (s1 <= a || s0 >= b) continue;
    mk += s.r ? `{${s.t}|${s.r}}` : s.t;
    pl += s.t; kana += s.r || s.t;
  }
  return { mk, pl, kana };
}
const clean = s => String(s)
  .replace(/\((では|が|へ|から|↗|↘|に)\)/g, '').replace(/[\[\]]/g, '').replace(/\b[AB]: ?/g, '')
  .replace(/\s+/g, ' ').trim();

// ---------- particle explanations (paraphrased strictly from IV. Граматика) ----------
const NOUN = t => t && t.pos === '名詞';
const QW = ['何', 'なに', 'なん', 'だれ', 'どこ', 'いつ', 'どちら', 'どれ', 'どなた'];
const nextVerb = (toks, i) => { for (let j = i + 1; j < toks.length; j++) { if (toks[j].pos === '動詞' && toks[j].pos_detail_1 === '自立') return toks[j]; if (toks[j].surface_form === '。' || toks[j].surface_form === '、') break; } return null; };
const nextWords = (toks, i, n = 6) => toks.slice(i + 1, i + 1 + n).map(t => t.basic_form);
const TRANSPORT = ['電車', 'バス', 'タクシー', '新幹線', '車', '自転車', '地下鉄', '飛行機', '船', 'でんしゃ', 'くるま'];
const TOOLS = ['はし', 'ボールペン', 'パソコン', 'テレビ', 'ラジオ', 'カード', '現金', '英語', '日本語', '中国語', 'ファックス', 'メール', '辞書', '電話', '手', 'ナイフ', 'フォーク'];
function explainParticle(toks, i, L) {
  const t = toks[i], p = t.surface_form, prev = toks[i - 1], next = toks[i + 1];
  const v = nextVerb(toks, i), vb = v?.basic_form || '';
  const words = nextWords(toks, i);
  const R = (pt, x) => (has(pt) && pointById.get(pt).lesson <= L ? { pt, x } : null);
  if (prev && prev.pos === '助詞') return null; // compound particles (では, には…) are not drilled
  switch (p) {
    case 'は':
      if (t.pos_detail_1 !== '係助詞') return null;
      return R('1-1', 'Частка は вказує на тему речення: спочатку називають іменник, про який ідеться, а потім — твердження щодо нього.');
    case 'も':
      if (prev && QW.includes(prev.surface_form)) return R('5-2', 'Питальне слово + も + заперечна форма дієслова заперечує все, на що вказує питальне слово (нікуди, нічого, ніхто).');
      return R('1-4', 'も ставиться після теми замість は, якщо про неї стверджується те саме, що й про тему попереднього речення («також»).');
    case 'の':
      if (t.pos_detail_1 !== '連体化') return null;
      if (next && ['です', 'じゃ', 'だ', 'では'].includes(next.surface_form)) return R('2-5', 'の поєднує два іменники; якщо з контексту зрозуміло, про що йдеться, ІМ₂ після の можна випустити («わたしの» — «мій»).');
      return R('1-5', 'Частка の поєднує два іменники: ІМ₁ є означенням для ІМ₂ (приналежність, організація, тема, країна чи фірма-виробник).');
    case 'か':
      if (prev && ['何', 'なに', 'どこ'].includes(prev.surface_form) && next && next.surface_form !== '。') return R('13-5', 'どこか означає «десь, кудись», なにか — «щось»; частки へ та を після них можна випустити.');
      if (!next || ['。', '？', '?'].includes(next.surface_form)) return R('1-3', 'Частка か в кінці речення робить його питанням; порядок слів не змінюється.');
      if (next.surface_form === '、') return R('2-4', 'РЕЧ₁か、РЕЧ₂か — питання з вибором: співрозмовнику пропонують вибрати один із варіантів.');
      return null;
    case 'を':
      if (t.pos_detail_1 !== '格助詞') return null;
      if (['出る', '降りる', 'でる', 'おりる'].includes(vb)) return R('13-4', 'Частка を позначає відправну точку (вихідне місце) з такими дієсловами, як でます, おります.');
      if (['渡る', '散歩', '歩く', '曲がる', 'わたる', 'まがる', 'あるく'].includes(vb) || words.includes('散歩')) return R('23-5', 'Частка を з дієсловами руху (さんぽします, わたります, まがります) позначає місце, яким пересуваються.');
      return R('6-1', 'Частка を позначає прямий додаток перехідного дієслова.');
    case 'へ':
      return R('5-1', 'Частка へ після назви місця вказує напрямок руху з いきます／きます／かえります. (Читається як «え».)');
    case 'で':
      if (t.pos_detail_1 !== '格助詞') return null;
      if (prev && TRANSPORT.includes(prev.surface_form)) return R('5-3', 'Частка で після назви транспорту вказує засіб пересування (で — спосіб дії).');
      if (prev && (TOOLS.includes(prev.surface_form) || /語$/.test(prev.surface_form))) return R('7-1', 'Частка で вказує на знаряддя чи спосіб, за допомогою якого виконується дія (мова, інструмент).');
      if (prev && ['一人', 'ひとり', 'みんな', '自分'].includes(prev.surface_form)) return R('5-4', 'ひとりで — «сам, наодинці»; частка と у такому разі не використовується.');
      if (prev && ['会議', 'パーティー', '試合'].includes(prev.surface_form)) return R('21-5', 'Частка で позначає ситуацію (подію), у якій відбувається дія.');
      if (toks.some(x => x.surface_form === 'いちばん')) return R('12-5', 'ІМ₁ で … いちばん — вибір з групи чи категорії ІМ₁; група позначається часткою で.');
      return R('6-5', 'Частка で після іменника зі значенням місця вказує на місце, де відбувається дія.');
    case 'に': {
      if (t.pos_detail_1 !== '格助詞') return null;
      if (['なる'].includes(vb)) return R('19-4', 'ІМ に なります — «ставати»; перед なります іменник і な-прикметник беруть に.');
      if (['あげる', '貸す', '教える', 'かける', '送る', 'おくる', 'かす', 'おしえる', '書く', '出す', 'くれる'].includes(vb)) return R('7-3', 'З дієсловами あげます, かします, おしえます тощо частка に вказує на людину, якій щось дають, позичають, викладають.');
      if (['もらう', '借りる', '習う', 'かりる', 'ならう'].includes(vb)) return R('7-4', 'З もらいます, かります, ならいます частка に вказує на особу, від якої отримують щось.');
      if (['ある', 'いる'].includes(vb) && v?.pos_detail_1 === '自立') return R('10-2', 'Частка に позначає місцезнаходження: ІМ (місце) に ІМ が あります／います.');
      if (['入る', '乗る', 'はいる', 'のる'].includes(vb)) return R('13-4', 'Частка に позначає мету (куди) з такими дієсловами, як はいります, のります.');
      if (['行く', '来る', '帰る', 'いく', 'くる', 'かえる'].includes(vb) && prev && (prev.pos === '動詞' || ['買い物', '散歩', '勉強', '食事', '祭り', 'スキー', '見学', '迎え', '旅行', '出張'].includes(prev.surface_form))) return R('13-3', 'ДІЄСЛ ます-форма／ІМ + に いきます／きます／かえります — частка に позначає мету руху.');
      if (prev && (prev.pos_detail_1 === '接尾' || /(時|分|日|月|年|曜日|半)$/.test(prev.surface_form)) && toks.slice(i + 1).some(x => /回$/.test(x.surface_form))) return R('11-2', 'Період に кількість 回 — частота дії (наприклад, «двічі на місяць»).');
      if (prev && (/(時|分|日|月|年|曜日|半)$/.test(prev.surface_form) || prev.pos_detail_2 === '助数詞')) return R('4-4', 'Частка に позначає час одноразової дії, коли в обставині часу є числівник (з днями тижня — за бажанням).');
      return null;
    }
    case 'と':
      if (['言う', '思う', 'いう', 'おもう'].includes(next?.basic_form)) return next.basic_form.match(/言|いう/) ? R('21-2', 'Частка と позначає зміст сказаного (цитату) перед いいます.') : R('21-1', 'Частка と позначає зміст думки перед おもいます.');
      if (prev && prev.pos === '動詞' && prev.conjugated_form === '基本形') return R('23-3', 'ДІЄСЛ словникова форма と、～ — після цієї дії неминуче відбувається інша.');
      if (toks.some(x => x.surface_form === 'どちら')) return R('12-4', 'ІМ₁ と ІМ₂ と どちらが … — вибір з двох; предмети поєднуються часткою と.');
      if (prev && NOUN(prev) && v && !(next && NOUN(next))) return R('5-4', 'Частка と після іменника-особи означає «з, разом з».');
      if (prev && NOUN(prev) && next && NOUN(next)) return R('4-6', 'Частка と поєднує два іменники сурядним зв’язком («і»), перелічуючи всі предмети.');
      return null;
    case 'から':
      if (t.pos_detail_1 === '接続助詞') {
        if (prev && prev.surface_form === 'て' || prev?.surface_form === 'で') return R('16-4', 'ДІЄСЛ₁ て-форма から、ДІЄСЛ₂ — дія ДІЄСЛ₂ відбувається після закінчення ДІЄСЛ₁.');
        return R('9-4', 'Частка から поєднує два речення з причинно-наслідковим зв’язком: РЕЧ₁ — причина («тому що»).');
      }
      if (['もらう', '借りる'].includes(vb)) return R('7-4', 'Замість に можна вжити から — «від кого/чого отримують»; від організацій — лише から.');
      return R('4-5', 'Частка から вказує на місце або час, з якого починається дія.');
    case 'まで':
      if (next && next.surface_form === 'に') return R('17-6', 'までに вказує на крайній термін, до якого має бути виконана дія.');
      return R('4-5', 'Частка まで вказує на місце або час, у якому дія закінчується.');
    case 'や':
      return R('10-5', 'Частка や з’єднує іменники, називаючи лише декілька з ряду (на відміну від と, яка перелічує всі).');
    case 'ね':
      if (next && !['。', '？'].includes(next.surface_form)) return null;
      return R('4-7', 'Частка ね в кінці речення передає сподівання на згоду співрозмовника чи підтвердження сказаного ним.');
    case 'よ':
      if (next && !['。', '？'].includes(next.surface_form)) return null;
      return R('5-6', 'Частка よ в кінці речення виділяє нову для співрозмовника інформацію або впевненість мовця.');
    case 'が':
      if (t.pos_detail_1 === '接続助詞') {
        if (prev && ['すみません', '失礼'].some(w => toks.slice(0, i).map(x => x.surface_form).join('').includes(w))) return R('14-7', 'У виразах すみませんが, しつれいですが частка が лише з’єднує вставну фразу з реченням.');
        return R('8-7', 'Сполучна частка が («але», «однак») поєднує два речення.');
      }
      if (prev && QW.includes(prev.surface_form)) return R('24-4', 'Якщо питальне слово є підметом, після нього ставиться が.') || R('12-5', 'Якщо питальне слово виконує роль підмета, використовується частка が.');
      if (['わかる', '好き', '嫌い', '上手', '下手', 'できる', '欲しい', 'ほしい', 'ある'].some(w => words.includes(w)) && words.indexOf('ある') !== 0 && i > 0 && toks.slice(0, i).some(x => x.surface_form === 'は')) {
        if (words.includes('欲しい') || words.includes('ほしい')) return R('13-1', 'ІМ が ほしいです — об’єкт бажання позначається часткою が.');
        if (words.includes('できる')) return R('18-2', 'ІМ／ДІЄСЛ こと が できます — зміст можливості позначається часткою が.');
        return R('9-1', 'Додатки до あります, わかります, すきです, じょうずです тощо оформляються часткою が.');
      }
      if (['ある', 'いる'].includes(vb)) return R('10-1', 'Підмет у реченні з あります／います (наявність предмета чи істоти) позначається часткою が.');
      if (['降る'].includes(vb)) return R('14-8', 'У реченнях про природні явища підмет позначається часткою が.');
      return null;
    default: return null;
  }
}
const PART_ALT = { 'は': ['が', 'も'], 'が': ['は', 'も'], 'も': ['は', 'が'], 'に': ['へ'], 'へ': ['に'], 'から': ['に'] };
const WRONG = { 'は': 'を', 'が': 'を', 'も': 'を', 'を': 'に', 'に': 'を', 'へ': 'を', 'で': 'を', 'の': 'を', 'と': 'を', 'から': 'を', 'まで': 'を', 'や': 'を', 'か': 'を' };

// ---------- verbs ----------
const GROUP = ct => (/^五段/.test(ct) ? 'I' : /^一段/.test(ct) ? 'II' : /^(サ変|カ変)/.test(ct) ? 'III' : null);
const U2I = { 'う': 'い', 'く': 'き', 'ぐ': 'ぎ', 'す': 'し', 'つ': 'ち', 'ぬ': 'に', 'ぶ': 'び', 'む': 'み', 'る': 'り' };
function masuOf(dict, g) {
  if (g === 'I') return U2I[dict.slice(-1)] ? dict.slice(0, -1) + U2I[dict.slice(-1)] + 'ます' : null;
  if (g === 'II') return dict.endsWith('る') ? dict.slice(0, -1) + 'ます' : null;
  if (dict.endsWith('する')) return dict.slice(0, -2) + 'します';
  if (dict === '来る') return '来ます';
  if (dict === 'くる') return 'きます';
  return null;
}

(async () => {
  const conj = await import('file:///' + path.join(ROOT, 'site/js/conjugate.js').replace(/\\/g, '/'));
  const tk = await new Promise((res, rej) => kuromoji.builder({ dicPath: path.join(path.dirname(require.resolve(process.env.KUROMOJI || 'kuromoji')), '..', 'dict') }).build((e, t) => (e ? rej(e) : res(t))));
  const examFile = path.join(ROOT, 'site/data/exam.json');
  const bank = fs.existsSync(examFile) ? JSON.parse(fs.readFileSync(examFile, 'utf8')) : { lessons: [] };
  const report = [];
  for (const L of grammar.filter(l => l.lesson >= from && l.lesson <= to)) {
    const items = [], seen = new Set(), uks = [];
    let np = 0, nv = 0, nt = 0, ne = 0, bad = 0;
    for (const pt of L.points) for (const b of pt.blocks) {
      if (b.ex == null || !b.uk || /[×○→]/.test(b.ex) || /^[\s(–-]/.test(b.uk) || /^……/.test(b.ex)) continue;
      const mk = clean(b.ex);
      const sg = segs(mk), plain = sg.map(s => s.t).join('');
      if (!/[。？?！]$/.test(plain) || seen.has(plain)) continue;
      seen.add(plain);
      const base = { l: L.lesson, pt: pt.id, ...(b.src ? { src: b.src } : {}) };
      const toks = tk.tokenize(plain);
      let off = 0; toks.forEach(t => { t.a = off; off += t.surface_form.length; t.b = off; });
      const words = toks.filter(t => t.pos !== '記号');
      // translation item
      uks.push(b.uk);
      items.push({ id: `t${L.lesson}-${++nt}`, t: 'tr', ...base, ja: mk, uk: b.uk });
      // particle items (max 3 per sentence)
      let k = 0;
      words.forEach(t => {
        if (k >= 3 || t.pos !== '助詞') return;
        const i = toks.indexOf(t);
        const e = explainParticle(toks, i, L.lesson);
        if (!e) return;
        k++;
        const pre = span(sg, 0, t.a).mk, post = span(sg, t.b, plain.length).mk;
        const it = { id: `p${L.lesson}-${++np}`, t: 'p', ...base, pt: e.pt, spt: pt.id, pre, a: t.surface_form, post, uk: b.uk, x: e.x };
        if (PART_ALT[t.surface_form]) it.alt = PART_ALT[t.surface_form];
        items.push(it);
        if (WRONG[t.surface_form] && ne < 40) items.push({ id: `e${L.lesson}-${++ne}`, t: 'e', k: 'p', ...base, pt: e.pt, spt: pt.id, pre, w: WRONG[t.surface_form], a: t.surface_form, post, uk: b.uk, x: e.x });
      });
      // verb-form item (max 1 per sentence)
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.pos !== '動詞' || t.pos_detail_1 !== '自立' || ['くださる', 'ある'].includes(t.basic_form) && t.conjugated_form === '命令ｉ') continue;
        let g = GROUP(t.conjugated_type);
        if (!g) continue;
        let a = t.a, dict = t.basic_form;
        if (t.basic_form === 'する' && toks[i - 1]?.pos_detail_1 === 'サ変接続') { a = toks[i - 1].a; dict = toks[i - 1].surface_form + 'する'; }
        const n1 = toks[i + 1], n2 = toks[i + 2], n3 = toks[i + 3];
        let form = null, end = t.b;
        if (t.conjugated_form === '連用タ接続' || t.conjugated_form === '連用形') {
          if (n1 && n1.pos === '助詞' && ['て', 'で'].includes(n1.surface_form)) { form = n2 && n2.surface_form === 'も' ? 'temo' : 'te'; end = form === 'temo' ? n2.b : n1.b; }
          else if (n1 && ['たら', 'だら'].includes(n1.surface_form)) { form = 'tara'; end = n1.b; }
          else if (n1 && n1.basic_form === 'た' && n1.conjugated_form === '基本形' && !(toks[i - 1] && toks[i - 1].surface_form === 'まし')) { form = 'ta'; end = n1.b; }
          else if (n1 && ['たり', 'だり'].includes(n1.surface_form)) { form = 'ta'; end = n1.a + 1; }
        } else if (t.conjugated_form === '未然形' && n1 && n1.basic_form === 'ない') {
          if (n1.surface_form === 'ない') { form = 'nai'; end = n1.b; }
          else if (n1.surface_form === 'なかっ' && n2?.surface_form === 'た') { form = 'nakatta'; end = n2.b; }
        } else if (t.conjugated_form === '基本形' && !(n1 && n1.pos === '助動詞')) { form = 'dict'; }
        if (!form || conj.FORMS[form].lesson > L.lesson) continue;
        const masu = masuOf(dict, g);
        if (!masu) continue;
        const ans = span(sg, a, end), whole = span(sg, a, t.b);
        // ます-form markup: reuse the kanji reading from the sentence
        const kanjiPrefix = (dict.match(/^[^぀-ヿ]+/) || [''])[0];
        const kseg = sg.find((s, si) => s.r && s.t === kanjiPrefix.slice(-s.t.length));
        const masuMk = kanjiPrefix && kseg ? masu.replace(kanjiPrefix, kanjiPrefix.slice(0, -kseg.t.length) + `{${kseg.t}|${kseg.r}}`) : masu;
        const masuKana = masuMk.replace(/\{([^|}]+)\|([^}]+)\}/g, '$2');
        const expect = conj.conjugate(masu, g, form);
        if (expect !== ans.pl) { bad++; continue; }
        const fp = conj.FORMS[form].point;
        const x = conj.explainConj(masuKana, g, form) + ` Конструкція речення — «${pt.title.replace(/\{([^|}]+)\|[^}]+\}/g, '$1')}».`;
        const pre = span(sg, 0, a).mk, post = span(sg, end, plain.length).mk;
        items.push({ id: `v${L.lesson}-${++nv}`, t: 'v', ...base, pt: fp && has(fp) ? fp : pt.id, spt: pt.id, pre, a: ans.mk, ak: ans.kana, post, base: masuMk, g, f: form, uk: b.uk, x });
        const wf = { te: 'dict', ta: 'te', nai: 'dict', dict: 'te', tara: 'te', temo: 'te', nakatta: 'nai' }[form];
        const w = wf && conj.conjugate(masu, g, wf);
        if (w && conj.FORMS[wf].lesson <= L.lesson) items.push({ id: `e${L.lesson}-${++ne}`, t: 'e', k: 'v', ...base, pt: fp && has(fp) ? fp : pt.id, spt: pt.id, pre, w, a: ans.mk, ak: ans.kana, post, uk: b.uk, x, f: form, base: masuMk, g });
        break;
      }
    }
    // distractors for translations: other sentences of the same lesson (deterministic)
    items.filter(it => it.t === 'tr').forEach((it, i, arr) => {
      const others = arr.filter(o => o.uk !== it.uk).map(o => o.uk);
      it.d = [1, 3, 5].map(s => others[(i * 7 + s) % Math.max(1, others.length)]).filter((v, j, a) => v && a.indexOf(v) === j).slice(0, 3);
    });
    bank.lessons = bank.lessons.filter(x => x.lesson !== L.lesson).concat({ lesson: L.lesson, items }).sort((a, b) => a.lesson - b.lesson);
    report.push(`L${L.lesson}: ${items.filter(i => i.t === 'p').length}p ${items.filter(i => i.t === 'v').length}v ${nt}t ${items.filter(i => i.t === 'e').length}e${bad ? ` (${bad} verb skipped)` : ''}`);
  }
  const J = JSON.stringify;
  const out = '{\n  "lessons": [\n' + bank.lessons.map(l => '    {\n      "lesson": ' + l.lesson + ',\n      "items": [\n' + l.items.map(i => '        ' + J(i)).join(',\n') + '\n      ]\n    }').join(',\n') + '\n  ]\n}\n';
  JSON.parse(out);
  fs.writeFileSync(examFile, out);
  console.log(report.join('\n'));
})();
