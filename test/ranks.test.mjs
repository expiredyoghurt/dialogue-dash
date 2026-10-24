// Dash Express 1.5: the admin sets the XP for each rank and each delivery vehicle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, pupilCtx } from './helpers/d1.mjs';
import * as pupil from '../src/pupil.js';
import { HttpError } from '../src/util.js';
import { teacherRoute } from '../src/teacher.js';
import { ADMIN } from '../src/accounts.js';
import { rankFor, RANKS } from '../src/rules.js';
import { vehicleFor, validateThresholds, DEFAULT_RANK_XP, DEFAULT_VEHICLE_XP, VEHICLES, ruleOf, levelFor } from '../src/districts.js';

const SEEDS = ['questions-450.sql', 'seed-new-types.sql', 'seed-new-types-extra.sql'];
const setup = () => {
  const { db, d1 } = makeDb({ seeds: SEEDS });
  return { db, env: { DB: d1 } };
};
const teacher = { admin: false, id: 7, name: 'Ms Tan', classes: new Set() };
const call = async (e, who, method, path, body) => {
  try {
    const r = await teacherRoute(new Request('http://x/api/t' + path, { method, body: body ? JSON.stringify(body) : undefined }), e, new URL('http://x/api/t' + path), who);
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};
const me = async (e) => (await pupil.me(e, pupilCtx)).json();
const addXp = (db, xp) => {
  const q = db.prepare('SELECT id, mode FROM questions LIMIT 1').get();
  db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (1, NULL, ?, ?, 1, 0, 1, ?, 'x', '[]', ?)").run(q.id, q.mode, xp, Date.now() - 86_400_000);
};

test('the standard amounts: six ranks and six rides, and they start out together', () => {
  assert.deepEqual(DEFAULT_RANK_XP, [0, 60, 160, 320, 560, 900]);
  assert.deepEqual(DEFAULT_VEHICLE_XP, [0, 60, 160, 320, 560, 900]);
  assert.equal(RANKS.length, 6);
  assert.equal(VEHICLES.length, 6);
  for (const [xp, i] of [[0, 0], [59, 0], [60, 1], [159, 1], [160, 2], [320, 3], [560, 4], [899, 4], [900, 5], [99999, 5]]) {
    assert.equal(rankFor(xp).index, i, 'rank at ' + xp);
    assert.equal(vehicleFor(xp).index, i, 'ride at ' + xp);
  }
  assert.deepEqual(vehicleFor(60), { index: 1, id: 'bike', name: 'Delivery bike', from: 60, next: 160, nextName: 'Scooter' });
  assert.deepEqual(vehicleFor(900), { index: 5, id: 'rocket', name: 'Rocket', from: 900, next: null, nextName: null });
  assert.deepEqual(rankFor(0), { index: 0, name: 'Rookie Writer', from: 0, next: 60, nextName: 'Quote Keeper' });
});

test('rankFor and vehicleFor use whatever amounts they are given', () => {
  const xps = [0, 10, 20, 30, 40, 50];
  assert.equal(rankFor(35, xps).index, 3);
  assert.equal(rankFor(35, xps).next, 40);
  assert.equal(rankFor(35, xps).name, 'Tag Master', 'names never change');
  assert.equal(vehicleFor(35, xps).index, 3);
  assert.equal(vehicleFor(35, xps).id, 'van');
  assert.equal(vehicleFor(35, xps).next, 40);
  assert.equal(rankFor(35, [0, 100, 200, 300, 400, 500]).index, 0);
  assert.equal(rankFor(35, null).index, 0, 'no override means the standard amounts');
});

test('validateThresholds: one whole number per step, starting at 0 and rising', () => {
  assert.equal(validateThresholds([0, 1, 2, 3, 4, 5], 6).ok, true);
  assert.deepEqual(validateThresholds(['0', '10', '20', '30', '40', '50'], 6).xps, [0, 10, 20, 30, 40, 50]);
  for (const bad of [
    null, 'x', [], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5, 6],
    [1, 2, 3, 4, 5, 6],                   // must start at 0
    [0, 10, 10, 20, 30, 40],              // must rise
    [0, 10, 5, 20, 30, 40],
    [0, 1.5, 2, 3, 4, 5],
    [0, -1, 2, 3, 4, 5],
    [0, '', 2, 3, 4, 5],
    [0, 1, 2, 3, 4, 2_000_000],
    [0, 'lots', 2, 3, 4, 5],
  ]) assert.equal(validateThresholds(bad, 6).ok, false, JSON.stringify(bad));
});

test('the admin sets rank XP and ride XP separately, and pupils see it at once', async () => {
  const { db, env: e } = setup();
  addXp(db, 100);
  let m = await me(e);
  assert.equal(m.rank.name, 'Quote Keeper');
  assert.equal(m.vehicle.id, 'bike');
  // ranks arrive sooner, rides later
  const put = await call(e, ADMIN, 'PUT', '/settings', { rankXp: [0, 20, 40, 60, 80, 100], vehicleXp: [0, 150, 300, 450, 600, 750] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.rankXp, [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(put.body.vehicleXp, [0, 150, 300, 450, 600, 750]);
  assert.equal(put.body.rankXpCustom, true);
  assert.equal(put.body.vehicleXpCustom, true);
  assert.deepEqual(put.body.ranks[0], { name: 'Rookie Writer', xp: 0 });
  assert.deepEqual(put.body.vehicles[1], { id: 'bike', name: 'Delivery bike', xp: 150 });
  m = await me(e);
  assert.equal(m.rank.name, 'Master Storyteller', '100 XP is now the top rank');
  assert.equal(m.rank.next, null);
  assert.equal(m.vehicle.id, 'foot', 'but still on foot: the first upgrade is at 150 XP');
  assert.equal(m.vehicle.next, 150);
  assert.equal(m.vehicle.nextName, 'Delivery bike');
  assert.deepEqual(m.rides.map((r) => r.xp), [0, 150, 300, 450, 600, 750]);
  addXp(db, 60);
  m = await me(e);
  assert.equal(m.vehicle.id, 'bike');
  assert.equal(m.level.level, levelFor(160), 'levels are separate from ranks and rides');
});

test('changing only the rides leaves the ranks alone, and the other way round', async () => {
  const { db, env: e } = setup();
  addXp(db, 100);
  await call(e, ADMIN, 'PUT', '/settings', { vehicleXp: [0, 500, 600, 700, 800, 900] });
  let m = await me(e);
  assert.equal(m.rank.name, 'Quote Keeper');
  assert.equal(m.vehicle.id, 'foot');
  await call(e, ADMIN, 'PUT', '/settings', { rankXp: [0, 10, 20, 30, 40, 50] });
  m = await me(e);
  assert.equal(m.rank.name, 'Master Storyteller');
  assert.equal(m.vehicle.id, 'foot', 'the ride amounts set earlier still apply');
  const s = (await call(e, ADMIN, 'GET', '/settings')).body;
  assert.equal(s.rankXpCustom && s.vehicleXpCustom, true);
});

test('resetting puts the standard amounts back, and bad input changes nothing', async () => {
  const { db, env: e } = setup();
  await call(e, ADMIN, 'PUT', '/settings', { rankXp: [0, 5, 10, 15, 20, 25], vehicleXp: [0, 5, 10, 15, 20, 25] });
  const reset = await call(e, ADMIN, 'PUT', '/settings', { rankXp: null, vehicleXp: null });
  assert.deepEqual(reset.body.rankXp, DEFAULT_RANK_XP);
  assert.deepEqual(reset.body.vehicleXp, DEFAULT_VEHICLE_XP);
  assert.equal(reset.body.rankXpCustom, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k IN ('rank_xp', 'vehicle_xp')").get().n, 0);
  for (const bad of [[0, 5, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6], [0, 1, 2], 'lots']) {
    assert.equal((await call(e, ADMIN, 'PUT', '/settings', { rankXp: bad })).status, 400, JSON.stringify(bad));
    assert.equal((await call(e, ADMIN, 'PUT', '/settings', { vehicleXp: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k IN ('rank_xp', 'vehicle_xp')").get().n, 0, 'nothing was saved');
});

test('a bad rank change does not drag a good change in the same request along with it', async () => {
  const { db, env: e } = setup();
  const r = await call(e, ADMIN, 'PUT', '/settings', { clock: false, rankXp: [0, 5, 5, 6, 7, 8] });
  assert.equal(r.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'clock'").get().n, 0);
});

test('only the admin can change rank and vehicle XP; teachers can read it', async () => {
  const { env: e } = setup();
  assert.equal((await call(e, teacher, 'PUT', '/settings', { rankXp: [0, 1, 2, 3, 4, 5] })).status, 403);
  assert.equal((await call(e, teacher, 'PUT', '/settings', { vehicleXp: null })).status, 403);
  const s = (await call(e, teacher, 'GET', '/settings')).body;
  assert.deepEqual(s.rankXp, DEFAULT_RANK_XP);
  assert.equal(s.vehicles.length, 6);
});

test('a damaged saved value falls back to the standard amounts', async () => {
  const { db, env: e } = setup();
  db.exec("INSERT INTO meta (k, v) VALUES ('rank_xp', 'not json'), ('vehicle_xp', '[0,5,5,9,9,9]')");
  const s = (await call(e, ADMIN, 'GET', '/settings')).body;
  assert.deepEqual(s.rankXp, DEFAULT_RANK_XP);
  assert.deepEqual(s.vehicleXp, DEFAULT_VEHICLE_XP);
  assert.equal(s.rankXpCustom, false);
  assert.equal(s.vehicleXpCustom, false);
  assert.equal((await me(e)).rank.name, 'Rookie Writer');
});

test('/api/meta describes the current amounts, and the standard ones without a database', async () => {
  const { env: e } = setup();
  const std = await (await pupil.meta()).json();
  assert.deepEqual(std.vehicles.map((v) => v.xp), DEFAULT_VEHICLE_XP);
  assert.equal(std.ranks.length, 6);
  await call(e, ADMIN, 'PUT', '/settings', { vehicleXp: [0, 11, 22, 33, 44, 55], rankXp: [0, 1, 2, 3, 4, 5] });
  const cur = await (await pupil.meta(e)).json();
  assert.deepEqual(cur.vehicles.map((v) => v.xp), [0, 11, 22, 33, 44, 55]);
  assert.deepEqual(cur.ranks.map((r) => r.xp), [0, 1, 2, 3, 4, 5]);
  assert.equal(cur.vehicles[0].id, 'foot');
});

test('a finished route reports the rank and ride under the current amounts', async () => {
  const { db, env: e } = setup();
  await call(e, ADMIN, 'PUT', '/settings', { rankXp: [0, 1, 2, 3, 4, 5], vehicleXp: [0, 2, 4, 6, 8, 99999] });
  const stops = db.prepare('SELECT id, mode, data FROM questions WHERE active = 1').all().filter((q) => ruleOf(q.mode, JSON.parse(q.data)) === 1).slice(0, 5);
  for (const q of stops) db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (1, NULL, ?, ?, 1, 0, 1, 10, 'x', '[]', ?)").run(q.id, q.mode, Date.now());
  const r = await pupil.route(new Request('http://x/api/route', { method: 'POST', body: JSON.stringify({ kind: 'route', district: 1, qids: stops.map((q) => q.id), startedAt: Date.now() - 1000, ms: 1000 }) }), e, pupilCtx);
  const body = await r.json();
  assert.equal(body.rank.index, 5);
  assert.equal(body.vehicle.index, 4);
  assert.equal(body.vehicle.next, 99999);
});
