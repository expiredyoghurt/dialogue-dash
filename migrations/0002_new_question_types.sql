-- Dialogue Dash v1.1 migration: new question types (Mode 4 multiple choice, Mode 5 change the speech,
-- Mode 6 fix the tense) plus line-break and action-beat options on Mode 1.
--
-- NO TABLE CHANGES ARE NEEDED. questions.mode is a plain integer with no CHECK constraint, and every new
-- field (lines, beat, options, accepted, group, floors ...) lives inside the existing questions.data JSON.
-- ALTER TABLE ... ADD COLUMN cannot be written idempotently in D1, so this release deliberately avoids it.
--
-- This file only records the schema level, and is safe to run any number of times.
INSERT OR IGNORE INTO meta (k, v) VALUES ('schema_version', 2);
