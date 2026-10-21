-- Dash Express (v1.2.0). Adds the route_runs table. Safe to run any number of times, and safe to run
-- BEFORE deploying: the 1.1 Worker simply ignores the table. Nothing existing is changed.
CREATE TABLE IF NOT EXISTS route_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pupil_id INTEGER NOT NULL,
  class_id INTEGER,
  kind TEXT NOT NULL,
  district INTEGER NOT NULL DEFAULT 0,
  mode INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0,
  n_total INTEGER NOT NULL,
  n_right INTEGER NOT NULL,
  n_first INTEGER NOT NULL DEFAULT 0,
  best_combo INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,
  costly_rule INTEGER,
  ts INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS route_runs_once ON route_runs(pupil_id, started_at);
CREATE INDEX IF NOT EXISTS route_runs_pupil ON route_runs(pupil_id, kind, district);
INSERT INTO meta (k, v) VALUES ('schema_version', 3) ON CONFLICT(k) DO UPDATE SET v = 3;
