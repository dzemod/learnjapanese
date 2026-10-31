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
- Imported so far: Вступний урок, lessons 1–5.

## Merging a browser export
"Export words for Claude" downloads `kotoba-sets-YYYY-MM-DD.json` (`{ sets, hiddenSets }`, same card format). Upsert sets by id, ask before removing `hiddenSets`, show a summary table, commit and push.

## Project
- Plain HTML/CSS/JS, no build step: `site/index.html`, `site/css/style.css`, `site/js/*.js` (ES modules).
  - `store.js` data/progress/sync/undo, `modes.js` study modes, `views.js` pages, `edit.js` word editing + bulk edit, `importer.js` OCR/PDF/readings (Tesseract.js, pdf.js, Kuroshiro — loaded lazily from CDNs).
- `site/api/save-set.js` — Vercel serverless function; commits a whole edited set into `site/data/sets.json` via the GitHub API (env `GITHUB_TOKEN`, `APP_PASSWORD`; see SETUP.md). Any set can be edited (textbook sets keep `source: "textbook"`); textbook sets cannot be deleted through it.
- Editing on the site: inline edit / add / delete on the set page, edit buttons inside every study mode, bulk edit at `#/set/<id>/edit` (reorder + edit all), undo toast, per-word history (last 5 versions, browser only). Edited sets are kept as a local copy (`jp.custom.newSets`) until the redeployed sets.json matches, so nothing is lost if saving fails.
- Card ids must never change when editing — learning progress is keyed by `setId/cardId`.
- Progress, stars, unsynced lessons, streak, best times: browser localStorage (`jp.*`), Export/Import backup on the home page.
- Everything must stay 100% free: no paid/AI APIs.
- Run locally: `npx serve site` (the save API only works on Vercel or with `vercel dev`).
