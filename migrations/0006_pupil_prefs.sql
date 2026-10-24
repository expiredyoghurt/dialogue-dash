-- Dash Express 1.7.0: pupil preferences (garage look, sound, punctuation keys) saved to the account.
-- Safe to run before deploying and any number of times.
-- Settings a pupil chose for themselves (garage look, sound, punctuation keys), so they follow them to any device.
CREATE TABLE IF NOT EXISTS pupil_prefs (
  pupil_id INTEGER PRIMARY KEY,
  prefs TEXT NOT NULL DEFAULT '{}',          -- JSON: { garage: {paint, helmet, sticker}, sound: bool, keys: bool|null }
  updated_at INTEGER NOT NULL
);
INSERT INTO meta (k, v) VALUES ('schema_version', 6) ON CONFLICT(k) DO UPDATE SET v = 6;
