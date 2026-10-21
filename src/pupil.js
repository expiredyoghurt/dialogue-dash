// Pupil-facing API: sign-in, guests, questions, answers, progress.

import { RULES, CODES, TAGS, RANKS, rankFor, HIDDEN_CODES } from './rules.js';
import { checkMode1, modelAnswer, buildSlots, checkSlot, describeSlot, displayText, explainErr, tokenize, normalizeText } from './engine.js';
import {
  ALL_MODES,
  XP,
  MAX_TRIES,
  xpFor as xpForTable,
  payloadFor,
  checkMode4,
  checkMode5,
  wordsFeedback,
  modelMode5,
  tapTargets,
  checkFix,
  fixedSentence,
} from './modes.js';
import { VERSION } from './version.js';
import { LEVEL_TIERS, DEFAULT_BANDS, levelFor, DISTRICTS, VEHICLES, COSMETICS, ROUTE_LEN, BIG_LEN, RUSH_LEN, BIG_PATIENCE, BIG_AT, RUSH_AT, PAR_MS_PER_STOP, ruleOf } from './districts.js';
import { pupilState, tipsTotal, finishRoute, pupilAccess, levelInfo, getSettings } from './express.js';
import { judgeVerb, suggestVerbs } from './verbs.js';
import { signToken, cleanCode } from './auth.js';
import { HttpError, json, readJson, clientIp, rateLimited, clip, int, cleanUser } from './util.js';

const DAY = 86_400_000;
const SGT = 8 * 3_600_000;
const dayOf = (ts) => Math.floor((ts + SGT) / DAY);

// ---------- sign-in ----------

export async function login(request, env) {
  if (await rateLimited(env, 'RL_LOGIN', clientIp(request))) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
  const body = await readJson(request);
  const username = cleanUser(body.username);
  const code = cleanCode(body.code);
  const fail = new HttpError(401, 'We couldn’t find that username with that class code. Check both and try again.');
  if (!username || code.length < 4) throw fail;
  const cls = await env.DB.prepare('SELECT id, name, sess_ver FROM classes WHERE code = ?1 AND archived = 0').bind(code).first();
  if (!cls) throw fail;
  const p = await env.DB.prepare('SELECT id, name FROM pupils WHERE class_id = ?1 AND username = ?2').bind(cls.id, username).first();
  if (!p) throw fail;
  await env.DB.prepare('UPDATE pupils SET last_seen = ?1 WHERE id = ?2').bind(Date.now(), p.id).run();
  const token = await signToken(env, { r: 'p', pid: p.id, cid: cls.id, sv: cls.sess_ver }, 12 * 3600);
  return json({ token, pupil: { id: p.id, name: p.name, className: cls.name, guest: false } });
}

export async function guest(request, env) {
  if (await rateLimited(env, 'RL_GUEST', clientIp(request))) throw new HttpError(429, 'Too many guest sign-ins from here. Wait a minute and try again.');
  const row = await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('guest', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1 RETURNING v").first();
  const username = 'guest_' + String(row.v).padStart(4, '0');
  const now = Date.now();
  const p = await env.DB
    .prepare('INSERT INTO pupils (class_id, name, username, is_guest, created_at, last_seen) VALUES (NULL, ?1, ?1, 1, ?2, ?2) RETURNING id')
    .bind(username, now)
    .first();
  const token = await signToken(env, { r: 'p', pid: p.id, cid: null, sv: 0 }, 12 * 3600);
  return json({ token, pupil: { id: p.id, name: username, className: 'Guest', guest: true } });
}

// Loads and checks the pupil behind a token.
export async function authPupil(env, payload) {
  if (!payload || payload.r !== 'p') return null;
  const row = await env.DB
    .prepare(
      `SELECT p.id, p.name, p.class_id, p.is_guest, c.sess_ver, c.archived, c.name AS class_name
         FROM pupils p LEFT JOIN classes c ON c.id = p.class_id WHERE p.id = ?1`,
    )
    .bind(payload.pid)
    .first();
  if (!row) return null;
  if (row.class_id) {
    if (row.archived || row.sess_ver !== payload.sv) return null;
  } else if (!row.is_guest) return null;
  return { id: row.id, name: row.name, classId: row.class_id, guest: !!row.is_guest, className: row.class_name || 'Guest' };
}

export function meta() {
  const codes = {};
  for (const [k, v] of Object.entries(CODES)) codes[k] = { rule: v.rule, label: v.label, hidden: !!v.hidden };
  const route = { len: ROUTE_LEN, big: BIG_LEN, rush: RUSH_LEN, patience: BIG_PATIENCE, bigAt: BIG_AT, rushAt: RUSH_AT, parMs: PAR_MS_PER_STOP };
  return json({ rules: RULES, codes, tags: TAGS, ranks: RANKS, version: VERSION, districts: DISTRICTS, vehicles: VEHICLES, cosmetics: COSMETICS, route, levels: { tiers: LEVEL_TIERS, defaultBands: DEFAULT_BANDS } });
}

// ---------- questions ----------

function visibleSql(p) {
  return p.guest ? { where: 'class_id IS NULL AND public = 1 AND active = 1', binds: [] } : { where: '(class_id IS NULL OR class_id = ?1) AND active = 1', binds: [p.classId] };
}

async function lastStatus(env, pupilId) {
  const rows = (await env.DB.prepare('SELECT question_id, correct FROM attempts WHERE pupil_id = ?1 ORDER BY id').bind(pupilId).all()).results || [];
  const m = new Map();
  for (const r of rows) m.set(r.question_id, r.correct ? 'done' : 'wrong');
  return m;
}

export async function listQuestions(env, p, url) {
  const mode = int(url.searchParams.get('mode'), 0);
  const practice = url.searchParams.get('practice') === '1';
  const district = int(url.searchParams.get('district'), 0);
  const v = visibleSql(p);
  const sql = `SELECT id, mode, data FROM questions WHERE ${v.where}${ALL_MODES.includes(mode) ? ` AND mode = ${mode}` : ''} ORDER BY id LIMIT 600`;
  const qs = (await env.DB.prepare(sql).bind(...v.binds).all()).results || [];
  const status = await lastStatus(env, p.id);
  const { allowed } = await pupilAccess(env, p);
  const out = [];
  for (const q of qs) {
    const st = status.get(q.id) || 'new';
    if (practice && st !== 'wrong') continue;
    const data = JSON.parse(q.data);
    const rule = ruleOf(q.mode, data);
    if (!allowed.has(rule)) continue; // locked districts are never served
    if (district && rule !== district) continue;
    const pl = payloadFor(q.mode, data);
    if (!pl) continue;
    out.push({ id: q.id, mode: q.mode, rule, status: st, p: pl });
  }
  return json({ questions: out });
}

// ---------- progress ----------

export async function me(env, p) {
  const rows = (await env.DB.prepare('SELECT question_id, mode, correct, xp, ts, codes, try_no, answer FROM attempts WHERE pupil_id = ?1 ORDER BY id').bind(p.id).all()).results || [];
  let xp = 0;
  const last = new Map();
  const days = new Set();
  const ruleErrors = {};
  const verbs = new Set();
  const today = dayOf(Date.now());
  let todayXp = 0;
  const firsts = rows.filter((r) => r.try_no === 1).slice(-80);
  for (const r of rows) {
    xp += r.xp;
    last.set(r.question_id, { mode: r.mode, correct: r.correct });
    days.add(dayOf(r.ts));
    if (dayOf(r.ts) === today) todayXp += r.xp;
    if (r.mode === 3 && r.correct && r.answer) verbs.add(r.answer.toLowerCase());
  }
  for (const r of firsts) {
    for (const c of JSON.parse(r.codes || '[]')) {
      const meta = CODES[c];
      if (!meta || meta.hidden) continue;
      ruleErrors[meta.rule] = (ruleErrors[meta.rule] || 0) + 1;
    }
  }
  let streak = 0;
  let d = days.has(today) ? today : today - 1;
  while (days.has(d)) {
    streak++;
    d--;
  }
  const v = visibleSql(p);
  const access = await pupilAccess(env, p, { answerXp: xp });
  const st = await pupilState(env, p, { visible: v, rows, ruleErrors, access });
  // "done of total" and "came back" only count parcels in districts the pupil can actually reach
  const modes = Object.fromEntries(ALL_MODES.map((m) => [m, { total: 0, done: 0 }]));
  let wrong = 0;
  for (const q of st.list) {
    if (!modes[q.mode] || !access.allowed.has(ruleOf(q.mode, q.data))) continue;
    modes[q.mode].total++;
    const l = last.get(q.id);
    if (l && l.correct) modes[q.mode].done++;
    else if (l) wrong++;
  }
  const total = xp + st.tips;
  return json({
    pupil: { id: p.id, name: p.name, className: p.className, guest: p.guest },
    xp: total,
    answerXp: xp,
    tips: st.tips,
    todayXp,
    rank: rankFor(total),
    streak,
    modes,
    wrong,
    ruleErrors,
    verbs: verbs.size,
    level: levelInfo(access),
    districts: st.districts,
    cleared: st.cleared,
    rush: st.rush,
    settings: st.settings,
    tip: st.tip,
    routes: st.routes,
  });
}

// ---------- finishing a route (Dash Express) ----------

export function route(request, env, p) {
  return finishRoute(request, env, p, visibleSql(p));
}

// ---------- answering ----------

const XP1 = [10, 6, 3];
const XP3 = [8, 5, 3];
const xpFor = (table, tryNo) => table[Math.min(Math.max(tryNo, 1), 3) - 1];

async function record(env, p, q, { tryNo, practice, correct, xp, answer, codes }) {
  await env.DB
    .prepare('INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)')
    .bind(p.id, p.classId, q.id, q.mode, tryNo, practice ? 1 : 0, correct ? 1 : 0, xp, clip(answer, 400), JSON.stringify(codes || []), Date.now())
    .run();
  const t = await env.DB.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM attempts WHERE pupil_id = ?1').bind(p.id).first();
  const total = t.xp + (await tipsTotal(env, p.id));
  return { xpTotal: total, rank: rankFor(total), level: levelFor(total, (await getSettings(env)).levelBands) };
}

const explainFor = (e, cTk) => explainErr(e, cTk);
const slim = (e) => ({ code: e.code, rule: e.rule, what: e.what, fix: e.fix, kind: e.kind, index: e.index });

export async function answer(request, env, p) {
  const body = await readJson(request);
  const qid = int(body.qid, 0);
  const row = p.guest
    ? await env.DB.prepare('SELECT id, mode, data FROM questions WHERE id = ?1 AND class_id IS NULL AND public = 1 AND active = 1').bind(qid).first()
    : await env.DB.prepare('SELECT id, mode, data FROM questions WHERE id = ?1 AND (class_id IS NULL OR class_id = ?2) AND active = 1').bind(qid, p.classId).first();
  if (!row) throw new HttpError(404, 'That question isn’t available.');
  const data = JSON.parse(row.data);
  if (!(await pupilAccess(env, p)).allowed.has(ruleOf(row.mode, data))) throw new HttpError(403, 'That part of town isn’t open yet. Keep earning XP to reach it.');
  const tryNo = Math.min(Math.max(int(body.tryNo, 1), 1), 3);
  const practice = !!body.practice;

  if (row.mode === 1) return json(await answerMode1(env, p, row, data, body, tryNo, practice));
  if (row.mode === 2) return json(await answerMode2(env, p, row, data, body, practice));
  if (row.mode === 3) return json(await answerMode3(env, p, row, data, body, tryNo, practice));
  if (row.mode === 4) return json(await answerMode4(env, p, row, data, body, practice));
  if (row.mode === 5) return json(await answerMode5(env, p, row, data, body, practice));
  if (row.mode === 6) return json(await answerMode6(env, p, row, data, body, practice));
  throw new HttpError(400, 'Unknown question type.');
}

async function answerMode1(env, p, q, data, body, tryNo, practice) {
  if (body.giveUp) {
    const t = await record(env, p, q, { tryNo, practice, correct: false, xp: 0, answer: '(showed the answer)', codes: [] });
    return { correct: false, final: true, reveal: modelAnswer(data), tip: data.tip || undefined, xp: 0, ...t };
  }
  const text = clip(body.answer, 600);
  if (!text.trim()) throw new HttpError(400, 'Type your answer first.');
  const r = checkMode1(data, text);
  const xp = r.correct ? xpFor(XP1, tryNo) : 0;
  const t = await record(env, p, q, { tryNo, practice, correct: r.correct, xp, answer: text, codes: r.codes });
  const final = !r.correct && tryNo >= 3;
  return {
    correct: r.correct,
    errors: r.errors.map(slim),
    note: r.note,
    xp,
    final,
    reveal: r.correct || final ? modelAnswer(data) : undefined,
    tip: (r.correct || final) && data.tip ? data.tip : undefined,
    ...t,
  };
}

async function answerMode2(env, p, q, data, body, practice) {
  const built = buildSlots(data.correct, data.faulty);
  if (!built.valid) throw new HttpError(500, 'This question has a problem. Please tell your teacher.');
  const clicked = new Set((Array.isArray(body.clicked) ? body.clicked : []).map((k) => String(k)).slice(0, 80));
  const slots = built.slots;
  const keys = new Set(slots.map((s) => s.key));
  const falseKeys = [...clicked].filter((k) => !keys.has(k));
  const phase = int(body.phase, 1);

  const view = (s) => ({
    key: s.key,
    kind: s.kind,
    index: s.index,
    spotted: clicked.has(s.key),
  });

  if (phase === 1) {
    return {
      phase: 1,
      total: slots.length,
      hits: slots.filter((s) => clicked.has(s.key)).length,
      falseKeys,
      slots: slots.map(view),
    };
  }

  const fixes = body.fixes && typeof body.fixes === 'object' ? body.fixes : {};
  let hits = 0;
  let fixed = 0;
  const codes = new Set();
  const results = slots.map((s) => {
    const spotted = clicked.has(s.key);
    const res = checkSlot(built.cTk, s, clip(fixes[s.key], 40));
    if (spotted) hits++;
    if (res.correct) fixed++;
    if (!spotted || !res.correct) for (const e of s.errors) codes.add(e.code);
    return {
      ...view(s),
      fixed: res.correct,
      invalid: !!res.invalid,
      message: res.message,
      expected: s.expectedDisp,
      summary: describeSlot(built.cTk, s),
      errors: s.errors.map(slim),
      residual: (res.errors || []).map(slim),
      typed: clip(fixes[s.key], 40),
    };
  });
  const perfect = hits === slots.length && fixed === slots.length && falseKeys.length === 0;
  const correct = hits === slots.length && fixed === slots.length;
  const xp = hits * 2 + fixed * 3 + (perfect ? 5 : 0);
  const t = await record(env, p, q, {
    tryNo: 1,
    practice,
    correct,
    xp,
    answer: JSON.stringify({ c: [...clicked], f: fixes }).slice(0, 400),
    codes: [...codes],
  });
  return { phase: 2, correct, perfect, total: slots.length, hits, fixed, falseKeys, slots: results, correctText: displayText(data.correct, true), xp, ...t };
}

async function answerMode3(env, p, q, data, body, tryNo, practice) {
  const word = clip(body.answer, 40);
  if (!word.trim()) throw new HttpError(400, 'Type a verb first.');
  const r = await judgeVerb(env, word, data.target, data.speaker);
  const xp = r.correct ? xpFor(XP3, tryNo) : 0;
  const codes = r.code ? [r.code] : [];
  const t = await record(env, p, q, { tryNo, practice, correct: r.correct, xp, answer: word.trim().toLowerCase(), codes });
  const out = { correct: r.correct, status: r.status, message: r.message, code: r.code, rule: 7, xp, ...t };
  if (r.correct) {
    out.sentence = displayText(`"${data.line}" ${word.trim().toLowerCase()} ${data.speaker}.`, true);
    out.more = await suggestVerbs(env.DB, data.target, word.trim().toLowerCase());
  } else if (body.giveUp || tryNo >= 3) {
    out.final = true;
    out.more = await suggestVerbs(env.DB, data.target, '', 5);
  }
  return out;
}

// ---------- Mode 4: multiple choice ----------

async function answerMode4(env, p, q, data, body, practice) {
  const tryNo = Math.min(Math.max(int(body.tryNo, 1), 1), MAX_TRIES[4]);
  if (body.giveUp) {
    const t = await record(env, p, q, { tryNo, practice, correct: false, xp: 0, answer: '(showed the answer)', codes: [] });
    return { correct: false, final: true, reveal: { correct: data.correct }, explanation: data.explanation, xp: 0, ...t };
  }
  const choice = (Array.isArray(body.choice) ? body.choice : []).slice(0, 8).map((x) => clip(x, 8));
  const r = checkMode4(data, choice);
  if (r.invalid) throw new HttpError(400, data.pick === 1 ? 'Choose one answer.' : `Choose exactly ${data.pick} answers.`);
  const xp = r.correct ? xpForTable(XP[4], tryNo) : 0;
  const code = data.code && CODES[data.code] ? data.code : 'MC_WRONG';
  const t = await record(env, p, q, { tryNo, practice, correct: r.correct, xp, answer: r.picked.join(','), codes: r.correct ? [] : [code] });
  const final = !r.correct && tryNo >= MAX_TRIES[4];
  return {
    correct: r.correct,
    final,
    xp,
    rule: r.correct ? undefined : CODES[code].rule,
    wrongIds: r.correct ? [] : r.wrongIds,
    whys: r.correct ? {} : r.whys,
    reveal: final ? { correct: data.correct } : undefined,
    explanation: r.correct || final ? data.explanation : undefined,
    ...t,
  };
}

// ---------- Mode 5: change the speech ----------

async function answerMode5(env, p, q, data, body, practice) {
  const tryNo = Math.min(Math.max(int(body.tryNo, 1), 1), MAX_TRIES[5]);
  if (body.giveUp) {
    const t = await record(env, p, q, { tryNo, practice, correct: false, xp: 0, answer: '(showed the answer)', codes: [] });
    return { correct: false, final: true, reveal: modelMode5(data), tip: data.tip || undefined, xp: 0, ...t };
  }
  const text = clip(body.answer, 300);
  if (!text.trim()) throw new HttpError(400, 'Type your answer first.');
  const r = checkMode5(data, text);
  const xp = r.correct ? xpForTable(XP[5], tryNo) : 0;
  let errors = [];
  if (!r.correct) {
    if (r.cTk) errors = r.errors.map((e) => slim(explainFor(e, r.cTk)));
    else errors = [wordsFeedback(r.words, tokenize(normalizeText(text).text).words)];
  }
  const t = await record(env, p, q, { tryNo, practice, correct: r.correct, xp, answer: text, codes: r.codes });
  const final = !r.correct && tryNo >= MAX_TRIES[5];
  return {
    correct: r.correct,
    errors,
    notes: r.notes,
    xp,
    final,
    reveal: r.correct || final ? (r.correct ? displayText(text.trim(), false) : modelMode5(data)) : undefined,
    tip: (r.correct || final) && data.tip ? data.tip : undefined,
    ...t,
  };
}

// ---------- Mode 6: tap the wrong word, type the fix ----------

async function answerMode6(env, p, q, data, body, practice) {
  const targets = tapTargets(data);
  const phase = int(body.phase, 1);
  const tap = int(body.tap, -1);
  if (phase === 1) {
    const tapTry = Math.min(Math.max(int(body.tapTry, 1), 1), 2);
    const hit = targets.includes(tap);
    return { phase: 1, hit, reveal: !hit && tapTry >= 2 ? targets[0] : undefined };
  }
  // phase 2: tapTry 1-2 = found it by tapping, 3 = it was shown to the pupil
  const tapTry = Math.min(Math.max(int(body.tapTry, 1), 1), 3);
  const fixTry = Math.min(Math.max(int(body.fixTry, 1), 1), MAX_TRIES[6]);
  if (!targets.includes(tap)) throw new HttpError(400, 'Tap the wrong word first.');
  const tapXp = tapTry <= 2 ? xpForTable(XP[6].tap, tapTry) : 0;
  const giveUp = !!body.giveUp;
  const typed = clip(body.fix, 40);
  const res = giveUp ? { ok: false, kind: 'none' } : checkFix(data, typed);
  if (!giveUp && res.kind === 'empty') throw new HttpError(400, 'Type your fix first.');
  const final = !res.ok && (giveUp || fixTry >= MAX_TRIES[6]);
  const xp = res.ok ? tapXp + xpForTable(XP[6].fix, fixTry) : final ? tapXp : 0;
  const codes = [];
  if (tapTry >= 3) codes.push('TENSE_NOT_SPOTTED');
  if (!res.ok && !giveUp) codes.push('TENSE_WRONG_FIX');
  const t = await record(env, p, q, { tryNo: fixTry, practice, correct: res.ok, xp, answer: giveUp ? '(showed the answer)' : typed, codes });
  let message;
  if (!res.ok && !giveUp) {
    message =
      res.kind === 'same'
        ? 'That’s the word that’s wrong. Change it so it matches the time of the rest of the sentence.'
        : res.kind === 'format'
          ? 'Type just the corrected word (no speech marks).'
          : 'Not quite. Look at the other verbs in the sentence: which time are they in?';
  }
  return {
    phase: 2,
    correct: res.ok,
    final,
    xp,
    message,
    reveal: final ? { fix: data.fixes[0] } : undefined,
    sentence: res.ok || final ? fixedSentence(data, tap) : undefined,
    tip: (res.ok || final) && data.tip ? data.tip : undefined,
    ...t,
  };
}

export { HIDDEN_CODES };
