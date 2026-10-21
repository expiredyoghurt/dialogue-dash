// Tests for seed-new-types.sql and seed-new-types-extra.sql (the v1.1 question types).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './helpers/d1.mjs';
import { checkMode1 } from '../src/engine.js';
import { checkMode4, checkMode5, checkFix, tapTargets, allVariants } from '../src/modes.js';
import { VERSION } from '../src/version.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const REQ = read('seed-new-types.sql');
const EXTRA = read('seed-new-types-extra.sql');
const parse = (sql) =>
  sql
    .split('\n')
    .filter((l) => l.startsWith('INSERT'))
    .map((l) => {
      const m = l.match(/SELECT (\d), NULL, 1, 1, '(.*)', \d+ WHERE NOT EXISTS/s);
      assert.ok(m, 'unparseable: ' + l.slice(0, 80));
      return { mode: +m[1], data: JSON.parse(m[2].replace(/''/g, "'")) };
    });
const req = parse(REQ);
const extra = parse(EXTRA);
const all = [...req, ...extra];

// ---- the nine from the brief ----
test('the required file holds exactly the nine questions from the brief', () => {
  assert.equal(req.length, 9);
  assert.deepEqual(req.map((q) => q.mode), [1, 1, 4, 5, 5, 6, 4, 4, 4]);
});
test('required content matches the brief, with typographic quotes in every stored key', () => {
  const [a, b, c, d, e, f, g, h, i] = req.map((q) => q.data);
  assert.equal(a.correct, '“Did you tell Mei the bridge is closed?” asked Raj.\n“No, I never said that,” replied Tally.');
  assert.equal(a.prompt, '“Did you tell Mei the bridge is closed?” asked Raj. “No, I never said that,” replied Tally.');
  assert.equal(a.instruction, 'Give each speaker their own line.');
  assert.equal(a.lines, true);
  assert.equal(a.floors, undefined);
  assert.equal(a.tip, 'A new speaker means a new line. It’s how readers keep track of who’s talking.');
  assert.equal(b.correct, 'Mei looked at the clock. “We’re going to be late,” groaned Mei.');
  assert.equal(b.prompt, 'mei looked at the clock we’re going to be late groaned mei');
  assert.equal(b.beat, true);
  assert.equal(c.stem, '“Open the gate!” said the guard. Which verb is the best upgrade for “said”?');
  assert.deepEqual(c.options.map((o) => o.text), ['whispered', 'bellowed', 'giggled', 'wondered']);
  assert.deepEqual(c.correct.map((id) => c.options.find((o) => o.id === id).text), ['bellowed']);
  assert.equal(d.prompt, '“I am going to the Warren,” said Brisk.');
  assert.deepEqual(d.accepted, ['Brisk said (that) she was going to the Warren.']);
  assert.equal(d.floors, undefined);
  assert.equal(e.prompt, 'Daisy told Erica that she would ring the bell the next day.');
  assert.ok(e.accepted.includes('Daisy said to Erica, “I will ring the bell tomorrow.”'));
  assert.ok(e.accepted.includes('Daisy told Erica, “I will ring the bell tomorrow.”'));
  assert.ok(e.accepted.includes('Daisy said to Erica, “I’ll ring the bell tomorrow.”'));
  assert.equal(f.sentence, 'The knight walked into the hall and sees a crown.');
  assert.deepEqual(f.wrong, ['sees']);
  assert.deepEqual(f.fixes, ['saw']);
  // 7, 8, 9: one passage, one group, three rows
  for (const q of [g, h, i]) assert.equal(q.group, 'rbtl-ilse');
  assert.equal(new Set([g, h, i].map((q) => q.context)).size, 1);
  assert.match(g.context, /^“I’m fine,” said Ilse, folding her arms\.\nWren smiled gently\. “You’ve been staring at that door for an hour\.”\n“It’s just a door,” Ilse muttered, but she did not turn around\.$/);
  assert.deepEqual(g.options.map((o) => o.text), ['calm', 'worried but hiding it', 'bored', 'angry with Wren']);
  assert.equal(g.options.find((o) => o.id === g.correct[0]).text, 'worried but hiding it');
  assert.equal(h.options.length, 6);
  assert.equal(h.pick, 2);
  assert.equal(h.correct.length, 4);
  assert.deepEqual(h.options.filter((o) => !h.correct.includes(o.id)).map((o) => o.text), ['Wren smiled.', 'The door is mentioned.']);
  assert.equal(i.options.find((o) => o.id === i.correct[0]).text, 'To show she understands and isn’t scolding');
});
test('there are 45 extras: five of each type, five new passages with three questions each', () => {
  assert.equal(extra.length, 45);
  const kind = (q) => (q.mode === 1 ? (q.data.lines ? 'lines' : 'beat') : q.mode === 4 ? (q.data.group ? (q.data.pick === 2 ? 'pick2' : q.data.code === 'MC_INFER' ? 'why-or-feel' : 'x') : 'verb') : q.mode === 5 ? (/reported/.test(q.data.instruction) ? 'direct-to-reported' : 'reported-to-direct') : 'tense');
  const n = {};
  for (const q of extra) n[kind(q)] = (n[kind(q)] || 0) + 1;
  assert.equal(n.lines, 5);
  assert.equal(n.beat, 5);
  assert.equal(n.verb, 5);
  assert.equal(n['direct-to-reported'], 5);
  assert.equal(n['reported-to-direct'], 5);
  assert.equal(n.tense, 5);
  assert.equal(n.pick2, 5);
  assert.equal(n['why-or-feel'], 10);
  const groups = {};
  for (const q of extra) if (q.data.group) (groups[q.data.group] ||= []).push(q);
  assert.equal(Object.keys(groups).length, 5);
  for (const g of Object.values(groups)) {
    assert.equal(g.length, 3);
    assert.equal(new Set(g.map((q) => q.data.context)).size, 1);
    assert.deepEqual(g.map((q) => q.data.pick), [1, 2, 1]);
  }
});
test('extras are all different from the required questions and from each other', () => {
  const key = (q) => JSON.stringify([q.mode, q.data.correct, q.data.stem, q.data.context, q.data.prompt, q.data.instruction, q.data.sentence]);
  assert.equal(new Set(all.map(key)).size, all.length);
});

// ---- every key passes its own checker; no distractor does ----
test('every seeded key passes its own checker and no distractor or unchanged prompt does', () => {
  for (const { mode, data: d } of all) {
    const label = JSON.stringify(d).slice(0, 70);
    if (mode === 1) {
      assert.equal(checkMode1(d, d.correct).correct, true, label);
      assert.equal(checkMode1(d, d.prompt).correct, false, label);
      if (d.lines) {
        assert.deepEqual(checkMode1(d, d.prompt).codes.filter((c, i, a) => a.indexOf(c) === i), ['NO_NEW_LINE'], label);
        assert.equal(checkMode1(d, d.correct.replace(/\n/g, ' ')).correct, false, label);
        assert.equal(checkMode1(d, d.correct.replace(/[“”]/g, '"')).correct, true, label);
      }
      if (d.beat) {
        const comma = checkMode1(d, d.correct.replace('. “', ', “'));
        assert.deepEqual(comma.codes, ['ACTION_COMMA'], label);
      }
    } else if (mode === 4) {
      const ids = d.options.map((o) => o.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(d.correct.every((id) => ids.includes(id)));
      assert.ok(d.explanation.length > 20, label);
      if (d.pick === 1) {
        for (const id of ids) assert.equal(checkMode4(d, [id]).correct, d.correct.includes(id), label + ' ' + id);
      } else {
        for (let x = 0; x < ids.length; x++)
          for (let y = x + 1; y < ids.length; y++) assert.equal(checkMode4(d, [ids[x], ids[y]]).correct, d.correct.includes(ids[x]) && d.correct.includes(ids[y]), label);
      }
      for (const o of d.options) if (!d.correct.includes(o.id)) assert.ok(o.why, 'distractor without a why: ' + o.text);
    } else if (mode === 5) {
      const vs = allVariants(d);
      assert.ok(vs.length >= 1);
      for (const v of vs) {
        assert.equal(checkMode5(d, v).correct, true, v);
        assert.equal(checkMode5(d, v.replace(/[“”]/g, '"').replace(/’/g, "'")).correct, true, v);
        assert.equal(checkMode5(d, v.toLowerCase()).correct, true, v);
        assert.equal(checkMode5(d, v.replace(/ /g, '   ')).correct, true, v);
      }
      assert.equal(checkMode5(d, d.prompt).correct, false, d.prompt);
    } else if (mode === 6) {
      assert.ok(tapTargets(d).length >= 1);
      for (const f of d.fixes) assert.equal(checkFix(d, f).ok, true, f);
      for (const w of d.wrong) assert.equal(checkFix(d, w).ok, false, w);
    }
  }
});
test('no stored string uses straight quotes (keys are typographic); apostrophes are ’', () => {
  const walk = (v, path, out) => {
    if (typeof v === 'string') {
      if (/["']/.test(v)) out.push(path + ': ' + v);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']', out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path + '.' + k, out);
  };
  const bad = [];
  all.forEach((q, i) => walk(q.data, '#' + i, bad));
  assert.deepEqual(bad, []);
});

// ---- additive, idempotent, never touches existing data ----
test('both seed files are INSERT-only, each guarded by WHERE NOT EXISTS', () => {
  for (const sql of [REQ, EXTRA]) {
    const stmts = sql.split('\n').filter((l) => l && !l.startsWith('--'));
    assert.ok(stmts.length > 0);
    for (const l of stmts) {
      assert.match(l, /^INSERT INTO questions \(mode, class_id, public, active, data, created_at\) SELECT /);
      assert.match(l, /WHERE NOT EXISTS \(SELECT 1 FROM questions WHERE mode = \d AND /);
      assert.ok(!/\b(UPDATE|DELETE|DROP|REPLACE|ALTER|TRUNCATE)\b/i.test(l.replace(/'(?:[^']|'')*'/g, "''")), 'non-additive statement');
    }
  }
});
test('the migration is idempotent and changes no tables', () => {
  const mig = read('migrations/0002_new_question_types.sql');
  const code = mig.split('\n').filter((l) => l && !l.startsWith('--')).join('\n');
  assert.ok(!/\b(ALTER|DROP|DELETE|UPDATE|CREATE TABLE)\b/i.test(code));
  const { db } = makeDb();
  db.exec(mig);
  db.exec(mig);
  assert.equal(db.prepare("SELECT v FROM meta WHERE k = 'schema_version'").get().v, 2);
});
test('seeding a live-looking database adds only the new rows, twice is a no-op, existing rows are untouched', () => {
  const { db } = makeDb({ seeds: ['questions-450.sql'] });
  db.prepare("INSERT INTO questions (mode, class_id, public, active, data, created_at) VALUES (1, NULL, 1, 1, ?, 2)").run(JSON.stringify({ correct: '“Hi,” said Tom.', prompt: 'hi said Tom' }));
  db.prepare("INSERT INTO questions (mode, class_id, public, active, data, created_at) VALUES (5, 1, 0, 1, ?, 3)").run(JSON.stringify({ prompt: 'teacher made', instruction: 'x', accepted: ['y'] }));
  db.prepare('UPDATE questions SET active = 0 WHERE id = 4').run();
  const snap = () => db.prepare('SELECT id, mode, class_id, public, active, data, created_at FROM questions ORDER BY id').all();
  const before = snap();
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  db.exec(REQ);
  assert.equal(count(), before.length + 9);
  assert.deepEqual(snap().slice(0, before.length), before);
  db.exec(REQ);
  assert.equal(count(), before.length + 9);
  db.exec(EXTRA);
  assert.equal(count(), before.length + 9 + 45);
  db.exec(EXTRA);
  db.exec(REQ);
  assert.equal(count(), before.length + 9 + 45);
  assert.deepEqual(snap().slice(0, before.length), before);
  // the three passage questions land on consecutive ids, passage order
  const ilse = db.prepare("SELECT id FROM questions WHERE json_extract(data, '$.group') = 'rbtl-ilse' ORDER BY id").all().map((r) => r.id);
  assert.equal(ilse.length, 3);
  assert.deepEqual(ilse, [ilse[0], ilse[0] + 1, ilse[0] + 2]);
});
test('the existing 450-question bank file is unchanged in size and shape', () => {
  assert.equal(read('questions-450.sql').split('\n').filter((l) => l.startsWith('INSERT')).length, 450);
});
test('version is bumped consistently', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, VERSION);
  assert.notEqual(VERSION, '1.0.0');
  assert.match(read('CHANGELOG.md'), new RegExp('## ' + VERSION.replace(/\./g, '\\.')));
});
