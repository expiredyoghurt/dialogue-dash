// Dash Express (v1.2): the courier layer on top of the question engine.
//
//   settings        teacher switches (delivery clock, open every district), kept in the meta table
//   pupilState()    districts, stars, tips and Dot's suggestion for one pupil
//   finishRoute()   marks a finished route from the attempts the server already holds and pays the tips
//
// Nothing here changes how an answer is marked or how XP is awarded for it. A route only adds a bonus (tips)
// on top, worked out from attempts the pupil really made, so a browser cannot talk itself into extra XP.

import { rankFor, RANKS } from './rules.js';
import {
  DISTRICT_NUMS,
  RUSH_AT,
  ruleOf,
  districtProgress,
  clearedCount,
  scoreRoute,
  levelFor,
  xpForLevel,
  nextTier,
  allowedDistricts,
  validateBands,
  DEFAULT_BANDS,
  LEVEL_TIERS,
  validateThresholds,
  DEFAULT_RANK_XP,
  DEFAULT_VEHICLE_XP,
  VEHICLES,
  vehicleFor,
} from './districts.js';
import { HttpError, json, readJson, int } from './util.js';

const HOUR = 3_600_000;
const KINDS = ['route', 'big', 'rush', 'mode'];

// ---------- teacher switches ----------

export async function getSettings(env) {
  let rows = [];
  try {
    rows = (await env.DB.prepare("SELECT k, v FROM meta WHERE k IN ('clock', 'open_districts', 'level_bands', 'rank_xp', 'vehicle_xp')").all()).results || [];
  } catch {}
  const m = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  let bands = DEFAULT_BANDS;
  let custom = false;
  if (typeof m.level_bands === 'string') {
    try {
      const v = validateBands(JSON.parse(m.level_bands));
      if (v.ok) {
        bands = v.bands;
        custom = true;
      }
    } catch {} // a damaged value falls back to the defaults
  }
  const thresholds = (key, count, what, fallback) => {
    if (typeof m[key] !== 'string') return { xps: fallback, custom: false };
    try {
      const v = validateThresholds(JSON.parse(m[key]), count, what);
      return v.ok ? { xps: v.xps, custom: true } : { xps: fallback, custom: false };
    } catch {
      return { xps: fallback, custom: false }; // a damaged value falls back to the standard amounts
    }
  };
  const rk = thresholds('rank_xp', RANKS.length, 'rank', DEFAULT_RANK_XP);
  const vh = thresholds('vehicle_xp', VEHICLES.length, 'ride', DEFAULT_VEHICLE_XP);
  return {
    clock: m.clock == null ? true : !!m.clock,
    openDistricts: !!m.open_districts,
    levelBands: bands,
    levelBandsCustom: custom,
    tierXp: LEVEL_TIERS.map((t) => ({ level: t.level, xp: xpForLevel(t.level, bands) })),
    rankXp: rk.xps,
    rankXpCustom: rk.custom,
    vehicleXp: vh.xps,
    vehicleXpCustom: vh.custom,
    defaults: { levelBands: DEFAULT_BANDS, rankXp: DEFAULT_RANK_XP, vehicleXp: DEFAULT_VEHICLE_XP },
    ranks: RANKS.map((r, i) => ({ name: r.name, xp: rk.xps[i] })),
    vehicles: VEHICLES.map((v, i) => ({ id: v.id, name: v.name, xp: vh.xps[i] })),
  };
}

export async function saveSettings(env, body) {
  const stmts = [];
  if (body.clock != null) stmts.push(env.DB.prepare("INSERT INTO meta (k, v) VALUES ('clock', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1").bind(body.clock ? 1 : 0));
  if (body.openDistricts != null) stmts.push(env.DB.prepare("INSERT INTO meta (k, v) VALUES ('open_districts', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1").bind(body.openDistricts ? 1 : 0));
  if (body.levelBands !== undefined) {
    if (body.levelBands === null) stmts.push(env.DB.prepare("DELETE FROM meta WHERE k = 'level_bands'")); // back to the defaults
    else {
      const v = validateBands(body.levelBands);
      if (!v.ok) throw new HttpError(400, v.error);
      stmts.push(env.DB.prepare("INSERT INTO meta (k, v) VALUES ('level_bands', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1").bind(JSON.stringify(v.bands)));
    }
  }
  for (const [field, key, count, what] of [['rankXp', 'rank_xp', RANKS.length, 'rank'], ['vehicleXp', 'vehicle_xp', VEHICLES.length, 'ride']]) {
    if (body[field] === undefined) continue;
    if (body[field] === null) stmts.push(env.DB.prepare('DELETE FROM meta WHERE k = ?1').bind(key)); // back to the standard amounts
    else {
      const v = validateThresholds(body[field], count, what);
      if (!v.ok) throw new HttpError(400, v.error);
      stmts.push(env.DB.prepare('INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(key, JSON.stringify(v.xps)));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return getSettings(env);
}

// ---------- runs and tips ----------

// route_runs may not exist yet (migrate-after-deploy). Everything below treats that as "no routes yet".
async function loadRuns(env, pupilId) {
  try {
    return (await env.DB.prepare('SELECT kind, district, mode, n_total, n_right, stars, passed, bonus, ts FROM route_runs WHERE pupil_id = ?1 ORDER BY id').bind(pupilId).all()).results || [];
  } catch {
    return [];
  }
}

export async function tipsTotal(env, pupilId) {
  try {
    const t = await env.DB.prepare('SELECT COALESCE(SUM(bonus), 0) AS b FROM route_runs WHERE pupil_id = ?1').bind(pupilId).first();
    return t ? t.b : 0;
  } catch {
    return 0;
  }
}

// Districts a teacher has opened by hand for a whole class (the class_settings table may not exist yet).
export async function classUnlocks(env, classId) {
  if (!classId) return [];
  try {
    const row = await env.DB.prepare('SELECT unlocked FROM class_settings WHERE class_id = ?1').bind(classId).first();
    const list = JSON.parse((row && row.unlocked) || '[]');
    return Array.isArray(list) ? list.filter((n) => DISTRICT_NUMS.includes(n)) : [];
  } catch {
    return [];
  }
}

// Everything that decides which districts a pupil may play: their level (from answer XP + tips), the districts
// their teacher opened for the class, and the admin's "open the whole town" switch.
export async function pupilAccess(env, p, { answerXp } = {}) {
  const [settings, tips, manual] = await Promise.all([getSettings(env), tipsTotal(env, p.id), classUnlocks(env, p.classId)]);
  let xp = answerXp;
  if (xp == null) xp = (await env.DB.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM attempts WHERE pupil_id = ?1').bind(p.id).first()).xp;
  const total = xp + tips;
  const bands = settings.levelBands;
  const level = levelFor(total, bands);
  return { settings, tips, xp, total, level, bands, manual, allowed: allowedDistricts({ level, manual, openAll: settings.openDistricts }) };
}

export const levelInfo = (access) => ({
  level: access.level,
  from: xpForLevel(access.level, access.bands),
  next: xpForLevel(access.level + 1, access.bands),
  nextTier: nextTier(access.level, access.bands),
  manual: access.manual,
});

// Dot's suggestion: the unlocked district where the pupil slipped most on first tries lately.
function dotTip(ruleErrors, districts) {
  let best = null;
  for (const d of districts) {
    if (d.empty || !d.unlocked) continue;
    const n = ruleErrors[d.n] || 0;
    if (n >= 2 && (!best || n > best.n)) best = { district: d.n, rule: d.n, n };
  }
  return best;
}

// Everything about a pupil that depends on the questions they can see.
export async function pupilState(env, p, { visible, rows, ruleErrors, access }) {
  const runs = await loadRuns(env, p.id);
  const settings = access.settings;
  const qs = (await env.DB.prepare(`SELECT id, mode, data FROM questions WHERE ${visible.where}`).bind(...visible.binds).all()).results || [];
  const last = new Map();
  // A parcel counts as delivered once it has ever been answered correctly, so a slip on a Big Delivery
  // (or a later retry) never takes a district back below the threshold. `wrong` is for parcels that came back.
  for (const r of rows) {
    const prev = last.get(r.question_id);
    last.set(r.question_id, { mode: r.mode, correct: !!(r.correct || (prev && prev.correct)), wrong: !r.correct });
  }
  const list = qs.map((q) => ({ id: q.id, mode: q.mode, data: JSON.parse(q.data) }));
  const districts = districtProgress(list, last, runs, { allowed: access.allowed });
  const cleared = clearedCount(districts);
  const tips = access.tips;
  return {
    settings,
    districts,
    cleared,
    rush: { open: settings.openDistricts || cleared >= RUSH_AT, at: RUSH_AT },
    tips,
    routes: runs.length,
    tip: dotTip(ruleErrors, districts),
    list,
    last,
  };
}

// ---------- finishing a route ----------

export async function finishRoute(request, env, p, visible) {
  const body = await readJson(request);
  const kind = String(body.kind || '');
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Unknown kind of route.');
  const qids = [...new Set((Array.isArray(body.qids) ? body.qids : []).map((x) => int(x, 0)).filter((x) => x > 0))].slice(0, 8);
  if (!qids.length) throw new HttpError(400, 'That route had no stops.');
  const district = int(body.district, 0);
  const mode = int(body.mode, 0);
  if ((kind === 'route' || kind === 'big') && !DISTRICT_NUMS.includes(district)) throw new HttpError(400, 'Unknown district.');
  const startedAt = int(body.startedAt, 0);
  const now = Date.now();
  if (!startedAt || startedAt > now + 120_000 || startedAt < now - 6 * HOUR) throw new HttpError(400, 'That route is too old to count.');
  const ms = Math.min(Math.max(int(body.ms, 0), 0), 3 * HOUR);

  // Already counted (a double tap, or a retry after a dropped connection)? Return what was stored.
  const prior = await existingRun(env, p.id, startedAt);
  if (prior) return json(await shape(env, p, visible, prior, true));

  // The stops must really belong where the pupil says they were delivered.
  const marks = qids.map((_, i) => `?${i + 1}`).join(',');
  const qrows = (await env.DB.prepare(`SELECT id, mode, data FROM questions WHERE id IN (${marks}) AND ${visible.where.replace(/\?1/g, `?${qids.length + 1}`)}`).bind(...qids, ...visible.binds).all()).results || [];
  if (qrows.length !== qids.length) throw new HttpError(400, 'Some stops on that route aren’t available.');
  const access = await pupilAccess(env, p);
  for (const q of qrows) {
    if (!access.allowed.has(ruleOf(q.mode, JSON.parse(q.data)))) throw new HttpError(403, 'That part of town isn’t open yet.');
    if ((kind === 'route' || kind === 'big') && ruleOf(q.mode, JSON.parse(q.data)) !== district) throw new HttpError(400, 'Those stops aren’t in that district.');
    if (kind === 'mode' && q.mode !== mode) throw new HttpError(400, 'Those stops aren’t that kind of job.');
  }
  if (kind === 'big' && qids.length < 3) throw new HttpError(400, 'A Big Delivery has more stops than that.');

  // Doors that are not open yet pay nothing.
  const settings = access.settings;
  if (kind === 'big' || kind === 'rush') {
    const rowsAll = (await env.DB.prepare('SELECT question_id, mode, correct FROM attempts WHERE pupil_id = ?1 ORDER BY id').bind(p.id).all()).results || [];
    const st = await pupilState(env, p, { visible, rows: rowsAll, ruleErrors: {}, access });
    if (kind === 'big' && !(st.districts.find((d) => d.n === district) || {}).bigReady) throw new HttpError(400, 'That Big Delivery isn’t open yet.');
    if (kind === 'rush' && !st.rush.open) throw new HttpError(400, 'Rush Hour isn’t open yet.');
  }

  // Marked from the attempts the server recorded while the route was being played.
  const since = Math.max(now - ms - 120_000, now - 3 * HOUR);
  const aMarks = qids.map((_, i) => `?${i + 3}`).join(',');
  const raw = (await env.DB.prepare(`SELECT question_id, try_no, correct, codes FROM attempts WHERE pupil_id = ?1 AND practice = 0 AND ts >= ?2 AND question_id IN (${aMarks}) ORDER BY id`).bind(p.id, since, ...qids).all()).results || [];
  const attempts = raw.map((a) => ({ ...a, codes: safeJson(a.codes) }));
  const score = scoreRoute({ kind, qids, attempts, ms, clock: settings.clock });

  try {
    await env.DB
      .prepare('INSERT INTO route_runs (pupil_id, class_id, kind, district, mode, started_at, ms, n_total, n_right, n_first, best_combo, stars, passed, bonus, costly_rule, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)')
      .bind(p.id, p.classId, kind, district, mode, startedAt, ms, score.total, score.right, score.first, score.bestCombo, score.stars, score.passed ? 1 : 0, score.bonus, score.costlyRule, now)
      .run();
  } catch (e) {
    const again = await existingRun(env, p.id, startedAt);
    if (again) return json(await shape(env, p, visible, again, true));
    throw new HttpError(500, 'Couldn’t save that route. Please try again.');
  }
  const saved = await existingRun(env, p.id, startedAt);
  return json(await shape(env, p, visible, saved, false, score));
}

const safeJson = (s) => {
  try {
    return JSON.parse(s || '[]');
  } catch {
    return [];
  }
};

async function existingRun(env, pupilId, startedAt) {
  try {
    return await env.DB.prepare('SELECT * FROM route_runs WHERE pupil_id = ?1 AND started_at = ?2').bind(pupilId, startedAt).first();
  } catch {
    return null;
  }
}

async function shape(env, p, visible, r, repeat, score) {
  const sum = await env.DB.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM attempts WHERE pupil_id = ?1').bind(p.id).first();
  const tips = await tipsTotal(env, p.id);
  const total = sum.xp + tips;
  const costly = r.costly_rule;
  const settings = await getSettings(env);
  return {
    repeat,
    run: {
      kind: r.kind,
      district: r.district,
      mode: r.mode,
      total: r.n_total,
      right: r.n_right,
      first: r.n_first,
      bestCombo: r.best_combo,
      stars: r.stars,
      passed: !!r.passed,
      bonus: r.bonus,
      ms: r.ms,
      costlyRule: costly || null,
      fast: score ? score.fast : null,
    },
    xpTotal: total,
    rank: rankFor(total, settings.rankXp),
    vehicle: vehicleFor(total, settings.vehicleXp),
    level: levelFor(total, settings.levelBands),
  };
}

