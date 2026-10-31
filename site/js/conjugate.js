// Verb conjugation by the rules of Minna no Nihongo (groups I / II / III), starting from the ます-form.
// Works on kana and on kanji spellings (okurigana carries the change; 来ます is handled specially).
// Used in the browser (Exam tab) and by tools/build-exam.js.

const ROW = { // i-row kana → [a, u, e, o] of the same consonant
  'い': ['わ', 'う', 'え', 'お'], 'き': ['か', 'く', 'け', 'こ'], 'ぎ': ['が', 'ぐ', 'げ', 'ご'], 'し': ['さ', 'す', 'せ', 'そ'],
  'ち': ['た', 'つ', 'て', 'と'], 'に': ['な', 'ぬ', 'ね', 'の'], 'び': ['ば', 'ぶ', 'べ', 'ぼ'], 'み': ['ま', 'む', 'め', 'も'], 'り': ['ら', 'る', 'れ', 'ろ'],
};
const TE = { 'い': 'って', 'ち': 'って', 'り': 'って', 'に': 'んで', 'び': 'んで', 'み': 'んで', 'き': 'いて', 'ぎ': 'いで', 'し': 'して' };

/** Forms, the lesson where Minna introduces them and the grammar point that explains them. */
export const FORMS = {
  te: { label: 'て-форма', lesson: 14, point: '14-3' },
  nai: { label: 'ない-форма', lesson: 17, point: '17-1' },
  dict: { label: 'словникова форма', lesson: 18, point: '18-1' },
  ta: { label: 'た-форма', lesson: 19, point: '19-1' },
  nakatta: { label: 'проста форма минулого часу, заперечна (～なかった)', lesson: 20, point: '20-1' },
  tara: { label: 'умовна форма ～たら', lesson: 25, point: '25-1' },
  temo: { label: '～ても', lesson: 25, point: '25-3' },
  pot: { label: 'потенційна форма (можливість)', lesson: 27, point: null },
  vol: { label: 'вольова форма (～よう)', lesson: 31, point: null },
  imp: { label: 'наказова форма', lesson: 33, point: null },
  proh: { label: 'заборонна форма (～な)', lesson: 33, point: null },
  ba: { label: 'умовна форма ～ば', lesson: 35, point: null },
  pass: { label: 'пасивна форма', lesson: 37, point: null },
  caus: { label: 'каузативна форма', lesson: 48, point: null },
};
export const formsUpTo = lesson => Object.entries(FORMS).filter(([, f]) => f.lesson <= lesson).map(([k]) => k);

const isKuru = stem => /(^|[^し])(き|来)$/.test(stem) && !/し$/.test(stem);
const KURU = { dict: 'くる', nai: 'こない', te: 'きて', ta: 'きた', nakatta: 'こなかった', tara: 'きたら', temo: 'きても', pot: 'こられる', vol: 'こよう', imp: 'こい', proh: 'くるな', ba: 'くれば', pass: 'こられる', caus: 'こさせる' };
const SURU = { dict: 'する', nai: 'しない', te: 'して', ta: 'した', nakatta: 'しなかった', tara: 'したら', temo: 'しても', pot: 'できる', vol: 'しよう', imp: 'しろ', proh: 'するな', ba: 'すれば', pass: 'される', caus: 'させる' };

/**
 * Conjugate a ます-form ("かきます", "書きます", "勉強します", "来ます") of the given group ('I'|'II'|'III').
 * Returns the form or null if the verb can't be handled.
 */
export function conjugate(masu, group, form) {
  const m = String(masu || '').trim().replace(/[～〜]/g, '');
  if (!m.endsWith('ます')) return null;
  const stem = m.slice(0, -2);
  if (!stem) return null;
  if (group === 'III') {
    if (stem.endsWith('し')) return stem.slice(0, -1) + SURU[form];
    if (isKuru(stem)) {
      const k = KURU[form];
      return stem.endsWith('来') ? stem + k.slice(1) : stem.slice(0, -1) + k;
    }
    return null;
  }
  if (group === 'II') {
    const add = { dict: 'る', nai: 'ない', te: 'て', ta: 'た', nakatta: 'なかった', tara: 'たら', temo: 'ても', pot: 'られる', vol: 'よう', imp: 'ろ', proh: 'るな', ba: 'れば', pass: 'られる', caus: 'させる' }[form];
    return add == null ? null : stem + add;
  }
  if (group !== 'I') return null;
  const last = stem.slice(-1), base = stem.slice(0, -1), r = ROW[last];
  if (!r) return null;
  const iku = /(行|い)き$/.test(stem) && !/[ひ]き$/.test(stem);
  const te = iku ? 'って' : TE[last];
  const ta = te.replace('て', 'た').replace('で', 'だ');
  const aru = /(^|[^か])あり$/.test(stem) || stem === 'あり';
  switch (form) {
    case 'dict': return base + r[1];
    case 'nai': return aru ? 'ない' : base + r[0] + 'ない';
    case 'nakatta': return aru ? 'なかった' : base + r[0] + 'なかった';
    case 'te': return base + te;
    case 'ta': return base + ta;
    case 'tara': return base + ta + 'ら';
    case 'temo': return base + te + 'も';
    case 'pot': return base + r[2] + 'る';
    case 'vol': return base + r[3] + 'う';
    case 'imp': return base + r[2];
    case 'proh': return base + r[1] + 'な';
    case 'ba': return base + r[2] + 'ば';
    case 'pass': return base + r[0] + 'れる';
    case 'caus': return base + r[0] + 'せる';
    default: return null;
  }
}

/** Ukrainian explanation of how the form is built (rules from IV. Граматика: уроки 14, 17, 18, 19, 20, 25…). */
export function explainConj(masu, group, form) {
  const res = conjugate(masu, group, form);
  if (!res) return '';
  const f = FORMS[form]?.label || form;
  const stem = masu.slice(0, -2);
  if (group === 'III') return `Дієслово III групи (особливе відмінювання): ${masu} → ${res} (${f}).`;
  if (group === 'II') {
    const add = res.slice(stem.length);
    return `Дієслово II групи: до ます-основи «${stem}» додається «${add}»: ${masu} → ${res} (${f}).`;
  }
  const last = stem.slice(-1);
  if (form === 'te' || form === 'ta' || form === 'tara' || form === 'temo') {
    if (/(行|い)き$/.test(stem)) return `Виняток: いきます → いって / いった. ${masu} → ${res} (${f}).`;
    const tail = form === 'te' ? '' : ' (た-форма утворюється з て-форми: て → た, で → だ)';
    return `Дієслово I групи: ます-основа закінчується на «${last}» → у て-формі «${TE[last]}»${tail}: ${masu} → ${res}.`;
  }
  if ((form === 'nai' || form === 'nakatta') && /あり$/.test(stem)) return `Виняток: あります → ない. ${masu} → ${res}.`;
  const col = { nai: 'あ', nakatta: 'あ', pass: 'あ', caus: 'あ', dict: 'う', proh: 'う', pot: 'え', imp: 'え', ba: 'え', vol: 'お' }[form];
  const extra = form === 'nai' && last === 'い' ? ' (い → わ, як у かいます → かわない)' : '';
  return `Дієслово I групи: остання літера ます-основи «${last}» (стовпчик い) замінюється на літеру зі стовпчика ${col}${extra}: ${masu} → ${res} (${f}).`;
}

/** Which known form does `answer` match? (to explain a wrong answer) */
export function detectForm(masu, group, answer, kana = '') {
  const a = String(answer || '').trim();
  for (const k of Object.keys(FORMS)) {
    const v = conjugate(masu, group, k), vk = kana ? conjugate(kana, group, k) : null;
    if (a && (a === v || a === vk)) return k;
  }
  if (a === masu || (kana && a === kana)) return 'masu';
  return null;
}
