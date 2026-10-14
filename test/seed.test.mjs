// Checks questions-450.sql: counts, and that it is safe on a fresh database, on one already holding
// questions 1-35, on one with teacher-added questions, and when run repeatedly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const qsql = readFileSync(new URL('../questions-450.sql', import.meta.url), 'utf8');
const lines = qsql.split('\n').filter((l) => l.startsWith('INSERT'));
const parse = (l) => {
  const m = l.match(/SELECT (\d), NULL, 1, 1, '(.*)', \d+ WHERE/s);
  return { mode: +m[1], data: JSON.parse(m[2].replace(/''/g, "'")) };
};
const fresh = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
};
const count = (db, where = '1=1') => db.prepare(`SELECT COUNT(*) AS n FROM questions WHERE ${where}`).get().n;

test('the file holds 150 unique questions per mode', () => {
  const qs = lines.map(parse);
  for (const m of [1, 2, 3]) {
    const mine = qs.filter((q) => q.mode === m);
    assert.equal(mine.length, 150, `mode ${m}`);
    const keys = new Set(mine.map((q) => (m === 3 ? q.data.speaker + '|' + q.data.line : q.data.correct)));
    assert.equal(keys.size, 150, `mode ${m} unique`);
  }
});

test('fresh database gets all 450, and re-running adds nothing', () => {
  const db = fresh();
  db.exec(qsql);
  assert.equal(count(db), 450);
  db.exec(qsql);
  assert.equal(count(db), 450);
});

test('a database that already has questions 1-35 (fixed ids) is topped up without touching them', () => {
  const db = fresh();
  const qs = lines.map(parse);
  const ins = db.prepare("INSERT INTO questions (id, mode, class_id, public, active, data, created_at) VALUES (?, ?, NULL, 1, 1, ?, 1)");
  qs.slice(0, 35).forEach((q, i) => ins.run(i + 1, q.mode, JSON.stringify(q.data)));
  // a teacher-added question lands on id 36, and one seed question was removed (inactive) by a teacher
  db.prepare("INSERT INTO questions (mode, class_id, public, active, data, created_at) VALUES (1, NULL, 1, 1, ?, 2)").run(JSON.stringify({ correct: '“Hi,” said Tom.', prompt: 'hi said Tom' }));
  db.prepare('UPDATE questions SET active = 0 WHERE id = 4').run();
  const before = db.prepare('SELECT id, data, active FROM questions WHERE id <= 36 ORDER BY id').all();
  db.exec(qsql);
  assert.equal(count(db), 36 + (450 - 35));
  assert.deepEqual(db.prepare('SELECT id, data, active FROM questions WHERE id <= 36 ORDER BY id').all(), before);
  db.exec(qsql);
  assert.equal(count(db), 36 + (450 - 35));
});
