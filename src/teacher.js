// Teacher console API (everything under /api/t/*), plus teacher sign-in.

import { CODES, TAGS, HIDDEN_CODES } from './rules.js';
import { prepare, buildSlots, stripToPrompt, diffTokens, tokenize, normalizeText, displayText, describeSlot, checkMode1 } from './engine.js';
import { saveVerb, writeForms, cleanTags, cleanWord, validWord, regularPast } from './verbs.js';
import { ALL_MODES, validateMode1Extras, validateMode4, validateMode5, validateMode6, previewMode, cleanRule } from './modes.js';
import { DISTRICTS, autoRule, ruleOf, isRule } from './districts.js';
import { getSettings, saveSettings } from './express.js';
import { levelFor, validateBands, validateThresholds, vehicleFor, allowedDistricts, DEFAULT_BANDS } from './districts.js';
import { rankFor, RANKS } from './rules.js';
import { LEVEL_TIERS, DISTRICT_NUMS } from './districts.js';
import {
  ADMIN, canClass, needClass, needAdmin, teacherSignIn, whoAmI, listTeachers, createTeacher, updateTeacher, resetTeacherPassword, deleteTeacher, changeOwnPassword,
} from './accounts.js';
import { signToken, safeEqual, teacherConfigured, newClassCode } from './auth.js';
import { HttpError, json, readJson, clientIp, rateLimited, clip, int, cleanUser, validUser, suggestUsername } from './util.js';

export async function teacherLogin(request, env) {
  if (!teacherConfigured(env)) throw new HttpError(503, 'Teacher sign-in is not set up yet. Set the teacher_user and teacher_password secrets in Cloudflare.');
  if (await rateLimited(env, 'RL_LOGIN', clientIp(request))) throw new HttpError(429, 'Too many tries. Wait a minute and try again.');
  const body = await readJson(request);
  const user = clip(body.username, 100);
  const pass = clip(body.password, 200);
  const [u, p] = await Promise.all([safeEqual(user, env.teacher_user), safeEqual(pass, env.teacher_password)]);
  if (u && p) return json({ token: await signToken(env, { r: 't' }, 8 * 3600), admin: true });
  let t = null;
  try {
    t = await teacherSignIn(env, user, pass);
  } catch {} // accounts not migrated yet: only the admin can sign in
  if (!t) throw new HttpError(401, 'Wrong username or password.');
  return json({ token: await signToken(env, { r: 't', tid: t.id, sv: t.sess_ver }, 8 * 3600), admin: false });
}

const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

// ---------- classes & pupils ----------

async function listClasses(env, who) {
  const rows = (
    await env.DB
      .prepare(
        `SELECT c.id, c.name, c.code, c.archived, c.created_at,
                (SELECT COUNT(*) FROM pupils p WHERE p.class_id = c.id) AS pupils
           FROM classes c ORDER BY c.archived, c.name`,
      )
      .all()
  ).results.filter((c) => canClass(who, c.id));
  let owned = new Set();
  if (!who.admin) {
    try {
      owned = new Set(((await env.DB.prepare('SELECT class_id FROM class_owners WHERE teacher_id = ?1').bind(who.id).all()).results || []).map((r) => r.class_id));
    } catch {}
  }
  for (const c of rows) c.owned = who.admin || owned.has(c.id);
  const guests = who.admin ? (await env.DB.prepare('SELECT COUNT(*) AS n FROM pupils WHERE is_guest = 1').first()).n : 0;
  return json({ classes: rows, guests });
}

// ---------- class dashboard ----------

const DAY = 86_400_000;
const STUCK_AT = 5; // first-try slips on one rule, within a fortnight, before we call a pupil stuck

// The rules behind a list of error codes, each counted once (an attempt with three comma slips is one slip on rule 4).
function rulesOfCodes(raw) {
  const out = new Set();
  for (const c of parse(raw, [])) {
    const m = CODES[c];
    if (m && !m.hidden && m.rule) out.add(m.rule);
  }
  return out;
}

async function dashboard(env, url, who) {
  const classId = int(url.searchParams.get('class'), 0);
  if (!classId) throw new HttpError(400, 'Choose a class.');
  needClass(who, classId);
  const cls = await env.DB.prepare('SELECT id, name FROM classes WHERE id = ?1').bind(classId).first();
  if (!cls) throw new HttpError(404, 'No such class.');
  const settings = await getSettings(env);
  const now = Date.now();
  const d7 = now - 7 * DAY;
  const d14 = now - 14 * DAY;
  const pupils = (await env.DB.prepare('SELECT id, name, username FROM pupils WHERE class_id = ?1 ORDER BY name COLLATE NOCASE').bind(classId).all()).results || [];
  const att = new Map(((await env.DB.prepare('SELECT pupil_id, COALESCE(SUM(xp), 0) AS xp, MAX(ts) AS last, SUM(CASE WHEN ts >= ?2 THEN 1 ELSE 0 END) AS a7, SUM(CASE WHEN ts >= ?2 THEN xp ELSE 0 END) AS xp7 FROM attempts WHERE class_id = ?1 GROUP BY pupil_id').bind(classId, d7).all()).results || []).map((r) => [r.pupil_id, r]));
  let runRows = [];
  try {
    runRows = (await env.DB.prepare('SELECT pupil_id, COALESCE(SUM(bonus), 0) AS tips, SUM(CASE WHEN ts >= ?2 THEN 1 ELSE 0 END) AS r7, SUM(CASE WHEN ts >= ?2 THEN bonus ELSE 0 END) AS tips7 FROM route_runs WHERE class_id = ?1 GROUP BY pupil_id').bind(classId, d7).all()).results || [];
  } catch {} // routes not migrated yet
  const runs = new Map(runRows.map((r) => [r.pupil_id, r]));
  const misses = (await env.DB.prepare('SELECT pupil_id, codes FROM attempts WHERE class_id = ?1 AND ts >= ?2 AND correct = 0 AND try_no = 1 ORDER BY id DESC LIMIT 5000').bind(classId, d14).all()).results || [];

  // slips: per pupil per rule, and across the class per rule
  const perPupil = new Map();
  const perRule = new Map();
  for (const m of misses) {
    for (const r of rulesOfCodes(m.codes)) {
      const pp = perPupil.get(m.pupil_id) || new Map();
      pp.set(r, (pp.get(r) || 0) + 1);
      perPupil.set(m.pupil_id, pp);
      const pr = perRule.get(r) || { rule: r, misses: 0, who: new Set() };
      pr.misses++;
      pr.who.add(m.pupil_id);
      perRule.set(r, pr);
    }
  }
  const topSlip = (id) => {
    const pp = perPupil.get(id);
    if (!pp) return null;
    let best = null;
    for (const [rule, n] of pp) if (!best || n > best.n) best = { rule, n };
    return best;
  };

  const levelCounts = {};
  let reach10 = 0;
  let reach20 = 0;
  const list = pupils.map((p) => {
    const a = att.get(p.id) || { xp: 0, last: null, a7: 0, xp7: 0 };
    const r = runs.get(p.id) || { tips: 0, r7: 0, tips7: 0 };
    const total = a.xp + r.tips;
    const level = levelFor(total, settings.levelBands);
    levelCounts[level] = (levelCounts[level] || 0) + 1;
    if (level >= 10) reach10++;
    if (level >= 20) reach20++;
    return { id: p.id, name: p.name, username: p.username, level, xp: total, rank: rankFor(total, settings.rankXp).name, lastActive: a.last || null, xp7: a.xp7 + r.tips7, attempts7: a.a7, routes7: r.r7, topSlip: topSlip(p.id) };
  });
  const active = list.filter((p) => p.lastActive && p.lastActive >= d7);
  const stuck = list.filter((p) => p.topSlip && p.topSlip.n >= STUCK_AT).map((p) => ({ pupilId: p.id, name: p.name, rule: p.topSlip.rule, n: p.topSlip.n })).sort((x, y) => y.n - x.n);
  const quiet = list.filter((p) => !p.lastActive || p.lastActive < d7).map((p) => ({ pupilId: p.id, name: p.name, lastActive: p.lastActive }));
  const rules = [...perRule.values()].map((r) => ({ rule: r.rule, misses: r.misses, pupils: r.who.size })).sort((x, y) => y.misses - x.misses).slice(0, 5);
  const manual = parse((await env.DB.prepare('SELECT unlocked FROM class_settings WHERE class_id = ?1').bind(classId).first().catch(() => null))?.unlocked, []);
  return json({
    class: cls,
    since: d7,
    totals: { pupils: list.length, active7: active.length, quiet7: list.length - active.length, xp7: list.reduce((n, p) => n + p.xp7, 0), routes7: list.reduce((n, p) => n + p.routes7, 0), attempts7: list.reduce((n, p) => n + p.attempts7, 0) },
    pupils: list,
    levelCounts,
    reach: { 10: reach10, 20: reach20 },
    tierXp: settings.tierXp,
    manual: Array.isArray(manual) ? manual : [],
    rules,
    stuck,
    quiet,
  });
}

// ---------- unlock grid: every class against every district ----------

async function unlockGrid(env, who) {
  const settings = await getSettings(env);
  const classes = ((await env.DB.prepare('SELECT id, name FROM classes WHERE archived = 0 ORDER BY name COLLATE NOCASE').all()).results || []).filter((c) => canClass(who, c.id));
  if (!classes.length) return json({ classes: [], tiers: LEVEL_TIERS, tierXp: settings.tierXp });
  const ids = classes.map((c) => c.id);
  const marks = ids.map((_, i) => `?${i + 1}`).join(',');
  const pupilRows = (await env.DB.prepare(`SELECT p.id, p.class_id, COALESCE(SUM(a.xp), 0) AS xp FROM pupils p LEFT JOIN attempts a ON a.pupil_id = p.id WHERE p.class_id IN (${marks}) GROUP BY p.id`).bind(...ids).all()).results || [];
  let tipRows = [];
  try {
    tipRows = (await env.DB.prepare(`SELECT pupil_id, COALESCE(SUM(bonus), 0) AS tips FROM route_runs WHERE class_id IN (${marks}) GROUP BY pupil_id`).bind(...ids).all()).results || [];
  } catch {}
  const tips = new Map(tipRows.map((r) => [r.pupil_id, r.tips]));
  let setRows = [];
  try {
    setRows = (await env.DB.prepare(`SELECT class_id, unlocked FROM class_settings WHERE class_id IN (${marks})`).bind(...ids).all()).results || [];
  } catch {}
  const manual = new Map(setRows.map((r) => [r.class_id, parse(r.unlocked, [])]));
  const stat = new Map(ids.map((id) => [id, { pupils: 0, reached: { 10: 0, 20: 0 } }]));
  for (const p of pupilRows) {
    const s = stat.get(p.class_id);
    if (!s) continue;
    s.pupils++;
    const level = levelFor(p.xp + (tips.get(p.id) || 0), settings.levelBands);
    if (level >= 10) s.reached[10]++;
    if (level >= 20) s.reached[20]++;
  }
  return json({
    classes: classes.map((c) => ({ id: c.id, name: c.name, pupils: stat.get(c.id).pupils, reached: stat.get(c.id).reached, unlocked: (manual.get(c.id) || []).filter((n) => DISTRICT_NUMS.includes(n)) })),
    tiers: LEVEL_TIERS,
    tierXp: settings.tierXp,
  });
}

// ---------- what a settings change would do (admin), before it is saved ----------

async function settingsPreview(request, env) {
  const body = await readJson(request);
  const cur = await getSettings(env);
  let bands = cur.levelBands;
  let rankXp = cur.rankXp;
  let vehicleXp = cur.vehicleXp;
  if (body.levelBands != null) {
    const v = validateBands(body.levelBands);
    if (!v.ok) throw new HttpError(400, v.error);
    bands = v.bands;
  } else if (body.levelBands === null) bands = DEFAULT_BANDS;
  if (body.rankXp != null) {
    const v = validateThresholds(body.rankXp, RANKS.length, 'rank');
    if (!v.ok) throw new HttpError(400, v.error);
    rankXp = v.xps;
  }
  if (body.vehicleXp != null) {
    const v = validateThresholds(body.vehicleXp, 6, 'ride');
    if (!v.ok) throw new HttpError(400, v.error);
    vehicleXp = v.xps;
  }
  const rows = (await env.DB.prepare('SELECT p.id, p.name, c.name AS cname, COALESCE(SUM(a.xp), 0) AS xp FROM pupils p LEFT JOIN attempts a ON a.pupil_id = p.id LEFT JOIN classes c ON c.id = p.class_id GROUP BY p.id').all()).results || [];
  let tipRows = [];
  try {
    tipRows = (await env.DB.prepare('SELECT pupil_id, COALESCE(SUM(bonus), 0) AS tips FROM route_runs GROUP BY pupil_id').all()).results || [];
  } catch {}
  const tips = new Map(tipRows.map((r) => [r.pupil_id, r.tips]));
  const out = { pupils: rows.length, level: { up: 0, down: 0 }, rank: { up: 0, down: 0 }, ride: { up: 0, down: 0 }, lose: { 4: 0, 7: 0 }, gain: { 4: 0, 7: 0 }, sample: [] };
  for (const p of rows) {
    const xp = p.xp + (tips.get(p.id) || 0);
    const l0 = levelFor(xp, cur.levelBands);
    const l1 = levelFor(xp, bands);
    if (l1 > l0) out.level.up++;
    if (l1 < l0) out.level.down++;
    const a0 = allowedDistricts({ level: l0 });
    const a1 = allowedDistricts({ level: l1 });
    for (const d of [4, 7]) {
      if (a0.has(d) && !a1.has(d)) out.lose[d]++;
      if (!a0.has(d) && a1.has(d)) out.gain[d]++;
    }
    const r0 = rankFor(xp, cur.rankXp).index;
    const r1 = rankFor(xp, rankXp).index;
    if (r1 > r0) out.rank.up++;
    if (r1 < r0) out.rank.down++;
    const v0 = vehicleFor(xp, cur.vehicleXp).index;
    const v1 = vehicleFor(xp, vehicleXp).index;
    if (v1 > v0) out.ride.up++;
    if (v1 < v0) out.ride.down++;
    if ((l0 !== l1 || r0 !== r1 || v0 !== v1) && out.sample.length < 6) out.sample.push({ name: p.name, className: p.cname || 'Guest', from: { level: l0, rank: RANKS[r0].name }, to: { level: l1, rank: RANKS[r1].name } });
  }
  return json(out);
}

// ---------- districts opened by hand for a class ----------

async function getUnlocks(env, classId) {
  let row = null;
  try {
    row = await env.DB.prepare('SELECT unlocked FROM class_settings WHERE class_id = ?1').bind(classId).first();
  } catch {} // table not migrated yet
  const list = parse(row && row.unlocked, []);
  return json({ unlocked: Array.isArray(list) ? list.filter((n) => DISTRICT_NUMS.includes(n)) : [], tiers: LEVEL_TIERS, tierXp: (await getSettings(env)).tierXp });
}

async function setUnlocks(request, env, classId) {
  const body = await readJson(request);
  const list = [...new Set((Array.isArray(body.unlocked) ? body.unlocked : []).map((n) => int(n, 0)).filter((n) => DISTRICT_NUMS.includes(n)))].sort((a, b) => a - b);
  await env.DB.prepare("INSERT INTO class_settings (class_id, unlocked) VALUES (?1, ?2) ON CONFLICT(class_id) DO UPDATE SET unlocked = ?2").bind(classId, JSON.stringify(list)).run();
  return json({ unlocked: list });
}

// How many classes one teacher account may create (stops a runaway script; the super admin has no limit).
const MAX_CLASSES_PER_TEACHER = 30;

async function createClass(request, env, who) {
  const body = await readJson(request);
  const name = clip(body.name, 60).trim();
  if (!name) throw new HttpError(400, 'Give the class a name.');
  if (!who.admin) {
    let made = 0;
    try {
      made = (await env.DB.prepare('SELECT COUNT(*) AS n FROM class_owners WHERE teacher_id = ?1').bind(who.id).first()).n;
    } catch {} // not migrated yet
    if (made >= MAX_CLASSES_PER_TEACHER) throw new HttpError(403, `You can create up to ${MAX_CLASSES_PER_TEACHER} classes. Delete one you no longer need, or ask the super admin.`);
  }
  for (let i = 0; i < 12; i++) {
    let row;
    try {
      row = await env.DB.prepare('INSERT INTO classes (name, code, created_at) VALUES (?1, ?2, ?3) RETURNING id, name, code').bind(name, newClassCode(), Date.now()).first();
    } catch (e) {
      if (!/UNIQUE/i.test(String(e?.message))) throw e;
      continue;
    }
    if (!who.admin) {
      // the creator runs it and owns it
      await env.DB.prepare('INSERT OR IGNORE INTO teacher_classes (teacher_id, class_id) VALUES (?1, ?2)').bind(who.id, row.id).run();
      try {
        await env.DB.prepare('INSERT OR REPLACE INTO class_owners (class_id, teacher_id) VALUES (?1, ?2)').bind(row.id, who.id).run();
      } catch {} // ownership table not migrated yet: still theirs to run, just not to delete
    }
    return json({ class: row });
  }
  throw new HttpError(500, 'Could not create a unique class code. Try again.');
}

// A teacher may delete only classes they created. The super admin may delete any.
async function needOwner(env, who, classId) {
  if (who.admin) return;
  let row = null;
  try {
    row = await env.DB.prepare('SELECT teacher_id FROM class_owners WHERE class_id = ?1').bind(classId).first();
  } catch {}
  if (!row || row.teacher_id !== who.id) throw new HttpError(403, 'Only the teacher who created a class (or the super admin) can delete it. You can archive it instead.');
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

// route_runs only exists once the 1.2 migration has run; until then there is nothing to delete.
async function routeRunsDelete(env, col, id) {
  try {
    await env.DB.prepare('SELECT 1 FROM route_runs LIMIT 1').first();
  } catch {
    return [];
  }
  return [env.DB.prepare(`DELETE FROM route_runs WHERE ${col} = ?1`).bind(id)];
}

async function tableDelete(env, table, col, id) {
  try {
    await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
  } catch {
    return [];
  }
  return [env.DB.prepare(`DELETE FROM ${table} WHERE ${col} = ?1`).bind(id)];
}

// Preferences of every pupil in a class, removed with the class (they are deleted by pupil id, before the pupils go).
async function prefsOfClass(env, classId) {
  try {
    await env.DB.prepare('SELECT 1 FROM pupil_prefs LIMIT 1').first();
  } catch {
    return [];
  }
  return [env.DB.prepare('DELETE FROM pupil_prefs WHERE pupil_id IN (SELECT id FROM pupils WHERE class_id = ?1)').bind(classId)];
}

async function deleteClass(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE class_id = ?1').bind(id),
    ...(await routeRunsDelete(env, 'class_id', id)),
    ...(await tableDelete(env, 'class_settings', 'class_id', id)),
    ...(await tableDelete(env, 'teacher_classes', 'class_id', id)),
    ...(await tableDelete(env, 'class_owners', 'class_id', id)),
    ...(await prefsOfClass(env, id)),
    env.DB.prepare('DELETE FROM pupils WHERE class_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM classes WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true });
}

async function listPupils(env, classId) {
  const sql = (tips) =>
    `SELECT p.id, p.name, p.username, COUNT(a.id) AS attempts, COALESCE(SUM(a.xp), 0)${tips ? ' + COALESCE((SELECT SUM(r.bonus) FROM route_runs r WHERE r.pupil_id = p.id), 0)' : ''} AS xp, MAX(a.ts) AS last_active
       FROM pupils p LEFT JOIN attempts a ON a.pupil_id = p.id
      WHERE p.class_id = ?1 GROUP BY p.id ORDER BY p.name COLLATE NOCASE`;
  let rows;
  try {
    rows = (await env.DB.prepare(sql(true)).bind(classId).all()).results; // XP includes route tips
  } catch {
    rows = (await env.DB.prepare(sql(false)).bind(classId).all()).results; // route_runs not migrated yet
  }
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
  await env.DB.batch([env.DB.prepare('DELETE FROM attempts WHERE pupil_id = ?1').bind(id), ...(await routeRunsDelete(env, 'pupil_id', id)), ...(await tableDelete(env, 'pupil_prefs', 'pupil_id', id)), env.DB.prepare('DELETE FROM pupils WHERE id = ?1').bind(id)]);
  return json({ ok: true });
}
async function resetPupil(env, id) {
  await env.DB.prepare('DELETE FROM attempts WHERE pupil_id = ?1').bind(id).run();
  for (const st of await routeRunsDelete(env, 'pupil_id', id)) await st.run();
  return json({ ok: true });
}

// ---------- questions ----------

export function validateQuestion(mode, input, { lowerFirst } = {}) {
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
    const extras = validateMode1Extras(d, correct);
    const data = { correct, prompt, alts, ...extras };
    if (checkMode1({ correct, alts: [], lines: extras.lines, beat: extras.beat }, prompt).correct) throw new HttpError(400, extras.lines ? 'The prompt is already correct — it should be missing the line break.' : 'The prompt is already correct — it should be missing punctuation.');
    return data;
  }
  if (mode === 2) {
    const correct = clip(d.correct, 700).trim();
    const faulty = clip(d.faulty, 700).trim();
    if (!correct || !faulty) throw new HttpError(400, 'Enter both the correct version and the faulty version.');
    const r = buildSlots(correct, faulty);
    if (!r.valid) throw new HttpError(400, r.reason);
    return { correct, faulty, ...cleanRule(d) };
  }
  if (mode === 3) {
    const speaker = clip(d.speaker, 40).trim();
    const line = clip(d.line, 200).trim();
    if (!speaker || !line) throw new HttpError(400, 'Enter the speaker and the line of speech.');
    if (!/[,.!?]$/.test(line)) throw new HttpError(400, 'End the line with punctuation (usually a comma, or ! or ?).');
    const target = cleanTags(d.target);
    if (!target.length) throw new HttpError(400, 'Choose at least one feeling/volume tag the verb must show.');
    return { speaker, line, context: clip(d.context, 300).trim(), target: target.slice(0, 4), ...cleanRule(d) };
  }
  if (mode === 4) return validateMode4(d);
  if (mode === 5) return validateMode5(d);
  if (mode === 6) return validateMode6(d);
  throw new HttpError(400, 'Unknown question type.');
}

function preview(mode, data) {
  if (mode === 1) return previewMode(1, data);
  if (mode >= 4) return previewMode(mode, data);
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

async function listQuestions(env, url, who) {
  const mode = int(url.searchParams.get('mode'), 0);
  const where = ALL_MODES.includes(mode) ? `WHERE q.mode = ${mode} AND q.active = 1` : 'WHERE q.active = 1';
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
  // A teacher sees the shared bank (read-only) and the questions made for their own classes.
  return json({
    questions: rows
      .filter((r) => who.admin || r.class_id === null || who.classes.has(r.class_id))
      .map((r) => {
        const data = parse(r.data, {});
        return { ...r, data, rule: ruleOf(r.mode, data), auto: autoRule(r.mode, data), ruleSet: isRule(data.rule), editable: who.admin || (r.class_id !== null && who.classes.has(r.class_id)) };
      }),
  });
}

async function classScope(env, body, who) {
  const classId = body.class_id ? int(body.class_id, 0) : null;
  if (!who.admin) {
    if (!classId) throw new HttpError(403, 'Choose one of your classes. Only the admin can add questions for every class.');
    needClass(who, classId);
  }
  if (classId) {
    const c = await env.DB.prepare('SELECT id FROM classes WHERE id = ?1').bind(classId).first();
    if (!c) throw new HttpError(400, 'That class doesn’t exist.');
  }
  return { classId, pub: body.public === false ? 0 : 1 };
}

// Shared questions (no class) belong to the admin; a teacher edits only the ones made for their own classes.
function needEditable(who, q) {
  if (who.admin) return;
  if (q.class_id === null || !who.classes.has(q.class_id)) throw new HttpError(403, 'That question is in the shared bank. Only the admin can change it.');
}

async function removeQuestion(env, id, who) {
  const q = await env.DB.prepare('SELECT id, class_id FROM questions WHERE id = ?1').bind(id).first();
  if (!q) throw new HttpError(404, 'Question not found.');
  needEditable(who, q);
  await env.DB.prepare('UPDATE questions SET active = 0 WHERE id = ?1').bind(id).run();
  return json({ ok: true });
}

async function createQuestion(request, env, who) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  const data = validateQuestion(mode, body.data, { lowerFirst: body.lowerFirst });
  const { classId, pub } = await classScope(env, body, who);
  const row = await env.DB
    .prepare('INSERT INTO questions (mode, class_id, public, active, data, created_at) VALUES (?1, ?2, ?3, 1, ?4, ?5) RETURNING id')
    .bind(mode, classId, pub, JSON.stringify(data), Date.now())
    .first();
  return json({ id: row.id, preview: preview(mode, data) });
}

async function updateQuestion(request, env, id, who) {
  const body = await readJson(request);
  const q = await env.DB.prepare('SELECT id, mode, data, class_id FROM questions WHERE id = ?1').bind(id).first();
  if (!q) throw new HttpError(404, 'Question not found.');
  needEditable(who, q);
  const data = body.data ? validateQuestion(q.mode, body.data, { lowerFirst: body.lowerFirst }) : JSON.parse(q.data);
  const { classId, pub } = await classScope(env, body, who);
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

// Sets (or clears) the district of many questions at once. rule: 1-12, or null to go back to the suggestion.
// Only data.rule changes; nothing else about a question is touched, so pupil results are safe.
async function setRules(request, env, who) {
  const body = await readJson(request);
  const items = Array.isArray(body.items) ? body.items : [];
  // Workers limit how many database calls one request may make, so the console sends these in small batches.
  if (items.length > 40) throw new HttpError(400, 'Send at most 40 questions at a time.');
  const wanted = new Map();
  for (const it of items) {
    const id = int(it && it.id, 0);
    if (!id) continue;
    const rule = it.rule == null || it.rule === '' ? null : int(it.rule, 0);
    if (rule !== null && !isRule(rule)) throw new HttpError(400, 'Districts are rules 1 to 12.');
    wanted.set(id, rule);
  }
  if (!wanted.size) return json({ changed: 0 });
  const ids = [...wanted.keys()];
  const found = (await env.DB.prepare(`SELECT id, data, class_id FROM questions WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})`).bind(...ids).all()).results || [];
  for (const q of found) needEditable(who, q);
  const stmts = found.map((q) => {
    const data = parse(q.data, {});
    const rule = wanted.get(q.id);
    if (rule === null) delete data.rule;
    else data.rule = rule;
    return env.DB.prepare('UPDATE questions SET data = ?1 WHERE id = ?2').bind(JSON.stringify(data), q.id);
  });
  if (stmts.length) await env.DB.batch(stmts);
  return json({ changed: stmts.length });
}

async function importQuestions(request, env, who) {
  const body = await readJson(request);
  const mode = int(body.mode, 0);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
  const { classId, pub } = await classScope(env, body, who);
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

async function analytics(env, url, who) {
  const cls = url.searchParams.get('class');
  const days = Math.min(Math.max(int(url.searchParams.get('days'), 30), 1), 365);
  const since = Date.now() - days * 86_400_000;
  const classId = cls === 'guests' ? null : int(cls, 0);
  if (cls !== 'guests' && !classId) throw new HttpError(400, 'Choose a class.');
  if (cls === 'guests') needAdmin(who, 'Only the admin can see guest players.');
  else needClass(who, classId);

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
    return { id: r.id, mode: r.mode, text: r.mode === 1 ? d.prompt : r.mode === 2 ? d.faulty : r.mode === 4 ? d.stem : r.mode === 5 ? d.prompt : r.mode === 6 ? d.sentence : `${d.line} ${d.speaker}`, tries: r.n, right: r.c || 0 };
  });
  return json({ days, codes, pupils: [...pupils.values()], hardest });
}

// ---------- routing ----------

export async function teacherRoute(request, env, url, who = ADMIN) {
  const m = request.method;
  const path = url.pathname.replace(/^\/api\/t/, '');
  let x;
  const pupilClass = async (id) => {
    const p = await env.DB.prepare('SELECT class_id FROM pupils WHERE id = ?1').bind(id).first();
    if (!p) throw new HttpError(404, 'No such pupil.');
    if (p.class_id === null) needAdmin(who, 'Only the admin can manage guest players.');
    else needClass(who, p.class_id);
  };
  if (path === '/ping') return json({ ok: true });
  if (path === '/me' && m === 'GET') return whoAmI(env, who);
  if (path === '/me/password' && m === 'POST') return changeOwnPassword(request, env, who);

  // teacher accounts: admin only
  if (path === '/teachers') {
    needAdmin(who);
    return m === 'GET' ? listTeachers(env) : m === 'POST' ? createTeacher(request, env) : null;
  }
  if ((x = path.match(/^\/teachers\/(\d+)$/))) {
    needAdmin(who);
    if (m === 'PATCH') return updateTeacher(request, env, +x[1]);
    if (m === 'DELETE') return deleteTeacher(env, +x[1]);
  }
  if ((x = path.match(/^\/teachers\/(\d+)\/reset-password$/)) && m === 'POST') {
    needAdmin(who);
    return resetTeacherPassword(env, +x[1]);
  }

  if (path === '/classes') {
    if (m === 'GET') return listClasses(env, who);
    if (m === 'POST') return createClass(request, env, who);
    return null;
  }
  if ((x = path.match(/^\/classes\/(\d+)$/))) {
    if (m === 'PATCH') {
      needClass(who, +x[1]);
      return updateClass(request, env, +x[1]);
    }
    if (m === 'DELETE') {
      await needOwner(env, who, +x[1]);
      return deleteClass(env, +x[1]);
    }
  }
  if ((x = path.match(/^\/classes\/(\d+)\/regen$/)) && m === 'POST') {
    needClass(who, +x[1]);
    return regenCode(request, env, +x[1]);
  }
  if ((x = path.match(/^\/classes\/(\d+)\/unlocks$/))) {
    needClass(who, +x[1]);
    if (m === 'GET') return getUnlocks(env, +x[1]);
    if (m === 'PUT') return setUnlocks(request, env, +x[1]);
  }
  if ((x = path.match(/^\/classes\/(\d+)\/pupils$/))) {
    needClass(who, +x[1]);
    if (m === 'GET') return listPupils(env, +x[1]);
    if (m === 'POST') return addPupils(request, env, +x[1]);
  }
  if ((x = path.match(/^\/classes\/(\d+)\/pupils\/preview$/)) && m === 'POST') {
    needClass(who, +x[1]);
    return previewPupils(request, env, +x[1]);
  }
  if ((x = path.match(/^\/pupils\/(\d+)$/))) {
    await pupilClass(+x[1]);
    if (m === 'PATCH') return updatePupil(request, env, +x[1]);
    if (m === 'DELETE') return deletePupil(env, +x[1]);
  }
  if ((x = path.match(/^\/pupils\/(\d+)\/reset$/)) && m === 'POST') {
    await pupilClass(+x[1]);
    return resetPupil(env, +x[1]);
  }

  if (path === '/questions') return m === 'GET' ? listQuestions(env, url, who) : m === 'POST' ? createQuestion(request, env, who) : null;
  if (path === '/questions/preview' && m === 'POST') return previewQuestion(request);
  if (path === '/questions/import' && m === 'POST') return importQuestions(request, env, who);
  if (path === '/questions/rules' && m === 'POST') return setRules(request, env, who);
  if (path === '/settings') {
    if (m === 'GET') return json(await getSettings(env));
    if (m === 'PUT') {
      needAdmin(who, 'Only the admin can change the town-wide settings.');
      return json(await saveSettings(env, await readJson(request)));
    }
    return null;
  }
  if (path === '/dashboard' && m === 'GET') return dashboard(env, url, who);
  if (path === '/unlock-grid' && m === 'GET') return unlockGrid(env, who);
  if (path === '/settings/preview' && m === 'POST') {
    needAdmin(who, 'Only the admin can change the town-wide settings.');
    return settingsPreview(request, env);
  }
  if (path === '/districts' && m === 'GET') return json({ districts: DISTRICTS, tiers: LEVEL_TIERS, tierXp: (await getSettings(env)).tierXp });
  if ((x = path.match(/^\/questions\/(\d+)$/))) {
    if (m === 'PUT') return updateQuestion(request, env, +x[1], who);
    if (m === 'DELETE') return removeQuestion(env, +x[1], who);
  }

  // verbs: teachers can approve or reject what pupils proposed; the shared word list is the admin's
  if (path === '/verbs/review' && m === 'GET') return reviewList(env);
  if ((x = path.match(/^\/verbs\/review\/([^/]+)\/(approve|reject|reset)$/)) && m === 'POST') return reviewAct(request, env, decodeURIComponent(x[1]), x[2]);
  if (path === '/verbs' || path === '/verbs/import' || /^\/verbs\/\d+$/.test(path)) {
    needAdmin(who, 'Only the admin can change the shared verb list.');
    if (path === '/verbs') return m === 'GET' ? listVerbs(env) : m === 'POST' ? createVerb(request, env) : null;
    if (path === '/verbs/import' && m === 'POST') return importVerbs(request, env);
    x = path.match(/^\/verbs\/(\d+)$/);
    if (m === 'PUT') return updateVerb(request, env, +x[1]);
    if (m === 'DELETE') return deleteVerb(env, +x[1]);
  }

  if (path === '/analytics' && m === 'GET') return analytics(env, url, who);
  return null;
}
