// Tests of the exam's AI helper (site/api/ask.js). No network and no real key: fetch is mocked.
//   node tools/qa-ask.mjs
// The name of the key must appear in the function that reads it (site/api/ask.js, which Vercel runs on the server and does
// not serve as a file), and nowhere else under site/. A value starting with "AIza" must not appear anywhere under site/.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'x.js'));
const KEY_NAME = 'GEMINI_API_KEY';
const FAKE_KEY = 'AIza' + 'FAKE-key-for-tests-only';
const LIMIT = 'Ліміт безкоштовних запитів вичерпано, спробуйте пізніше';
const FAIL = 'Не вдалося отримати відповідь, спробуйте ще раз';

let fails = 0, passed = 0;
const ok = (cond, name, extra = '') => { if (cond) passed++; else { fails++; console.log(`FAIL ${name} ${extra}`); } };

process.env[KEY_NAME] = FAKE_KEY;
process.env.APP_PASSWORD = 'test-password';
const handler = require(path.join(ROOT, 'site/api/ask.js'));

// console output is captured: whatever is logged must not contain the key
const logged = [];
for (const m of ['log', 'error', 'warn']) { const orig = console[m]; console[m] = (...a) => { logged.push(a.join(' ')); if (m === 'log') orig(...a); }; }

const realFetch = globalThis.fetch;
let calls = [];
const geminiOk = text => async (url, opts) => { calls.push({ url: String(url), opts }); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 }); };
const geminiStatus = (status, body = '') => async (url, opts) => { calls.push({ url: String(url), opts }); return new Response(body, { status }); };
let ipN = 0;
async function call(body, { method = 'POST', ip = `10.0.0.${++ipN}` } = {}) {
  const out = { status: 0, json: null, headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status(s) { out.status = s; return this; }, json(j) { out.json = j; return this; } };
  await handler({ method, body, headers: { 'x-forwarded-for': ip } }, res);
  out.text = JSON.stringify(out.json);
  return out;
}
const good = { question: 'Чому тут は?', context: 'Завдання: 私（　）学生です', password: 'test-password' };

// ---------- password ----------
globalThis.fetch = geminiOk('відповідь');
let r = await call({ question: 'x' });
ok(r.status === 401, '401 without the password', r.status);
r = await call({ ...good, password: 'wrong' });
ok(r.status === 401 && r.json.code === 'bad_password', '401 with a wrong password', r.status);
ok(calls.length === 0, 'no Gemini call without the password');
const savedPw = process.env.APP_PASSWORD;
delete process.env.APP_PASSWORD;
r = await call({ question: 'x', password: '' });
ok(r.status === 503 && calls.length === 0, 'an unset APP_PASSWORD lets nothing through', r.status);
process.env.APP_PASSWORD = savedPw;

// ---------- response shape and the request to Google ----------
r = await call(good);
ok(r.status === 200 && r.json.answer === 'відповідь' && r.json.truncated === false, 'response shape', r.text);
ok(Object.keys(r.json).sort().join() === 'answer,truncated', 'only answer + truncated are returned', r.text);
ok(r.headers['Cache-Control'] === 'no-store', 'no-store');
const sent = calls.at(-1), payload = JSON.parse(sent.opts.body);
ok(sent.url.startsWith('https://generativelanguage.googleapis.com/') && /:generateContent$/.test(sent.url), 'generateContent endpoint', sent.url);
ok(!sent.url.includes(FAKE_KEY) && sent.opts.headers['x-goog-api-key'] === FAKE_KEY, 'the key goes in a header, not in the URL');
ok(payload.generationConfig.maxOutputTokens === 512, 'maxOutputTokens 512');
const system = payload.systemInstruction.parts[0].text;
ok(/Minna no Nihongo/.test(system) && /Answer in Ukrainian/.test(system) && /only in kana/.test(system) && /150 words/.test(system) && /contact the developer/.test(system), 'system instruction');
const userText = payload.contents[0].parts[0].text;
ok(userText.includes(good.question) && userText.includes(good.context), 'question + context are sent');
ok(!JSON.stringify(payload).includes('test-password'), 'the password is not forwarded to Google');
globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'обрізано' }] }, finishReason: 'MAX_TOKENS' }] }), { status: 200 });
r = await call(good);
ok(r.json.truncated === true, 'a cut answer is marked as truncated');

// ---------- input ----------
calls = [];
globalThis.fetch = geminiOk('відповідь');
r = await call({ ...good, question: 'я'.repeat(1001), context: '' });
ok(r.status === 400 && r.json.code === 'too_long', 'question over 1000 characters', r.status);
r = await call({ ...good, question: 'я'.repeat(600), context: 'я'.repeat(401) });
ok(r.status === 400 && r.json.code === 'too_long', 'question + context over 1000 characters', r.status);
ok(calls.length === 0, 'too long: no Gemini call');
r = await call({ ...good, question: 'я'.repeat(600), context: 'я'.repeat(400) });
ok(r.status === 200, 'exactly 1000 characters pass', r.status);
for (const [name, b] of [['empty question', { ...good, question: '   ' }], ['no question', { password: good.password }], ['non-string question', { ...good, question: { a: 1 } }], ['non-string context', { ...good, context: [1] }]]) {
  r = await call(b);
  ok(r.status === 400, name, r.status);
}
r = await call('{not json');
ok(r.status === 400, 'malformed JSON', r.status);
r = await call(good, { method: 'DELETE' });
ok(r.status === 405, 'other methods are refused', r.status);
r = await call(undefined, { method: 'GET' });
ok(r.status === 200 && r.json.configured === true && !r.text.includes(FAKE_KEY), 'GET reports only whether it is configured', r.text);

// ---------- rate limit ----------
calls = [];
for (let i = 0; i < 15; i++) { r = await call(good, { ip: '20.0.0.1' }); ok(r.status === 200, `request ${i + 1} of 15 passes`, r.status); }
r = await call(good, { ip: '20.0.0.1' });
ok(r.status === 429 && r.json.error === LIMIT && r.json.code === 'rate_limit', '16th request is limited', r.text);
ok(calls.length === 15, 'the limited request does not reach Gemini', calls.length);
r = await call({ ...good, password: 'wrong' }, { ip: '20.0.0.1' });
ok(r.status === 401, 'a wrong password is 401 even when limited', r.status);
r = await call(good, { ip: '20.0.0.2' });
ok(r.status === 200, 'another IP is not limited', r.status);
r = await call(good, { ip: '20.0.0.1, 70.0.0.1' });
ok(r.status === 429, 'the first address of x-forwarded-for counts', r.status);
const realNow = Date.now;
Date.now = () => realNow() + 10 * 60 * 1000 + 1000;
r = await call(good, { ip: '20.0.0.1' });
Date.now = realNow;
ok(r.status === 200, 'the limit resets after 10 minutes', r.status);

// ---------- failures: Ukrainian text only, nothing raw ----------
const secretBody = JSON.stringify({ error: { message: `API key ${FAKE_KEY} not valid`, status: 'INVALID_ARGUMENT' } });
globalThis.fetch = geminiStatus(429, secretBody);
r = await call(good);
ok(r.status === 429 && r.json.error === LIMIT && r.json.code === 'quota', 'Google 429', r.text);
for (const [name, f] of [
  ['Google 400 with the key in its body', geminiStatus(400, secretBody)],
  ['Google 500', geminiStatus(500, 'Internal error')],
  ['network failure', async () => { throw new Error(`connect failed ${FAKE_KEY}`); }],
  ['not JSON', geminiStatus(200, '<html>')],
  ['blocked: no candidates', geminiStatus(200, JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))],
  ['empty text', geminiStatus(200, JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }))],
]) {
  globalThis.fetch = f;
  r = await call(good);
  ok(r.status === 502 && r.json.error === FAIL, name, r.text);
  ok(!r.text.includes(FAKE_KEY) && !r.text.includes('Internal error'), `${name}: nothing raw in the response`, r.text);
}
const savedKey = process.env[KEY_NAME];
delete process.env[KEY_NAME];
calls = [];
globalThis.fetch = geminiOk('x');
r = await call(good);
ok(r.status === 503 && r.json.error === FAIL && calls.length === 0, 'missing key: normal failure message', r.text);
process.env[KEY_NAME] = savedKey;
ok(!logged.some(l => l.includes(FAKE_KEY)), 'the key is never logged');
globalThis.fetch = realFetch;

// ---------- nothing secret under site/ ----------
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } })(path.join(ROOT, 'site'));
const FN = path.join(ROOT, 'site/api/ask.js');
ok(files.length > 20, 'the scan sees the site', files.length);
for (const f of files) {
  const buf = fs.readFileSync(f), rel = path.relative(ROOT, f).replace(/\\/g, '/');
  ok(!buf.includes('AIza'), `no value starting with AIza: ${rel}`);
  if (f !== FN) ok(!buf.includes(KEY_NAME), `no ${KEY_NAME}: ${rel}`);
}
const src = fs.readFileSync(FN, 'utf8');
const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
ok(code.split(KEY_NAME).length === 2 && code.includes(`process.env.${KEY_NAME}`), 'the function only reads the key from process.env');

console.log(`qa-ask: ${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
