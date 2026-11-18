// Full kanji QA in batches of 100 kanji — each batch is its own `node tools/qa-site.mjs kanji --batch N` run with its
// own report in qa/kanji/bNN/, so an interruption loses at most one batch. Finished batches are skipped on a re-run.
//
//   node tools/qa-kanji-full.mjs            run the missing batches, then merge → qa/kanji/report.md
//   node tools/qa-kanji-full.mjs 3 4        run only batches 3 and 4 (again, even if finished)
//   node tools/qa-kanji-full.mjs --merge    only merge the batch reports
//   node tools/qa-kanji-full.mjs --list     print the batch commands (to run them by hand)
// Quick check after a change (20 kanji, desktop + phone): node tools/qa-site.mjs kanji --quick   (→ qa/quick/)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa', 'kanji');
const kanji = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/kanji.json'), 'utf8')).books;
const total = kanji.reduce((n, b) => n + b.lessons.reduce((m, l) => m + l.kanji.length, 0), 0);
const N = Math.ceil(total / 100);
const args = process.argv.slice(2);
const pick = args.filter(a => /^\d+$/.test(a)).map(Number);
const dirOf = b => path.join(OUT, 'b' + String(b).padStart(2, '0'));
const finished = b => { try { return !String(JSON.parse(fs.readFileSync(path.join(dirOf(b), 'report.json'), 'utf8')).finished).startsWith('(partial'); } catch { return false; } };

if (args.includes('--list')) {
  for (let b = 1; b <= N; b++) console.log(`node tools/qa-site.mjs kanji --batch ${b}    # kanji ${(b - 1) * 100 + 1}–${Math.min(b * 100, total)}${finished(b) ? '  (done)' : ''}`);
  process.exit(0);
}
if (!args.includes('--merge')) {
  const todo = pick.length ? pick : Array.from({ length: N }, (_, i) => i + 1).filter(b => !finished(b));
  console.log(`${total} kanji · ${N} batches · to run: ${todo.join(', ') || 'none'}`);
  for (const b of todo) {
    console.log(`\n=== batch ${b}/${N} (kanji ${(b - 1) * 100 + 1}–${Math.min(b * 100, total)})`);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/qa-site.mjs'), 'kanji', '--batch', String(b), ...args.filter(a => a === '--no-shots')], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) { console.error(`batch ${b} failed (exit ${r.status}) — re-run the same command to continue`); process.exit(1); }
  }
}
// ---------- merge ----------
const reps = [];
for (let b = 1; b <= N; b++) { try { reps.push({ b, ...JSON.parse(fs.readFileSync(path.join(dirOf(b), 'report.json'), 'utf8')) }); } catch {} }
const sum = k => reps.reduce((n, r) => n + (r[k] || 0), 0);
const issues = reps.flatMap(r => r.issues.map(i => ({ ...i, b: r.b })));
const missing = Array.from({ length: N }, (_, i) => i + 1).filter(b => !finished(b));
const fmt = s => (s < 5400 ? `${Math.round(s / 60)} хв` : `${(s / 3600).toFixed(1)} год`);
let md = `# Kanji QA (batches) ${new Date().toISOString()}\n\nBatches: ${reps.length}/${N}${missing.length ? ` · NOT finished: ${missing.join(', ')}` : ''} · steps: ${sum('steps')} · writing-mode kanji: ${sum('kwChecked')} · issues: ${issues.length} · time: ${fmt(sum('seconds'))}\n`;
md += `Font checks: ${sum('fontChecked')} (cached: ${sum('fontSkipped')})\n`;
const byType = {};
for (const i of issues) (byType[i.t] ||= []).push(i);
for (const [t, list] of Object.entries(byType)) {
  md += `\n## ${t} (${list.length})\n`;
  for (const i of list.slice(0, 300)) md += `- [b${i.b} ${i.v}] ${i.step} — ${i.el || ''} ${i.d || ''} ${i.x ? '«' + i.x + '»' : ''}\n`;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log('\n' + md.slice(0, 3000));
