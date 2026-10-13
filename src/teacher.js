// Teacher console API (everything under /api/t/*), plus teacher sign-in.

import { CODES, TAGS, HIDDEN_CODES } from './rules.js';
import { prepare, buildSlots, stripToPrompt, diffTokens, tokenize, normalizeText, displayText, describeSlot, checkMode1 } from './engine.js';
import { saveVerb, writeForms, cleanTags, cleanWord, validWord, regularPast } from './verbs.js';
import { signToken, safeEqual, teacherConfigured, newClassCode } from './auth.js';
import { HttpError, json, readJson, clientIp, rateLimited, clip, int, cleanUser, validUser, suggestUsername } from './util.js';

export async function teacherLogin(request, env) {
  if (!teacherConfigured(env)) throw new HttpError(503, 'Teacher sign-in is not set up yet. Set the teacher_user and teacher_password secrets in Cloudflare.');
  if (await rateLimited(env, 'RL_LOGIN', clientIp(request))) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
  const body = await readJson(request);
  const [u, p] = await Promise.all([safeEqual(clip(body.username, 100), env.teacher_user), safeEqual(clip(body.password, 200), env.teacher_password)]);
  if (!(u && p)) throw new HttpError(401, 'Wrong username or password.');
  return json({ token: await signToken(env, { r: 't' }, 8 * 3600) });
}

const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

// ---------- classes & pupils ----------

async function listClasses(env) {
  const rows = (
    await env.DB
      .prepare(
        `SELECT c.id, c.name, c.code, c.archived, c.created_at,
                (SELECT COUNT(*) FROM pupils p WHERE p.class_id = c.id) AS pupils
           FROM classes c ORDER BY c.archived, c.name`,
      )
      .all()
  ).results;
  const guests = (await env.DB.prepare('SELECT COUNT(*) AS n FROM pupils WHERE is_guest = 1').first()).n;
  return json({ classes: rows, guests });
}

async function createClass(request, env) {
  const body = await readJson(request);
  const name = clip(body.name, 60).trim();
  if (!name) throw new HttpError(400, 'Give the class a name.');
  for (let i = 0; i < 12; i++) {
    try {
      const row = await env.DB.prepare('INSERT INTO classes (name, code, created_at) VALUES (?1, ?2, ?3) RETURNING id, name, code').bind(name, newClassCode(), Date.now()).first();
      return json({ class: row });
    } catch (e) {
      if (!/UNIQUE/i.test(String(e?.message))) throw e;
    }
  }
  throw new HttpError(500, 'Could not create a unique class code. Try again.');
}

async function updateClass(request, env, id) {
  const body = await readJson(request);
  if (body.name !== undefined) {
    const name = clip(body.name, 60).trim();
    if (!name) throw new HttpError(400, 'Give the class a name.');
    await env.DB.prepare('UPDATE classes SET name = ?1 WHERE id = ?2').bind(name, id).run();
  }
  if (body.archived !== undefined) {
    await env.DB.prepare('UPDATE classes SET archived = ?1, sess_ver = sess_ver + 1 WHERE id = ?2').bind(body.archived ? 1 : 0, id).run();
  }
  return json({ ok: true });
}

async function regenCode(request, env, id) {
  const body = await readJson(request);
  for (let i = 0; i < 12; i++) {
    try {
      const code = newClassCode();
      const row = await env.DB
        .prepare(`UPDATE classes SET code = ?1${body.signOut ? ', sess_ver = sess_ver + 1' : ''} WHERE id = ?2 RETURNING code`)
        .bind(code, id)
        .first();
      if (!row) throw new HttpError(404, 'Class not found.');
      return json({ code: row.code, signedOut: !!body.signOut });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (!/UNIQUE/i.test(String(e?.message))) throw e;
    }
  }
  throw new HttpError(500, 'Could not create a unique class code. Try again.');
}

async function deleteClass(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE class_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM pupils WHERE class_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM classes WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true });
}

async function listPupils(env, classId) {
  const rows = (
    await env.DB
      .prepare(
        `SELECT p.id, p.name, p.username, COUNT(a.id) AS attempts, COALESCE(SUM(a.xp), 0) AS xp, MAX(a.ts) AS last_active
           FROM pupils p LEFT JOIN attempts a ON a.pupil_id = p.id
          WHERE p.class_id = ?1 GROUP BY p.id ORDER BY p.name COLLATE NOCASE`,
      )
      .bind(classId)
      .all()
  ).results;
  return json({ pupils: rows });
}

// Turns pasted lines ("Raj Tan" or "Raj Tan, rajt") into proposed pupils, checking for clashes.
async function previewPupils(request, env, classId) {
  const body = await readJson(request);
  const lines = String(body.text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200);
  const existing = new Set((await env.DB.prepare('SELECT username FROM pupils WHERE class_id = ?1').bind(classId).all()).results.map((r) => r.username));
  const taken = new Set(existing);
  const out = [];
  for (const line of lines) {
    if (/^(name|pupil|student)\b.*,\s*(username|user)/i.test(line)) continue; // header row
    const [rawName, rawUser] = line.split(/[,\t;]/).map((s) => s.trim());
    const name = clip(rawName, 60);
    if (!name) continue;
    let username = cleanUser(rawUser || '');
    let status = 'ok';
    if (username) {
      if (!validUser(username)) status = 'invalid';
      else if (taken.has(username)) status = 'duplicate';
    } else username = suggestUsername(name, taken);
    if (status === 'ok') taken.add(username);
    out.push({ name, username, status });
  }
  return json({ rows: out });
}

async function addPupils(request, env, classId) {
  const body = await readJson(request);
  const list = Array.isArray(body.pupils) ? body.pupils.slice(0, 200) : [];
  const cls = await env.DB.prepare('SELECT id FROM classes WHERE id = ?1').bind(classId).first();
  if (!cls) throw new HttpError(404, 'Class not found.');
  const existing = new Set((await env.DB.prepare('SELECT username FROM pupils WHERE class_id = ?1').bind(classId).all()).results.map((r) => r.username));
  const stmts = [];
  const skipped = [];
  let added = 0;
  for (const p of list) {
    const name = clip(p.name, 60).trim();
    const username = cleanUser(p.username);
    if (!name || !validUser(username)) {
      skipped.push({ name: name || '(blank)', reason: 'invalid username' });
      continue;
    }
    if (existing.has(username)) {
      skipped.push({ name, reason: 'username already used in this class' });
      continue;
    }
    existing.add(username);
    stmts.push(env.DB.prepare('INSERT INTO pupils (class_id, name, username, is_guest, created_at) VALUES (?1, ?2, ?3, 0, ?4)').bind(classId, name, username, Date.now()));
    added++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ added, skipped });
}

async function updatePupil(request, env, id) {
  const body = await readJson(request);
  const p = await env.DB.prepare('SELECT id, class_id FROM pupils WHERE id = ?1 AND is_guest = 0').bind(id).first();
  if (!p) throw new HttpError(404, 'Pupil not found.');
  if (body.name !== undefined) {
    const name = clip(body.name, 60).trim();
    if (!name) throw new HttpError(400, 'Name can’t be blank.');
    await env.DB.prepare('UPDATE pupils SET name = ?1 WHERE id = ?2').bind(name, id).run();
  }
  if (body.username !== undefined) {
    const u = cleanUser(body.username);
    if (!validUser(u)) throw new HttpError(400, 'Usernames use 2–24 letters, numbers, dots, dashes or underscores.');
    try {
      await env.DB.prepare('UPDATE pupils SET username = ?1 WHERE id = ?2').bind(u, id).run();
    } catch (e) {
      if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, 'Another pupil in this class already has that username.');
      throw e;
    }
  }
  return json({ ok: true });
}

async function deletePupil(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM attempts WHERE pupil_id = ?1').bind(id), env.DB.prepare('DELETE FROM pupils WHERE id = ?1').bind(id)]);
  return json({ ok: true });
}
async function resetPupil(env, id) {
  await env.DB.prepare('DELETE FROM attempts WHERE pupil_id = ?1').bind(id).run();
  return json({ ok: true });
}

// ---------- questions ----------

function validateQuestion(mode, input, { lowerFirst } = {}) {
  const d = input || {};
  if (mode === 1) {
    const correct = clip(d.correct, 500).trim();
    if (!correct) throw new HttpError(400, 'Type the correct sentence.');
    const tk = prepare(correct);
    if (tk.words.length < 3) throw new HttpError(400, 'The sentence is too short.');
    if (!tk.info.some((i) => i.quotes.length)) throw new HttpError(400, 'The correct sentence needs speech marks around the spoken words.');
    if (tk.info.reduce((n, i) => n + i.quotes.length, 0) % 2) throw new HttpError(400, 'The correct sentence has an unmatched speech mark.');
    const prompt = clip(d.prompt, 500).trim() || stripToPrompt(correct, { lowerFirstSpoken: !!lowerFirst });
    const alts = (Array.isArray(d.alts) ? d.alts : []).map((a) => clip(a, 500).trim()).filter(Boolean).slice(0, 6);
    for (const a of alts) {
      const r = diffTokens(tk, tokenize(normalizeText(a).text));
      if (!r.aligned) throw new HttpError(400, `The alternative “${a}” must use the same words as the correct sentence.`);
    }
    const data = { correct, prompt, alts };
    if (checkMode1({ correct, alts: [] }, prompt).correct) throw new HttpError(400, 'The prompt is already correct — it should be missing punctuation.');
    return data;
  }
  if (mode === 2) {
    const correct = clip(d.correct, 700).trim();
    const faulty = clip(d.faulty, 700).trim();
    if (!correct || !faulty) throw new HttpError(400, 'Enter both the correct version and the faulty version.');
    const r = buildSlots(correct, faulty);
    if (!r.valid) throw new HttpError(400, r.reason);
    return { correct, faulty };
  }
  if (mode === 3) {
    const speaker = clip(d.speaker, 40).trim();
    const line = clip(d.line, 200).trim();
    if (!speaker || !line) throw new HttpError(400, 'Enter the speaker and the line of speech.');
    if (!/[,.!?]$/.test(line)) throw new HttpError(400, 'End the line with punctuation (usually a comma, or ! or ?).');
    const target = cleanTags(d.target);
    if (!target.length) throw new HttpError(400, 'Choose at least one feeling/volume tag the verb must show.');
    return { speaker, line, context: clip(d.context, 300).trim(), target: target.slice(0, 4) };
  }
  throw new HttpError(400, 'Unknown question type.');
}

function preview(mode, data) {
  if (mode === 1) return { prompt: data.prompt, answer: displayText(data.correct, true) };
  if (mode === 2) {
    const r = buildSlots(data.correct, data.faulty);
    return {
      mistakes: r.slots.map((s) => ({ summary: describeSlot(r.cTk, s), codes: s.errors.map((e) => e.code) })),
      faulty: displayText(data.faulty),
      correct: displayText(data.correct, true),
    };
  }
  return { sentence: displayText(`"${data.line}" ${'____'} ${data.speaker}.`, true) };
}

async function listQuestions(env, url) {
  const mode = int(url.searchParams.get('mode'), 0);
  const where = [1, 2, 3].includes(mode) ? `WHERE q.mode = ${mode} AND q.active = 1` : 'WHERE q.active = 1';
  const rows = (
    await env.DB
      .prepare(
        `SELECT q.id, q.mode, q.class_id, q.public, q.data, q.created_at, c.name AS class_name,
                COALESCE(s.n, 0) AS tries, COALESCE(s.c, 0) AS right
           FROM questions q
           LEFT JOIN classes c ON c.id = q.class_id
           LEFT JOIN (SELECT question_id, COUNT(*) AS n, SUM(correct) AS c FROM attempts WHERE try_no = 1 GROUP BY question_id) s ON s.question_id = q.id
          ${where} ORDER BY q.mode, q.id`,
      )
      .all()
  ).results;
  return json({ questions: rows.map((r) => ({ ...r, data: parse(r.data, {}) })) });
}

async function classScope(env, body) {
  const classId = body.class_id ? int(body.class_id, 0) : null;
  if (classId) {
    const c = await env.DB.prepare('SELECT id FROM classes WHERE id = ?1').bind(classId).first();
    if (!c) throw new HttpError(400, 'That class doesn’t exist.');
  }
  return { classId, pub: body.public === false ? 0 : 1 };
}

async function createQuestion(request, env) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  const data = validateQuestion(mode, body.data, { lowerFirst: body.lowerFirst });
  const { classId, pub } = await classScope(env, body);
  const row = await env.DB
    .prepare('INSERT INTO questions (mode, class_id, public, active, data, created_at) VALUES (?1, ?2, ?3, 1, ?4, ?5) RETURNING id')
    .bind(mode, classId, pub, JSON.stringify(data), Date.now())
    .first();
  return json({ id: row.id, preview: preview(mode, data) });
}

async function updateQuestion(request, env, id) {
  const body = await readJson(request);
  const q = await env.DB.prepare('SELECT id, mode, data FROM questions WHERE id = ?1').bind(id).first();
  if (!q) throw new HttpError(404, 'Question not found.');
  const data = body.data ? validateQuestion(q.mode, body.data, { lowerFirst: body.lowerFirst }) : JSON.parse(q.data);
  const { classId, pub } = await classScope(env, body);
  await env.DB.prepare('UPDATE questions SET data = ?1, class_id = ?2, public = ?3 WHERE id = ?4').bind(JSON.stringify(data), classId, pub, id).run();
  return json({ ok: true, preview: preview(q.mode, data) });
}

async function previewQuestion(request) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  try {
    const data = validateQuestion(mode, body.data, { lowerFirst: body.lowerFirst });
    return json({ ok: true, data, preview: preview(mode, data) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, problem: e.message });
    throw e;
  }
}

async function importQuestions(request, env) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
  const { classId, pub } = await classScope(env, body);
  const stmts = [];
  const problems = [];
  rows.forEach((r, i) => {
    try {
      const data = validateQuestion(mode, r, { lowerFirst: r.lowerFirst || body.lowerFirst });
      stmts.push(env.DB.prepare('INSERT INTO questions (mode, class_id, public, active, data, created_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)').bind(mode, classId, pub, JSON.stringify(data), Date.now()));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      problems.push({ row: i + 1, problem: e.message });
    }
  });
  if (stmts.length) await env.DB.batch(stmts);
  return json({ added: stmts.length, problems });
}

// ---------- verb bank ----------

const verbRow = (r) => ({ id: r.id, base: r.base, past: r.past, tags: parse(r.tags, []), banned: !!r.banned, source: r.source });

async function listVerbs(env) {
  const rows = (await env.DB.prepare('SELECT id, base, past, tags, banned, source FROM verbs ORDER BY banned DESC, base').all()).results;
  const pending = (await env.DB.prepare("SELECT COUNT(*) AS n FROM verb_ai WHERE status IN ('pending','ai_ok')").first()).n;
  return json({ verbs: rows.map(verbRow), pending, tags: TAGS });
}

async function createVerb(request, env) {
  const body = await readJson(request);
  const base = cleanWord(body.base);
  const past = cleanWord(body.past) || (validWord(base) ? regularPast(base) : '');
  try {
    const id = await saveVerb(env.DB, { base, past, tags: body.tags, banned: body.banned, source: 'teacher' });
    return json({ id });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

async function updateVerb(request, env, id) {
  const body = await readJson(request);
  const base = cleanWord(body.base);
  const past = cleanWord(body.past);
  if (!validWord(base) || !validWord(past)) throw new HttpError(400, 'Enter the base form and the past tense, e.g. whisper / whispered.');
  const r = await env.DB.prepare('UPDATE verbs SET base = ?1, past = ?2, tags = ?3, banned = ?4 WHERE id = ?5 RETURNING id').bind(base, past, JSON.stringify(cleanTags(body.tags)), body.banned ? 1 : 0, id).first();
  if (!r) throw new HttpError(404, 'Verb not found.');
  await writeForms(env.DB, id, base, past);
  return json({ ok: true });
}

async function deleteVerb(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM verb_forms WHERE verb_id = ?1').bind(id), env.DB.prepare('DELETE FROM verbs WHERE id = ?1').bind(id)]);
  return json({ ok: true });
}

async function importVerbs(request, env) {
  const body = await readJson(request);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 300) : [];
  let added = 0;
  const problems = [];
  for (const [i, r] of rows.entries()) {
    const base = cleanWord(r.base);
    const past = cleanWord(r.past) || (validWord(base) ? regularPast(base) : '');
    const have = await env.DB.prepare('SELECT 1 AS x FROM verb_forms WHERE form = ?1').bind(base).first();
    if (have) {
      problems.push({ row: i + 1, problem: `${base} is already in the bank` });
      continue;
    }
    try {
      await saveVerb(env.DB, { base, past, tags: Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(/[|;\s]+/), source: 'teacher' });
      added++;
    } catch (e) {
      problems.push({ row: i + 1, problem: e.message });
    }
  }
  return json({ added, problems });
}

async function reviewList(env) {
  const rows = (await env.DB.prepare("SELECT * FROM verb_ai WHERE status IN ('pending','ai_ok') ORDER BY ts DESC LIMIT 100").all()).results;
  const rej = (await env.DB.prepare("SELECT word, reason, ts FROM verb_ai WHERE status IN ('auto_rejected','rejected') ORDER BY ts DESC LIMIT 40").all()).results;
  return json({
    items: rows.map((r) => ({ word: r.word, base: r.base, past: r.past, tags: parse(r.tags, []), conf: r.conf, reason: r.reason, status: r.status, ts: r.ts })),
    rejected: rej,
  });
}

async function reviewAct(request, env, word, action) {
  const w = cleanWord(word);
  const row = await env.DB.prepare('SELECT * FROM verb_ai WHERE word = ?1').bind(w).first();
  if (!row) throw new HttpError(404, 'That word isn’t in the review list.');
  if (action === 'approve') {
    const body = await readJson(request);
    const base = cleanWord(body.base || row.base || w);
    const past = cleanWord(body.past || row.past || (validWord(base) ? regularPast(base) : w));
    const tags = cleanTags(body.tags && body.tags.length ? body.tags : parse(row.tags, []));
    if (!tags.length) throw new HttpError(400, 'Choose at least one tag for this verb.');
    const have = await env.DB.prepare('SELECT verb_id FROM verb_forms WHERE form = ?1').bind(past).first();
    if (!have) await saveVerb(env.DB, { base, past, tags, source: 'ai' });
    await env.DB.prepare("UPDATE verb_ai SET status = 'approved' WHERE word = ?1").bind(w).run();
  } else if (action === 'reject') {
    await env.DB.prepare("UPDATE verb_ai SET status = 'rejected' WHERE word = ?1").bind(w).run();
  } else if (action === 'reset') {
    await env.DB.prepare('DELETE FROM verb_ai WHERE word = ?1').bind(w).run();
  }
  return json({ ok: true });
}

// ---------- analytics ----------

async function analytics(env, url) {
  const cls = url.searchParams.get('class');
  const days = Math.min(Math.max(int(url.searchParams.get('days'), 30), 1), 365);
  const since = Date.now() - days * 86_400_000;
  const classId = cls === 'guests' ? null : int(cls, 0);
  if (cls !== 'guests' && !classId) throw new HttpError(400, 'Choose a class.');

  const [errRows, attRows, pupRows, qRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT a.pupil_id, j.value AS code, COUNT(*) AS n
           FROM attempts a, json_each(a.codes) j
          WHERE a.class_id IS ?1 AND a.try_no = 1 AND a.ts >= ?2
          GROUP BY a.pupil_id, j.value`,
      )
      .bind(classId, since)
      .all(),
    env.DB
      .prepare('SELECT pupil_id, mode, COUNT(*) AS n, SUM(correct) AS c FROM attempts WHERE class_id IS ?1 AND try_no = 1 AND ts >= ?2 GROUP BY pupil_id, mode')
      .bind(classId, since)
      .all(),
    classId
      ? env.DB.prepare('SELECT id, name FROM pupils WHERE class_id = ?1 ORDER BY name COLLATE NOCASE').bind(classId).all()
      : env.DB.prepare('SELECT id, name FROM pupils WHERE is_guest = 1 ORDER BY id').all(),
    env.DB
      .prepare(
        `SELECT a.question_id AS id, q.mode, q.data, COUNT(*) AS n, SUM(a.correct) AS c
           FROM attempts a JOIN questions q ON q.id = a.question_id
          WHERE a.class_id IS ?1 AND a.try_no = 1 AND a.ts >= ?2
          GROUP BY a.question_id HAVING n >= 3 ORDER BY (1.0 * SUM(a.correct) / COUNT(*)) ASC, n DESC LIMIT 8`,
      )
      .bind(classId, since)
      .all(),
  ]);

  const pupils = new Map();
  for (const p of pupRows.results) pupils.set(p.id, { id: p.id, name: p.name, attempts: 0, correct: 0, byMode: {}, counts: {} });
  for (const r of attRows.results) {
    const p = pupils.get(r.pupil_id);
    if (!p) continue;
    p.attempts += r.n;
    p.correct += r.c || 0;
    p.byMode[r.mode] = { n: r.n, c: r.c || 0 };
  }
  const totals = {};
  for (const r of errRows.results) {
    const meta = CODES[r.code];
    if (!meta || HIDDEN_CODES.includes(r.code)) continue;
    const p = pupils.get(r.pupil_id);
    if (!p) continue;
    p.counts[r.code] = r.n;
    totals[r.code] = (totals[r.code] || 0) + r.n;
  }
  const codes = Object.entries(CODES)
    .filter(([c, m]) => !m.hidden)
    .map(([code, m]) => ({ code, label: m.label, rule: m.rule, total: totals[code] || 0 }));
  const hardest = qRows.results.map((r) => {
    const d = parse(r.data, {});
    return { id: r.id, mode: r.mode, text: r.mode === 1 ? d.prompt : r.mode === 2 ? d.faulty : `${d.line} ${d.speaker}`, tries: r.n, right: r.c || 0 };
  });
  return json({ days, codes, pupils: [...pupils.values()], hardest });
}

// ---------- routing ----------

export async function teacherRoute(request, env, url) {
  const m = request.method;
  const path = url.pathname.replace(/^\/api\/t/, '');
  let x;
  if (path === '/ping') return json({ ok: true });
  if (path === '/classes') return m === 'GET' ? listClasses(env) : m === 'POST' ? createClass(request, env) : null;
  if ((x = path.match(/^\/classes\/(\d+)$/))) {
    if (m === 'PATCH') return updateClass(request, env, +x[1]);
    if (m === 'DELETE') return deleteClass(env, +x[1]);
  }
  if ((x = path.match(/^\/classes\/(\d+)\/regen$/)) && m === 'POST') return regenCode(request, env, +x[1]);
  if ((x = path.match(/^\/classes\/(\d+)\/pupils$/))) {
    if (m === 'GET') return listPupils(env, +x[1]);
    if (m === 'POST') return addPupils(request, env, +x[1]);
  }
  if ((x = path.match(/^\/classes\/(\d+)\/pupils\/preview$/)) && m === 'POST') return previewPupils(request, env, +x[1]);
  if ((x = path.match(/^\/pupils\/(\d+)$/))) {
    if (m === 'PATCH') return updatePupil(request, env, +x[1]);
    if (m === 'DELETE') return deletePupil(env, +x[1]);
  }
  if ((x = path.match(/^\/pupils\/(\d+)\/reset$/)) && m === 'POST') return resetPupil(env, +x[1]);

  if (path === '/questions') return m === 'GET' ? listQuestions(env, url) : m === 'POST' ? createQuestion(request, env) : null;
  if (path === '/questions/preview' && m === 'POST') return previewQuestion(request);
  if (path === '/questions/import' && m === 'POST') return importQuestions(request, env);
  if ((x = path.match(/^\/questions\/(\d+)$/))) {
    if (m === 'PUT') return updateQuestion(request, env, +x[1]);
    if (m === 'DELETE') {
      await env.DB.prepare('UPDATE questions SET active = 0 WHERE id = ?1').bind(+x[1]).run();
      return json({ ok: true });
    }
  }

  if (path === '/verbs') return m === 'GET' ? listVerbs(env) : m === 'POST' ? createVerb(request, env) : null;
  if (path === '/verbs/import' && m === 'POST') return importVerbs(request, env);
  if (path === '/verbs/review' && m === 'GET') return reviewList(env);
  if ((x = path.match(/^\/verbs\/review\/([^/]+)\/(approve|reject|reset)$/)) && m === 'POST') return reviewAct(request, env, decodeURIComponent(x[1]), x[2]);
  if ((x = path.match(/^\/verbs\/(\d+)$/))) {
    if (m === 'PUT') return updateVerb(request, env, +x[1]);
    if (m === 'DELETE') return deleteVerb(env, +x[1]);
  }

  if (path === '/analytics' && m === 'GET') return analytics(env, url);
  return null;
}
