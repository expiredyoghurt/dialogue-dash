// What a pupil chose for themselves: the look of their ride, sound on or off, punctuation keys.
// Kept on the account so it follows them from the classroom computer to a tablet or phone.
//
//   { garage: { paint, helmet, sticker }, sound: true|false, keys: true|false|null }   (keys null = automatic)
//
// Only these keys are ever stored, and a garage item must exist and be unlocked at the pupil's XP.

import { COSMETICS } from './districts.js';
import { HttpError, json, readJson } from './util.js';

const KINDS = [['paint', 'paints'], ['helmet', 'helmets'], ['sticker', 'stickers']];

export function defaultGarage() {
  return { paint: COSMETICS.paints[0].id, helmet: COSMETICS.helmets[0].id, sticker: COSMETICS.stickers[0].id };
}

// What is stored, made safe to hand back: unknown ids and items the pupil no longer has unlocked fall back to the first one.
export function readablePrefs(raw, xp) {
  let p = {};
  try {
    p = JSON.parse(raw || '{}') || {};
  } catch {}
  const out = {};
  if (p.garage && typeof p.garage === 'object') {
    const g = defaultGarage();
    for (const [k, list] of KINDS) {
      const item = COSMETICS[list].find((x) => x.id === p.garage[k]);
      if (item && item.at <= xp) g[k] = item.id;
    }
    out.garage = g;
  }
  if (typeof p.sound === 'boolean') out.sound = p.sound;
  if (typeof p.keys === 'boolean') out.keys = p.keys;
  return out;
}

// Checks an update from the browser. Throws for anything that isn't allowed.
export function cleanPrefsUpdate(body, xp) {
  const out = {};
  if (body.garage !== undefined) {
    if (!body.garage || typeof body.garage !== 'object') throw new HttpError(400, 'That garage choice isn’t valid.');
    const g = {};
    for (const [k, list] of KINDS) {
      if (body.garage[k] === undefined) continue;
      const item = COSMETICS[list].find((x) => x.id === body.garage[k]);
      if (!item) throw new HttpError(400, 'That ' + k + ' doesn’t exist.');
      if (item.at > xp) throw new HttpError(403, 'That one isn’t unlocked yet. Keep earning XP!');
      g[k] = item.id;
    }
    out.garage = g;
  }
  if (body.sound !== undefined) {
    if (typeof body.sound !== 'boolean') throw new HttpError(400, 'Sound is on or off.');
    out.sound = body.sound;
  }
  if (body.keys !== undefined) {
    if (body.keys !== null && typeof body.keys !== 'boolean') throw new HttpError(400, 'Punctuation keys are on, off or automatic.');
    out.keys = body.keys;
  }
  return out;
}

export async function loadPrefsRaw(env, pupilId) {
  try {
    const row = await env.DB.prepare('SELECT prefs FROM pupil_prefs WHERE pupil_id = ?1').bind(pupilId).first();
    return row ? row.prefs : '{}';
  } catch {
    return '{}'; // not migrated yet
  }
}

// PUT /api/prefs  (merges the given keys into what is stored)
export async function savePrefs(request, env, p, xp) {
  const upd = cleanPrefsUpdate(await readJson(request), xp);
  let cur = {};
  try {
    cur = JSON.parse(await loadPrefsRaw(env, p.id)) || {};
  } catch {}
  const next = { ...cur };
  if (upd.garage) next.garage = { ...defaultGarage(), ...(cur.garage || {}), ...upd.garage };
  if (upd.sound !== undefined) next.sound = upd.sound;
  if (upd.keys !== undefined) {
    if (upd.keys === null) delete next.keys;
    else next.keys = upd.keys;
  }
  try {
    await env.DB.prepare('INSERT INTO pupil_prefs (pupil_id, prefs, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(pupil_id) DO UPDATE SET prefs = ?2, updated_at = ?3').bind(p.id, JSON.stringify(next), Date.now()).run();
  } catch {
    throw new HttpError(503, 'Couldn’t save that just now. Your choice still works on this device.');
  }
  return json({ prefs: readablePrefs(JSON.stringify(next), xp) });
}
