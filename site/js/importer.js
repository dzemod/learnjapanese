// In-browser import: OCR (Tesseract.js), PDF (pdf.js), automatic readings (Kuroshiro + Kuromoji in a Web Worker).
// All libraries are free/open-source and loaded lazily from public CDNs — nothing is sent to any server.
import { tightenJa, hasKanji } from './util.js';
import { kuroshiroAnalyzer, onTokProgress, tokProgressText } from './tokenizer.js';

const CDN = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  kuroshiro: 'https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js',
};
export const MAX_BYTES = 10 * 1024 * 1024;

const loaded = {};
export function loadScript(src) {
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error('Не вдалося завантажити бібліотеку. Перевірте інтернет-з’єднання.')); };
    document.head.append(s);
  }));
}

export function checkFile(file, kinds) {
  if (!file) throw new Error('Файл не вибрано.');
  if (file.size > MAX_BYTES) throw new Error(`Файл завеликий (${(file.size / 1048576).toFixed(1)} МБ). Максимум — 10 МБ.`);
  const ok = kinds === 'pdf' ? /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) : /^image\//.test(file.type);
  if (!ok) throw new Error(kinds === 'pdf' ? 'Це не PDF-файл.' : 'Це не зображення (потрібен PNG, JPG, WEBP…).');
}

// ---------------------------------------------------------------- OCR
let workerP = null;
let progressCb = null;
async function getWorker() {
  await loadScript(CDN.tesseract);
  workerP ||= window.Tesseract.createWorker(['ukr', 'jpn'], 1, { // ukr first: much better Cyrillic, Japanese still fine
    logger: m => progressCb?.(m),
  }).catch(e => { workerP = null; throw e; });
  return workerP;
}

const JA_CHAR = /[぀-ヿ㐀-鿿々ー]/;
/** Rebuild lines from Tesseract words, marking wide gaps between words as column breaks (" | "). */
function linesFromResult(data) {
  const out = [];
  for (const line of data.lines || []) {
    const words = (line.words || []).filter(w => w.text.trim());
    if (!words.length) continue;
    const h = Math.max(8, line.bbox.y1 - line.bbox.y0);
    let txt = words[0].text;
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
      const a = words[i - 1].text, b = words[i].text;
      if (gap > h * 1.1) txt += ' | ';
      else if (JA_CHAR.test(a.slice(-1)) && JA_CHAR.test(b[0])) txt += '';
      else txt += ' ';
      txt += b;
    }
    out.push(tightenJa(txt.trim()));
  }
  return out;
}

/**
 * OCR an image (File/Blob/canvas). onProgress(fraction 0..1, label).
 * Returns an array of text lines.
 */
export async function ocrImage(img, onProgress) {
  progressCb = m => {
    const labels = {
      'loading tesseract core': 'Завантаження OCR…',
      'initializing tesseract': 'Ініціалізація…',
      'loading language traineddata': 'Завантаження мовних даних (японська й українська, один раз ≈ 15 МБ)…',
      'initializing api': 'Підготовка…',
      'recognizing text': 'Розпізнавання тексту…',
    };
    onProgress?.(m.progress || 0, labels[m.status] || m.status);
  };
  onProgress?.(0, 'Завантаження OCR…');
  const worker = await getWorker();
  const { data } = await worker.recognize(img);
  progressCb = null;
  return linesFromResult(data);
}

// ---------------------------------------------------------------- PDF
async function getPdfLib() {
  await loadScript(CDN.pdf);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  return lib;
}

/** Parse a page range like "1-3, 5" (1-based). Empty → all. */
export function parseRange(str, max) {
  const s = String(str || '').trim();
  if (!s) return Array.from({ length: max }, (_, i) => i + 1);
  const set = new Set();
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) throw new Error(`Не розумію діапазон сторінок «${part}». Приклад: 1-3, 5`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) set.add(i);
  }
  if (!set.size) throw new Error(`У PDF лише ${max} сторінок.`);
  return [...set].sort((x, y) => x - y);
}

/** Text from a PDF text layer, one line per visual row; wide gaps become " | ". */
async function pageText(page) {
  const tc = await page.getTextContent();
  const rows = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [, , , d, x, y] = it.transform;
    const size = Math.abs(d) || 10;
    let row = rows.find(r => Math.abs(r.y - y) < size * 0.5);
    if (!row) rows.push((row = { y, size, items: [] }));
    row.items.push({ x, w: it.width, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let t = r.items[0].s;
    for (let i = 1; i < r.items.length; i++) {
      const gap = r.items[i].x - (r.items[i - 1].x + r.items[i - 1].w);
      t += gap > r.size * 1.2 ? ' | ' : gap > r.size * 0.15 ? ' ' : '';
      t += r.items[i].s;
    }
    return tightenJa(t.trim());
  });
}

/**
 * Read a PDF: text layer if present, otherwise render pages and OCR them.
 * Returns { lines, mode: 'text' | 'ocr', pages }.
 */
export async function readPdf(file, rangeStr, onProgress) {
  onProgress?.(0, 'Відкриваю PDF…');
  const lib = await getPdfLib();
  let pdf;
  try { pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise; }
  catch { throw new Error('Не вдалося відкрити PDF — файл пошкоджений або захищений паролем.'); }
  const pages = parseRange(rangeStr, pdf.numPages);
  // 1) Try the text layer
  const textLines = [];
  for (const n of pages) textLines.push(...(await pageText(await pdf.getPage(n))));
  const jaChars = textLines.join('').match(/[぀-ヿ㐀-鿿]/g)?.length || 0;
  if (jaChars > 10) return { lines: textLines, mode: 'text', pages: pages.length };
  // 2) Scan → OCR each page
  if (pages.length > 15) throw new Error(`Це скан на ${pages.length} сторінок — розпізнавання буде дуже довгим. Вкажіть менший діапазон сторінок (до 15).`);
  const lines = [];
  for (let k = 0; k < pages.length; k++) {
    const page = await pdf.getPage(pages[k]);
    const vp = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const part = await ocrImage(canvas, (p, label) =>
      onProgress?.((k + p) / pages.length, `Сторінка ${pages[k]} (${k + 1}/${pages.length}) — ${label}`));
    lines.push(...part);
    canvas.width = canvas.height = 0;
  }
  return { lines, mode: 'ocr', pages: pages.length };
}

// ---------------------------------------------------------------- Readings
let kuroP = null;
async function getKuroshiro() {
  if (!kuroP) {
    kuroP = (async () => {
      await loadScript(CDN.kuroshiro);
      const K = window.Kuroshiro.default || window.Kuroshiro;
      const k = new K();
      await k.init(kuroshiroAnalyzer()); // Kuromoji runs in a Web Worker (js/tokenizer.js)
      return k;
    })().catch(e => { kuroP = null; throw e; });
  }
  return kuroP;
}

/** Fill in missing hiragana readings for cards that contain kanji. Marks them readingAuto. Returns count. */
export async function autoReadings(cards, onProgress) {
  const todo = cards.filter(c => hasKanji(c.japanese) && !c.reading);
  if (!todo.length) return 0;
  onProgress?.(0, 'Завантаження словника для читань (≈ 18 МБ, один раз)…');
  const off = onTokProgress(st => { if (st.phase === 'download' || st.phase === 'build') { const p = tokProgressText(st); onProgress?.(p.frac, p.text); } });
  let k;
  try { k = await getKuroshiro(); } finally { off(); }
  let i = 0;
  for (const c of todo) {
    try {
      const r = await k.convert(c.japanese.replace(/[～〜~]/g, ''), { to: 'hiragana', mode: 'normal' });
      c.reading = r.replace(/\s+/g, '');
      c.readingAuto = true;
    } catch { /* leave empty */ }
    onProgress?.(++i / todo.length, `Генерую читання… ${i}/${todo.length}`);
  }
  return todo.length;
}
