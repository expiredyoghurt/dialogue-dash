// Dash Express 1.7: class dashboard, unlock grid, settings impact preview, account-saved preferences, install files.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { makeDb, pupilCtx } from './helpers/d1.mjs';
import * as pupil from '../src/pupil.js';
import { HttpError } from '../src/util.js';
import { teacherRoute } from '../src/teacher.js';
import { ADMIN, loadWho, hashPassword } from '../src/accounts.js';
import { levelFor, COSMETICS, DEFAULT_BANDS } from '../src/districts.js';
import { readablePrefs, cleanPrefsUpdate } from '../src/prefs.js';
import { VERSION } from '../src/version.js';

const SEEDS = ['questions-450.sql', 'seed-new-types.sql', 'seed-new-types-extra.sql'];
const setup = () => {
  const { db, d1 } = makeDb({ seeds: SEEDS });
  return { db, env: { DB: d1, teacher_user: 'admin', teacher_password: 'adminpw-123' } };
};
const call = async (e, who, method, path, body) => {
  try {
    const r = await teacherRoute(new Request('http://x/api/t' + path, { method, body: body ? JSON.stringify(body) : undefined }), e, new URL('http://x/api/t' + path), who);
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};
const DAY = 86_400_000;
const addClass = (db, name) => db.prepare('INSERT INTO classes (name, code, created_at) VALUES (?, ?, 1) RETURNING id').get(name, 'C' + name).id;
const addPupil = (db, classId, name) => db.prepare("INSERT INTO pupils (class_id, name, username, is_guest, created_at) VALUES (?, ?, ?, 0, 1) RETURNING id").get(classId, name, name.toLowerCase()).id;
const firstQ = (db) => db.prepare('SELECT id, mode FROM questions WHERE active = 1 LIMIT 1').get();
const attempt = (db, pid, cid, { xp = 10, correct = 1, tryNo = 1, codes = [], ts = Date.now() } = {}) => {
  const q = firstQ(db);
  db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'x', ?, ?)").run(pid, cid, q.id, q.mode, tryNo, correct, xp, JSON.stringify(codes), ts);
};
const teacherWho = async (e, db, classIds, username = 'tan') => {
  const { salt, hash } = await hashPassword('pw-pw-pw-1');
  const id = db.prepare('INSERT INTO teachers (username, name, pass_salt, pass_hash, created_at) VALUES (?, ?, ?, ?, 1) RETURNING id').get(username, 'Ms Tan', salt, hash).id;
  for (const c of classIds) db.prepare('INSERT INTO teacher_classes (teacher_id, class_id) VALUES (?, ?)').run(id, c);
  return loadWho(e, { r: 't', tid: id, sv: 0 });
};

// ---------------------------------------------------------------- class dashboard

test('dashboard: totals, who has been quiet, level spread and the most-missed rules', async () => {
  const { db, env: e } = setup();
  const c = addClass(db, 'A');
  const [amy, ben, cal, dee] = ['Amy', 'Ben', 'Cal', 'Dee'].map((n) => addPupil(db, c, n));
  attempt(db, amy, c, { xp: 500 }); // level 10
  attempt(db, amy, c, { xp: 10, correct: 0, tryNo: 1, codes: ['NO_QUOTES'] });
  attempt(db, ben, c, { xp: 60, ts: Date.now() - 2 * DAY });
  attempt(db, cal, c, { xp: 30, ts: Date.now() - 20 * DAY }); // played, but not this week
  // Dee never played
  const r = await call(e, ADMIN, 'GET', `/dashboard?class=${c}`);
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.class.name, 'A');
  assert.equal(d.totals.pupils, 4);
  assert.equal(d.totals.active7, 2);
  assert.equal(d.totals.quiet7, 2);
  assert.equal(d.totals.xp7, 570);
  assert.deepEqual(d.quiet.map((q) => q.name).sort(), ['Cal', 'Dee']);
  assert.equal(d.quiet.find((q) => q.name === 'Dee').lastActive, null);
  const byName = Object.fromEntries(d.pupils.map((p) => [p.name, p]));
  assert.equal(byName.Amy.level, levelFor(510));
  assert.equal(byName.Amy.xp, 510);
  assert.equal(byName.Dee.level, 1);
  assert.equal(d.reach[10], 1);
  assert.equal(d.reach[20], 0);
  assert.equal(d.levelCounts[levelFor(510)], 1);
  assert.deepEqual(d.rules, [{ rule: 1, misses: 1, pupils: 1 }]);
  assert.deepEqual(d.tierXp, [{ level: 1, xp: 0 }, { level: 10, xp: 450 }, { level: 20, xp: 1200 }]);
});

test('dashboard: a pupil who keeps slipping on one rule is flagged as stuck', async () => {
  const { db, env: e } = setup();
  const c = addClass(db, 'A');
  const amy = addPupil(db, c, 'Amy');
  const ben = addPupil(db, c, 'Ben');
  for (let i = 0; i < 5; i++) attempt(db, amy, c, { xp: 0, correct: 0, codes: ['NO_QUOTES', 'EXTRA_QUOTES'] });
  for (let i = 0; i < 3; i++) attempt(db, ben, c, { xp: 0, correct: 0, codes: ['NO_QUOTES'] });
  attempt(db, amy, c, { xp: 0, correct: 0, tryNo: 2, codes: ['NO_QUOTES'] }); // second tries are not counted
  attempt(db, amy, c, { xp: 0, correct: 0, codes: ['NO_QUOTES'], ts: Date.now() - 40 * DAY }); // too old
  const d = (await call(e, ADMIN, 'GET', `/dashboard?class=${c}`)).body;
  assert.deepEqual(d.stuck, [{ pupilId: amy, name: 'Amy', rule: 1, n: 5 }], 'five slips on rule 1; three is not enough');
  assert.deepEqual(d.rules[0], { rule: 1, misses: 8, pupils: 2 }, 'two codes on one attempt count once');
  assert.deepEqual(d.pupils.find((p) => p.name === 'Ben').topSlip, { rule: 1, n: 3 });
});

test('dashboard: routes and tips count, and a teacher only sees their own classes', async () => {
  const { db, env: e } = setup();
  const a = addClass(db, 'A');
  const b = addClass(db, 'B');
  const amy = addPupil(db, a, 'Amy');
  db.prepare("INSERT INTO route_runs (pupil_id, class_id, kind, district, mode, started_at, ms, n_total, n_right, n_first, best_combo, stars, passed, bonus, ts) VALUES (?, ?, 'route', 1, 0, 1, 1, 5, 5, 5, 5, 3, 1, 22, ?)").run(amy, a, Date.now());
  const d = (await call(e, ADMIN, 'GET', `/dashboard?class=${a}`)).body;
  assert.equal(d.totals.routes7, 1);
  assert.equal(d.pupils[0].xp, 22);
  assert.equal(d.pupils[0].xp7, 22);
  const who = await teacherWho(e, db, [a]);
  assert.equal((await call(e, who, 'GET', `/dashboard?class=${a}`)).status, 200);
  assert.equal((await call(e, who, 'GET', `/dashboard?class=${b}`)).status, 403);
  assert.equal((await call(e, who, 'GET', '/dashboard')).status, 400);
  assert.equal((await call(e, ADMIN, 'GET', '/dashboard?class=999')).status, 404);
});

// ---------------------------------------------------------------- unlock grid

test('unlock grid: one row per class, with who has reached each tier and what is opened by hand', async () => {
  const { db, env: e } = setup();
  const a = addClass(db, 'A');
  const b = addClass(db, 'B');
  const [p1, p2] = [addPupil(db, a, 'Amy'), addPupil(db, a, 'Ben')];
  addPupil(db, b, 'Cal');
  attempt(db, p1, a, { xp: 450 });
  attempt(db, p2, a, { xp: 1200 });
  await call(e, ADMIN, 'PUT', `/classes/${a}/unlocks`, { unlocked: [8, 9] });
  const g = (await call(e, ADMIN, 'GET', '/unlock-grid')).body;
  assert.deepEqual(g.classes.map((c) => c.name), ['A', 'B']);
  const rowA = g.classes[0];
  assert.deepEqual(rowA.unlocked, [8, 9]);
  assert.equal(rowA.pupils, 2);
  assert.deepEqual(rowA.reached, { 10: 2, 20: 1 });
  assert.deepEqual(g.classes[1].reached, { 10: 0, 20: 0 });
  assert.equal(g.tiers.length, 3);
  assert.equal(g.tierXp[2].xp, 1200);
});

test('unlock grid: a teacher sees only their classes; archived classes are left out', async () => {
  const { db, env: e } = setup();
  const a = addClass(db, 'A');
  const b = addClass(db, 'B');
  const old = addClass(db, 'Old');
  db.prepare('UPDATE classes SET archived = 1 WHERE id = ?').run(old);
  const who = await teacherWho(e, db, [a, old]);
  assert.deepEqual((await call(e, who, 'GET', '/unlock-grid')).body.classes.map((c) => c.id), [a]);
  assert.equal((await call(e, ADMIN, 'GET', '/unlock-grid')).body.classes.length, 2);
  assert.equal(b > 0, true);
  const none = await teacherWho(e, db, [], 'nobody');
  assert.deepEqual((await call(e, none, 'GET', '/unlock-grid')).body.classes, []);
});

// ---------------------------------------------------------------- settings impact preview

test('settings preview: how many pupils a change would move, before it is saved', async () => {
  const { db, env: e } = setup();
  const c = addClass(db, 'A');
  const ids = ['Amy', 'Ben', 'Cal'].map((n) => addPupil(db, c, n));
  attempt(db, ids[0], c, { xp: 450 }); // level 10 now
  attempt(db, ids[1], c, { xp: 1200 }); // level 20 now
  attempt(db, ids[2], c, { xp: 90 });
  const harder = await call(e, ADMIN, 'POST', '/settings/preview', { levelBands: [{ upTo: null, xp: 100 }] });
  assert.equal(harder.status, 200);
  assert.equal(harder.body.pupils, 3);
  assert.equal(harder.body.level.down, 3, 'Cal slips from level 2 to 1 as well');
  assert.equal(harder.body.level.up, 0);
  assert.equal(harder.body.lose[4], 1, 'Amy would lose districts 4-6');
  assert.equal(harder.body.lose[7], 1, 'Ben would lose districts 7-12');
  assert.ok(harder.body.sample.length >= 2 && harder.body.sample[0].from.level > harder.body.sample[0].to.level);
  const easier = await call(e, ADMIN, 'POST', '/settings/preview', { levelBands: [{ upTo: null, xp: 10 }] });
  assert.equal(easier.body.level.up, 3);
  assert.equal(easier.body.gain[4], 1, 'Cal would gain districts 4-6');
  const ranks = await call(e, ADMIN, 'POST', '/settings/preview', { rankXp: [0, 5, 10, 15, 20, 25], vehicleXp: [0, 1000, 2000, 3000, 4000, 5000] });
  assert.equal(ranks.body.rank.up, 2, 'Amy and Cal reach the top rank; Ben already had it');
  assert.equal(ranks.body.ride.down, 3, 'all three would have a slower ride');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k IN ('level_bands', 'rank_xp', 'vehicle_xp')").get().n, 0, 'nothing was saved');
  const same = await call(e, ADMIN, 'POST', '/settings/preview', { levelBands: DEFAULT_BANDS });
  assert.deepEqual([same.body.level.up, same.body.level.down, same.body.sample.length], [0, 0, 0]);
});

test('settings preview: admin only, and bad input is refused', async () => {
  const { db, env: e } = setup();
  const who = await teacherWho(e, db, []);
  assert.equal((await call(e, who, 'POST', '/settings/preview', { levelBands: [{ upTo: null, xp: 5 }] })).status, 403);
  assert.equal((await call(e, ADMIN, 'POST', '/settings/preview', { levelBands: [{ upTo: 10, xp: 5 }] })).status, 400);
  assert.equal((await call(e, ADMIN, 'POST', '/settings/preview', { rankXp: [1, 2, 3, 4, 5, 6] })).status, 400);
  assert.equal((await call(e, ADMIN, 'POST', '/settings/preview', {})).status, 200, 'an empty draft just describes no change');
});

// ---------------------------------------------------------------- account-saved preferences

const me = async (e) => (await pupil.me(e, pupilCtx)).json();
const putPrefs = async (e, body) => {
  try {
    const r = await pupil.prefs(new Request('http://x/api/prefs', { method: 'PUT', body: JSON.stringify(body) }), e, pupilCtx);
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};
const addXp = (db, xp) => attempt(db, 1, null, { xp, ts: Date.now() - DAY });

test('preferences: a pupil’s garage, sound and keys are saved on the account and come back with me()', async () => {
  const { db, env: e } = setup();
  addXp(db, 300);
  assert.deepEqual((await me(e)).prefs, {});
  const r = await putPrefs(e, { garage: { paint: 'coral', helmet: 'round', sticker: 'bolt' }, sound: false, keys: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, { garage: { paint: 'coral', helmet: 'round', sticker: 'bolt' }, sound: false, keys: true });
  assert.deepEqual((await me(e)).prefs, r.body.prefs);
  // a partial update keeps the rest
  await putPrefs(e, { garage: { paint: 'mint' } });
  assert.deepEqual((await me(e)).prefs.garage, { paint: 'mint', helmet: 'round', sticker: 'bolt' });
  await putPrefs(e, { sound: true });
  assert.equal((await me(e)).prefs.sound, true);
  assert.equal((await me(e)).prefs.keys, true);
  await putPrefs(e, { keys: null });
  assert.equal('keys' in (await me(e)).prefs, false, 'null puts keys back to automatic');
});

test('preferences: only things that exist and are unlocked can be chosen, and nothing else is stored', async () => {
  const { db, env: e } = setup();
  addXp(db, 100);
  assert.equal((await putPrefs(e, { garage: { paint: 'rainbow' } })).status, 403, 'rainbow needs 650 XP');
  assert.equal((await putPrefs(e, { garage: { paint: 'neon-pink' } })).status, 400);
  assert.equal((await putPrefs(e, { garage: 'red' })).status, 400);
  assert.equal((await putPrefs(e, { sound: 'loud' })).status, 400);
  assert.equal((await putPrefs(e, { keys: 'yes' })).status, 400);
  assert.equal((await putPrefs(e, { garage: { paint: 'coral' }, admin: true, role: 'teacher', __proto__: { x: 1 } })).status, 200);
  assert.deepEqual(Object.keys(JSON.parse(db.prepare('SELECT prefs FROM pupil_prefs').get().prefs)), ['garage']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pupil_prefs').get().n, 1);
});

test('preferences: a saved item that is no longer unlocked falls back to the starter, never an error', async () => {
  const { db, env: e } = setup();
  addXp(db, 700);
  await putPrefs(e, { garage: { paint: 'rainbow', helmet: 'star' } });
  assert.equal((await me(e)).prefs.garage.paint, 'rainbow');
  db.prepare('DELETE FROM attempts').run(); // a teacher reset the pupil's results
  const g = (await me(e)).prefs.garage;
  assert.equal(g.paint, COSMETICS.paints[0].id);
  assert.equal(g.helmet, COSMETICS.helmets[0].id);
  assert.deepEqual(readablePrefs('not json', 999), {});
  assert.deepEqual(readablePrefs('{"garage":{"paint":"zzz"},"sound":"x","evil":1}', 999), { garage: { paint: COSMETICS.paints[0].id, helmet: COSMETICS.helmets[0].id, sticker: COSMETICS.stickers[0].id } });
  assert.throws(() => cleanPrefsUpdate({ garage: { paint: 'rainbow' } }, 0), HttpError);
});

test('preferences: removed with the pupil, with their class, and with old guests', async () => {
  const { db, env: e } = setup();
  const c = addClass(db, 'A');
  const p = addPupil(db, c, 'Amy');
  const q = addPupil(db, c, 'Ben');
  db.prepare("INSERT INTO pupil_prefs (pupil_id, prefs, updated_at) VALUES (?, '{}', 1), (?, '{}', 1)").run(p, q);
  await call(e, ADMIN, 'DELETE', `/pupils/${p}`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pupil_prefs').get().n, 1);
  await call(e, ADMIN, 'DELETE', `/classes/${c}`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pupil_prefs').get().n, 0);
});

test('preferences: before the 1.7 migration nothing breaks', async () => {
  const { db, env: e } = setup();
  db.exec('DROP TABLE pupil_prefs');
  assert.deepEqual((await me(e)).prefs, {});
  assert.equal((await putPrefs(e, { sound: false })).status, 503);
});

// ---------------------------------------------------------------- install files

test('the web app manifest describes an installable app', () => {
  const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(m.name, 'Dash Express');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url.startsWith('/'), true);
  assert.equal(m.scope, '/');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon for round and squircle launchers');
  for (const i of m.icons) {
    const f = 'public' + i.src;
    assert.ok(existsSync(f), f + ' exists');
    assert.ok(statSync(f).size > 1000);
    assert.equal(readFileSync(f).subarray(1, 4).toString(), 'PNG', f + ' is a PNG');
  }
});

test('the pupil page links the manifest and icons, and fits phones with notches', () => {
  const html = readFileSync('public/index.html', 'utf8');
  for (const needle of ['rel="manifest"', 'name="theme-color"', 'rel="apple-touch-icon"', 'viewport-fit=cover', 'apple-mobile-web-app-capable', '/ui.js', '/sfx.js']) assert.ok(html.includes(needle), needle);
  assert.ok(existsSync('public/icons/apple-touch-icon.png'));
  assert.ok(existsSync('public/icons/favicon.svg'));
  const headers = readFileSync('public/_headers', 'utf8');
  assert.match(headers, /\/sw\.js\s+Cache-Control: no-cache/);
});

// Run the real sw.js in a sandbox with a pretend service-worker environment.
function loadWorker() {
  const handlers = {};
  const cached = new Map();
  const sandbox = {
    self: { location: { origin: 'https://dash.example' }, addEventListener: (t, f) => (handlers[t] = f), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: {
      open: async () => ({ addAll: async () => {}, put: async (req, res) => cached.set(typeof req === 'string' ? req : req.url, res) }),
      keys: async () => ['dash-express-0.9.0', 'something-else'],
      delete: async (n) => (sandbox.deleted = [...(sandbox.deleted || []), n]),
      match: async (req) => cached.get(typeof req === 'string' ? 'https://dash.example' + req : req.url),
    },
    fetch: async () => ({ ok: true, type: 'basic', clone() { return this; }, tag: 'net' }),
    Response: { error: () => ({ tag: 'error' }) },
    URL, Promise, setTimeout, clearTimeout, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync('public/sw.js', 'utf8'), sandbox);
  return { handlers, sandbox, cached };
}
const fetchEvent = (url, method = 'GET', mode = 'cors') => {
  const ev = { request: { url, method, mode }, responded: null, respondWith(p) { this.responded = p; } };
  return ev;
};

test('service worker: leaves the API, the teacher console, other sites and non-GET requests alone', () => {
  const { handlers } = loadWorker();
  for (const [url, method] of [
    ['https://dash.example/api/me', 'GET'], ['https://dash.example/api/answer', 'POST'], ['https://dash.example/teacher.html', 'GET'], ['https://dash.example/teacher.js', 'GET'],
    ['https://dash.example/sw.js', 'GET'], ['https://fonts.googleapis.com/css2', 'GET'], ['https://dash.example/app.js', 'POST'],
  ]) {
    const ev = fetchEvent(url, method);
    handlers.fetch(ev);
    assert.equal(ev.responded, null, method + ' ' + url + ' must not be intercepted');
  }
});

test('service worker: serves the app from the network, and from its saved copy when offline', async () => {
  const { handlers, sandbox, cached } = loadWorker();
  const ev = fetchEvent('https://dash.example/app.js');
  handlers.fetch(ev);
  assert.ok(ev.responded, 'app files are handled');
  assert.equal((await ev.responded).tag, 'net');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(cached.has('https://dash.example/app.js'), 'saved a copy for later');
  sandbox.fetch = async () => { throw new TypeError('offline'); };
  const off = fetchEvent('https://dash.example/app.js');
  handlers.fetch(off);
  assert.equal((await off.responded).tag, 'net', 'the saved copy is used offline');
  // an offline page visit falls back to the saved home page
  cached.set('https://dash.example/', { tag: 'home' });
  const nav = fetchEvent('https://dash.example/anything', 'GET', 'navigate');
  handlers.fetch(nav);
  assert.equal((await nav.responded).tag, 'home');
  const missing = fetchEvent('https://dash.example/nope.png');
  handlers.fetch(missing);
  assert.equal((await missing.responded).tag, 'error');
});

test('service worker: clears old caches on update, and its version matches the app', async () => {
  const { handlers, sandbox } = loadWorker();
  let waited;
  handlers.activate({ waitUntil: (p) => (waited = p) });
  await waited;
  assert.deepEqual(sandbox.deleted, ['dash-express-0.9.0'], 'only this app’s old caches go');
  const src = readFileSync('public/sw.js', 'utf8');
  assert.ok(src.includes(`const VERSION = '${VERSION}';`), 'sw.js VERSION matches src/version.js (' + VERSION + ')');
});
