// Attachments of the «Сенсей» chat: one photo or text file per message, prepared in the browser only.
//   image/*            ≤ 5 MB   → redrawn on a canvas (drops EXIF incl. location), ≤ 1024 px, JPEG 0.8 → sent as a file
//   .txt / .md (text)  ≤ 200 KB → read with FileReader, ≤ TEXT_MAX characters → appended to the question as text
//   .pdf               ≤ 200 KB → text layer via pdf.js (already used by importer.js, loaded lazily) → as text
// Nothing here is stored: the file lives in memory until it is sent or removed.
export const IMAGE_MAX = 5 * 1024 * 1024;
export const TEXT_MAX_BYTES = 200 * 1024;
export const TEXT_MAX = 6000; // characters of a text file sent to the model
export const IMAGE_SIDE = 1024;
export const JPEG_Q = 0.8;
export const MSG_BAD_FILE = 'Цей файл не підтримується або завеликий';
export const MSG_NO_TEXT = 'У цьому файлі не знайдено тексту';
export const ACCEPT = 'image/*,.txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf';

/** Kind of a file: 'image' | 'text' | 'pdf', or '' when not supported / too large. */
export function fileKind(file) {
  if (!file) return '';
  const name = String(file.name || '').toLowerCase(), type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return file.size <= IMAGE_MAX ? 'image' : '';
  const kind = type === 'application/pdf' || /\.pdf$/.test(name) ? 'pdf'
    : type === 'text/plain' || type === 'text/markdown' || /\.(txt|md|markdown)$/.test(name) ? 'text' : '';
  return kind && file.size <= TEXT_MAX_BYTES ? kind : '';
}

/** Size for the chip: «12 КБ», «1,4 МБ». */
export function sizeLabel(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;
}

/** Text cut to TEXT_MAX characters → { text, cut }. */
export function clip(text, max = TEXT_MAX) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  return t.length > max ? { text: t.slice(0, max), cut: true } : { text: t, cut: false };
}

/** The user message for the model: typed question + the file's text (marked when it was cut). */
export function withFileText(question, name, text, cut) {
  const head = `Файл «${name}»${cut ? ` (обрізано до перших ${TEXT_MAX} символів)` : ''}:`;
  return `${question}\n\n${head}\n"""\n${text}\n"""`;
}

const readAsText = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result || ''));
  r.onerror = () => rej(r.error || new Error('read failed'));
  r.readAsText(file);
});

async function pdfText(file) {
  const { loadPdfLib } = await import('./importer.js');
  const lib = await loadPdfLib();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = '';
  for (let n = 1; n <= pdf.numPages && out.length <= TEXT_MAX; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    out += tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join('') + '\n';
  }
  return out;
}

/** Image → JPEG Blob, longest side ≤ IMAGE_SIDE; the canvas redraw keeps no metadata (EXIF, GPS). */
export async function resizeImage(file, side = IMAGE_SIDE, quality = JPEG_Q) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode(); // the browser applies the EXIF orientation when drawing
    const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); // transparent PNG → white, not black
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    c.width = c.height = 0;
    if (!blob) throw new Error('toBlob failed');
    return { blob, w, h };
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Prepares a chosen file. Resolves to { kind, name, size, blob?, w?, h?, text?, cut? } or { error: Ukrainian message }.
 */
export async function prepareAttachment(file) {
  const kind = fileKind(file);
  if (!kind) return { error: MSG_BAD_FILE };
  const base = { kind, name: String(file.name || (kind === 'image' ? 'фото.jpg' : 'файл')).slice(0, 80), size: file.size };
  try {
    if (kind === 'image') { const r = await resizeImage(file); return { ...base, ...r, size: r.blob.size }; }
    const raw = kind === 'pdf' ? await pdfText(file) : await readAsText(file);
    const { text, cut } = clip(raw);
    if (!text) return { error: MSG_NO_TEXT };
    return { ...base, text, cut };
  } catch (e) {
    console.warn('sensei: file could not be read:', e?.message || e);
    return { error: MSG_BAD_FILE };
  }
}
