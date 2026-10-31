# Kotoba — personal Japanese ⇄ Ukrainian flashcards

## PERMANENT RULES — adding words

1. When I send a screenshot, photo, PDF or text with words, extract the Japanese–Ukrainian pairs exactly as written (add the hiragana reading for kanji), add them as the set I name (source: my), skip duplicates, list anything unclear, then commit and push to main.

2. (earlier rule, still valid) When I send a screenshot, photo or file with words (Japanese + Ukrainian), extract every word pair exactly as written and add them to data/sets.json as a new set (ask me the set name or use today's date) or to the set I name. Skip duplicates, list anything unclear instead of guessing, show me a table of the added words, then commit and push to main.

### How to apply them
- The word file is **`site/data/sets.json`** ("data/sets.json" in the rules = this file; it lives inside `site/` because Vercel's Root Directory is `site`). It is the permanent storage.
- Set: `{ "id", "title", "dateCreated" (YYYY-MM-DD), "source" ("textbook" | "my"), "cards": [...] }`
- Card: `{ "id", "kanji", "kana", "ukrainian", "verbGroup", "hint", "section", "source" }`
  - `kanji` — word as written with kanji, `""` if the word has no kanji
  - `kana` — reading in kana (for kana-only words: the word itself). For my words with kanji, add the hiragana reading yourself.
  - `ukrainian` — meaning exactly as written
  - `verbGroup` — `"I"`, `"II"`, `"III"` or `""`
  - `hint` — usage hint in square brackets as written, e.g. `"[じかんに～]"`, else `""`
  - `section` — `"main"`, `"dialogue"` (◊ 会話 ◊), `"reading"` (読み物)
  - `source` — `"textbook"` or `"my"`
  - optional `"check": true` = word from OCR / auto-generated reading that I still need to check (shown with a «перевірити» badge)
- Ids: set ids are lowercase slugs (`mnn-01`, `my-…`); card ids `<setId>-<n>`; never reuse or renumber ids (browser progress is keyed by `setId/cardId`).
- Keep the file layout: one card per line (same format the save API writes). Validate before committing:
  `node -e "JSON.parse(require('fs').readFileSync('site/data/sets.json','utf8'))"`
- Duplicates = same kanji/kana with the same meaning already in the target set — skip and report them.
- Always show me a table of the added words, then `git commit` and `git push origin main`.

## Textbook (Minna no Nihongo, Ukrainian edition) — local only, never commit
- `learnjapanesetextbook/minna-1.pdf` — Part I: "Вступний урок" + lessons 1–25. PDF page = book page + 20 (lesson 1 on PDF page 32; contents PDF 14–20).
- `learnjapanesetextbook/minna-2.pdf` — Part II: lessons 26–50. PDF page = book page + 23 (lesson 26 on PDF page 27; contents PDF 13–20).
- Vocabulary section "I. Нові слова та вирази": columns kana | kanji | Ukrainian; verbs marked I/II/III; hints in [ ]; sub-lists ◊ 会話 ◊ (section "dialogue") and 読み物 (section "reading"); lines starting with ※ are proper names — skip.
- Textbook sets: id `mnn-00` (Вступний урок), `mnn-01` … `mnn-50`, `source: "textbook"`.
- Imported: Вступний урок + all lessons 1–50 (2,217 words). Proper names (※ in Part II; fictional names/landmarks after the wavy line in Part I) are skipped; real countries/cities without ※ are kept. Home page groups them as Частина I (0–25) and Частина II (26–50).

## Grammar tab — `site/data/grammar.json`
- `{ lessons: [{ lesson, points: [{ id: "<lesson>-<n>", title, blocks: [...] }] }] }`; blocks: `{h}` subheading, `{p}` paragraph, `{note}`, `{table: [[...]]}`, `{ex, uk, src?, check?}` example (`src` = "文型 1" / "例文 3"; `check: true` = my translation because the translation book's sentence differs from the main book — different editions).
- Japanese text uses furigana markup `{漢字|かんじ}` (shown as 漢字(かんじ)); every kanji in examples gets a reading.
- Source: `minna-1/2.pdf` "IV. Граматика" (explanation exactly as written) + main book 文型/例文 with translations from "II. Переклад". Main book lesson starts: L1 p6, L2 p14, L3 p22, L4 p32, L5 p40 (≈8–10 pages per lesson).
- Add lessons: write `L06-10.js` (CommonJS array of lessons, same shape) in a temp dir, run `node tools/build-grammar.js <dir>` (upserts only those lessons).

## Kanji tab — `site/data/kanji.json`
- `{ books: [{ id: "k300"|"k700", title, titleJp, source, lessons: [{ id: "k300-01", no, title, titleUk, range, kanji: [...] }] }] }`, one kanji per line.
- Kanji: `{ id: "k300-001", no, kanji, strokes, radical, en, meaning, on: [katakana], kun: [hiragana, okurigana after "-"], check, examples: [{ id: "k300-001-1", word, kana, en, uk, check }] }`. `meaning`/`uk` are translated from the book's English → `check: true`.
- Each lesson is also two study sets for the normal modes: `<lessonId>` (kanji) and `<lessonId>-w` ("Слова уроку N"); progress keys `k300-01/k300-001`, `k300-01-w/k300-001-1` — never renumber ids.
- Edits on the site go to `/api/save-set` with `action: "kanji-lesson"` (writes kanji.json).
- Add lessons: write `k300-03.js` (`module.exports = { book, no, title, titleUk, range, kanji: [[no, kanji, strokes, radical, en, uk, [on], [kun], [[word, kana, en, uk], ...]], ...] }`) in a temp dir, run `node tools/add-kanji.js <dir>` (never overwrites existing lessons).
- kanji-300 PDF: lesson 1 kanji on PDF pp. 27–34, lesson 2 pp. 37–44 (4 kanji per full page + 1 on the next page, then exercises). Book has 15 lessons (contents PDF p. 4–5).
- Stroke order: KanjiVG SVGs from jsDelivr (CC BY-SA 3.0, attribution shown in the kanji card).

## Exam tab — `site/js/exam.js`, `site/data/exam.json`, `site/js/conjugate.js`
- `#/exam` setup (lesson range, Мої уроки, kanji book/range, task types, count / full mock, timer, presets), `#/exam/run`, `#/exam/result`. Session in sessionStorage (`jp.examSession`), history in localStorage (`jp.examHistory`), presets in localStorage + `site/data/exam-presets.json` (API action `exam-presets`).
- Bank `exam.json`: `{ lessons: [{ lesson, items: [...] }] }`, items: `t:"p"` particle blank, `t:"v"` verb form, `t:"tr"` translation (+ distractors `d`), `t:"e"` error finding. Each item: `l` lesson, `pt` grammar point for the reference, `spt` point of the sentence, `x` explanation (from IV. Граматика / conjugation rules).
- Build/refresh per lessons: `npm i --no-save kuromoji@0.1.2` (or `KUROMOJI=<path>`), then `node tools/build-exam.js <from> <to>` — run after adding grammar lessons.
- Particle explanations = rules in `tools/build-exam.js` (`explainParticle`) — add rules for lessons 26–50 when their grammar is imported; verb forms of lessons 26+ need `FORMS[...].point` in `conjugate.js` (potential 27, volitional 31, imperative 33, ば 35, passive 37, causative 48).
- References: grammar `#/grammar/<l>/<pointId>`, kanji `#/kanji/<lessonId>/<kanjiId>`, words `#/set/<id>`; floating «Повернутися до екзамену» button (exam.js `returnButton`).

## Progress of the textbook import (update after each batch)
- Grammar: ALL lessons 1–50 done (exam bank 1–50). Part II II/IV: L46 149,151–152 · L47 155,157–158 · L48 161,163–164 · L49 167,169–170 · L50 173,175–176; main L46 172 · L47 180 · L48 188 · L49 196 · L50 204. L41 119,121–122 · L42 125,127–128 · L43 131,133–134. L36 89,91–92 · L37 95,97–98 · L38 101,103–104 · L39 107,109–110 · L40 113,115–116 · L41 starts 117; main L38 104, L39 112, L40 120, L41 129. Part II II/IV pages: L31 59,61–62 · L32 65,67–68 · L33 71,73–74 · L34 77,79–80 · L35 83,85–86 · L36 starts 87; main L34 68, L35 76, L36 88, L37 96. Part II (minna-2.pdf): L26 29,31–32 · L27 35,37–38 · L28 41,43–44 · L29 47,49–50 · L30 53,55–56 · L31 59,61–62 (lesson start +2 = II, +4..+5 = IV); main Part II: L26 p2, L27 10, L28 18, L29 26, L30 34, L31 44, L32 52, L33 60. L22 160,162–163 · L23 166,168–169 · L24 172,174–175 · L25 178,180–181; main L22 186, L23 196, L24 204, L25 212. L17 130,132–133 · L18 136,138–139 · L19 142,144–145 · L20 148,150–151 · L21 154,156–157; main L16 134, L17 144, L18 152, L19 160, L20 170, L21 178. L12 100,102–103 · L13 106,108–109 · L14 112,114–115 · L15 118,120–121 · L16 124,126–127; main L12 98, L13 110, L14 118, L15 126. Translation book pages: L6 64,66–67 · L7 70,72–73 · L8 76,78–79 · L9 82,84–85 · L10 88,90–91 · L11 94,96–97 (pattern: lesson start, vocab, II at +2, III at +3, IV at +4..+5). Main book: L6 48, L7 56, L8 66, L9 74, L10 82, L11 90.
- Kanji: kanji-300 lessons 1–4 done (80 kanji); NEXT 5課 PDF 69–76, 6課 83–90, 7課 93–100, 8課 103–110 (title page −1, odd page = 4 kanji, next even page top = 1 kanji; PDF page = book page). kanji-700 not started.
- Scans are read by rendering pages to PNG with the `mupdf` npm package (no Python/poppler on this PC).

## Merging a browser export
"Export words for Claude" downloads `kotoba-sets-YYYY-MM-DD.json` (`{ sets, hiddenSets }`, same card format). Upsert sets by id, ask before removing `hiddenSets`, show a summary table, commit and push.

## Project
- Plain HTML/CSS/JS, no build step: `site/index.html`, `site/css/style.css`, `site/js/*.js` (ES modules).
  - `store.js` data/progress/sync/undo, `modes.js` study modes, `views.js` pages, `edit.js` word editing + bulk edit, `importer.js` OCR/PDF/readings (Tesseract.js, pdf.js, Kuroshiro — loaded lazily from CDNs), `grammar.js` Граматика tab (`#/grammar`, `#/grammar/<n>`), `kanji.js` Канджі tab (`#/kanji`, `#/kanji/<lessonId>`, virtual study sets, kanji editor, stroke order).
  - Top tabs: Слова (`#/`) · Граматика · Канджі.
- `site/api/save-set.js` — Vercel serverless function; commits a whole edited set into `site/data/sets.json` via the GitHub API (env `GITHUB_TOKEN`, `APP_PASSWORD`; see SETUP.md). Any set can be edited (textbook sets keep `source: "textbook"`); textbook sets cannot be deleted through it.
- Editing on the site: inline edit / add / delete on the set page, edit buttons inside every study mode, bulk edit at `#/set/<id>/edit` (reorder + edit all), undo toast, per-word history (last 5 versions, browser only). Edited sets are kept as a local copy (`jp.custom.newSets`) until the redeployed sets.json matches, so nothing is lost if saving fails.
- Card ids must never change when editing — learning progress is keyed by `setId/cardId`.
- Progress, stars, unsynced lessons, streak, best times: browser localStorage (`jp.*`), Export/Import backup on the home page.
- Everything must stay 100% free: no paid/AI APIs.
- Run locally: `npx serve site` (the save API only works on Vercel or with `vercel dev`).

## Review (REVIEW.md)
- Review in progress (user request): batches words 1–10 … 41–50, grammar by 10, kanji by chapters, exam bank, interface; after each batch commit "Review: …" and update REVIEW.md (corrections table, «Потребує перевірки», statistics). Done: batch 1 (words 0–10 + global typography), batch 2 (words 11–20), batch 3 (words 21–30), batch 4 (words 31–40).
- After rebuilding grammar/exam always run `node tools/typo-uk.js` (quotes «», apostrophe ’, dash —, …).
- Transcription: kana only for readings; Cyrillic names/terms by the Ukrainian (Kovalenko) system (し сі, ち ті, じ дзі, つ цу, しゃ ся, ちゃ тя, じゃ дзя).
