// Safe, small Markdown renderer for AI replies (Сенсей). The model's text is never trusted: every line is
// HTML-escaped first, then only these forms become markup:
//   "# " / "## " → <h2>, "### "… → <h3>; a line of -- / --- / *** / ___ / — → <hr>; "- ", "* ", "• " → <ul>;
//   "1. " / "1) " → <ol>; **bold** → <strong>; *italic* → <em>; `code` → <code> (underscores stay text: snake_case);
//   "> " → <blockquote>; "| a | b |" rows (with |---| under the header) → <table>; blank line → new paragraph,
//   single line break → <br>. Headings may come without the space ("###Title").
// Leftover markers are removed: stray * and #, "--" inside a sentence becomes a dash. No library.

const escHTML = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Inline markup of one escaped line. Code spans are cut out first, so nothing inside them is touched. */
export function inline(escaped) {
  const codes = [];
  let s = escaped.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, '$1<em>$2</em>')
    .replace(/\*+/g, '') // stray asterisks
    .replace(/(^|\s)#{1,6}(?=\s|$)/g, '$1') // stray heading marks
    .replace(/\s--+\s/g, ' — ') // "слово -- пояснення"
    .replace(/--+/g, '—')
    .replace(/ {2,}/g, ' ');
  return s.replace(/`/g, '').replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

const HR = /^\s*(?:-{2,}|\*{3,}|_{3,}|—{1,}|–{2,})\s*$/;
const H = /^\s*(#{1,6})\s*(\S.*?)\s*#*\s*$/; // models also write "###Heading" without the space
const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/; // |---|:---:|
const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
/** Last pass on a paragraph line: markers that must never show (a leading #, > or |). */
const bare = l => l.replace(/^\s*(?:#{1,6}|>)\s*/, '').replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' · ');

/** Text of a reply → HTML (block structure + inline markup), safe to put into innerHTML. */
export function renderReply(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null, quote = [], table = []; // list = { tag, items, start }
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(l => inline(escHTML(bare(l).trim()))).join('<br>')}</p>`); para = []; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote><p>${quote.map(l => inline(escHTML(bare(l).trim()))).join('<br>')}</p></blockquote>`); quote = []; };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter(r => !SEP.test(r)).map(cells);
    const head = table.length > 1 && SEP.test(table[1]) ? rows.shift() : null;
    const td = (c, tag) => `<${tag}>${inline(escHTML(c))}</${tag}>`;
    out.push(`<table>${head ? `<thead><tr>${head.map(c => td(c, 'th')).join('')}</tr></thead>` : ''}<tbody>${rows.map(r => `<tr>${r.map(c => td(c, 'td')).join('')}</tr>`).join('')}</tbody></table>`);
    table = [];
  };
  const flushList = () => {
    if (!list) return;
    const start = list.tag === 'ol' && list.start !== 1 ? ` start="${list.start}"` : '';
    out.push(`<${list.tag}${start}>${list.items.map(i => `<li>${inline(escHTML(i.trim()))}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); flushQuote(); flushTable(); };
  for (const line of lines) {
    let m;
    if (!line.trim()) { flush(); continue; }
    if (ROW.test(line) || (table.length && SEP.test(line))) { if (!table.length) flush(); table.push(line); continue; }
    flushTable();
    if (HR.test(line)) { flush(); out.push('<hr>'); continue; }
    if ((m = line.match(QUOTE))) { flushPara(); flushList(); if (m[1].trim()) quote.push(m[1]); continue; }
    flushQuote();
    if ((m = line.match(H))) {
      flush();
      const body = inline(escHTML(m[2])).replace(/<\/?strong>/g, ''); // a heading is bold already
      if (body.trim()) out.push(m[1].length <= 2 ? `<h2>${body}</h2>` : `<h3>${body}</h3>`);
      continue;
    }
    if ((m = line.match(UL)) || (m = line.match(OL))) {
      const tag = m.length === 3 && OL.test(line) ? 'ol' : 'ul';
      flushPara();
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [], start: tag === 'ol' ? +m[1] : 1 }; }
      list.items.push(tag === 'ol' ? m[2] : m[1]);
      continue;
    }
    // a line that is only **bold text** (the model's usual section title) → <h3>
    if ((m = line.match(/^\s*\*\*([^*\n]+?):?\*\*:?\s*$/))) { flush(); out.push(`<h3>${inline(escHTML(m[1]))}</h3>`); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; } // continued list item
    flushList();
    para.push(line);
  }
  flush();
  // no empty dividers at the edges or two in a row
  return out.join('').replace(/^(<hr>)+|(<hr>)+$/g, '').replace(/(<hr>){2,}/g, '<hr>');
}
