// End-to-end API test against a locally running `wrangler dev` (see README / package.json).
//   BASE=http://127.0.0.1:8799 node test/e2e.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8799';
const TUSER = process.env.TUSER || 'Teacher1';
const TPASS = process.env.TPASS || 'Password1';
let pass = 0;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}
const ok = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n      ', e.message);
    process.exitCode = 1;
    throw e;
  }
};

const run = async () => {
  const W = 'flib' + [...Array(8)].map(() => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
  let T, cls, pupilToken, guestToken, guestName, questions;
  const suffix = Math.random().toString(36).slice(2, 6);

  await ok('static page is served', async () => {
    const r = await fetch(BASE + '/');
    assert.equal(r.status, 200);
  });

  await ok('teacher login rejects a wrong password, accepts the right one', async () => {
    assert.equal((await api('POST', '/api/teacher/login', { body: { username: TUSER, password: 'nope' } })).status, 401);
    assert.equal((await api('POST', '/api/teacher/login', { body: { username: 'x', password: TPASS } })).status, 401);
    const r = await api('POST', '/api/teacher/login', { body: { username: TUSER, password: TPASS } });
    assert.equal(r.status, 200);
    T = r.data.token;
    assert.equal((await api('GET', '/api/t/ping')).status, 401);
    assert.equal((await api('GET', '/api/t/ping', { token: T })).status, 200);
  });

  await ok('create a class and add pupils (preview flags duplicates)', async () => {
    const c = await api('POST', '/api/t/classes', { token: T, body: { name: '5 Integrity ' + suffix } });
    assert.equal(c.status, 200);
    cls = c.data.class;
    assert.match(cls.code, /^[A-HJKMNP-Z2-9]{6}$/);
    const pv = await api('POST', `/api/t/classes/${cls.id}/pupils/preview`, { token: T, body: { text: 'Name,Username\nRaj Tan\nRaj Tay\nMei Lin, mei\nBad Name, a\nMei Lin' } });
    assert.equal(pv.status, 200);
    const rows = pv.data.rows;
    assert.equal(rows.length, 5);
    assert.equal(rows[0].username, 'rajt');
    assert.equal(rows[1].username, 'rajt2');
    assert.equal(rows[2].username, 'mei');
    assert.equal(rows[3].status, 'invalid');
    assert.equal(rows[4].username, 'meil');
    const add = await api('POST', `/api/t/classes/${cls.id}/pupils`, { token: T, body: { pupils: rows.filter((r) => r.status === 'ok') } });
    assert.equal(add.data.added, 4);
    const list = await api('GET', `/api/t/classes/${cls.id}/pupils`, { token: T });
    assert.equal(list.data.pupils.length, 4);
    const dup = await api('POST', `/api/t/classes/${cls.id}/pupils`, { token: T, body: { pupils: [{ name: 'Another', username: 'RAJT' }] } });
    assert.equal(dup.data.added, 0);
  });

  await ok('pupil login: wrong code / username fail with the same message; right ones work', async () => {
    const a = await api('POST', '/api/login', { body: { username: 'rajt', code: 'ZZZZZZ' } });
    const b = await api('POST', '/api/login', { body: { username: 'nobody', code: cls.code } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.error, b.data.error);
    const r = await api('POST', '/api/login', { body: { username: ' RajT ', code: cls.code.toLowerCase() } });
    assert.equal(r.status, 200);
    pupilToken = r.data.token;
    assert.equal(r.data.pupil.name, 'Raj Tan');
  });

  await ok('questions list hides the answers', async () => {
    for (const mode of [1, 2, 3]) {
      const r = await api('GET', `/api/questions?mode=${mode}`, { token: pupilToken });
      assert.equal(r.status, 200);
      assert.ok(r.data.questions.length >= 8);
      const text = JSON.stringify(r.data);
      assert.ok(!/"correct"/.test(text));
    }
    questions = (await api('GET', '/api/t/questions', { token: T })).data.questions;
    assert.ok(questions.length >= 35);
    assert.equal((await api('GET', '/api/questions?mode=1')).status, 401);
    assert.equal((await api('GET', '/api/t/questions', { token: pupilToken })).status, 401);
  });

  const q1 = () => questions.find((q) => q.mode === 1 && q.data.correct.startsWith('Raj said'));
  await ok('Mode 1: wrong answers get specific feedback; right answer scores XP', async () => {
    const q = q1();
    let r = await api('POST', '/api/answer', { token: pupilToken, body: { qid: q.id, answer: 'Raj said I want to be a doctor', tryNo: 1 } });
    assert.equal(r.status, 200);
    assert.equal(r.data.correct, false);
    const codes = r.data.errors.map((e) => e.code);
    assert.ok(codes.includes('NO_COMMA_BEFORE') && codes.includes('NO_END_PUNCT') && codes.includes('NO_QUOTES'));
    assert.ok(r.data.errors.every((e) => e.what && e.fix && e.rule >= 0));
    assert.equal(r.data.reveal, undefined);
    r = await api('POST', '/api/answer', { token: pupilToken, body: { qid: q.id, answer: 'Raj said, "I want to be a doctor."', tryNo: 2 } });
    assert.equal(r.data.correct, true);
    assert.equal(r.data.xp, 6);
    assert.ok(r.data.xpTotal >= 6);
  });

  let wrongQ;
  await ok('Mode 1: third wrong try reveals the answer and the question lands in More practice', async () => {
    wrongQ = questions.find((q) => q.mode === 1 && q.data.correct.startsWith('“Watch out'));
    let r;
    for (const t of [1, 2, 3]) r = await api('POST', '/api/answer', { token: pupilToken, body: { qid: wrongQ.id, answer: 'Watch out shouted Kai', tryNo: t } });
    assert.equal(r.data.final, true);
    assert.match(r.data.reveal, /Watch out!/);
    const p = await api('GET', '/api/questions?practice=1', { token: pupilToken });
    assert.ok(p.data.questions.some((q) => q.id === wrongQ.id));
    // fix it in practice
    const fix = await api('POST', '/api/answer', { token: pupilToken, body: { qid: wrongQ.id, answer: '“Watch out!” shouted Kai.', tryNo: 1, practice: true } });
    assert.equal(fix.data.correct, true);
    const p2 = await api('GET', '/api/questions?practice=1', { token: pupilToken });
    assert.ok(!p2.data.questions.some((q) => q.id === wrongQ.id));
  });

  await ok('Mode 2: spot then fix, with partial credit and the hidden answers revealed only at the end', async () => {
    const q = questions.find((q) => q.mode === 2 && q.data.correct.startsWith('“Let’s go to the library'));
    const list = (await api('GET', '/api/questions?mode=2', { token: pupilToken })).data.questions.find((x) => x.id === q.id);
    assert.ok(list.p.words.length > 8 && list.p.gaps.length === list.p.words.length + 1 && list.p.places >= 6);
    assert.ok(!JSON.stringify(list).includes('Let’s'));
    // phase 1: click only two real spots and one wrong one
    const p1 = await api('POST', '/api/answer', { token: pupilToken, body: { qid: q.id, phase: 1, clicked: ['w0', 'g5', 'w3'] } });
    assert.equal(p1.data.phase, 1);
    assert.equal(p1.data.hits, 2);
    assert.deepEqual(p1.data.falseKeys, ['w3']);
    assert.ok(p1.data.slots.length === p1.data.total);
    assert.ok(!p1.data.slots.some((s) => 'expected' in s));
    // phase 2: fix word 0 correctly, gap 5 wrongly, leave the rest blank
    const fixes = { w0: 'Let’s', g5: '",' };
    const p2 = await api('POST', '/api/answer', { token: pupilToken, body: { qid: q.id, phase: 2, clicked: ['w0', 'g5', 'w3'], fixes } });
    assert.equal(p2.data.phase, 2);
    assert.equal(p2.data.correct, false);
    const w0 = p2.data.slots.find((s) => s.key === 'w0');
    const g5 = p2.data.slots.find((s) => s.key === 'g5');
    assert.equal(w0.fixed, true);
    assert.equal(g5.fixed, false);
    assert.ok(g5.residual.some((e) => e.code === 'PUNCT_OUTSIDE'));
    assert.match(p2.data.correctText, /library,”/);
    assert.equal(p2.data.slots.filter((s) => s.fixed).length, p2.data.fixed);
    // now do a perfect run
    const all = p2.data.slots;
    const fixesOk = {};
    for (const s of all) fixesOk[s.key] = s.expected;
    const clickedAll = all.map((s) => s.key);
    const p3 = await api('POST', '/api/answer', { token: pupilToken, body: { qid: q.id, phase: 2, clicked: clickedAll, fixes: fixesOk } });
    assert.equal(p3.data.correct, true, JSON.stringify(p3.data.slots.filter((s) => !s.fixed)));
    assert.equal(p3.data.perfect, true);
    assert.ok(p3.data.xp >= all.length * 5 + 5);
  });

  await ok('Mode 3: list words, banned, tense, mismatch, unknown word (no AI here) goes to review', async () => {
    const q = questions.find((q) => q.mode === 3 && q.data.speaker === 'Mei');
    const ans = (a, tryNo = 1) => api('POST', '/api/answer', { token: pupilToken, body: { qid: q.id, answer: a, tryNo } });
    let r = await ans('said');
    assert.equal(r.data.code, 'WEAK_VERB');
    r = await ans('whisper');
    assert.equal(r.data.code, 'WRONG_TENSE');
    assert.match(r.data.message, /whispered/);
    r = await ans('cheered');
    assert.equal(r.data.code, 'VERB_MISMATCH');
    r = await ans('two words');
    assert.equal(r.data.code, 'VERB_INVALID');
    r = await ans(`${W}ed`);
    assert.equal(r.data.code, 'VERB_PENDING');
    r = await ans('Stammered');
    assert.equal(r.data.correct, true);
    assert.match(r.data.sentence, /“I can’t find my homework,” stammered Mei\./);
    assert.ok(Array.isArray(r.data.more));
    // the unknown word shows in the teacher's review queue; approving makes it work
    const rev = await api('GET', '/api/t/verbs/review', { token: T });
    const item = rev.data.items.find((i) => i.word === `${W}ed`);
    assert.ok(item);
    const ap = await api('POST', `/api/t/verbs/review/${W}ed/approve`, { token: T, body: { base: `${W}`, past: `${W}ed`, tags: ['scared'] } });
    assert.equal(ap.status, 200);
    r = await ans(`${W}ed`);
    assert.equal(r.data.correct, true);
    assert.equal(r.data.xp, 8);
  });

  await ok('guest sign-in gives guest_NNNN, only public questions, and is kept out of class analytics', async () => {
    const g = await api('POST', '/api/guest');
    assert.equal(g.status, 200);
    assert.match(g.data.pupil.name, /^guest_\d{4}$/);
    guestToken = g.data.token;
    guestName = g.data.pupil.name;
    const g2 = await api('POST', '/api/guest');
    assert.notEqual(g2.data.pupil.name, guestName);
    const q = questions.find((q) => q.mode === 1);
    const r = await api('POST', '/api/answer', { token: guestToken, body: { qid: q.id, answer: 'x y z', tryNo: 1 } });
    assert.equal(r.status, 200);
    const a = await api('GET', `/api/t/analytics?class=${cls.id}&days=30`, { token: T });
    assert.ok(!a.data.pupils.some((p) => p.name.startsWith('guest_')));
    const ag = await api('GET', '/api/t/analytics?class=guests&days=30', { token: T });
    assert.ok(ag.data.pupils.some((p) => p.name === guestName && p.attempts === 1));
  });

  await ok('class-only questions are invisible to other classes and guests', async () => {
    const c2 = (await api('POST', '/api/t/classes', { token: T, body: { name: 'Other ' + suffix } })).data.class;
    await api('POST', `/api/t/classes/${c2.id}/pupils`, { token: T, body: { pupils: [{ name: 'Zed', username: 'zed' }] } });
    const created = await api('POST', '/api/t/questions', { token: T, body: { mode: 1, class_id: cls.id, data: { correct: 'Zed shouted, “Run for cover!”' } } });
    assert.equal(created.status, 200);
    const mine = (await api('GET', '/api/questions?mode=1', { token: pupilToken })).data.questions;
    assert.ok(mine.some((q) => q.id === created.data.id));
    const z = (await api('POST', '/api/login', { body: { username: 'zed', code: c2.code } })).data.token;
    assert.ok(!(await api('GET', '/api/questions?mode=1', { token: z })).data.questions.some((q) => q.id === created.data.id));
    assert.ok(!(await api('GET', '/api/questions?mode=1', { token: guestToken })).data.questions.some((q) => q.id === created.data.id));
    assert.equal((await api('POST', '/api/answer', { token: z, body: { qid: created.data.id, answer: 'x', tryNo: 1 } })).status, 404);
  });

  await ok('teacher can add questions of every type; bad input is explained', async () => {
    const pv = await api('POST', '/api/t/questions/preview', { token: T, body: { mode: 1, data: { correct: '“Quiet, please,” whispered Mrs Lee.' } } });
    assert.equal(pv.data.ok, true);
    assert.equal(pv.data.preview.prompt, 'Quiet please whispered Mrs Lee');
    const noQuotes = await api('POST', '/api/t/questions/preview', { token: T, body: { mode: 1, data: { correct: 'Raj said hello there' } } });
    assert.equal(noQuotes.data.ok, false);
    assert.match(noQuotes.data.problem, /speech marks/);
    const m2 = await api('POST', '/api/t/questions/preview', { token: T, body: { mode: 2, data: { correct: '“Hello,” said Ann.', faulty: '“hello” said Ann' } } });
    assert.equal(m2.data.ok, true);
    assert.ok(m2.data.preview.mistakes.length >= 2);
    const bad2 = await api('POST', '/api/t/questions/preview', { token: T, body: { mode: 2, data: { correct: '“Hello,” said Ann.', faulty: '“Hi,” said Ann.' } } });
    assert.equal(bad2.data.ok, false);
    const m3 = await api('POST', '/api/t/questions', { token: T, body: { mode: 3, data: { speaker: 'Tom', line: 'Leave me alone!', context: 'Tom is upset.', target: ['angry'] } } });
    assert.equal(m3.status, 200);
    const noTarget = await api('POST', '/api/t/questions', { token: T, body: { mode: 3, data: { speaker: 'Tom', line: 'Leave me alone!', target: [] } } });
    assert.equal(noTarget.status, 400);
    const imp = await api('POST', '/api/t/questions/import', { token: T, body: { mode: 1, rows: [{ correct: '“Good morning,” said Mr Ng.' }, { correct: 'no quotes here at all' }] } });
    assert.equal(imp.data.added, 1);
    assert.equal(imp.data.problems.length, 1);
  });

  await ok('verb bank: add, edit, import, delete', async () => {
    const add = await api('POST', '/api/t/verbs', { token: T, body: { base: 'chime', past: 'chimed', tags: ['happy', 'bogus'] } });
    assert.equal(add.status, 200);
    const list = (await api('GET', '/api/t/verbs', { token: T })).data;
    const v = list.verbs.find((x) => x.base === 'chime');
    assert.deepEqual(v.tags, ['happy']);
    assert.equal((await api('PUT', `/api/t/verbs/${v.id}`, { token: T, body: { base: 'chime', past: 'chimed', tags: ['happy', 'excited'], banned: false } })).status, 200);
    const imp = await api('POST', '/api/t/verbs/import', { token: T, body: { rows: [{ base: 'chime', past: 'chimed', tags: 'happy' }, { base: `${W}x`, tags: 'happy|calm' }] } });
    assert.equal(imp.data.added, 1);
    assert.equal(imp.data.problems.length, 1);
    assert.equal((await api('DELETE', `/api/t/verbs/${v.id}`, { token: T })).status, 200);
    assert.ok(!(await api('GET', '/api/t/verbs', { token: T })).data.verbs.some((x) => x.base === 'chime'));
  });

  await ok('analytics: error counts per pupil per error type', async () => {
    const a = (await api('GET', `/api/t/analytics?class=${cls.id}&days=30`, { token: T })).data;
    const raj = a.pupils.find((p) => p.name === 'Raj Tan');
    assert.ok(raj.attempts >= 4);
    assert.ok(raj.counts.NO_COMMA_BEFORE >= 1);
    assert.ok(raj.counts.WEAK_VERB >= 1);
    assert.equal(raj.counts.VERB_PENDING, undefined);
    assert.equal(raj.counts.VERB_INVALID, undefined);
    assert.ok(a.codes.every((c) => !['VERB_PENDING', 'VERB_INVALID'].includes(c.code)));
    // retries (try 2, 3) are not counted again
    const me = (await api('GET', '/api/me', { token: pupilToken })).data;
    assert.ok(me.xp > 20);
    assert.ok(me.streak >= 1);
    assert.ok(me.modes[1].done >= 2);
    assert.ok(me.verbs >= 2);
  });

  await ok('regenerating the class code blocks new sign-ins; "sign everyone out" also ends sessions', async () => {
    const old = cls.code;
    let r = await api('POST', `/api/t/classes/${cls.id}/regen`, { token: T, body: { signOut: false } });
    assert.match(r.data.code, /^[A-HJKMNP-Z2-9]{6}$/);
    assert.notEqual(r.data.code, old);
    assert.equal((await api('POST', '/api/login', { body: { username: 'rajt', code: old } })).status, 401);
    assert.equal((await api('GET', '/api/me', { token: pupilToken })).status, 200, 'existing session survives a plain regenerate');
    r = await api('POST', `/api/t/classes/${cls.id}/regen`, { token: T, body: { signOut: true } });
    assert.equal((await api('GET', '/api/me', { token: pupilToken })).status, 401, 'session ended after sign-out-everyone');
    const again = await api('POST', '/api/login', { body: { username: 'rajt', code: r.data.code } });
    assert.equal(again.status, 200);
  });

  await ok('archiving a class signs its pupils out; deleting removes data', async () => {
    const list = (await api('GET', '/api/t/classes', { token: T })).data;
    const mine = list.classes.find((c) => c.id === cls.id);
    assert.equal(mine.pupils, 4);
    assert.ok(list.guests >= 2);
    assert.equal((await api('PATCH', `/api/t/classes/${cls.id}`, { token: T, body: { archived: true } })).status, 200);
    assert.equal((await api('POST', '/api/login', { body: { username: 'rajt', code: mine.code } })).status, 401);
    assert.equal((await api('DELETE', `/api/t/classes/${cls.id}`, { token: T })).status, 200);
  });

  console.log(`\n${pass} checks passed`);
};

run().catch(() => {
  process.exitCode = 1;
});
