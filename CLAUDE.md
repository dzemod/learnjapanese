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

## Progress of the textbook import (update after each batch)
- Grammar: lessons 1–5 done.
- Kanji: kanji-300 lessons 1–2 done (40 kanji); kanji-700 not started.
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
