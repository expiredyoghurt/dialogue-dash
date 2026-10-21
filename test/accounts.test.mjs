// Dash Express 1.3: level gating, class unlocks, teacher accounts and what each kind of teacher may touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, pupilCtx } from './helpers/d1.mjs';
import * as pupil from '../src/pupil.js';
import { HttpError } from '../src/util.js';
import { teacherRoute, teacherLogin } from '../src/teacher.js';
import { verifyToken } from '../src/auth.js';
import { ADMIN, loadWho, teacherSignIn, hashPassword, checkPassword } from '../src/accounts.js';
import { levelFor, xpForLevel, nextTier, allowedDistricts, tierLevel, ruleOf, validateBands, DEFAULT_BANDS, LEVEL_TIERS } from '../src/districts.js';

const SEEDS = ['questions-450.sql', 'seed-new-types.sql', 'seed-new-types-extra.sql'];
const SECRETS = { teacher_user: 'admin', teacher_password: 'admin-pass-123' };
const setup = () => {
  const { db, d1 } = makeDb({ seeds: SEEDS });
  return { db, env: { DB: d1, ...SECRETS } };
};
const rows = (db) => db.prepare('SELECT id, mode, data, class_id FROM questions WHERE active = 1').all().map((r) => ({ ...r, data: JSON.parse(r.data) }));
const inDistrict = (db, n) => rows(db).filter((r) => ruleOf(r.mode, r.data) === n);
const addXp = (db, xp, ctx = pupilCtx) => {
  const q = rows(db)[0];
  db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (?,?,?,?,1,0,1,?, 'x', '[]', ?)").run(ctx.id, ctx.classId, q.id, q.mode, xp, Date.now() - 86_400_000);
};
const list = async (e, ctx = pupilCtx, qs = '') => (await (await pupil.listQuestions(e, ctx, new URL('http://x/api/questions' + qs))).json()).questions;
const me = async (e, ctx = pupilCtx) => (await pupil.me(e, ctx)).json();
const call = async (e, who, method, path, body) => {
  try {
    const r = await teacherRoute(new Request('http://x/api/t' + path, { method, body: body ? JSON.stringify(body) : undefined }), e, new URL('http://x/api/t' + path), who);
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};
const addClass = (db, name) => db.prepare("INSERT INTO classes (name, code, created_at) VALUES (?, ?, 1) RETURNING id").get(name, 'CODE' + name).id;
const addPupil = (db, classId, name) => db.prepare("INSERT INTO pupils (class_id, name, username, is_guest, created_at) VALUES (?, ?, ?, 0, 1) RETURNING id").get(classId, name, name.toLowerCase()).id;

// ---------------------------------------------------------------- levels

test('levels: the standard ranges cost 50, 75, 100, 150 then 200 XP per level', () => {
  assert.deepEqual(DEFAULT_BANDS, [{ upTo: 10, xp: 50 }, { upTo: 20, xp: 75 }, { upTo: 30, xp: 100 }, { upTo: 40, xp: 150 }, { upTo: null, xp: 200 }]);
  const at = (xp) => levelFor(xp);
  assert.equal(at(0), 1);
  assert.equal(at(49), 1);
  assert.equal(at(50), 2, 'level 1 is free; level 2 costs 50');
  assert.equal(at(449), 9);
  assert.equal(at(450), 10, 'levels 2-10 cost 50 each: 9 x 50');
  assert.equal(at(524), 10);
  assert.equal(at(525), 11, 'level 11 costs 75');
  assert.equal(at(1199), 19);
  assert.equal(at(1200), 20, '450 + ten levels at 75');
  assert.equal(at(1299), 20);
  assert.equal(at(1300), 21, 'level 21 costs 100');
  assert.equal(at(2200), 30);
  assert.equal(at(2349), 30);
  assert.equal(at(2350), 31, 'level 31 costs 150');
  assert.equal(at(3700), 40);
  assert.equal(at(3899), 40);
  assert.equal(at(3900), 41, 'level 41 costs 200');
  assert.equal(at(4100), 42);
  assert.equal(at(10_100), 41 + Math.floor((10_100 - 3900) / 200), 'and 200 each from there on');
  assert.equal(at(-5), 1);
  for (const [l, xp] of [[1, 0], [2, 50], [10, 450], [11, 525], [20, 1200], [21, 1300], [30, 2200], [31, 2350], [40, 3700], [41, 3900]]) assert.equal(xpForLevel(l), xp, 'xpForLevel(' + l + ')');
});

test('levelFor and xpForLevel agree for any ranges', () => {
  const sets = [DEFAULT_BANDS, [{ xp: 100, upTo: null }], [{ upTo: 2, xp: 7 }, { upTo: 5, xp: 1 }, { upTo: null, xp: 33 }]];
  for (const bands of sets) {
    for (let x = 0; x < 3000; x += 7) {
      const L = levelFor(x, bands);
      assert.ok(xpForLevel(L, bands) <= x && x < xpForLevel(L + 1, bands), `xp ${x} level ${L}`);
    }
  }
});

test('validateBands accepts sensible ranges and refuses the rest', () => {
  assert.equal(validateBands(DEFAULT_BANDS).ok, true);
  assert.equal(validateBands([{ upTo: null, xp: 60 }]).ok, true);
  assert.deepEqual(validateBands([{ upTo: '12', xp: '40' }, { upTo: null, xp: '90' }]).bands, [{ upTo: 12, xp: 40 }, { upTo: null, xp: 90 }]);
  for (const bad of [
    null, [], 'x', Array.from({ length: 9 }, (_, i) => ({ upTo: i + 2, xp: 5 })),
    [{ upTo: 10, xp: 50 }],                                     // last range must be open-ended
    [{ upTo: 10, xp: 50 }, { upTo: 10, xp: 60 }, { upTo: null, xp: 70 }], // not increasing
    [{ upTo: 20, xp: 50 }, { upTo: 10, xp: 60 }, { upTo: null, xp: 70 }],
    [{ upTo: 1, xp: 50 }, { upTo: null, xp: 70 }],              // level 1 is free, a range must reach level 2
    [{ upTo: 10, xp: 0 }, { upTo: null, xp: 70 }],
    [{ upTo: 10, xp: 2.5 }, { upTo: null, xp: 70 }],
    [{ upTo: 10, xp: 50 }, { upTo: null, xp: -1 }],
    [{ upTo: 5000, xp: 50 }, { upTo: null, xp: 70 }],
  ]) assert.equal(validateBands(bad).ok, false, JSON.stringify(bad));
});

test('tiers: districts 1-3 from the start, 4-6 at level 10, the rest at level 20', () => {
  assert.deepEqual(LEVEL_TIERS.map((t) => [t.level, t.districts]), [[1, [1, 2, 3]], [10, [4, 5, 6]], [20, [7, 8, 9, 10, 11, 12]]]);
  const open = (level, extra = {}) => [...allowedDistricts({ level, ...extra })];
  assert.deepEqual(open(1), [1, 2, 3]);
  assert.deepEqual(open(9), [1, 2, 3]);
  assert.deepEqual(open(10), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(open(19), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(open(20), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(open(1, { manual: [8] }), [1, 2, 3, 8]);
  assert.deepEqual(open(1, { manual: [99, 'x'] }), [1, 2, 3], 'nonsense is ignored');
  assert.equal(open(1, { openAll: true }).length, 12);
  assert.equal(tierLevel(5), 10);
  assert.equal(tierLevel(12), 20);
  assert.deepEqual(nextTier(1), { level: 10, districts: [4, 5, 6], xp: 450 });
  assert.deepEqual(nextTier(10), { level: 20, districts: [7, 8, 9, 10, 11, 12], xp: 1200 });
  assert.deepEqual(nextTier(10, [{ upTo: null, xp: 100 }]), { level: 20, districts: [7, 8, 9, 10, 11, 12], xp: 1900 }, 'tiers follow whatever ranges are set');
  assert.equal(nextTier(20), null);
});

test('a pupil only ever gets parcels from the districts their level has opened', async () => {
  const { db, env: e } = setup();
  const seen = async () => new Set((await list(e)).map((q) => q.rule));
  assert.deepEqual([...(await seen())].sort((a, b) => a - b), [1, 2, 3]);
  addXp(db, 449);
  assert.equal((await me(e)).level.level, 9);
  assert.deepEqual([...(await seen())].sort((a, b) => a - b), [1, 2, 3]);
  addXp(db, 1);
  assert.equal((await me(e)).level.level, 10);
  assert.deepEqual([...(await seen())].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  addXp(db, 749);
  assert.equal((await me(e)).level.level, 19);
  assert.equal((await seen()).size, 6, 'one XP short of level 20');
  addXp(db, 1);
  assert.equal((await me(e)).level.level, 20);
  assert.equal((await seen()).size, 12);
});

test('me() reports level, what is next, and what is locked and why', async () => {
  const { db, env: e } = setup();
  let m = await me(e);
  assert.equal(m.level.level, 1);
  assert.equal(m.level.from, 0);
  assert.equal(m.level.next, 50);
  assert.deepEqual(m.level.nextTier, { level: 10, districts: [4, 5, 6], xp: 450 });
  assert.equal(m.districts[3].unlocked, false);
  assert.equal(m.districts[3].needLevel, 10);
  assert.equal(m.districts[6].needLevel, 20);
  addXp(db, 1200);
  m = await me(e);
  assert.equal(m.level.nextTier, null);
  assert.ok(m.districts.every((d) => d.unlocked));
});

test('locked parcels cannot be answered or delivered even if the browser asks for them', async () => {
  const { db, env: e } = setup();
  const locked = inDistrict(db, 4)[0];
  const r = await pupil.answer(new Request('http://x/api/answer', { method: 'POST', body: JSON.stringify({ qid: locked.id, answer: 'x', tryNo: 1 }) }), e, pupilCtx).catch((x) => x);
  assert.ok(r instanceof HttpError && r.status === 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n, 0, 'nothing was recorded');
  const open = inDistrict(db, 1).slice(0, 5);
  for (const q of open) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (1, NULL, ?, ?, 1, 0, 1, 10, 'x', '[]', ?)").run(q.id, q.mode, Date.now());
  const route = (qids, district) => pupil.route(new Request('http://x/api/route', { method: 'POST', body: JSON.stringify({ kind: 'route', district, qids, startedAt: Date.now() - 1000, ms: 1000 }) }), e, pupilCtx).catch((x) => x);
  const bad = await route([locked.id], 4);
  assert.ok(bad instanceof HttpError && bad.status === 403, 'a route in a locked district is refused');
  const good = await route(open.map((q) => q.id), 1);
  assert.equal(good.status, 200);
});

test('practice and the depot counts leave out locked districts too', async () => {
  const { db, env: e } = setup();
  const m = await me(e);
  const total = Object.values(m.modes).reduce((a, x) => a + x.total, 0);
  const all = rows(db).length;
  assert.ok(total < all && total > 50, `only the reachable parcels are counted (${total} of ${all})`);
  const modeList = await list(e, pupilCtx, '?mode=3');
  assert.equal(modeList.length, 0, 'Build your ride is all district 7 and still locked');
});

// ---------------------------------------------------------------- class unlocks

test('a teacher can open districts for a class ahead of the level; guests are unaffected', async () => {
  const { db, env: e } = setup();
  const cid = addClass(db, 'A');
  const ctx = { id: addPupil(db, cid, 'Mei'), name: 'Mei', classId: cid, guest: false, className: 'A' };
  assert.deepEqual([...new Set((await list(e, ctx)).map((q) => q.rule))].sort((a, b) => a - b), [1, 2, 3]);
  const put = await call(e, ADMIN, 'PUT', `/classes/${cid}/unlocks`, { unlocked: [7, 4, 4, 99, 'x'] });
  assert.deepEqual(put.body.unlocked, [4, 7]);
  assert.deepEqual((await call(e, ADMIN, 'GET', `/classes/${cid}/unlocks`)).body.unlocked, [4, 7]);
  const m = await me(e, ctx);
  assert.deepEqual(m.districts.filter((d) => d.unlocked).map((d) => d.n), [1, 2, 3, 4, 7]);
  assert.equal(m.level.level, 1, 'level itself is unchanged');
  assert.deepEqual([...new Set((await list(e, ctx)).map((q) => q.rule))].sort((a, b) => a - b), [1, 2, 3, 4, 7]);
  assert.deepEqual([...new Set((await list(e)).map((q) => q.rule))].sort((a, b) => a - b), [1, 2, 3], 'a guest is not in that class');
  await call(e, ADMIN, 'PUT', `/classes/${cid}/unlocks`, { unlocked: [] });
  assert.equal((await me(e, ctx)).districts.filter((d) => d.unlocked).length, 3, 'taking the unlock away puts the lock back');
});

test('the admin can open the whole town for everyone', async () => {
  const { env: e } = setup();
  await call(e, ADMIN, 'PUT', '/settings', { openDistricts: true });
  assert.equal((await me(e)).districts.filter((d) => d.unlocked).length, 12);
});

// ---------------------------------------------------------------- accounts

const makeTeacher = async (e, body = { name: 'Ms Tan', username: 'tan', classes: [] }) => (await call(e, ADMIN, 'POST', '/teachers', body)).body;

test('passwords are salted PBKDF2 hashes', async () => {
  const a = await hashPassword('hello-world');
  const b = await hashPassword('hello-world');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.ok(!a.hash.includes('hello'));
  assert.equal(await checkPassword('hello-world', a.salt, a.hash), true);
  assert.equal(await checkPassword('Hello-world', a.salt, a.hash), false);
});

test('the admin creates a teacher, who can sign in with the password shown once', async () => {
  const { db, env: e } = setup();
  const c1 = addClass(db, 'A');
  const made = await makeTeacher(e, { name: 'Ms Tan', username: 'Tan', classes: [c1, 9999] });
  assert.equal(made.teacher.username, 'tan');
  assert.deepEqual(made.teacher.classes, [c1], 'classes that do not exist are ignored');
  assert.match(made.password, /^[A-Za-z2-9]{10}$/);
  const stored = db.prepare('SELECT pass_hash, pass_salt FROM teachers').get();
  assert.ok(stored.pass_hash && !JSON.stringify(stored).includes(made.password), 'the password itself is not stored');
  assert.ok(await teacherSignIn(e, 'tan', made.password));
  assert.ok(await teacherSignIn(e, 'TAN', made.password), 'usernames are not case sensitive');
  assert.equal(await teacherSignIn(e, 'tan', 'nope'), null);
  assert.equal(await teacherSignIn(e, 'nobody', made.password), null);
  const list1 = (await call(e, ADMIN, 'GET', '/teachers')).body.teachers;
  assert.equal(list1.length, 1);
  assert.deepEqual(Object.keys(list1[0]).sort(), ['active', 'classes', 'created_at', 'id', 'last_login', 'name', 'username']);
});

test('usernames: the admin’s is reserved, duplicates and odd ones are refused', async () => {
  const { env: e } = setup();
  assert.equal((await call(e, ADMIN, 'POST', '/teachers', { name: 'X', username: 'admin' })).status, 400);
  assert.equal((await call(e, ADMIN, 'POST', '/teachers', { name: 'X', username: 'ab' })).status, 400);
  assert.equal((await call(e, ADMIN, 'POST', '/teachers', { name: 'X', username: 'has space' })).status, 400);
  assert.equal((await call(e, ADMIN, 'POST', '/teachers', { name: '', username: 'okname' })).status, 400);
  await makeTeacher(e);
  assert.equal((await call(e, ADMIN, 'POST', '/teachers', { name: 'Another', username: 'tan' })).status, 409);
});

test('signing in through the login endpoint: admin and teacher both get a working token', async () => {
  const { db, env: e } = setup();
  const made = await makeTeacher(e);
  const login = (username, password) => teacherLogin(new Request('http://x/api/teacher/login', { method: 'POST', body: JSON.stringify({ username, password }) }), e).catch((x) => x);
  const a = await (await login('admin', 'admin-pass-123')).json();
  assert.equal(a.admin, true);
  assert.equal(await loadWho(e, await verifyToken(e, a.token)), ADMIN);
  const t = await (await login('tan', made.password)).json();
  assert.equal(t.admin, false);
  const who = await loadWho(e, await verifyToken(e, t.token));
  assert.equal(who.admin, false);
  assert.equal(who.name, 'Ms Tan');
  const bad = await login('tan', 'wrong');
  assert.ok(bad instanceof HttpError && bad.status === 401);
  const bad2 = await login('admin', 'wrong');
  assert.ok(bad2 instanceof HttpError && bad2.status === 401);
  assert.ok(db.prepare('SELECT last_login FROM teachers').get().last_login > 0);
});

test('deactivating, resetting a password or deleting a teacher signs them out', async () => {
  const { env: e } = setup();
  const made = await makeTeacher(e);
  const id = made.teacher.id;
  const token = async (pw) => (await (await teacherLogin(new Request('http://x', { method: 'POST', body: JSON.stringify({ username: 'tan', password: pw }) }), e)).json()).token;
  let t = await token(made.password);
  assert.ok(await loadWho(e, await verifyToken(e, t)));
  await call(e, ADMIN, 'PATCH', `/teachers/${id}`, { active: false });
  assert.equal(await loadWho(e, await verifyToken(e, t)), null, 'switched off');
  assert.equal(await teacherSignIn(e, 'tan', made.password), null, 'cannot sign in while off');
  await call(e, ADMIN, 'PATCH', `/teachers/${id}`, { active: true });
  t = await token(made.password);
  const reset = (await call(e, ADMIN, 'POST', `/teachers/${id}/reset-password`)).body;
  assert.notEqual(reset.password, made.password);
  assert.equal(await loadWho(e, await verifyToken(e, t)), null, 'old session ends on a reset');
  assert.equal(await teacherSignIn(e, 'tan', made.password), null);
  t = await token(reset.password);
  assert.ok(await loadWho(e, await verifyToken(e, t)));
  await call(e, ADMIN, 'DELETE', `/teachers/${id}`);
  assert.equal(await loadWho(e, await verifyToken(e, t)), null, 'deleted');
});

test('a teacher can change their own password; the admin cannot do it here', async () => {
  const { env: e } = setup();
  const made = await makeTeacher(e);
  const who = await loadWho(e, { r: 't', tid: made.teacher.id, sv: 0 });
  assert.equal((await call(e, who, 'POST', '/me/password', { current: 'wrong', next: 'a-new-password' })).status, 403);
  assert.equal((await call(e, who, 'POST', '/me/password', { current: made.password, next: 'short' })).status, 400);
  assert.equal((await call(e, who, 'POST', '/me/password', { current: made.password, next: 'a-new-password' })).status, 200);
  assert.ok(await teacherSignIn(e, 'tan', 'a-new-password'));
  assert.equal(await teacherSignIn(e, 'tan', made.password), null);
  assert.equal((await call(e, ADMIN, 'POST', '/me/password', { current: 'x', next: 'a-new-password' })).status, 400);
});

test('assigning and re-assigning classes', async () => {
  const { db, env: e } = setup();
  const [a, b, c] = ['A', 'B', 'C'].map((n) => addClass(db, n));
  const made = await makeTeacher(e, { name: 'Ms Tan', username: 'tan', classes: [a] });
  await call(e, ADMIN, 'PATCH', `/teachers/${made.teacher.id}`, { classes: [b, c] });
  assert.deepEqual((await call(e, ADMIN, 'GET', '/teachers')).body.teachers[0].classes.sort(), [b, c]);
  const who = await loadWho(e, { r: 't', tid: made.teacher.id, sv: 0 });
  assert.deepEqual([...who.classes].sort(), [b, c]);
});

// ---------------------------------------------------------------- what a teacher may touch

const twoClasses = async () => {
  const s = setup();
  const a = addClass(s.db, 'A');
  const b = addClass(s.db, 'B');
  const made = await makeTeacher(s.env, { name: 'Ms Tan', username: 'tan', classes: [a] });
  const who = await loadWho(s.env, { r: 't', tid: made.teacher.id, sv: 0 });
  return { ...s, a, b, who, pa: addPupil(s.db, a, 'Amy'), pb: addPupil(s.db, b, 'Ben') };
};

test('a teacher sees and manages only their own classes', async () => {
  const { db, env: e, who, a, b, pa, pb } = await twoClasses();
  assert.deepEqual((await call(e, who, 'GET', '/classes')).body.classes.map((c) => c.id), [a]);
  assert.equal((await call(e, ADMIN, 'GET', '/classes')).body.classes.length, 2);
  assert.equal((await call(e, who, 'GET', `/classes/${a}/pupils`)).status, 200);
  assert.equal((await call(e, who, 'GET', `/classes/${b}/pupils`)).status, 403);
  assert.equal((await call(e, who, 'POST', `/classes/${b}/pupils`, { names: 'Zed' })).status, 403);
  assert.equal((await call(e, who, 'PATCH', `/classes/${b}`, { name: 'Mine now' })).status, 403);
  assert.equal((await call(e, who, 'PATCH', `/classes/${a}`, { name: 'A renamed' })).status, 200);
  assert.equal((await call(e, who, 'POST', `/classes/${b}/regen`)).status, 403);
  assert.equal((await call(e, who, 'POST', `/classes/${a}/regen`)).status, 200);
  assert.equal((await call(e, who, 'PATCH', `/pupils/${pb}`, { name: 'Ben2' })).status, 403);
  assert.equal((await call(e, who, 'POST', `/pupils/${pb}/reset`)).status, 403);
  assert.equal((await call(e, who, 'DELETE', `/pupils/${pb}`)).status, 403);
  assert.equal((await call(e, who, 'POST', `/pupils/${pa}/reset`)).status, 200);
  assert.equal((await call(e, who, 'PATCH', `/pupils/${pa}`, { name: 'Amy2' })).status, 200);
  assert.equal((await call(e, who, 'DELETE', `/pupils/${pa}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pupils WHERE class_id = ?').get(b).n, 1, 'the other class is untouched');
});

test('a teacher cannot run the town or manage teachers, or delete a class they were only given', async () => {
  const { env: e, who, a } = await twoClasses();
  assert.equal((await call(e, who, 'DELETE', `/classes/${a}`)).status, 403, 'a class the super admin assigned can be run, not deleted');
  assert.equal((await call(e, who, 'GET', '/teachers')).status, 403);
  assert.equal((await call(e, who, 'POST', '/teachers', { name: 'X', username: 'xxx' })).status, 403);
  assert.equal((await call(e, who, 'PATCH', '/teachers/1', { active: false })).status, 403);
  assert.equal((await call(e, who, 'DELETE', '/teachers/1')).status, 403);
  assert.equal((await call(e, who, 'POST', '/teachers/1/reset-password')).status, 403);
  assert.equal((await call(e, who, 'PUT', '/settings', { clock: false })).status, 403);
  assert.equal((await call(e, who, 'GET', '/settings')).status, 200, 'they can read the settings');
  assert.equal((await call(e, who, 'GET', '/verbs')).status, 403);
  assert.equal((await call(e, who, 'POST', '/verbs', { base: 'x' })).status, 403);
  assert.equal((await call(e, who, 'GET', '/verbs/review')).status, 200, 'but they can review verbs pupils proposed');
});

test('a teacher opens districts only for their own classes', async () => {
  const { env: e, who, a, b } = await twoClasses();
  assert.equal((await call(e, who, 'PUT', `/classes/${a}/unlocks`, { unlocked: [4, 5, 6] })).status, 200);
  assert.deepEqual((await call(e, who, 'GET', `/classes/${a}/unlocks`)).body.unlocked, [4, 5, 6]);
  assert.equal((await call(e, who, 'PUT', `/classes/${b}/unlocks`, { unlocked: [4] })).status, 403);
  assert.equal((await call(e, who, 'GET', `/classes/${b}/unlocks`)).status, 403);
  assert.equal((await call(e, ADMIN, 'PUT', `/classes/${b}/unlocks`, { unlocked: [9] })).status, 200);
});

test('questions: the shared bank is the admin’s; a teacher works on their own classes’ questions', async () => {
  const { db, env: e, who, a, b } = await twoClasses();
  const global = rows(db).find((r) => r.class_id === null);
  const mine = { mode: 1, data: { correct: '“Stop!” shouted Kai.' }, class_id: a };
  assert.equal((await call(e, who, 'POST', '/questions', { mode: 1, data: mine.data })).status, 403, 'must choose a class');
  assert.equal((await call(e, who, 'POST', '/questions', { ...mine, class_id: b })).status, 403, 'not their class');
  const made = await call(e, who, 'POST', '/questions', mine);
  assert.equal(made.status, 200);
  const imp = await call(e, who, 'POST', '/questions/import', { mode: 1, class_id: b, rows: [{ correct: '“Hi,” said Raj.' }] });
  assert.equal(imp.status, 403);
  assert.equal((await call(e, who, 'POST', '/questions/import', { mode: 1, class_id: a, rows: [{ correct: '“Hi,” said Raj.' }] })).body.added, 1);
  const seen = (await call(e, who, 'GET', '/questions')).body.questions;
  assert.ok(seen.find((q) => q.id === made.body.id).editable);
  assert.equal(seen.find((q) => q.id === global.id).editable, false, 'shared questions are visible but read-only');
  const other = await call(e, ADMIN, 'POST', '/questions', { mode: 1, data: { correct: '“Nope,” said Zed.' }, class_id: b });
  assert.equal(seen.find((q) => q.id === other.body.id), undefined, 'another class’s questions are hidden');
  assert.equal((await call(e, who, 'PUT', `/questions/${global.id}`, { data: global.data })).status, 403);
  assert.equal((await call(e, who, 'PUT', `/questions/${other.body.id}`, { data: { correct: '“Edited,” said Zed.' }, class_id: b })).status, 403);
  assert.equal((await call(e, who, 'PUT', `/questions/${made.body.id}`, { data: { correct: '“Stop!” yelled Kai.' }, class_id: a })).status, 200);
  assert.equal((await call(e, who, 'PUT', `/questions/${made.body.id}`, { data: { correct: '“Stop!” yelled Kai.' }, class_id: b })).status, 403, 'cannot hand it to a class that is not theirs');
  assert.equal((await call(e, who, 'DELETE', `/questions/${global.id}`)).status, 403);
  assert.equal((await call(e, who, 'DELETE', `/questions/${made.body.id}`)).status, 200);
  assert.equal((await call(e, who, 'POST', '/questions/rules', { items: [{ id: global.id, rule: 5 }] })).status, 403);
  const own = await call(e, who, 'POST', '/questions', mine);
  assert.equal((await call(e, who, 'POST', '/questions/rules', { items: [{ id: own.body.id, rule: 5 }] })).status, 200);
});

test('a teacher’s class question reaches only that class', async () => {
  const { db, env: e, who, a, b } = await twoClasses();
  const made = await call(e, who, 'POST', '/questions', { mode: 1, data: { correct: '“Stop!” shouted Kai.' }, class_id: a });
  const ctx = (cid) => ({ id: 50 + cid, name: 'P', classId: cid, guest: false, className: 'X' });
  assert.ok((await list(e, ctx(a))).some((q) => q.id === made.body.id));
  assert.ok(!(await list(e, ctx(b))).some((q) => q.id === made.body.id));
  assert.ok(!(await list(e)).some((q) => q.id === made.body.id), 'and not guests');
  assert.ok(db);
});

test('analytics: a teacher sees their own classes, never another’s or the guests’', async () => {
  const { env: e, who, a, b } = await twoClasses();
  assert.equal((await call(e, who, 'GET', `/analytics?class=${a}`)).status, 200);
  assert.equal((await call(e, who, 'GET', `/analytics?class=${b}`)).status, 403);
  assert.equal((await call(e, who, 'GET', '/analytics?class=guests')).status, 403);
  assert.equal((await call(e, ADMIN, 'GET', '/analytics?class=guests')).status, 200);
  assert.equal((await call(e, ADMIN, 'GET', `/analytics?class=${b}`)).status, 200);
});

test('a teacher cannot manage guest players; the admin can', async () => {
  const { db, env: e, who } = await twoClasses();
  const gid = db.prepare("INSERT INTO pupils (class_id, name, username, is_guest, created_at) VALUES (NULL, 'Guest', 'guest', 1, 1) RETURNING id").get().id;
  assert.equal((await call(e, who, 'POST', `/pupils/${gid}/reset`)).status, 403);
  assert.equal((await call(e, ADMIN, 'POST', `/pupils/${gid}/reset`)).status, 200);
});

test('deleting a class removes its unlocks and teacher assignments; /me says who you are', async () => {
  const { db, env: e, who, a } = await twoClasses();
  await call(e, ADMIN, 'PUT', `/classes/${a}/unlocks`, { unlocked: [5] });
  assert.equal((await call(e, who, 'GET', '/me')).body.admin, false);
  assert.deepEqual((await call(e, who, 'GET', '/me')).body.classes, [a]);
  assert.equal((await call(e, ADMIN, 'GET', '/me')).body.admin, true);
  assert.equal((await call(e, ADMIN, 'DELETE', `/classes/${a}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class_settings').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_classes').get().n, 0);
});

test('before the 1.3 migration the app still works for pupils and the admin', async () => {
  const { db, env: e } = setup();
  db.exec('DROP TABLE class_settings; DROP TABLE teacher_classes; DROP TABLE teachers;');
  assert.equal((await me(e)).level.level, 1);
  assert.equal((await call(e, ADMIN, 'GET', '/classes')).status, 200);
  const login = await teacherLogin(new Request('http://x', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin-pass-123' }) }), e);
  assert.equal((await login.json()).admin, true);
  const bad = await teacherLogin(new Request('http://x', { method: 'POST', body: JSON.stringify({ username: 'tan', password: 'x' }) }), e).catch((x) => x);
  assert.ok(bad instanceof HttpError && bad.status === 401);
});

// ---------------------------------------------------------------- the admin's XP-per-level setting

test('the admin can change XP per level; every pupil’s level follows straight away', async () => {
  const { db, env: e } = setup();
  addXp(db, 450);
  assert.equal((await me(e)).level.level, 10);
  assert.deepEqual((await call(e, ADMIN, 'GET', '/settings')).body.tierXp, [{ level: 1, xp: 0 }, { level: 10, xp: 450 }, { level: 20, xp: 1200 }]);
  const put = await call(e, ADMIN, 'PUT', '/settings', { levelBands: [{ upTo: 10, xp: 100 }, { upTo: null, xp: 40 }] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.levelBands, [{ upTo: 10, xp: 100 }, { upTo: null, xp: 40 }]);
  assert.equal(put.body.levelBandsCustom, true);
  assert.deepEqual(put.body.tierXp, [{ level: 1, xp: 0 }, { level: 10, xp: 900 }, { level: 20, xp: 1300 }]);
  let m = await me(e);
  assert.equal(m.level.level, 5, '450 XP is now only level 5 (4 x 100 = 400, next is 100 more)');
  assert.equal(m.level.from, 400);
  assert.equal(m.level.next, 500);
  assert.equal(m.level.nextTier.xp, 900);
  assert.equal(m.districts[3].unlocked, false, 'districts that needed level 10 lock again');
  addXp(db, 450);
  m = await me(e);
  assert.equal(m.level.level, 10);
  assert.equal(m.districts[3].unlocked, true);
  // back to the standard amounts
  const reset = await call(e, ADMIN, 'PUT', '/settings', { levelBands: null });
  assert.equal(reset.body.levelBandsCustom, false);
  assert.deepEqual(reset.body.levelBands, DEFAULT_BANDS);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'level_bands'").get().n, 0);
  assert.equal((await me(e)).level.level, levelFor(900));
});

test('XP-per-level changes: bad input is refused and changes nothing', async () => {
  const { db, env: e } = setup();
  for (const bad of [[], [{ upTo: 10, xp: 50 }], [{ upTo: null, xp: 0 }], 'lots', [{ upTo: 10, xp: 5 }, { upTo: 5, xp: 5 }, { upTo: null, xp: 5 }]]) {
    assert.equal((await call(e, ADMIN, 'PUT', '/settings', { levelBands: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'level_bands'").get().n, 0);
  assert.deepEqual((await call(e, ADMIN, 'GET', '/settings')).body.levelBands, DEFAULT_BANDS);
});

test('only the admin can change XP per level; teachers can read it', async () => {
  const { env: e, who } = await twoClasses();
  assert.equal((await call(e, who, 'PUT', '/settings', { levelBands: [{ upTo: null, xp: 10 }] })).status, 403);
  assert.deepEqual((await call(e, who, 'GET', '/settings')).body.levelBands, DEFAULT_BANDS);
});

test('a damaged saved value falls back to the standard amounts instead of breaking levels', async () => {
  const { db, env: e } = setup();
  db.exec("INSERT INTO meta (k, v) VALUES ('level_bands', 'not json {')");
  assert.deepEqual((await call(e, ADMIN, 'GET', '/settings')).body.levelBands, DEFAULT_BANDS);
  assert.equal((await me(e)).level.level, 1);
  db.exec("UPDATE meta SET v = '[{\"upTo\":5,\"xp\":0},{\"upTo\":null,\"xp\":9}]' WHERE k = 'level_bands'");
  assert.equal((await call(e, ADMIN, 'GET', '/settings')).body.levelBandsCustom, false, 'an invalid saved value is ignored');
});

test('teachers see the XP at which each tier opens, using the current ranges', async () => {
  const { env: e, who, a } = await twoClasses();
  let u = (await call(e, who, 'GET', `/classes/${a}/unlocks`)).body;
  assert.deepEqual(u.tierXp, [{ level: 1, xp: 0 }, { level: 10, xp: 450 }, { level: 20, xp: 1200 }]);
  await call(e, ADMIN, 'PUT', '/settings', { levelBands: [{ upTo: null, xp: 100 }] });
  u = (await call(e, who, 'GET', `/classes/${a}/unlocks`)).body;
  assert.deepEqual(u.tierXp.map((t) => t.xp), [0, 900, 1900]);
});

test('a finished route reports the level under the current ranges', async () => {
  const { db, env: e } = setup();
  await call(e, ADMIN, 'PUT', '/settings', { levelBands: [{ upTo: null, xp: 10 }] });
  const stops = inDistrict(db, 1).slice(0, 5);
  for (const q of stops) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (1, NULL, ?, ?, 1, 0, 1, 10, 'x', '[]', ?)").run(q.id, q.mode, Date.now());
  const r = await pupil.route(new Request('http://x/api/route', { method: 'POST', body: JSON.stringify({ kind: 'route', district: 1, qids: stops.map((q) => q.id), startedAt: Date.now() - 1000, ms: 1000 }) }), e, pupilCtx);
  const body = await r.json();
  assert.equal(body.level, levelFor(body.xpTotal, [{ upTo: null, xp: 10 }]));
  assert.ok(body.level > 5);
});

// ---------------------------------------------------------------- teachers create and own classes

const asTeacher = async (e, username = 'tan', name = 'Ms Tan', classes = []) => {
  const made = await makeTeacher(e, { name, username, classes });
  return { who: await loadWho(e, { r: 't', tid: made.teacher.id, sv: 0 }), id: made.teacher.id };
};
const reload = (e, id) => loadWho(e, { r: 't', tid: id, sv: 0 }); // each request loads the account afresh

test('a teacher can create their own class and run it straight away', async () => {
  const { db, env: e } = setup();
  const t = await asTeacher(e);
  const made = await call(e, t.who, 'POST', '/classes', { name: '  4 Kindness ' });
  assert.equal(made.status, 200);
  assert.equal(made.body.class.name, '4 Kindness');
  assert.match(made.body.class.code, /^[A-Z0-9]{4,8}$/);
  const id = made.body.class.id;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_classes WHERE teacher_id = ? AND class_id = ?').get(t.id, id).n, 1, 'the creator is assigned');
  assert.equal(db.prepare('SELECT teacher_id FROM class_owners WHERE class_id = ?').get(id).teacher_id, t.id, 'and owns it');
  const who = await reload(e, t.id);
  const list = (await call(e, who, 'GET', '/classes')).body.classes;
  assert.deepEqual(list.map((c) => [c.id, c.owned]), [[id, true]]);
  assert.equal((await call(e, who, 'POST', `/classes/${id}/pupils`, { pupils: [{ name: 'Mei Lin', username: 'mei.lin' }, { name: 'Raj Kumar', username: 'raj.kumar' }] })).status, 200);
  assert.equal((await call(e, who, 'GET', `/classes/${id}/pupils`)).body.pupils.length, 2);
  assert.equal((await call(e, who, 'PUT', `/classes/${id}/unlocks`, { unlocked: [5] })).status, 200);
  assert.equal((await call(e, who, 'PATCH', `/classes/${id}`, { name: '4 Kindness B' })).status, 200);
  assert.equal((await call(e, who, 'POST', `/classes/${id}/regen`)).status, 200);
  assert.equal((await call(e, who, 'POST', '/questions', { mode: 1, data: { correct: '“Stop!” shouted Kai.' }, class_id: id })).status, 200, 'and write questions for it');
  assert.equal((await call(e, who, 'GET', `/analytics?class=${id}`)).status, 200);
});

test('a teacher’s classes are private to them; the super admin sees everything', async () => {
  const { env: e } = setup();
  const t1 = await asTeacher(e, 'tan', 'Ms Tan');
  const t2 = await asTeacher(e, 'lee', 'Mr Lee');
  const c1 = (await call(e, t1.who, 'POST', '/classes', { name: 'Tan class' })).body.class.id;
  const c2 = (await call(e, t2.who, 'POST', '/classes', { name: 'Lee class' })).body.class.id;
  const w1 = await reload(e, t1.id);
  const w2 = await reload(e, t2.id);
  assert.deepEqual((await call(e, w1, 'GET', '/classes')).body.classes.map((c) => c.id), [c1]);
  assert.deepEqual((await call(e, w2, 'GET', '/classes')).body.classes.map((c) => c.id), [c2]);
  assert.equal((await call(e, w1, 'GET', `/classes/${c2}/pupils`)).status, 403);
  assert.equal((await call(e, w1, 'PATCH', `/classes/${c2}`, { name: 'Mine' })).status, 403);
  assert.equal((await call(e, w1, 'DELETE', `/classes/${c2}`)).status, 403);
  assert.equal((await call(e, w1, 'POST', `/classes/${c2}/regen`)).status, 403);
  assert.equal((await call(e, ADMIN, 'GET', '/classes')).body.classes.length, 2);
  const admin = (await call(e, ADMIN, 'GET', '/classes')).body.classes;
  assert.ok(admin.every((c) => c.owned === true), 'the super admin owns everything');
});

test('a teacher can delete a class they created, with its pupils and settings; nobody else’s', async () => {
  const { db, env: e } = setup();
  const t = await asTeacher(e);
  const other = addClass(db, 'Other');
  const id = (await call(e, t.who, 'POST', '/classes', { name: 'Mine' })).body.class.id;
  let who = await reload(e, t.id);
  await call(e, who, 'POST', `/classes/${id}/pupils`, { pupils: [{ name: 'Mei Lin', username: 'mei.lin' }] });
  await call(e, who, 'PUT', `/classes/${id}/unlocks`, { unlocked: [4] });
  assert.equal((await call(e, who, 'DELETE', `/classes/${other}`)).status, 403);
  assert.equal((await call(e, who, 'DELETE', `/classes/${id}`)).status, 200);
  for (const [table, col] of [['classes', 'id'], ['pupils', 'class_id'], ['class_settings', 'class_id'], ['teacher_classes', 'class_id'], ['class_owners', 'class_id']]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(id).n, 0, table);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM classes WHERE id = ?').get(other).n, 1, 'the other class is untouched');
  who = await reload(e, t.id);
  assert.equal((await call(e, who, 'GET', '/classes')).body.classes.length, 0);
});

test('a class the super admin made, or assigned, can be run by a teacher but not deleted', async () => {
  const { db, env: e } = setup();
  const t = await asTeacher(e);
  const made = (await call(e, ADMIN, 'POST', '/classes', { name: 'Admin made' })).body.class.id;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class_owners').get().n, 0, 'the super admin’s classes have no owner');
  await call(e, ADMIN, 'PATCH', `/teachers/${t.id}`, { classes: [made] });
  const who = await reload(e, t.id);
  const row = (await call(e, who, 'GET', '/classes')).body.classes[0];
  assert.equal(row.owned, false);
  assert.equal((await call(e, who, 'PATCH', `/classes/${made}`, { name: 'Renamed' })).status, 200);
  assert.equal((await call(e, who, 'DELETE', `/classes/${made}`)).status, 403);
  assert.equal((await call(e, ADMIN, 'DELETE', `/classes/${made}`)).status, 200);
});

test('a second teacher given a class someone else created cannot delete it', async () => {
  const { env: e } = setup();
  const t1 = await asTeacher(e, 'tan', 'Ms Tan');
  const t2 = await asTeacher(e, 'lee', 'Mr Lee');
  const c = (await call(e, t1.who, 'POST', '/classes', { name: 'Shared' })).body.class.id;
  await call(e, ADMIN, 'PATCH', `/teachers/${t2.id}`, { classes: [c] });
  const w2 = await reload(e, t2.id);
  assert.equal((await call(e, w2, 'GET', `/classes/${c}/pupils`)).status, 200, 'co-teachers can run it');
  assert.equal((await call(e, w2, 'DELETE', `/classes/${c}`)).status, 403);
  assert.equal((await call(e, await reload(e, t1.id), 'DELETE', `/classes/${c}`)).status, 200, 'the creator can');
});

test('class names are required, and a teacher can create at most 30 classes', async () => {
  const { db, env: e } = setup();
  const t = await asTeacher(e);
  assert.equal((await call(e, t.who, 'POST', '/classes', { name: '   ' })).status, 400);
  for (let i = 0; i < 29; i++) db.prepare('INSERT INTO class_owners (class_id, teacher_id) VALUES (?, ?)').run(1000 + i, t.id);
  assert.equal((await call(e, t.who, 'POST', '/classes', { name: 'Number 30' })).status, 200);
  assert.equal((await call(e, t.who, 'POST', '/classes', { name: 'Number 31' })).status, 403);
  assert.equal((await call(e, ADMIN, 'POST', '/classes', { name: 'Admin has no limit' })).status, 200);
});

test('deleting a teacher account keeps their classes and pupils, but nobody owns them any more', async () => {
  const { db, env: e } = setup();
  const t = await asTeacher(e);
  const id = (await call(e, t.who, 'POST', '/classes', { name: 'Kept' })).body.class.id;
  await call(e, await reload(e, t.id), 'POST', `/classes/${id}/pupils`, { pupils: [{ name: 'Mei Lin', username: 'mei.lin' }] });
  await call(e, ADMIN, 'DELETE', `/teachers/${t.id}`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM classes WHERE id = ?').get(id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pupils WHERE class_id = ?').get(id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class_owners').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_classes').get().n, 0);
  // hand it to another teacher: they can run it, not delete it
  const t2 = await asTeacher(e, 'lee', 'Mr Lee', [id]);
  assert.equal((await call(e, await reload(e, t2.id), 'DELETE', `/classes/${id}`)).status, 403);
  assert.equal((await call(e, ADMIN, 'DELETE', `/classes/${id}`)).status, 200);
});

test('before the 1.4 migration a teacher can still create and run a class, only deleting it needs the super admin', async () => {
  const { db, env: e } = setup();
  db.exec('DROP TABLE class_owners');
  const t = await asTeacher(e);
  const made = await call(e, t.who, 'POST', '/classes', { name: 'Early' });
  assert.equal(made.status, 200);
  const who = await reload(e, t.id);
  assert.equal((await call(e, who, 'GET', '/classes')).body.classes[0].owned, false);
  assert.equal((await call(e, who, 'DELETE', `/classes/${made.body.class.id}`)).status, 403);
  assert.equal((await call(e, ADMIN, 'DELETE', `/classes/${made.body.class.id}`)).status, 200);
});
