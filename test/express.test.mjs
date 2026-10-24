// Dash Express (v1.2): districts, routes, tips, Big Delivery, and the teacher switches.
// Runs the real Worker code (pupil.js, express.js, teacher.js) against an in-memory SQLite database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, pupilCtx } from './helpers/d1.mjs';
import * as pupil from '../src/pupil.js';
import { HttpError } from '../src/util.js';
import { teacherRoute } from '../src/teacher.js';
import { cleanRule } from '../src/modes.js';
import {
  DISTRICTS,
  DISTRICT_NUMS,
  BIG_AT,
  BIG_LEN,
  RUSH_AT,
  autoRule,
  ruleOf,
  districtProgress,
  scoreRoute,
} from '../src/districts.js';

const SEEDS = ['questions-450.sql', 'seed-new-types.sql', 'seed-new-types-extra.sql'];
const env = () => {
  const { db, d1 } = makeDb({ seeds: SEEDS });
  return { db, env: { DB: d1 } };
};
// A town with every district open, for tests about content rather than levels.
const openEnv = () => {
  const r = env();
  r.db.exec("INSERT INTO meta (k, v) VALUES ('open_districts', 1)");
  return r;
};
const rows = (db) => db.prepare('SELECT id, mode, data FROM questions').all().map((r) => ({ ...r, data: JSON.parse(r.data) }));
const byDistrict = (db) => {
  const m = Object.fromEntries(DISTRICT_NUMS.map((n) => [n, []]));
  for (const r of rows(db)) m[ruleOf(r.mode, r.data)].push(r);
  return m;
};
const me = async (e) => (await pupil.me(e, pupilCtx)).json();
const post = (path, body) => new Request('http://x/api' + path, { method: 'POST', body: JSON.stringify(body) });
const route = async (e, body) => {
  try {
    const r = await pupil.route(post('/route', body), e, pupilCtx);
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};
// A correct (or wrong) first try, written straight into attempts as the answer endpoint would.
const attempt = (db, qid, mode, { correct = true, tryNo = 1, xp = 10, codes = [], ts = Date.now() } = {}) =>
  db.prepare('INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (?,?,?,?,?,0,?,?,?,?,?)').run(pupilCtx.id, null, qid, mode, tryNo, correct ? 1 : 0, xp, 'x', JSON.stringify(codes), ts);
const tcall = async (e, method, path, body) => {
  try {
    const r = await teacherRoute(new Request('http://x/api/t' + path, { method, body: body ? JSON.stringify(body) : undefined }), e, new URL('http://x/api/t' + path));
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};

test('twelve districts, one per rule, in order', () => {
  assert.equal(DISTRICTS.length, 12);
  assert.deepEqual(DISTRICT_NUMS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const d of DISTRICTS) {
    assert.equal(d.rule, d.n);
    assert.ok(d.name && d.blurb);
  }
  assert.deepEqual(DISTRICTS.slice(0, 3).map((d) => d.name), ['Speech Mark Street', 'Capital Corner', 'Full Stop Market']);
});

test('the shipped question bank fills every district', () => {
  const { db } = env();
  const m = byDistrict(db);
  for (const n of DISTRICT_NUMS) assert.ok(m[n].length >= 1, `district ${n} has no questions`);
  for (const n of [1, 2, 3, 4, 5, 6, 7]) assert.ok(m[n].length >= 15, `district ${n} has only ${m[n].length}`);
  assert.equal(rows(db).length, Object.values(m).reduce((a, l) => a + l.length, 0));
});

test('autoRule: structure decides the suggestion, and a teacher choice always wins', () => {
  assert.equal(autoRule(3, {}), 7);
  assert.equal(autoRule(5, {}), 10);
  assert.equal(autoRule(6, {}), 11);
  assert.equal(autoRule(4, { code: 'MC_INFER' }), 12);
  assert.equal(autoRule(4, { code: 'MC_VERB' }), 7);
  assert.equal(autoRule(1, { lines: true, correct: 'x' }), 8);
  assert.equal(autoRule(1, { beat: true, correct: 'x' }), 9);
  assert.equal(autoRule(1, { correct: '“I’m tired,” said Raj. “Let’s go home.”' }), 6);
  assert.equal(autoRule(1, { correct: 'Mr Tan said, “Hand in your books before recess.”' }), 4);
  assert.equal(autoRule(1, { correct: '“Where did you put my bag?” asked Hana.' }), 3);
  assert.equal(autoRule(1, { correct: '“Stop!” shouted Kai.' }), 1);
  assert.equal(ruleOf(1, { correct: '“Stop!” shouted Kai.', rule: 9 }), 9);
  assert.equal(ruleOf(1, { correct: '“Stop!” shouted Kai.', rule: 99 }), 1, 'an invalid stored rule is ignored');
});

test('cleanRule accepts 1-12 or nothing', () => {
  assert.deepEqual(cleanRule({}), {});
  assert.deepEqual(cleanRule({ rule: '' }), {});
  assert.deepEqual(cleanRule({ rule: '7' }), { rule: 7 });
  assert.throws(() => cleanRule({ rule: 13 }), HttpError);
  assert.throws(() => cleanRule({ rule: 0 }), HttpError);
});

test('the question list tags each question with its district and can filter by one', async () => {
  const { db, env: e } = openEnv();
  const all = (await (await pupil.listQuestions(e, pupilCtx, new URL('http://x/api/questions'))).json()).questions;
  assert.ok(all.every((q) => q.rule >= 1 && q.rule <= 12));
  const d6 = (await (await pupil.listQuestions(e, pupilCtx, new URL('http://x/api/questions?district=6'))).json()).questions;
  assert.ok(d6.length > 10 && d6.every((q) => q.rule === 6));
  assert.equal(d6.length, all.filter((q) => q.rule === 6).length);
  const one = rows(db).find((r) => r.mode === 1 && autoRule(1, r.data) !== 12);
  db.prepare('UPDATE questions SET data = ? WHERE id = ?').run(JSON.stringify({ ...one.data, rule: 12 }), one.id);
  const d12 = (await (await pupil.listQuestions(e, pupilCtx, new URL('http://x/api/questions?district=12'))).json()).questions;
  assert.ok(d12.some((q) => q.id === one.id));
});

test('a new pupil is level 1 with districts 1-3 open; the rest are locked and Rush Hour is shut', async () => {
  const { env: e } = env();
  const m = await me(e);
  assert.equal(m.districts.length, 12);
  assert.deepEqual(m.districts.map((d) => d.unlocked), [true, true, true, false, false, false, false, false, false, false, false, false]);
  assert.equal(m.level.level, 1);
  assert.equal(m.cleared, 0);
  assert.equal(m.rush.open, false);
  assert.equal(m.settings.clock, true);
  assert.equal(m.settings.openDistricts, false);
  assert.equal(m.tips, 0);
  assert.equal(m.tip, null);
  assert.equal(m.xp, 0);
});

test('districtProgress: Big Delivery opens at the threshold and clearing needs it', () => {
  const qs = (n, mode = 1) => Array.from({ length: n }, (_, i) => ({ id: i + 1, mode, data: { rule: 1 } }));
  const list = [...qs(12), { id: 100, mode: 1, data: { rule: 2 } }];
  const done = (ids) => new Map(ids.map((id) => [id, { correct: 1 }]));
  const allowed = new Set([1, 2, 3]);
  let p = districtProgress(list, done([1, 2, 3]), [], { allowed });
  assert.equal(p[0].bigReady, false);
  p = districtProgress(list, done([1, 2, 3, 4, 5, 6, 7, 8]), [], { allowed });
  assert.equal(p[0].bigReady, true);
  assert.equal(p[0].cleared, false);
  p = districtProgress(list, done([1, 2, 3, 4, 5, 6, 7, 8]), [{ kind: 'big', district: 1, passed: 1 }], { allowed });
  assert.equal(p[0].cleared, true);
  // a failed Big Delivery does not clear it
  p = districtProgress(list, done([1, 2, 3, 4, 5, 6, 7, 8]), [{ kind: 'big', district: 1, passed: 0 }], { allowed });
  assert.equal(p[0].cleared, false);
  // tiny district (under 4 questions): just finish them all, no Big Delivery
  const tiny = [{ id: 1, mode: 1, data: { rule: 3 } }, { id: 2, mode: 1, data: { rule: 3 } }];
  p = districtProgress(tiny, done([1]), [], { allowed });
  assert.equal(p[2].bigReady, false);
  assert.equal(p[2].cleared, false);
  p = districtProgress(tiny, done([1, 2]), [], { allowed });
  assert.equal(p[2].cleared, true);
  // an empty district counts as cleared and never blocks Rush Hour arithmetic
  p = districtProgress([], new Map(), [], { allowed });
  assert.ok(p.every((d) => d.empty && d.cleared));
  // unlocked comes only from the allowed set, and each district knows the level that opens it
  assert.deepEqual(p.map((d) => d.unlocked), [true, true, true, false, false, false, false, false, false, false, false, false]);
  assert.deepEqual(p.map((d) => d.needLevel), [1, 1, 1, 10, 10, 10, 20, 20, 20, 20, 20, 20]);
  // stars come from the best ordinary route
  p = districtProgress(list, new Map(), [{ kind: 'route', district: 1, stars: 2 }, { kind: 'route', district: 1, stars: 1 }, { kind: 'big', district: 1, stars: 3, passed: 0 }], { allowed });
  assert.equal(p[0].stars, 2);
});

test('scoreRoute: stars, first-try combo and bonuses are worked out from attempts alone', () => {
  const qids = [1, 2, 3, 4, 5];
  const first = (id) => ({ question_id: id, try_no: 1, correct: 1, codes: [] });
  const all = scoreRoute({ kind: 'route', qids, attempts: qids.map(first), ms: 60_000, clock: true });
  assert.equal(all.right, 5);
  assert.equal(all.first, 5);
  assert.equal(all.bestCombo, 5);
  assert.equal(all.stars, 3);
  assert.equal(all.fast, true);
  // right (5) + combo (0+1+2+3+3 = 9) + speed (3) + three stars (5)
  assert.equal(all.bonus, 5 + 9 + 3 + 5);
  const slow = scoreRoute({ kind: 'route', qids, attempts: qids.map(first), ms: 60_000, clock: false });
  assert.equal(slow.fast, false);
  assert.equal(slow.bonus, 5 + 9 + 5);
  // one slip: the combo restarts
  const slip = [first(1), first(2), { question_id: 3, try_no: 1, correct: 0, codes: ['NO_QUOTES'] }, { question_id: 3, try_no: 2, correct: 1, codes: [] }, first(4), first(5)];
  const s = scoreRoute({ kind: 'route', qids, attempts: slip, ms: 0, clock: true });
  assert.equal(s.right, 5);
  assert.equal(s.first, 4);
  assert.equal(s.bestCombo, 2);
  assert.equal(s.costlyRule, 1);
  assert.equal(s.stars, 3);
  assert.equal(s.fast, false, 'no time recorded, no speed bonus');
  // nothing answered earns nothing
  const none = scoreRoute({ kind: 'route', qids, attempts: [], ms: 1000, clock: true });
  assert.equal(none.right, 0);
  assert.equal(none.stars, 0);
  assert.equal(none.bonus, 0);
  assert.equal(none.passed, false);
});

test('scoreRoute: a Big Delivery is passed with fewer than 3 slips and everything delivered', () => {
  const qids = [1, 2, 3, 4, 5, 6];
  const ok = (id, t = 1) => ({ question_id: id, try_no: t, correct: 1, codes: [] });
  const bad = (id) => ({ question_id: id, try_no: 1, correct: 0, codes: ['NO_COMMA_BEFORE'] });
  const two = scoreRoute({ kind: 'big', qids, attempts: [bad(1), ok(1, 2), bad(2), ok(2, 2), ok(3), ok(4), ok(5), ok(6)], ms: 0, clock: true });
  assert.equal(two.slips, 2);
  assert.equal(two.passed, true);
  assert.ok(two.bonus >= 10);
  const three = scoreRoute({ kind: 'big', qids, attempts: [bad(1), ok(1, 2), bad(2), ok(2, 2), bad(3), ok(3, 2), ok(4), ok(5), ok(6)], ms: 0, clock: true });
  assert.equal(three.slips, 3);
  assert.equal(three.passed, false);
  const gaveUp = scoreRoute({ kind: 'big', qids, attempts: [ok(1), ok(2), ok(3)], ms: 0, clock: true });
  assert.equal(gaveUp.passed, false);
  assert.ok(gaveUp.bonus <= gaveUp.right);
});

test('finishing a route pays tips from real attempts, counts toward XP and rank, and is idempotent', async () => {
  const { db, env: e } = env();
  const d1 = byDistrict(db)[1].slice(0, 5);
  for (const q of d1) attempt(db, q.id, q.mode);
  const startedAt = Date.now() - 50_000;
  const body = { kind: 'route', district: 1, qids: d1.map((q) => q.id), startedAt, ms: 50_000 };
  const r = await route(e, body);
  assert.equal(r.status, 200);
  assert.equal(r.body.run.right, 5);
  assert.equal(r.body.run.stars, 3);
  assert.equal(r.body.run.bestCombo, 5);
  assert.equal(r.body.run.bonus, 5 + 9 + 3 + 5);
  assert.equal(r.body.xpTotal, 50 + 22);
  assert.equal(r.body.repeat, false);
  const again = await route(e, body);
  assert.equal(again.body.repeat, true);
  assert.equal(again.body.xpTotal, 72, 'a double submit pays once');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM route_runs').get().n, 1);
  const m = await me(e);
  assert.equal(m.xp, 72);
  assert.equal(m.answerXp, 50);
  assert.equal(m.tips, 22);
  assert.equal(m.districts[0].stars, 3);
  assert.equal(m.routes, 1);
});

test('the soft clock is a teacher switch: off means no speed bonus', async () => {
  const { db, env: e } = env();
  assert.equal((await tcall(e, 'PUT', '/settings', { clock: false })).body.clock, false);
  const d1 = byDistrict(db)[1].slice(0, 5);
  for (const q of d1) attempt(db, q.id, q.mode);
  const r = await route(e, { kind: 'route', district: 1, qids: d1.map((q) => q.id), startedAt: Date.now() - 1000, ms: 1000 });
  assert.equal(r.body.run.bonus, 5 + 9 + 5);
  assert.equal((await me(e)).settings.clock, false);
});

test('a route cannot claim stops from another district, stale starts, or nothing at all', async () => {
  const { db, env: e } = env();
  const m = byDistrict(db);
  const wrong = m[2].slice(0, 5);
  for (const q of wrong) attempt(db, q.id, q.mode);
  const ids = wrong.map((q) => q.id);
  assert.equal((await route(e, { kind: 'route', district: 1, qids: ids, startedAt: Date.now() - 1000, ms: 1000 })).status, 400);
  assert.equal((await route(e, { kind: 'route', district: 2, qids: ids, startedAt: Date.now() - 9 * 3_600_000, ms: 1000 })).status, 400);
  assert.equal((await route(e, { kind: 'route', district: 2, qids: [], startedAt: Date.now() - 1000 })).status, 400);
  assert.equal((await route(e, { kind: 'nope', district: 2, qids: ids, startedAt: Date.now() - 1000 })).status, 400);
  assert.equal((await route(e, { kind: 'route', district: 2, qids: [999999], startedAt: Date.now() - 1000 })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM route_runs').get().n, 0);
  // a route with no attempts behind it pays nothing
  const idle = byDistrict(db)[3].slice(0, 5).map((q) => q.id);
  const r = await route(e, { kind: 'route', district: 3, qids: idle, startedAt: Date.now() - 1000, ms: 1000 });
  assert.equal(r.body.run.right, 0);
  assert.equal(r.body.run.bonus, 0);
});

test('Big Delivery: closed until the district is learned, then passing it clears the district', async () => {
  const { db, env: e } = env();
  const pool = byDistrict(db)[1];
  const stops = pool.slice(0, BIG_LEN);
  for (const q of stops) attempt(db, q.id, q.mode);
  const body = { kind: 'big', district: 1, qids: stops.map((q) => q.id), startedAt: Date.now() - 20_000, ms: 20_000 };
  assert.equal((await route(e, body)).status, 400, 'not open: fewer than the threshold answered');
  for (const q of pool.slice(BIG_LEN, BIG_AT + 1)) attempt(db, q.id, q.mode);
  let m = await me(e);
  assert.equal(m.districts[0].bigReady, true);
  assert.equal(m.districts[0].cleared, false);
  const r = await route(e, { ...body, startedAt: Date.now() - 19_000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.run.passed, true);
  m = await me(e);
  assert.equal(m.districts[0].cleared, true);
  assert.equal(m.cleared, 1);
});

test('failing a Big Delivery still stamps a receipt, and the Big Delivery stays open for another go', async () => {
  const { db, env: e } = env();
  const pool = byDistrict(db)[1];
  for (const q of pool.slice(0, BIG_AT)) attempt(db, q.id, q.mode, { ts: Date.now() - 3_600_000 });
  const stops = pool.slice(0, BIG_LEN);
  // three stops go wrong on their first try, and are never put right
  for (const q of stops.slice(0, 3)) attempt(db, q.id, q.mode, { correct: false, xp: 0, codes: ['NO_QUOTES'] });
  for (const q of stops.slice(3)) attempt(db, q.id, q.mode);
  const r = await route(e, { kind: 'big', district: 1, qids: stops.map((q) => q.id), startedAt: Date.now() - 20_000, ms: 20_000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.run.passed, false);
  const m = await me(e);
  assert.equal(m.districts[0].done, BIG_AT, 'delivered parcels stay delivered');
  assert.equal(m.districts[0].bigReady, true);
  assert.equal(m.districts[0].cleared, false);
});

test('Rush Hour opens after three districts are cleared, or when the teacher opens the town', async () => {
  const { db, env: e } = env();
  assert.equal((await me(e)).rush.open, false);
  const ids = byDistrict(db)[1].slice(0, 5).map((q) => q.id);
  for (const q of byDistrict(db)[1].slice(0, 5)) attempt(db, q.id, q.mode);
  assert.equal((await route(e, { kind: 'rush', qids: ids, startedAt: Date.now() - 1000, ms: 1000 })).status, 400);
  const open = await tcall(e, 'PUT', '/settings', { openDistricts: true });
  assert.equal(open.body.openDistricts, true);
  const m = await me(e);
  assert.equal(m.rush.open, true);
  assert.ok(m.districts.every((d) => d.unlocked));
  assert.equal(RUSH_AT, 3);
  const r = await route(e, { kind: 'rush', qids: ids, startedAt: Date.now() - 1000, ms: 1000 });
  assert.equal(r.body.run.kind, 'rush');
  assert.ok(r.body.run.bonus > 0);
});

test('Dot suggests the open district where the pupil slips most on first tries', async () => {
  const { db, env: e } = env();
  const q1 = byDistrict(db)[1][0];
  attempt(db, q1.id, q1.mode, { correct: false, xp: 0, codes: ['NO_QUOTES', 'EXTRA_QUOTES'] });
  const m = await me(e);
  assert.deepEqual(m.tip, { district: 1, rule: 1, n: 2 });
  // slips in a locked district (7 needs level 20) are not suggested
  const q7 = byDistrict(db)[7][0];
  attempt(db, q7.id, q7.mode, { correct: false, xp: 0, codes: ['WEAK_VERB', 'WEAK_VERB', 'WEAK_VERB'] });
  assert.equal((await me(e)).tip.district, 1);
});

test('teacher: bulk-tag districts, clear a tag, and reject nonsense', async () => {
  const { db, env: e } = env();
  const qs = rows(db).filter((r) => r.mode === 1).slice(0, 3);
  const set = await tcall(e, 'POST', '/questions/rules', { items: qs.map((q) => ({ id: q.id, rule: 12 })) });
  assert.equal(set.body.changed, 3);
  const list = (await tcall(e, 'GET', '/questions?mode=1')).body.questions;
  for (const q of qs) {
    const row = list.find((x) => x.id === q.id);
    assert.equal(row.rule, 12);
    assert.equal(row.ruleSet, true);
    assert.equal(row.auto, autoRule(1, q.data));
    assert.equal(row.data.correct, q.data.correct, 'nothing else about the question changed');
  }
  await tcall(e, 'POST', '/questions/rules', { items: [{ id: qs[0].id, rule: null }] });
  const row = (await tcall(e, 'GET', '/questions?mode=1')).body.questions.find((x) => x.id === qs[0].id);
  assert.equal(row.ruleSet, false);
  assert.equal(row.rule, row.auto);
  assert.equal((await tcall(e, 'POST', '/questions/rules', { items: [{ id: qs[0].id, rule: 13 }] })).status, 400);
});

test('teacher: authoring keeps a chosen district for every mode', async () => {
  const { env: e } = env();
  const m1 = await tcall(e, 'POST', '/questions', { mode: 1, data: { correct: '“Stop!” shouted Kai.', rule: 3 } });
  assert.equal(m1.status, 200);
  const m3 = await tcall(e, 'POST', '/questions', { mode: 3, data: { speaker: 'Kai', line: 'Stop right there!', target: ['loud'], rule: 7 } });
  assert.equal(m3.status, 200);
  const m2 = await tcall(e, 'POST', '/questions', { mode: 2, data: { correct: '“Stop!” shouted Kai.', faulty: 'stop shouted Kai', rule: 3 } });
  assert.equal(m2.status, 200);
  const list = (await tcall(e, 'GET', '/questions')).body.questions;
  for (const r of [m1, m2, m3]) assert.equal(list.find((q) => q.id === r.body.id).data.rule, r.body.id === m3.body.id ? 7 : 3);
  assert.equal((await tcall(e, 'POST', '/questions', { mode: 1, data: { correct: '“Stop!” shouted Kai.', rule: 20 } })).status, 400);
});

test('deleting or resetting a pupil removes their routes too', async () => {
  const { db, env: e } = env();
  db.prepare("INSERT INTO pupils (id, class_id, name, username, is_guest, created_at, last_seen) VALUES (1, NULL, 'T', 't', 1, 1, 1)").run();
  const d1 = byDistrict(db)[1].slice(0, 5);
  for (const q of d1) attempt(db, q.id, q.mode);
  await route(e, { kind: 'route', district: 1, qids: d1.map((q) => q.id), startedAt: Date.now() - 1000, ms: 1000 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM route_runs').get().n, 1);
  await tcall(e, 'POST', '/pupils/1/reset');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM route_runs').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n, 0);
});

test('/api/meta describes the town for the browser', async () => {
  const body = await (await pupil.meta()).json();
  assert.equal(body.version, '1.7.0');
  assert.equal(body.districts.length, 12);
  assert.equal(body.vehicles.length, body.ranks.length, 'one vehicle per rank');
  assert.ok(body.cosmetics.paints.length >= 6);
  assert.equal(body.route.len, 5);
  assert.equal(body.route.patience, 3);
});

test('before the 1.2 migration the app still works (no route_runs table)', async () => {
  const { db, env: e } = env();
  db.exec('DROP TABLE route_runs');
  const m = await me(e);
  assert.equal(m.tips, 0);
  assert.equal(m.districts.length, 12);
  const q = rows(db)[0];
  attempt(db, q.id, q.mode);
  assert.equal((await me(e)).xp, 10);
});
