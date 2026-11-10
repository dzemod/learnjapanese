// Exam task instructions carry no hint in brackets (e.g. «Напишіть дієслово у потрібній формі (て-форма)»).
//   node tools/test-exam-labels.mjs
// Checks every `label:` of a question builder in site/js/exam.js (string and template literals, both sides of
// `a ? 'x' : 'y'`), the section tasks of the university version (univ-paper.js SECTIONS) and the instruction-like
// fields of the banks. The browser QA (qa-site.mjs) also checks the rendered `.q-label` / `.u-task`.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, fails = 0;
const ok = (c, name, extra = '') => { if (c) passed++; else { fails++; console.log('FAIL', name, extra); } };
const HINT = /[(（][^)）]*[)）]|[(（]/;

// ---------- question builders ----------
const src = fs.readFileSync(path.join(ROOT, 'site/js/exam.js'), 'utf8');
const labels = [];
for (const m of src.matchAll(/\blabel:\s*([^\n]*)/g)) {
  // the value up to the next property (", key:") — enough for one-line labels
  const val = m[1].split(/,\s*(?:prompt|kind|mode|options|answer|uid|type)\s*:/)[0];
  for (const lit of val.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) labels.push(lit[1] ?? lit[2]);
}
ok(labels.length >= 15, 'labels found in exam.js', labels.length);
for (const l of labels) {
  ok(!HINT.test(l.replace(/\$\{[^}]*\}/g, '')), `no hint in brackets: «${l}»`);
}
ok(!/label:\s*`[^`]*\(\$\{/.test(src), 'no «(${…})» appended to a label');
ok(labels.includes('Напишіть дієслово у потрібній формі'), 'verb task asks for the form without naming it');
// labels may insert a value: only formName(f) is allowed, and it must come out without brackets for every form
const inserted = labels.flatMap(l => [...l.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].trim()));
ok(inserted.every(x => x === 'formName(f)'), 'only formName(f) is inserted into a label', inserted.join(', '));
const fn = /const formName = f => FORMS\[f\]\.label\.replace\((\/.*\/g), ''\);/.exec(src);
ok(!!fn, 'formName strips the bracketed note');
if (fn) {
  const re = eval(fn[1]); // eslint-disable-line no-eval -- the regex literal from exam.js
  const { FORMS } = await import(pathToFileURL(path.join(ROOT, 'site/js/conjugate.js')).href);
  for (const [k, f] of Object.entries(FORMS)) ok(!HINT.test(f.label.replace(re, '')), `form ${k}: task name without brackets`, f.label.replace(re, ''));
}

// ---------- university version ----------
const { SECTIONS } = await import(pathToFileURL(path.join(ROOT, 'site/js/univ-paper.js')).href);
ok(SECTIONS.length === 7, 'seven sections');
for (const s of SECTIONS) ok(!HINT.test(s.task) && !HINT.test(s.title), `section ${s.s}: no hint in brackets`, s.task);

// ---------- banks: no instruction / hint fields ----------
for (const f of ['site/data/exam.json', 'site/data/exam-univ.json']) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(!/"(label|task|hint|instr)"\s*:/.test(text), `${f}: no instruction or hint fields`);
}

console.log(`test-exam-labels: ${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
