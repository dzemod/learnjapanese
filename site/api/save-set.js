// Vercel serverless function: saves one of "my lessons" into site/data/sets.json in the GitHub repo.
// Free: runs on Vercel Hobby, uses the GitHub REST API with a fine-grained token.
//   GITHUB_TOKEN  — fine-grained token, "Contents: Read and write", only for the learnjapanese repo
//   APP_PASSWORD  — your own password, asked once on each device
// Optional: GITHUB_REPO (default dzemod/learnjapanese), GITHUB_BRANCH (default main)
const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'dzemod/learnjapanese';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE = 'site/data/sets.json';
const KANJI_FILE = 'site/data/kanji.json';
const MAX_CARDS = 3000;

function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kotoba-flashcards',
      ...(opts.headers || {}),
    },
  });
}

function ghError(status) {
  const e = new Error(
    status === 401 ? 'GitHub-токен недійсний або прострочений. Створіть новий токен (див. SETUP.md) і оновіть GITHUB_TOKEN у Vercel.'
      : status === 403 ? 'GitHub-токен не має дозволу на запис. Потрібен доступ «Contents: Read and write» до репозиторію learnjapanese.'
      : status === 404 ? `Репозиторій ${REPO} або гілку ${BRANCH} не знайдено — перевірте, що токен має доступ до цього репозиторію.`
      : `Помилка GitHub (${status}). Спробуйте ще раз за хвилину.`);
  e.status = status === 409 || status === 422 ? 409 : 502;
  e.code = status === 409 || status === 422 ? 'conflict' : 'github';
  return e;
}

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function cleanSet(s) {
  if (!s || typeof s !== 'object') throw Object.assign(new Error('Неправильні дані уроку.'), { status: 400 });
  const id = str(s.id, 100);
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/i.test(id)) throw Object.assign(new Error('Неправильний ідентифікатор уроку.'), { status: 400 });
  if (!Array.isArray(s.cards) || s.cards.length > MAX_CARDS) throw Object.assign(new Error('Неправильний список слів.'), { status: 400 });
  return {
    id,
    title: str(s.title, 200) || id,
    dateCreated: /^\d{4}-\d{2}-\d{2}$/.test(s.dateCreated) ? s.dateCreated : new Date().toISOString().slice(0, 10),
    source: s.source === 'textbook' ? 'textbook' : 'my',
    cards: s.cards.map((c, i) => {
      const card = {
        id: str(c.id, 80) || `${id}-${i + 1}`,
        kanji: str(c.kanji), kana: str(c.kana), ukrainian: str(c.ukrainian),
        verbGroup: ['I', 'II', 'III'].includes(c.verbGroup) ? c.verbGroup : '',
        hint: str(c.hint, 200), section: ['main', 'dialogue', 'reading'].includes(c.section) ? c.section : 'main',
        source: c.source === 'textbook' ? 'textbook' : 'my',
      };
      if (c.check) card.check = true;
      return card;
    }).filter(c => (c.kanji || c.kana) && c.ukrainian),
  };
}

/** Same layout as the hand-edited file: one card per line. */
function format(data) {
  const sets = data.sets.map(s => {
    const { cards = [], ...meta } = s;
    const head = Object.entries(meta).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    const body = cards.length ? `[\n${cards.map(c => '        ' + JSON.stringify(c)).join(',\n')}\n      ]` : '[]';
    return `    {\n${head},\n      "cards": ${body}\n    }`;
  });
  return `{\n  "sets": [\n${sets.join(',\n')}\n  ]\n}\n`;
}

/** kanji.json layout: one kanji per line. */
function formatKanji(data) {
  const NL = "\n";
  const books = (data.books || []).map(b => {
    const { lessons = [], ...meta } = b;
    const head = Object.entries(meta).map(([k, v]) => "      " + JSON.stringify(k) + ": " + JSON.stringify(v)).join("," + NL);
    const ls = lessons.map(l => {
      const { kanji = [], ...lm } = l;
      const lh = Object.entries(lm).map(([k, v]) => "          " + JSON.stringify(k) + ": " + JSON.stringify(v)).join("," + NL);
      return "        {" + NL + lh + "," + NL + "          \"kanji\": [" + NL + kanji.map(k => "            " + JSON.stringify(k)).join("," + NL) + NL + "          ]" + NL + "        }";
    });
    return "    {" + NL + head + "," + NL + "      \"lessons\": [" + NL + ls.join("," + NL) + NL + "      ]" + NL + "    }";
  });
  return "{" + NL + "  \"books\": [" + NL + books.join("," + NL) + NL + "  ]" + NL + "}" + NL;
}

function cleanKanjiLesson(l) {
  const bad = () => Object.assign(new Error('Неправильні дані уроку канджі.'), { status: 400 });
  if (!l || typeof l !== 'object' || !/^k\d+-\d+$/.test(String(l.id)) || !Array.isArray(l.kanji) || l.kanji.length > 200) throw bad();
  const list = v => (Array.isArray(v) ? v : []).map(x => str(x, 40)).filter(Boolean).slice(0, 20);
  return {
    ...l,
    kanji: l.kanji.map(k => {
      if (!k || typeof k !== 'object' || !k.id || !k.kanji) throw bad();
      const out = {
        id: str(k.id, 40), no: +k.no || 0, kanji: str(k.kanji, 4), strokes: +k.strokes || 0, radical: str(k.radical, 10),
        en: str(k.en, 200), meaning: str(k.meaning, 200), on: list(k.on), kun: list(k.kun),
        examples: (Array.isArray(k.examples) ? k.examples : []).slice(0, 60).map(e => {
          const x = { id: str(e.id, 60), word: str(e.word, 60), kana: str(e.kana, 80), en: str(e.en, 200), uk: str(e.uk, 300) };
          if (e.check) x.check = true;
          return x;
        }).filter(e => e.id && e.word),
      };
      if (k.check) out.check = true;
      return out;
    }),
  };
}

async function saveKanjiLesson(res, raw) {
  const lesson = cleanKanjiLesson(raw);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readFile(KANJI_FILE);
    let found = false;
    for (const b of data.books || []) {
      const i = (b.lessons || []).findIndex(l => l.id === lesson.id);
      if (i >= 0) { b.lessons[i] = { ...b.lessons[i], kanji: lesson.kanji }; found = true; }
    }
    if (!found) return res.status(404).json({ error: 'Такого уроку канджі немає в kanji.json.' });
    try {
      await writeFile(data, sha, `Update kanji lesson ${lesson.id} from the site`, KANJI_FILE);
      return res.status(200).json({ ok: true });
    } catch (e) {
      if (e.code !== 'conflict' || attempt === 2) throw e;
    }
  }
}

async function readFile(file = FILE) {
  const r = await gh(`contents/${file}?ref=${encodeURIComponent(BRANCH)}`);
  if (r.status === 404) return { sha: undefined, data: file === FILE ? { sets: [] } : { books: [] } };
  if (!r.ok) throw ghError(r.status);
  const j = await r.json();
  let b64 = j.content;
  if (!b64) { // files > 1 MB: fetch the blob
    const b = await gh(`git/blobs/${j.sha}`);
    if (!b.ok) throw ghError(b.status);
    b64 = (await b.json()).content;
  }
  const data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  if (file === FILE && !Array.isArray(data.sets)) data.sets = [];
  return { sha: j.sha, data };
}

async function writeFile(data, sha, message, file = FILE) {
  const r = await gh(`contents/${file}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(file === FILE ? format(data) : formatKanji(data), 'utf8').toString('base64'), sha, branch: BRANCH }),
  });
  if (!r.ok) throw ghError(r.status);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(process.env.GITHUB_TOKEN && process.env.APP_PASSWORD);
  if (req.method === 'GET') return res.status(200).json({ configured });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не підтримується.' });
  if (!configured) {
    return res.status(503).json({ code: 'not_configured', error: 'Збереження в GitHub ще не налаштоване: у Vercel немає GITHUB_TOKEN або APP_PASSWORD (див. SETUP.md). Урок збережено в цьому браузері.' });
  }

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body || '{}'); } catch { body = null; }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Неправильний запит.' });
  if (!safeEqual(body.password, process.env.APP_PASSWORD)) {
    return res.status(401).json({ code: 'bad_password', error: 'Неправильний пароль. Спробуйте ще раз.' });
  }
  if (body.action === 'check') return res.status(200).json({ ok: true });

  try {
    if (body.action === 'kanji-lesson') return await saveKanjiLesson(res, body.lesson);
    let set = null, setId = '';
    if (body.action === 'upsert') { set = cleanSet(body.set); setId = set.id; }
    else if (body.action === 'delete') { setId = str(body.setId, 100); }
    else return res.status(400).json({ error: 'Невідома дія.' });

    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, data } = await readFile();
      const idx = data.sets.findIndex(s => s.id === setId);
      if (!set && idx >= 0 && data.sets[idx].source === 'textbook') {
        return res.status(403).json({ error: 'Уроки з підручника не можна видаляти через сайт.' });
      }
      if (set && idx >= 0) set.source = data.sets[idx].source === 'textbook' ? 'textbook' : set.source;
      let message;
      if (set) {
        if (idx >= 0) { set.dateCreated = data.sets[idx].dateCreated || set.dateCreated; data.sets[idx] = set; }
        else data.sets.push(set);
        message = `${idx >= 0 ? 'Update' : 'Add'} lesson "${set.title}" (${set.cards.length} words) from the site`;
      } else {
        if (idx < 0) return res.status(200).json({ ok: true, unchanged: true });
        message = `Delete my lesson "${data.sets[idx].title}" from the site`;
        data.sets.splice(idx, 1);
      }
      try {
        await writeFile(data, sha, message);
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code !== 'conflict' || attempt === 2) throw e;
      }
    }
  } catch (e) {
    return res.status(e.status && e.status < 500 ? e.status : 502).json({ code: e.code || 'error', error: e.message || 'Невідома помилка.' });
  }
};
