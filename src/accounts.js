// Teacher accounts (v1.3).
//
//   super admin  the Cloudflare secrets (teacher_user / teacher_password). Can do everything, and is the only
//                one who can create teacher accounts, edit the shared question bank and verb list, change
//                town-wide settings, see guest players, and delete classes that nobody owns.
//   teacher      a row in `teachers`. Is the admin of their own classes: creates them (and owns them), runs
//                pupils, codes, class questions, analytics and district unlocks, and can delete the classes
//                they created. The super admin can also assign them classes made by someone else, which they
//                can run but not delete.
//
// `who` is what every teacher-console request is checked against:
//   { admin: true }  or  { admin: false, id, name, classes: Set<classId> }

import { safeEqual } from './auth.js';
import { HttpError, json, readJson, clip, int } from './util.js';

const ITER = 100_000; // the most the Workers runtime allows for PBKDF2
const enc = new TextEncoder();

export const ADMIN = Object.freeze({ admin: true, id: 0, name: 'Admin', classes: null });

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: ITER }, key, 256));
}
export async function hashPassword(password) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(password, salt) };
}
export async function checkPassword(password, salt, hash) {
  return safeEqual(await derive(password, salt), hash);
}

// Easy to read out loud: no 0/O, 1/l/I.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function newPassword(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const canClass = (who, classId) => !!who && (who.admin || who.classes.has(classId));
export function needClass(who, classId) {
  if (!canClass(who, classId)) throw new HttpError(403, 'That class isn’t one of yours.');
}
export function needAdmin(who, what) {
  if (!who || !who.admin) throw new HttpError(403, what || 'Only the admin can do that.');
}

// ---------- sign-in and per-request identity ----------

// Returns the teacher row for a good username + password, or null. Always does the same work either way.
export async function teacherSignIn(env, username, password) {
  const row = await env.DB.prepare('SELECT * FROM teachers WHERE username = ?1').bind(clip(username, 60).trim().toLowerCase()).first();
  const salt = row ? row.pass_salt : b64(new Uint8Array(16));
  const hash = row ? row.pass_hash : 'x';
  const good = await checkPassword(clip(password, 200), salt, hash);
  if (!row || !good || !row.active) return null;
  await env.DB.prepare('UPDATE teachers SET last_login = ?1 WHERE id = ?2').bind(Date.now(), row.id).run();
  return row;
}

// Turns a verified token into `who`, or null if the account is gone, switched off or signed out.
export async function loadWho(env, payload) {
  if (!payload || payload.r !== 't') return null;
  if (!payload.tid) return ADMIN; // the original sign-in, from the Cloudflare secrets
  const t = await env.DB.prepare('SELECT id, name, active, sess_ver FROM teachers WHERE id = ?1').bind(payload.tid).first();
  if (!t || !t.active || t.sess_ver !== (payload.sv || 0)) return null;
  const rows = (await env.DB.prepare('SELECT class_id FROM teacher_classes WHERE teacher_id = ?1').bind(t.id).all()).results || [];
  return { admin: false, id: t.id, name: t.name, classes: new Set(rows.map((r) => r.class_id)) };
}

// ---------- the admin's account screen ----------

const USER_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

async function accountRows(env) {
  const [ts, links] = await Promise.all([
    env.DB.prepare('SELECT id, username, name, active, created_at, last_login FROM teachers ORDER BY name COLLATE NOCASE').all(),
    env.DB.prepare('SELECT teacher_id, class_id FROM teacher_classes').all(),
  ]);
  const by = new Map();
  for (const l of links.results || []) by.set(l.teacher_id, [...(by.get(l.teacher_id) || []), l.class_id]);
  return (ts.results || []).map((t) => ({ ...t, active: !!t.active, classes: by.get(t.id) || [] }));
}

export async function listTeachers(env) {
  return json({ teachers: await accountRows(env) });
}

async function validClassIds(env, ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map((x) => int(x, 0)).filter(Boolean))].slice(0, 100);
  if (!want.length) return [];
  const rows = (await env.DB.prepare(`SELECT id FROM classes WHERE id IN (${want.map((_, i) => `?${i + 1}`).join(',')})`).bind(...want).all()).results || [];
  return rows.map((r) => r.id);
}

async function writeClasses(env, teacherId, classIds) {
  const stmts = [env.DB.prepare('DELETE FROM teacher_classes WHERE teacher_id = ?1').bind(teacherId)];
  for (const c of classIds) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO teacher_classes (teacher_id, class_id) VALUES (?1, ?2)').bind(teacherId, c));
  await env.DB.batch(stmts);
}

export async function createTeacher(request, env) {
  const body = await readJson(request);
  const name = clip(body.name, 60).trim();
  const username = clip(body.username, 30).trim().toLowerCase();
  if (!name) throw new HttpError(400, 'Give the teacher a name.');
  if (!USER_RE.test(username)) throw new HttpError(400, 'Usernames are 3-30 characters: lowercase letters, numbers, dots, dashes and underscores.');
  if (env.teacher_user && username === String(env.teacher_user).trim().toLowerCase()) throw new HttpError(400, 'That username is the admin’s. Choose another.');
  const password = newPassword();
  const { salt, hash } = await hashPassword(password);
  let row;
  try {
    row = await env.DB.prepare('INSERT INTO teachers (username, name, pass_salt, pass_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id, username, name').bind(username, name, salt, hash, Date.now()).first();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw new HttpError(409, 'That username is already taken.');
    throw e;
  }
  const classes = await validClassIds(env, body.classes);
  if (classes.length) await writeClasses(env, row.id, classes);
  return json({ teacher: { ...row, active: true, classes }, password });
}

export async function updateTeacher(request, env, id) {
  const body = await readJson(request);
  const t = await env.DB.prepare('SELECT id FROM teachers WHERE id = ?1').bind(id).first();
  if (!t) throw new HttpError(404, 'No such teacher.');
  if (body.name !== undefined) {
    const name = clip(body.name, 60).trim();
    if (!name) throw new HttpError(400, 'Give the teacher a name.');
    await env.DB.prepare('UPDATE teachers SET name = ?1 WHERE id = ?2').bind(name, id).run();
  }
  if (body.active !== undefined) {
    // switching an account off also signs it out everywhere
    await env.DB.prepare('UPDATE teachers SET active = ?1, sess_ver = sess_ver + 1 WHERE id = ?2').bind(body.active ? 1 : 0, id).run();
  }
  if (body.classes !== undefined) await writeClasses(env, id, await validClassIds(env, body.classes));
  return json({ ok: true });
}

export async function resetTeacherPassword(env, id) {
  const t = await env.DB.prepare('SELECT id FROM teachers WHERE id = ?1').bind(id).first();
  if (!t) throw new HttpError(404, 'No such teacher.');
  const password = newPassword();
  const { salt, hash } = await hashPassword(password);
  await env.DB.prepare('UPDATE teachers SET pass_salt = ?1, pass_hash = ?2, sess_ver = sess_ver + 1 WHERE id = ?3').bind(salt, hash, id).run();
  return json({ password });
}

// Deleting a teacher keeps their classes (and pupils). Those classes lose their owner, so from then on only
// the super admin can delete them or give them to another teacher.
export async function deleteTeacher(env, id) {
  try {
    await env.DB.prepare('DELETE FROM class_owners WHERE teacher_id = ?1').bind(id).run();
  } catch {} // not migrated yet
  await env.DB.batch([env.DB.prepare('DELETE FROM teacher_classes WHERE teacher_id = ?1').bind(id), env.DB.prepare('DELETE FROM teachers WHERE id = ?1').bind(id)]);
  return json({ ok: true });
}

// A teacher changing their own password (the admin's lives in the Cloudflare secrets).
export async function changeOwnPassword(request, env, who) {
  if (who.admin) throw new HttpError(400, 'The admin password is set in Cloudflare (the teacher_password secret).');
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT pass_salt, pass_hash FROM teachers WHERE id = ?1').bind(who.id).first();
  if (!row || !(await checkPassword(clip(body.current, 200), row.pass_salt, row.pass_hash))) throw new HttpError(403, 'Your current password isn’t right.');
  const next = clip(body.next, 200);
  if (next.length < 8) throw new HttpError(400, 'Use at least 8 characters for the new password.');
  const { salt, hash } = await hashPassword(next);
  await env.DB.prepare('UPDATE teachers SET pass_salt = ?1, pass_hash = ?2 WHERE id = ?3').bind(salt, hash, who.id).run();
  return json({ ok: true });
}

// What the console needs to know about the signed-in person.
export async function whoAmI(env, who) {
  if (who.admin) return json({ admin: true, name: 'Admin', classes: null });
  return json({ admin: false, name: who.name, classes: [...who.classes] });
}
