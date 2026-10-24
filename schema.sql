-- Dialogue Dash: D1 schema. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  sess_ver INTEGER NOT NULL DEFAULT 1,   -- bump to sign every pupil in the class out
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pupils (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER,                      -- NULL for guests
  name TEXT NOT NULL,
  username TEXT NOT NULL,                -- lowercase; what the pupil types to sign in
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS pupils_class_user ON pupils(class_id, username) WHERE class_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pupils_guest_user ON pupils(username) WHERE is_guest = 1;

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode INTEGER NOT NULL,                 -- 1 rewrite, 2 spot the error, 3 upgrade the tag, 4 multiple choice, 5 change the speech, 6 fix the tense
  class_id INTEGER,                      -- NULL = every class
  public INTEGER NOT NULL DEFAULT 1,     -- guests only see public questions
  active INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,                    -- JSON, shape depends on mode
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_mode ON questions(mode, active);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pupil_id INTEGER NOT NULL,
  class_id INTEGER,
  question_id INTEGER NOT NULL,
  mode INTEGER NOT NULL,
  try_no INTEGER NOT NULL DEFAULT 1,
  practice INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  answer TEXT,
  codes TEXT NOT NULL DEFAULT '[]',      -- JSON array of error codes made in this attempt
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_pupil ON attempts(pupil_id, question_id);
CREATE INDEX IF NOT EXISTS attempts_class ON attempts(class_id, ts);

-- Mode 3: the teacher-editable bank of saying verbs.
CREATE TABLE IF NOT EXISTS verbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base TEXT NOT NULL,
  past TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',       -- JSON array, e.g. ["scared","soft"]
  banned INTEGER NOT NULL DEFAULT 0,     -- said / asked: too plain for Mode 3
  source TEXT NOT NULL DEFAULT 'teacher',-- seed | teacher | ai
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verb_forms (
  form TEXT PRIMARY KEY,                 -- lowercase base / past / 3rd person / -ing
  verb_id INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS verb_forms_verb ON verb_forms(verb_id);

-- Every word the AI has judged, so each word costs at most one AI call, ever.
CREATE TABLE IF NOT EXISTS verb_ai (
  word TEXT PRIMARY KEY,
  base TEXT,
  past TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  is_speech INTEGER NOT NULL DEFAULT 0,
  conf REAL NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL,                  -- ai_ok | pending | auto_rejected | approved | rejected
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verb_ai_status ON verb_ai(status, ts);

-- Dash Express (v1.2): one row per finished route. Tips (bonus XP), stars and Big Delivery results live here;
-- the questions and attempts tables are unchanged. started_at makes a double-submitted route harmless.
CREATE TABLE IF NOT EXISTS route_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pupil_id INTEGER NOT NULL,
  class_id INTEGER,
  kind TEXT NOT NULL,                    -- route | big | rush | mode
  district INTEGER NOT NULL DEFAULT 0,   -- 1-12, 0 when the route is not in one district
  mode INTEGER NOT NULL DEFAULT 0,       -- for kind = mode
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

-- Who created a class. The creator owns it: they can delete it, and no other teacher can.
-- Classes made by the super admin have no owner, so only the super admin can delete them.
CREATE TABLE IF NOT EXISTS class_owners (
  class_id INTEGER PRIMARY KEY,
  teacher_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS class_owners_teacher ON class_owners(teacher_id);

-- Settings a pupil chose for themselves (garage look, sound, punctuation keys), so they follow them to any device.
CREATE TABLE IF NOT EXISTS pupil_prefs (
  pupil_id INTEGER PRIMARY KEY,
  prefs TEXT NOT NULL DEFAULT '{}',          -- JSON: { garage: {paint, helmet, sticker}, sound: bool, keys: bool|null }
  updated_at INTEGER NOT NULL
);
