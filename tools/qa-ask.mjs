// Static checks of the exam's AI helper (Puter.js in the browser, no server function, no key). No network.
//   node tools/qa-ask.mjs
// The browser behaviour (sign-in, answers, errors) is tested by tools/qa-ask-ui.mjs with a mocked Puter.js.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, fails = 0;
const ok = (c, name, extra = '') => { if (c) passed++; else { fails++; console.log('FAIL', name, extra); } };

// ---------- the Gemini backend is gone ----------
ok(!fs.existsSync(path.join(ROOT, 'site/api/ask.js')) && !fs.existsSync(path.join(ROOT, 'api/ask.js')), 'no api/ask.js');
ok(fs.existsSync(path.join(ROOT, 'site/api/save-set.js')), 'save-set.js is still there');
ok(fs.readFileSync(path.join(ROOT, 'site/api/save-set.js'), 'utf8').includes('process.env.APP_PASSWORD'), 'save-set.js still checks APP_PASSWORD');

// ---------- no Google / Gemini key or endpoint anywhere under site/ and api/ ----------
const files = [];
const walk = d => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
walk(path.join(ROOT, 'site'));
walk(path.join(ROOT, 'api'));
ok(files.length > 20, 'the scan sees the site', files.length);
const BAD = [
  ['a Google API key (AIza…)', /AIza[0-9A-Za-z_-]{20,}/],
  ['GEMINI_API_KEY', /GEMINI_API_KEY/],
  ['the Gemini endpoint', /generativelanguage\.googleapis\.com/],
  ['a Gemini model name', /gemini-\d/i],
];
for (const f of files) {
  if (/\.(png|jpe?g|gif|webp|woff2?|ico)$/i.test(f)) continue;
  const text = fs.readFileSync(f, 'latin1'), rel = path.relative(ROOT, f).replace(/\\/g, '/');
  for (const [what, re] of BAD) ok(!re.test(text), `no ${what}: ${rel}`);
}

// ---------- the helper ----------
const src = fs.readFileSync(path.join(ROOT, 'site/js/ai-helper.js'), 'utf8');
ok(src.includes("'https://js.puter.com/v2/'"), 'Puter.js from its documented URL');
ok(!/fetch\(\s*['"`]api\/ask/.test(src) && !/password/i.test(src.replace(/\/\/.*$/gm, '')), 'no /api/ask call and no password in the helper');
ok(/s\.defer = true/.test(src), 'the script is added with defer');
ok(/puter\.auth\.isSignedIn\(\)/.test(src) && /puter\.auth\.signIn\(\)/.test(src), 'documented sign-in calls');
ok(/puter\.ai\.chat\(messages, false, \{ model/.test(src), 'documented chat call with a model');
ok(/'Щоб отримати пояснення, увійдіть у безкоштовний акаунт Puter'/.test(src), 'sign-in message');
ok(/'Не вдалося отримати відповідь, спробуйте ще раз'/.test(src), 'failure message');
for (const phrase of ['patient Japanese teacher', 'Minna no Nihongo', 'Answer in Ukrainian', 'name the grammar point', '150 words', 'only in kana', 'never romaji', 'Do not invent facts', 'contact the developer'])
  ok(src.includes(phrase), `system prompt: ${phrase}`);
ok(/sessionStorage\.getItem[^\n]*\}\s*catch/.test(src) && /sessionStorage\.setItem[^\n]*\}\s*catch/.test(src), 'sessionStorage in try/catch');
ok(/aria-live="polite"/.test(src) && /MAX_INPUT = 1000/.test(src), 'aria-live answer area, 1000-character limit');
// Puter.js only where the helper is: not in the page; only the exam modules and the grammar lesson use the helper
ok(!/puter/i.test(fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8')), 'index.html does not load Puter.js');
const users = fs.readdirSync(path.join(ROOT, 'site/js')).filter(f => f !== 'ai-helper.js' && /ai-helper\.js|puter/i.test(fs.readFileSync(path.join(ROOT, 'site/js', f), 'utf8')));
ok(users.every(f => f.startsWith('exam') || f === 'grammar.js') && users.includes('grammar.js') && users.includes('exam.js'), 'the exam modules and grammar.js use the one shared helper', users.join(', '));
ok(!fs.existsSync(path.join(ROOT, 'site/js/exam-ask.js')), 'no second copy: exam-ask.js is gone');
ok(src.includes('`${SYSTEM}\\n\\n${MATERIAL_INTRO}\\n\\n${material}`'), 'lesson material goes into the system prompt after the rules');
ok(/logKey: `jp\.ask\.grammar\.\$\{n\}`/.test(fs.readFileSync(path.join(ROOT, 'site/js/grammar.js'), 'utf8')), 'grammar: own history per lesson');

console.log(`qa-ask: ${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
