// Dash Express: districts, vehicles, cosmetics, and which district a question belongs to.
// Free of D1 and Workers APIs so it can be unit-tested in Node.
//
// District n teaches rule n (src/rules.js), so a district is simply "the rule, as a place on the map".
// A question belongs to the district of its rule. A teacher can set that with data.rule (1-12); otherwise
// autoRule() suggests one from the question itself.

import { CODES, RANKS } from './rules.js';

export const DISTRICTS = [
  { n: 1, name: 'Speech Mark Street', rule: 1, blurb: 'Wrap the spoken words in speech marks, and nothing else.' },
  { n: 2, name: 'Capital Corner', rule: 2, blurb: 'Speech starts with a capital. Names and “I” always do too.' },
  { n: 3, name: 'Full Stop Market', rule: 3, blurb: 'Every spoken sentence needs an ending: . ! or ?' },
  { n: 4, name: 'Comma Lane', rule: 4, blurb: 'Saying words first? A comma goes before the speech marks.' },
  { n: 5, name: 'Inside Row', rule: 5, blurb: 'Punctuation sits inside the speech marks. Saying words after it stay lowercase.' },
  { n: 6, name: 'Crossroads', rule: 6, blurb: 'New sentence means a capital. Same sentence carrying on means lowercase.' },
  { n: 7, name: 'Verb Garage', rule: 7, blurb: 'Swap “said” for a verb that shows how the speaker feels.' },
  { n: 8, name: 'Doorstep Row', rule: 8, blurb: 'A new speaker gets a new line, like one envelope per person.' },
  { n: 9, name: 'Action Alley', rule: 9, blurb: 'An action is its own sentence, so it ends with a full stop.' },
  { n: 10, name: 'Relay Road', rule: 10, blurb: 'Pass a message on: direct speech to reported speech and back.' },
  { n: 11, name: 'Diary Docks', rule: 11, blurb: 'Keep the dispatch diary in one time. Spot the verb that slipped.' },
  { n: 12, name: 'Customer Quarter', rule: 12, blurb: 'Read between the lines: what do actions and tone give away?' },
];
export const DISTRICT_NUMS = DISTRICTS.map((d) => d.n);

// ---------------------------------------------------------------------------------------------
// Ranks and rides. Each has its own list of XP thresholds, which start out the same (so a new rank
// still brings a new ride) but the admin can change either list on its own.
// ---------------------------------------------------------------------------------------------
export const DEFAULT_RANK_XP = RANKS.map((r) => r.xp);
export const DEFAULT_VEHICLE_XP = RANKS.map((r) => r.xp);

// Checks an admin-supplied list of thresholds: one whole number per rank (or ride), the first 0, each higher
// than the one before.
export function validateThresholds(input, count, what = 'rank') {
  if (!Array.isArray(input) || input.length !== count) return { ok: false, error: `Give an XP amount for each of the ${count} ${what}s.` };
  const xps = input.map((x) => (x === '' || x === null ? NaN : Number(x)));
  if (xps.some((x) => !Number.isInteger(x) || x < 0 || x > 1_000_000)) return { ok: false, error: 'XP amounts must be whole numbers from 0 to 1,000,000.' };
  if (xps[0] !== 0) return { ok: false, error: `The first ${what} always starts at 0 XP.` };
  for (let i = 1; i < xps.length; i++) if (xps[i] <= xps[i - 1]) return { ok: false, error: `Each ${what} needs more XP than the one before it.` };
  return { ok: true, xps };
}

// Which ride a pupil has, from the ride thresholds. Shaped like rankFor().
export function vehicleFor(xp, xps = DEFAULT_VEHICLE_XP) {
  let idx = 0;
  for (let i = 0; i < VEHICLES.length; i++) if (xp >= xps[i]) idx = i;
  const next = VEHICLES[idx + 1] ? { xp: xps[idx + 1], name: VEHICLES[idx + 1].name } : null;
  return { index: idx, id: VEHICLES[idx].id, name: VEHICLES[idx].name, from: xps[idx], next: next ? next.xp : null, nextName: next ? next.name : null };
}

// ---------------------------------------------------------------------------------------------
// Levels and what they unlock. A pupil's level comes from their total XP (answers + tips).
// Level 1 is free. Each later level costs the XP of the range it falls in, and the admin can change the ranges:
//   levels 2-10 cost 50 each, 11-20 cost 75, 21-30 cost 100, 31-40 cost 150, 41 onwards cost 200 (the defaults)
// so level 10 is reached at 450 XP and level 20 at 1,200 XP.
// Districts open in tiers. A teacher can open districts for a class ahead of the level (class_settings).
// ---------------------------------------------------------------------------------------------
export const DEFAULT_BANDS = [
  { upTo: 10, xp: 50 },
  { upTo: 20, xp: 75 },
  { upTo: 30, xp: 100 },
  { upTo: 40, xp: 150 },
  { upTo: null, xp: 200 },
];

// Checks admin-supplied ranges: 1-8 rows, each { upTo: last level in the range, xp: cost of each level in it },
// upTo increasing, and the last row open-ended (upTo null) so every level has a price.
export function validateBands(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) return { ok: false, error: 'Use between 1 and 8 ranges.' };
  const bands = [];
  let prev = 1;
  for (let i = 0; i < input.length; i++) {
    const r = input[i] || {};
    const last = i === input.length - 1;
    const xp = Number(r.xp);
    if (!Number.isInteger(xp) || xp < 1 || xp > 100000) return { ok: false, error: 'XP per level must be a whole number from 1 to 100,000.' };
    if (last) {
      if (r.upTo !== null && r.upTo !== undefined && r.upTo !== '') return { ok: false, error: 'The last range must carry on for every higher level.' };
      bands.push({ upTo: null, xp });
    } else {
      const upTo = Number(r.upTo);
      if (!Number.isInteger(upTo) || upTo <= prev || upTo > 1000) return { ok: false, error: 'Each range must end at a higher level than the one before it (level ' + (prev + 1) + ' or more).' };
      bands.push({ upTo, xp });
      prev = upTo;
    }
  }
  return { ok: true, bands };
}

// Level for a total of XP.
export function levelFor(xp, bands = DEFAULT_BANDS) {
  let remaining = Math.max(0, Math.floor(xp || 0));
  let level = 1;
  for (const b of bands) {
    const count = b.upTo === null ? Infinity : Math.max(0, b.upTo - level);
    if (count === 0) continue;
    const take = Math.min(Math.floor(remaining / b.xp), count);
    level += take;
    remaining -= take * b.xp;
    if (take < count) break; // can't afford the next level in this range
  }
  return level;
}

// XP at which a level is reached.
export function xpForLevel(level, bands = DEFAULT_BANDS) {
  const target = Math.max(1, Math.floor(level));
  let xp = 0;
  let at = 1;
  for (const b of bands) {
    if (at >= target) break;
    const top = b.upTo === null ? target : Math.min(b.upTo, target);
    if (top <= at) continue;
    xp += (top - at) * b.xp;
    at = top;
  }
  return xp;
}
export const tierLevel = (n) => (LEVEL_TIERS.find((t) => t.districts.includes(n)) || LEVEL_TIERS[LEVEL_TIERS.length - 1]).level;

export const LEVEL_TIERS = [
  { level: 1, districts: [1, 2, 3] },
  { level: 10, districts: [4, 5, 6] },
  { level: 20, districts: [7, 8, 9, 10, 11, 12] },
];

// The next tier a pupil has not reached yet, for "reach level 10 to open ..." messages. null once all are open.
export function nextTier(level, bands = DEFAULT_BANDS) {
  const t = LEVEL_TIERS.find((x) => x.level > level);
  return t ? { level: t.level, districts: t.districts, xp: xpForLevel(t.level, bands) } : null;
}

// Which districts this pupil may play: the tiers their level has reached, plus anything the teacher opened
// for their class, or everything when the admin opens the whole town.
export function allowedDistricts({ level, manual = [], openAll = false }) {
  if (openAll) return new Set(DISTRICT_NUMS);
  const set = new Set();
  for (const t of LEVEL_TIERS) if (level >= t.level) for (const n of t.districts) set.add(n);
  for (const n of manual) if (DISTRICT_NUMS.includes(n)) set.add(n);
  return set;
}

// Route sizes and thresholds.
export const ROUTE_LEN = 5; // stops on an ordinary route
export const BIG_LEN = 6; // stops on a Big Delivery
export const RUSH_LEN = 6; // stops on a Rush Hour route
export const BIG_PATIENCE = 3; // slips a Big Delivery customer will put up with
export const BIG_AT = 8; // correct questions in a district that open its Big Delivery
export const BIG_MIN_POOL = 4; // districts smaller than this have no Big Delivery (finish them all instead)
export const RUSH_AT = 3; // districts cleared before Rush Hour opens
export const PAR_MS_PER_STOP = 90_000; // soft delivery clock: par time per stop

// Vehicles follow the rank ladder in rules.js (same index).
export const VEHICLES = [
  { id: 'foot', name: 'On foot' },
  { id: 'bike', name: 'Delivery bike' },
  { id: 'scooter', name: 'Scooter' },
  { id: 'van', name: 'Van' },
  { id: 'truck', name: 'Truck' },
  { id: 'rocket', name: 'Rocket' },
];

// Garage cosmetics unlock at a total of XP + tips. The pupil's choice is kept in their own browser.
export const COSMETICS = {
  paints: [
    { id: 'sun', name: 'Sunny yellow', color: '#ffd23f', at: 0 },
    { id: 'sky', name: 'Sky blue', color: '#4aa8ff', at: 0 },
    { id: 'mint', name: 'Mint', color: '#3ecf8e', at: 40 },
    { id: 'coral', name: 'Coral', color: '#ff6b6b', at: 90 },
    { id: 'grape', name: 'Grape', color: '#8b5cf6', at: 160 },
    { id: 'tangerine', name: 'Tangerine', color: '#ff9f1c', at: 260 },
    { id: 'midnight', name: 'Midnight', color: '#2b3a67', at: 400 },
    { id: 'rainbow', name: 'Rainbow', color: 'rainbow', at: 650 },
  ],
  helmets: [
    { id: 'none', name: 'No helmet', at: 0 },
    { id: 'cap', name: 'Courier cap', at: 20 },
    { id: 'round', name: 'Round helmet', at: 70 },
    { id: 'visor', name: 'Visor helmet', at: 200 },
    { id: 'star', name: 'Star helmet', at: 450 },
  ],
  stickers: [
    { id: 'none', name: 'No sticker', at: 0 },
    { id: 'star', name: 'Gold star', at: 30 },
    { id: 'bolt', name: 'Lightning bolt', at: 110 },
    { id: 'quote', name: 'Speech marks', at: 180 },
    { id: 'heart', name: 'Heart', at: 300 },
    { id: 'flag', name: 'Chequered flag', at: 520 },
  ],
};

// ---------------------------------------------------------------------------------------------
// Which district does a question belong to?
// ---------------------------------------------------------------------------------------------

const MC_RULE = { MC_VERB: 7, MC_INFER: 12 };

// A best guess from the question itself. Teachers can override it (data.rule). Modes 1 and 2 have no
// single "rule" of their own, so the guess looks at how the dialogue is built:
//   two spoken parts in a line      -> Crossroads (6)
//   very short speech               -> Speech Mark Street (1), the gentlest start
//   "I" or a name inside the speech -> Capital Corner (2)
//   saying words first              -> Comma Lane (4)
//   ends in ? or !                  -> Full Stop Market (3)
//   everything else                 -> Inside Row (5)
export function autoRule(mode, data) {
  const d = data || {};
  if (mode === 3) return 7;
  if (mode === 4) return MC_RULE[d.code] || 7;
  if (mode === 5) return 10;
  if (mode === 6) return 11;
  if (mode === 1 && d.lines) return 8;
  if (mode === 1 && d.beat) return 9;
  const line = String(d.correct || '').split('\n')[0].replace(/[“”]/g, '"');
  const spans = (line.match(/"/g) || []).length / 2;
  if (spans >= 2) return 6;
  const inner = (line.match(/"([^"]*)"/) || [])[1] || '';
  const words = inner.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return 1;
  const capInside = /(^|\s)I(['’]|\s|$)/.test(inner) || words.slice(1).some((w) => /^[A-Z][a-z]/.test(w));
  if (capInside) return 2;
  if (/^[^"]+,\s*"/.test(line)) return 4;
  if (/[?!]$/.test(inner)) return 3;
  return 5;
}

export const isRule = (n) => Number.isInteger(n) && n >= 1 && n <= 12;

// The district a question is in: the teacher's choice if there is one, otherwise the guess.
export function ruleOf(mode, data) {
  const set = data && data.rule;
  return isRule(set) ? set : autoRule(mode, data);
}

// ---------------------------------------------------------------------------------------------
// Per-district progress, from one pupil's attempts. Pure, so the Worker and the tests share it.
//   questions: [{ id, mode, data }]   last: Map(questionId -> { correct: ever answered right, wrong: last try was wrong })
//   runs: route_runs rows
// ---------------------------------------------------------------------------------------------

export function districtProgress(questions, last, runs, { allowed } = {}) {
  const by = {};
  for (const n of DISTRICT_NUMS) by[n] = { n, total: 0, done: 0, wrong: 0, stars: 0, bigDone: false, bigReady: false, cleared: false, unlocked: false, empty: false, needLevel: tierLevel(n) };
  for (const q of questions) {
    const n = ruleOf(q.mode, q.data);
    const b = by[n];
    if (!b) continue;
    b.total++;
    const l = last.get(q.id);
    if (l && l.correct) b.done++;
    else if (l && l.wrong !== false) b.wrong++;
  }
  for (const r of runs || []) {
    const b = by[r.district];
    if (!b) continue;
    if (r.kind === 'route') b.stars = Math.max(b.stars, r.stars || 0);
    if (r.kind === 'big' && r.passed) b.bigDone = true;
  }
  for (const n of DISTRICT_NUMS) {
    const b = by[n];
    b.empty = b.total === 0;
    b.bigReady = b.total >= BIG_MIN_POOL && b.done >= Math.min(b.total, BIG_AT);
    b.cleared = b.empty ? true : b.total < BIG_MIN_POOL ? b.done >= b.total : b.bigDone;
    b.unlocked = allowed ? allowed.has(n) : true;
  }
  return DISTRICT_NUMS.map((n) => by[n]);
}

// Districts a pupil has really cleared (empty "coming soon" districts don't count).
export const clearedCount = (list) => list.filter((d) => !d.empty && d.cleared).length;

// ---------------------------------------------------------------------------------------------
// Marking a finished route from the attempts the server already holds. Pure.
//   qids: the route's questions in order; attempts: this pupil's attempts for them since the route began
// ---------------------------------------------------------------------------------------------

export function scoreRoute({ kind, qids, attempts, ms, clock }) {
  const total = qids.length;
  const byQ = new Map();
  for (const a of attempts) {
    if (!byQ.has(a.question_id)) byQ.set(a.question_id, []);
    byQ.get(a.question_id).push(a);
  }
  let right = 0;
  let first = 0;
  let streak = 0;
  let best = 0;
  let bonusCombo = 0;
  const costly = {};
  const misses = [];
  for (const id of qids) {
    const list = byQ.get(id) || [];
    const ok = list.some((a) => a.correct);
    const firstTry = list.some((a) => a.correct && a.try_no === 1);
    if (ok) right++;
    if (firstTry) {
      first++;
      streak++;
      best = Math.max(best, streak);
      bonusCombo += Math.min(streak, 4) - 1;
    } else {
      streak = 0;
      misses.push(id);
    }
    for (const a of list) {
      if (a.correct) continue;
      for (const c of a.codes || []) {
        const m = CODES[c];
        if (m && !m.hidden && m.rule) costly[m.rule] = (costly[m.rule] || 0) + 1;
      }
    }
  }
  let costlyRule = null;
  let costlyN = 0;
  for (const [r, n] of Object.entries(costly)) if (n > costlyN) [costlyRule, costlyN] = [Number(r), n];
  const pct = total ? right / total : 0;
  const stars = pct >= 1 ? 3 : pct >= 0.8 ? 2 : pct >= 0.6 ? 1 : 0;
  const slips = total - first;
  const passed = kind === 'big' ? right === total && slips < BIG_PATIENCE : stars >= 1;
  let bonus = right + bonusCombo;
  const par = total * PAR_MS_PER_STOP;
  const fast = !!clock && right === total && ms > 0 && ms <= par;
  if (fast) bonus += 3;
  if (stars === 3) bonus += 5;
  if (kind === 'big' && passed) bonus += 10;
  if (!passed && kind === 'big') bonus = Math.min(bonus, right);
  return { total, right, first, bestCombo: best, stars, passed, bonus, fast, slips, costlyRule, par };
}
