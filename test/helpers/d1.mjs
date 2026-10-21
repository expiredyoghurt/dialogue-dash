// A tiny D1 look-alike over node:sqlite, so the real pupil.js / teacher.js code can run in tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

export function makeDb({ seeds = [] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../../schema.sql'));
  for (const f of seeds) db.exec(read('../../' + f));
  const stmt = (sql) => {
    let params = [];
    const s = {
      bind(...p) {
        params = p;
        return s;
      },
      async all() {
        return { results: db.prepare(sql).all(...params) };
      },
      async first() {
        return db.prepare(sql).get(...params) ?? null;
      },
      async run() {
        db.prepare(sql).run(...params);
        return { success: true };
      },
      _run() {
        return db.prepare(sql).run(...params);
      },
    };
    return s;
  };
  const d1 = {
    prepare: stmt,
    async batch(list) {
      for (const s of list) s._run();
      return [];
    },
  };
  return { db, d1 };
}

export const pupilCtx = { id: 1, name: 'Test', classId: null, guest: true, className: 'Guest' };
export const req = (body) => new Request('http://x/api/answer', { method: 'POST', body: JSON.stringify(body) });
