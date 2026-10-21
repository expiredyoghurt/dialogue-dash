-- Dash Express 1.3.0: teacher accounts, class assignments and per-class district unlocks.
-- Safe to run before deploying, and any number of times. Nothing existing is changed.
-- Teacher accounts (v1.3). The Cloudflare secrets (teacher_user / teacher_password) remain the admin sign-in.
-- The admin creates teacher accounts here and assigns each to the classes they run.
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sess_ver INTEGER NOT NULL DEFAULT 0,      -- bumped on password reset / sign-out-everywhere
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS teacher_classes (
  teacher_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, class_id)
);
CREATE INDEX IF NOT EXISTS teacher_classes_class ON teacher_classes(class_id);

-- Districts a teacher has opened for a whole class, ahead of the level that would open them.
CREATE TABLE IF NOT EXISTS class_settings (
  class_id INTEGER PRIMARY KEY,
  unlocked TEXT NOT NULL DEFAULT '[]'       -- JSON array of district numbers (1-12)
);
INSERT INTO meta (k, v) VALUES ('schema_version', 4) ON CONFLICT(k) DO UPDATE SET v = 4;
