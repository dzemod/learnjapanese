// Safe, small Markdown renderer for AI replies (Сенсей). The model's text is never trusted: every line is
// HTML-escaped first, then only these forms become markup:
//   "# " / "## " → <h2>, "### "… → <h3>; a line of -- / --- / *** / ___ / — → <hr>; "- ", "* ", "• " → <ul>;
//   "1. " / "1) " → <ol>; **bold** → <strong>; *italic* → <em>; `code` → <code> (underscores stay text: snake_case);
//   blank line → new paragraph, single line break → <br>.
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
const H = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*(\d{1,3})[.)]\s+(.*)$/;

/** Text of a reply → HTML (block structure + inline markup), safe to put into innerHTML. */
export function renderReply(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null; // list = { tag, items, start }
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(l => inline(escHTML(l.trim()))).join('<br>')}</p>`); para = []; };
  const flushList = () => {
    if (!list) return;
    const start = list.tag === 'ol' && list.start !== 1 ? ` start="${list.start}"` : '';
    out.push(`<${list.tag}${start}>${list.items.map(i => `<li>${inline(escHTML(i.trim()))}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };
  for (const line of lines) {
    let m;
    if (!line.trim()) { flush(); continue; }
    if (HR.test(line)) { flush(); out.push('<hr>'); continue; }
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
