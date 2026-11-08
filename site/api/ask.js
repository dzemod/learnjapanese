// Vercel serverless function: the exam's AI helper. Sends one question to Google Gemini (free tier) and returns the answer.
//   GEMINI_API_KEY — free key from Google AI Studio (Vercel → Settings → Environment Variables), server only
//   APP_PASSWORD   — the same password as /api/save-set
// POST { question, context?, password } → 200 { answer, truncated } | 4xx/5xx { code, error }. No conversation is kept here.
const crypto = require('crypto');

// Free tier, stable, no shutdown announced (checked 2026-11). Thinking is off by default on this model, which matters:
// thought tokens count against maxOutputTokens, so a thinking model could spend the whole limit and return nothing.
const MODEL = 'gemini-2.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_INPUT = 1000; // characters of question + context
const MAX_OUTPUT_TOKENS = 512;
const RATE_MAX = 15; // requests per IP …
const RATE_WINDOW_MS = 10 * 60 * 1000; // … per 10 minutes
const TIMEOUT_MS = 25000;

const MSG_LIMIT = 'Ліміт безкоштовних запитів вичерпано, спробуйте пізніше';
const MSG_FAIL = 'Не вдалося отримати відповідь, спробуйте ще раз';

const SYSTEM = `You are a patient Japanese teacher for a Ukrainian-speaking learner who uses the Minna no Nihongo textbook.
Answer in Ukrainian. Explain why the learner's answer is wrong (if it is) and why the correct answer is right, and name the grammar point.
Keep the answer under about 150 words unless the learner asks for more. Use plain text without Markdown headings or tables.
Write Japanese readings only in kana: never romaji and never Cyrillic.
Do not invent facts beyond the textbook; if you are unsure, say so.
If the question is about the website itself and not about Japanese, tell the learner to contact the developer.`;

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// In memory, so per serverless instance: a simple guard for the free quota, not an exact global count.
const hits = new Map(); // ip → timestamps
function overLimit(ip, now = Date.now()) {
  if (hits.size > 2000) for (const [k, list] of hits) if (!list.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  const over = list.length >= RATE_MAX;
  if (!over) list.push(now);
  hits.set(ip, list);
  return over;
}
function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function readBody(req) {
  try {
    const b = req.body; // Vercel's getter throws on malformed JSON
    const parsed = typeof b === 'string' ? JSON.parse(b || '{}') : b;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

const fail = (res, status, code, error) => res.status(status).json({ code, error });

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.GEMINI_API_KEY;
  const password = process.env.APP_PASSWORD;
  if (req.method === 'GET') return res.status(200).json({ configured: !!(key && password) });
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Метод не підтримується.');

  const body = readBody(req);
  if (!body) return fail(res, 400, 'bad_request', 'Неправильний запит.');
  // Without APP_PASSWORD nothing may pass (an empty password would otherwise equal the empty setting).
  if (!password) return fail(res, 503, 'not_configured', MSG_FAIL);
  if (!safeEqual(body.password, password)) return fail(res, 401, 'bad_password', 'Неправильний пароль. Спробуйте ще раз.');

  const { question, context = '' } = body;
  if (typeof question !== 'string' || typeof context !== 'string' || !question.trim()) return fail(res, 400, 'bad_request', 'Напишіть запитання.');
  const q = question.trim(), c = context.trim();
  if (q.length + c.length > MAX_INPUT) return fail(res, 400, 'too_long', `Запит задовгий: максимум ${MAX_INPUT} символів.`);

  if (overLimit(clientIp(req))) return fail(res, 429, 'rate_limit', MSG_LIMIT);
  if (!key) return fail(res, 503, 'not_configured', MSG_FAIL);

  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      // In a header, not in the URL, so the key cannot end up in any URL log.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: c ? `Завдання екзамену:\n${c}\n\nЗапитання учня:\n${q}` : q }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 429) return fail(res, 429, 'quota', MSG_LIMIT);
    if (!r.ok) {
      console.error('ask: Gemini returned HTTP', r.status); // status only: Google's error body is never logged or forwarded
      return fail(res, 502, 'upstream', MSG_FAIL);
    }
    const j = await r.json();
    const cand = j.candidates?.[0];
    const answer = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!answer) {
      console.error('ask: empty answer, finishReason', cand?.finishReason || j.promptFeedback?.blockReason || 'none');
      return fail(res, 502, 'empty', MSG_FAIL);
    }
    return res.status(200).json({ answer, truncated: cand.finishReason === 'MAX_TOKENS' });
  } catch (e) {
    console.error('ask: request failed:', e?.name || 'error');
    return fail(res, 502, 'network', MSG_FAIL);
  }
};
