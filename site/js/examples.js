// Matching textbook examples (grammar.json: IV. Граматика, 文型, 例文 + translations) and my words
// for Перекладач: Ukrainian → by word stems (weighted by rarity), Japanese → by content words and the
// grammar points found in the sentence. Pure module (no DOM).
const FG = /\{([^{}|]+)\|([^{}]+)\}/g;
const STOP = new Set('і й та а але в у на з із зі зо до по за від для про при що це не ні як чи ж же би б ти я він вона воно ми ви вони мене мені мною тебе тобі його йому її їй їх їм нас нам вас вам є був була було були буде дуже так там тут теж також цей ця ці той та ті свій своя свої мій моя мої твій яка який яке які коли де хто'.split(' '));

/** Ukrainian text → set of crude stems (first 4 letters of words with ≥ 5 letters). */
export function ukStems(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().replace(/ʼ|'/g, '’').match(/[а-щьюяіїєґ’]+/g) || []) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.length >= 5 ? w.slice(0, 4) : w);
  }
  return out;
}

export function buildExampleIndex(lessons) {
  const list = [], df = new Map();
  for (const l of lessons || []) for (const p of l.points || []) for (const b of p.blocks || []) {
    if (!b.ex || !b.uk) continue;
    const stems = ukStems(b.uk);
    list.push({ ex: b.ex, plain: b.ex.replace(FG, '$1').replace(/\s+/g, ''), uk: b.uk, src: b.src || '', check: !!b.check, lesson: l.lesson, pointId: p.id, title: p.title, stems });
    for (const s of stems) df.set(s, (df.get(s) || 0) + 1);
  }
  const N = list.length || 1;
  const idf = s => Math.log(1 + N / (df.get(s) || N));
  return { list, idf };
}

const top = (scored, n) => scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.e.plain.length - b.e.plain.length).slice(0, n).map(x => ({ ...x.e, score: x.score, hits: x.hits }));

/** Examples whose Ukrainian translation shares words with the query. */
export function matchByUk(idx, text, n = 6) {
  const q = ukStems(text);
  if (!q.size) return [];
  const scored = idx.list.map(e => {
    let score = 0;
    const hits = [];
    for (const s of q) if (e.stems.has(s)) { score += idx.idf(s); hits.push(s); }
    return { e, score: hits.length >= Math.min(2, q.size) ? score : hits.length ? score / 3 : 0, hits };
  });
  return top(scored, n);
}

/**
 * Examples containing the content words of a Japanese sentence (bases; verbs by stem) and/or
 * illustrating the same grammar points.
 */
export function matchByJa(idx, words, pointIds = [], n = 6) {
  const keys = [...new Set(words.filter(w => w && w.length >= 1))];
  const pts = new Set(pointIds);
  const scored = idx.list.map(e => {
    const hits = keys.filter(k => e.plain.includes(k));
    const score = hits.reduce((a, k) => a + Math.min(3, k.length), 0) + (pts.has(e.pointId) ? 2 : 0);
    return { e, score: hits.length || pts.has(e.pointId) ? score : 0, hits };
  });
  return top(scored, n);
}

/** Cards (internal format) whose Ukrainian meaning contains a word of the query. */
export function matchWords(sets, text, n = 12) {
  const q = ukStems(text);
  if (!q.size) return [];
  const seen = new Set(), out = [];
  for (const s of sets) for (const c of s.cards || []) {
    if (!c.ukrainian || !c.japanese) continue;
    const st = ukStems(c.ukrainian);
    const hits = [...q].filter(x => st.has(x));
    if (!hits.length) continue;
    const key = c.japanese + '|' + c.ukrainian;
    if (seen.has(key)) continue;
    seen.add(key);
    // shorter meanings (a single word) first: they are the actual translation, not a phrase containing it
    out.push({ card: c, set: s, score: hits.length * 10 - Math.min(9, c.ukrainian.length / 6) + (s.source === 'textbook' ? 0.5 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}
