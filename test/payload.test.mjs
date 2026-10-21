// Runs the real Worker code (pupil.js, teacher.js) against an in-memory SQLite database:
//  - no answer data may leave in a question payload,
//  - every seeded question can be answered correctly through /api/answer, and wrong answers are marked wrong,
//  - teacher authoring round-trips through the same validators.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, pupilCtx, req } from './helpers/d1.mjs';
import * as pupil from '../src/pupil.js';
import { HttpError } from '../src/util.js';
import { teacherRoute } from '../src/teacher.js';
import { allVariants, tapTargets, fixedSentence } from '../src/modes.js';

const SEEDS = ['questions-450.sql', 'seed-new-types.sql', 'seed-new-types-extra.sql'];
const env = () => {
  const { db, d1 } = makeDb({ seeds: SEEDS });
  db.exec("INSERT INTO meta (k, v) VALUES ('open_districts', 1)"); // these tests are about content, not about levels
  return { db, env: { DB: d1 } };
};
const listAll = async (e, search = '') => (await (await pupil.listQuestions(e, pupilCtx, new URL('http://x/api/questions' + search))).json()).questions;
const rows = (db) => db.prepare('SELECT id, mode, data FROM questions').all().map((r) => ({ ...r, data: JSON.parse(r.data) }));
const answer = async (e, body) => (await pupil.answer(req(body), e, pupilCtx)).json();
const answerRaw = async (e, body) => {
  try {
    const r = await pupil.answer(req(body), e, pupilCtx);
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};

const ALLOWED = {
  1: ['prompt', 'instruction', 'lines', 'group'],
  2: ['words', 'gaps', 'places'],
  3: ['speaker', 'line', 'context', 'hint'],
  4: ['stem', 'context', 'options', 'pick', 'group'],
  5: ['prompt', 'instruction', 'group'],
  6: ['words', 'gaps', 'group'],
};

test('payloads carry only whitelisted fields (no key, accepted answers, ids of correct options, tips, explanations)', async () => {
  const { db, env: e } = env();
  const qs = await listAll(e);
  assert.ok(qs.length >= 450 + 54);
  const seenModes = new Set();
  for (const q of qs) {
    seenModes.add(q.mode);
    assert.deepEqual(Object.keys(q).sort(), ['id', 'mode', 'p', 'rule', 'status']);
    for (const k of Object.keys(q.p)) assert.ok(ALLOWED[q.mode].includes(k), `mode ${q.mode} payload has unexpected field "${k}"`);
    if (q.mode === 4) for (const o of q.p.options) assert.deepEqual(Object.keys(o).sort(), ['id', 'text']);
    if (q.mode === 6) for (const g of q.p.gaps) assert.deepEqual(Object.keys(g).sort(), ['nl', 'raw']);
  }
  assert.deepEqual([...seenModes].sort(), [1, 2, 3, 4, 5, 6]);
  // none of the answer-bearing strings of any new-type question appears in the whole response
  const body = JSON.stringify(qs);
  for (const r of rows(db)) {
    const d = r.data;
    const secrets = [];
    if (r.mode === 4) {
      secrets.push(d.explanation, ...d.options.map((o) => o.why).filter(Boolean));
    }
    if (r.mode === 5) secrets.push(...allVariants(d), ...(d.tip ? [d.tip] : []));
    if (r.mode === 6) secrets.push(d.tip, fixedSentence(d, tapTargets(d)[0]));
    if (r.mode === 1 && d.tip) secrets.push(d.tip);
    if (r.mode === 1 && (d.lines || d.beat)) secrets.push(d.correct);
    for (const s of secrets.filter(Boolean)) assert.ok(!body.includes(JSON.stringify(s).slice(1, -1)), 'leaked: ' + s.slice(0, 60));
  }
  // and the field names that only teachers may see never appear as JSON keys
  for (const k of ['correct', 'accepted', 'fixes', 'wrong', 'explanation', 'why', 'tip', 'alts', 'code', 'target']) assert.ok(!body.includes(`"${k}":`), `"${k}" key leaked`);
});
test('options are shuffled per request and the payload order does not follow the authored order', async () => {
  const { env: e } = env();
  const orders = new Set();
  for (let i = 0; i < 12; i++) {
    const q = (await listAll(e, '?mode=4')).find((x) => x.p.stem.startsWith('Which TWO details show she isn’t'));
    orders.add(q.p.options.map((o) => o.id).join(''));
  }
  assert.ok(orders.size > 1, 'options came back in the same order every time');
});
test('the verb question and passage trio are visible; siblings share a group in the payload', async () => {
  const { env: e } = env();
  const qs = await listAll(e, '?mode=4');
  const ilse = qs.filter((q) => q.p.group === 'rbtl-ilse');
  assert.equal(ilse.length, 3);
  assert.equal(new Set(ilse.map((q) => q.p.context)).size, 1);
});
test('wrong, non-final answers reveal nothing about the key', async () => {
  const { db, env: e } = env();
  const find = (mode, f) => rows(db).find((r) => r.mode === mode && f(r.data));
  const gate = find(4, (d) => d.stem.startsWith('“Open the gate!”'));
  const w4 = await answer(e, { qid: gate.id, choice: ['a'], tryNo: 1 });
  assert.equal(w4.correct, false);
  assert.equal(w4.final, false);
  for (const k of ['reveal', 'explanation']) assert.equal(w4[k], undefined, k);
  assert.deepEqual(w4.wrongIds, ['a']);
  assert.deepEqual(Object.keys(w4.whys), ['a']);
  const warren = find(5, (d) => d.prompt.includes('Warren'));
  const w5 = await answer(e, { qid: warren.id, answer: 'Brisk said she is going to the Warren.', tryNo: 1 });
  assert.equal(w5.correct, false);
  for (const k of ['reveal', 'tip']) assert.equal(w5[k], undefined, k);
  assert.ok(!JSON.stringify(w5).includes('was going'));
  const knight = find(6, (d) => d.sentence.startsWith('The knight'));
  const m6 = await answer(e, { qid: knight.id, phase: 1, tap: 0, tapTry: 1 });
  assert.deepEqual(m6, { phase: 1, hit: false });
  const f6 = await answer(e, { qid: knight.id, phase: 2, tap: 7, tapTry: 1, fix: 'see', fixTry: 1 });
  assert.equal(f6.correct, false);
  for (const k of ['reveal', 'sentence', 'tip']) assert.equal(f6[k], undefined, k);
  const lines = find(1, (d) => d.lines);
  const w1 = await answer(e, { qid: lines.id, answer: lines.data.prompt, tryNo: 1 });
  assert.equal(w1.correct, false);
  assert.equal(w1.reveal, undefined);
  assert.equal(w1.tip, undefined);
  assert.deepEqual(w1.errors.map((x) => x.code), ['NO_NEW_LINE']);
});
test('a non-answer, such as the wrong number of choices, is an error and awards nothing', async () => {
  const { db, env: e } = env();
  const two = rows(db).find((r) => r.mode === 4 && r.data.pick === 2);
  for (const choice of [[], ['a'], ['a', 'b', 'c'], ['a', 'a'], ['zz', 'a']]) {
    const r = await answerRaw(e, { qid: two.id, choice });
    assert.equal(r.status, 400, JSON.stringify(choice));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n, 0);
  const knight = rows(db).find((r) => r.mode === 6);
  assert.equal((await answerRaw(e, { qid: knight.id, phase: 2, tap: 0, tapTry: 1, fix: 'saw', fixTry: 1 })).status, 400);
});

test('every new-type question can be answered correctly, XP is awarded, and wrong answers are marked wrong', async () => {
  const { db, env: e } = env();
  const newRows = rows(db).filter((r) => (r.mode === 1 && (r.data.lines || r.data.beat)) || r.mode >= 4);
  assert.equal(newRows.length, 54);
  for (const r of newRows) {
    const d = r.data;
    let res;
    if (r.mode === 1) res = await answer(e, { qid: r.id, answer: d.correct, tryNo: 1 });
    else if (r.mode === 4) {
      const ids = d.options.map((o) => o.id);
      const wrongId = ids.find((id) => !d.correct.includes(id));
      const bad = d.pick === 1 ? [wrongId] : [d.correct[0], wrongId];
      assert.equal((await answer(e, { qid: r.id, choice: bad, tryNo: 1 })).correct, false);
      res = await answer(e, { qid: r.id, choice: d.correct.slice(0, d.pick), tryNo: 1 });
    } else if (r.mode === 5) res = await answer(e, { qid: r.id, answer: allVariants(d).at(-1), tryNo: 1 });
    else {
      const t = tapTargets(d)[0];
      assert.equal((await answer(e, { qid: r.id, phase: 1, tap: t, tapTry: 1 })).hit, true);
      res = await answer(e, { qid: r.id, phase: 2, tap: t, tapTry: 1, fix: d.fixes.at(-1), fixTry: 1 });
    }
    assert.equal(res.correct, true, JSON.stringify(d).slice(0, 80));
    assert.ok(res.xp > 0);
    assert.ok(res.xpTotal > 0);
    if (r.mode === 4) assert.ok(res.explanation);
    if (r.mode !== 4 && d.tip) assert.ok(res.tip, 'tip missing after a correct answer');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE correct = 1').get().n, 54);
});
test('XP tables: multiple choice 6 then 3, tense fix 3+6 at best, transform 10 / 6 / 3', async () => {
  const { db, env: e } = env();
  const mc = rows(db).find((r) => r.mode === 4 && r.data.pick === 1);
  assert.equal((await answer(e, { qid: mc.id, choice: mc.data.correct, tryNo: 1 })).xp, 6);
  assert.equal((await answer(e, { qid: mc.id, choice: mc.data.correct, tryNo: 2 })).xp, 3);
  const tr = rows(db).find((r) => r.mode === 5);
  const a = allVariants(tr.data)[0];
  assert.deepEqual([1, 2, 3].map(() => 0).length, 3);
  for (const [t, xp] of [[1, 10], [2, 6], [3, 3]]) assert.equal((await answer(e, { qid: tr.id, answer: a, tryNo: t })).xp, xp);
  const t6 = rows(db).find((r) => r.mode === 6);
  const tg = tapTargets(t6.data)[0];
  assert.equal((await answer(e, { qid: t6.id, phase: 2, tap: tg, tapTry: 1, fix: t6.data.fixes[0], fixTry: 1 })).xp, 9);
  assert.equal((await answer(e, { qid: t6.id, phase: 2, tap: tg, tapTry: 2, fix: t6.data.fixes[0], fixTry: 2 })).xp, 5);
  assert.equal((await answer(e, { qid: t6.id, phase: 2, tap: tg, tapTry: 3, fix: t6.data.fixes[0], fixTry: 3 })).xp, 2);
});
test('final tries reveal the answer; give-up works; analytics codes are recorded', async () => {
  const { db, env: e } = env();
  const gate = rows(db).find((r) => r.mode === 4 && r.data.stem.startsWith('“Open the gate!”'));
  await answer(e, { qid: gate.id, choice: ['c'], tryNo: 1 });
  const fin = await answer(e, { qid: gate.id, choice: ['d'], tryNo: 2 });
  assert.equal(fin.final, true);
  assert.deepEqual(fin.reveal.correct, gate.data.correct);
  assert.ok(fin.explanation);
  const codes = db.prepare('SELECT codes FROM attempts ORDER BY id').all().map((r) => r.codes);
  assert.deepEqual(codes, ['["MC_VERB"]', '["MC_VERB"]']);
  const warren = rows(db).find((r) => r.mode === 5 && r.data.prompt.includes('Warren'));
  const g = await answer(e, { qid: warren.id, giveUp: true, tryNo: 1 });
  assert.equal(g.final, true);
  assert.equal(g.reveal, 'Brisk said (that) she was going to the Warren.');
  const knight = rows(db).find((r) => r.mode === 6 && r.data.sentence.startsWith('The knight'));
  const miss = await answer(e, { qid: knight.id, phase: 1, tap: 0, tapTry: 2 });
  assert.equal(miss.hit, false);
  assert.equal(miss.reveal, 7);
  const f = await answer(e, { qid: knight.id, phase: 2, tap: 7, tapTry: 3, fix: 'saw', fixTry: 1 });
  assert.equal(f.correct, true);
  assert.equal(f.xp, 6); // no credit for the tap it was shown
  assert.deepEqual(JSON.parse(db.prepare('SELECT codes FROM attempts ORDER BY id DESC LIMIT 1').get().codes), ['TENSE_NOT_SPOTTED']);
});
test('/api/me counts all six modes and /api/meta carries the new rules and the version', async () => {
  const { env: e } = env();
  const me = await (await pupil.me(e, pupilCtx)).json();
  assert.deepEqual(Object.keys(me.modes).sort(), ['1', '2', '3', '4', '5', '6']);
  assert.equal(me.modes[4].total, 4 + 20);
  assert.equal(me.modes[5].total, 2 + 10);
  assert.equal(me.modes[6].total, 1 + 5);
  const meta = await (await pupil.meta()).json();
  for (const r of [8, 9, 10, 11, 12]) assert.ok(meta.rules[r].title);
  for (const c of ['NO_NEW_LINE', 'ACTION_COMMA', 'MC_VERB', 'MC_INFER', 'SPEECH_WORDS', 'TENSE_NOT_SPOTTED']) assert.ok(meta.codes[c]);
  assert.match(meta.version, /^\d+\.\d+\.\d+$/);
});

// ---------- teacher authoring goes through the same checks ----------
const tcall = async (e, method, path, body) => {
  try {
    const r = await teacherRoute(new Request('http://x/api/t' + path, { method, body: body ? JSON.stringify(body) : undefined }), e, new URL('http://x/api/t' + path));
    return { status: r.status, body: await r.json() };
  } catch (x) {
    if (x instanceof HttpError) return { status: x.status, body: { error: x.message } };
    throw x;
  }
};
test('teacher: create, preview, edit and remove questions in every new mode', async () => {
  const { db, env: e } = env();
  const cases = [
    { mode: 1, data: { correct: '“Is it ready?” asked Sam.\n“Almost,” said Jo.', prompt: '“Is it ready?” asked Sam. “Almost,” said Jo.', lines: true, instruction: 'Give each speaker their own line.', tip: 'Tip.', rule: 8 } },
    { mode: 1, data: { correct: 'Sam sat down. “I’m tired,” he yawned.', prompt: 'sam sat down i’m tired he yawned', beat: true } },
    { mode: 4, data: { stem: 'Pick one', options: [{ text: 'a' }, { text: 'b', why: 'no' }], correct: ['a'], pick: 1, explanation: 'Because.', code: 'MC_VERB' } },
    { mode: 5, data: { prompt: '“I am here,” said Tom.', instruction: 'Rewrite as reported speech.', accepted: ['Tom said (that) he was here.'] } },
    { mode: 6, data: { sentence: 'The cat jumped and lands softly.', wrong: 'lands', fixes: 'landed' } },
  ];
  for (const c of cases) {
    const pv = await tcall(e, 'POST', '/questions/preview', c);
    assert.equal(pv.body.ok, true, JSON.stringify(pv.body));
    const created = await tcall(e, 'POST', '/questions', c);
    assert.equal(created.status, 200);
    const id = created.body.id;
    const edited = await tcall(e, 'PUT', '/questions/' + id, { data: c.data });
    assert.equal(edited.status, 200);
    const list = (await tcall(e, 'GET', '/questions?mode=' + c.mode)).body.questions;
    assert.ok(list.some((q) => q.id === id));
    assert.equal((await tcall(e, 'DELETE', '/questions/' + id)).status, 200);
    assert.ok(!(await tcall(e, 'GET', '/questions?mode=' + c.mode)).body.questions.some((q) => q.id === id));
    assert.equal(db.prepare('SELECT active FROM questions WHERE id = ?').get(id).active, 0);
  }
});
test('teacher: bad questions are refused with a helpful message', async () => {
  const { env: e } = env();
  const bad = [
    [{ mode: 1, data: { correct: '“A,” said B.', prompt: '“A,” said B.', lines: true } }, /line break/],
    [{ mode: 1, data: { correct: '“A b c,” said Bo.\n“D e f,” said Cy.', prompt: '“A b c,” said Bo.\n“D e f,” said Cy.', lines: true } }, /already correct/],
    [{ mode: 4, data: { stem: 's', options: [{ text: 'a' }, { text: 'b' }], correct: ['a', 'b'], explanation: 'e' } }, /must be wrong/],
    [{ mode: 5, data: { prompt: 'p q', instruction: 'i', accepted: [] } }, /at least one/],
    [{ mode: 6, data: { sentence: 'The cat sat down now.', wrong: 'dog', fixes: 'x' } }, /isn’t in the sentence/],
    [{ mode: 7, data: {} }, /Unknown question type/],
  ];
  for (const [body, re] of bad) {
    const r = await tcall(e, 'POST', '/questions', body);
    assert.equal(r.status, 400);
    assert.match(r.body.error, re);
  }
});
test('teacher: analytics lists new-mode questions and codes', async () => {
  const { db, env: e } = env();
  db.prepare("INSERT INTO pupils (id, class_id, name, username, is_guest, created_at) VALUES (1, NULL, 'guest_0001', 'guest_0001', 1, 1)").run();
  const gate = rows(db).find((r) => r.mode === 4 && r.data.stem.startsWith('“Open the gate!”'));
  for (let i = 0; i < 3; i++) await pupil.answer(req({ qid: gate.id, choice: ['a'], tryNo: 1 }), e, pupilCtx);
  const r = await tcall(e, 'GET', '/analytics?class=guests&days=30');
  assert.equal(r.status, 200);
  assert.ok(r.body.codes.some((c) => c.code === 'MC_VERB' && c.total === 3));
  assert.ok(r.body.hardest.some((h) => h.mode === 4 && h.text.startsWith('“Open the gate!”')));
});
