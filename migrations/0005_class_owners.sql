-- Dash Express 1.4.0: teachers can create their own classes. Safe to run before deploying and any number of times.
-- Who created a class. The creator owns it: they can delete it, and no other teacher can.
-- Classes made by the super admin have no owner, so only the super admin can delete them.
CREATE TABLE IF NOT EXISTS class_owners (
  class_id INTEGER PRIMARY KEY,
  teacher_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS class_owners_teacher ON class_owners(teacher_id);
INSERT INTO meta (k, v) VALUES ('schema_version', 5) ON CONFLICT(k) DO UPDATE SET v = 5;
