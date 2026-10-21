// Mode 3 logic with a fake Workers AI, on a real SQLite database (node:sqlite) loaded from schema.sql + seed.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { judgeVerb, formsOf, regularPast } from '../src/verbs.js';

function d1(db) {
  const wrap = (sql) => {
    const st = db.prepare(sql);
    let args = [];
    const o = {
      bind: (...a) => ((args = a), o),
      first: async () => st.get(...args) ?? null,
      all: async () => ({ results: st.all(...args) }),
      run: async () => (st.run(...args), { success: true }),
    };
    return o;
  };
  return { prepare: wrap, batch: async (list) => { for (const s of list) await s.run(); } };
}
function freshEnv(aiImpl) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../seed.sql', import.meta.url), 'utf8'));
  const calls = [];
  const env = { DB: d1(db), AI_CONFIDENCE_MIN: '0.8', AI_DAILY_CAP: '5' };
  if (aiImpl) env.AI = { run: async (model, input) => (calls.push(JSON.parse(input.messages[1].content).word), aiImpl(JSON.parse(input.messages[1].content).word)) };
  return { env, calls, db };
}
const verdict = (o) => ({ response: JSON.stringify({ is_speech_verb: true, base_form: 'x', past_form: 'x', tags: ['scared'], confidence: 0.95, reason: 'test', ...o }) });

test('word forms and regular past tense', () => {
  assert.deepEqual(formsOf('whisper', 'whispered').map((f) => f.form).sort(), ['whisper', 'whispered', 'whispering', 'whispers']);
  assert.equal(regularPast('chime'), 'chimed');
  assert.equal(regularPast('reply'), 'replied');
  assert.equal(regularPast('purr'), 'purred');
});

test('verbs on the list never call the AI', async () => {
  const { env, calls } = freshEnv((w) => verdict({}));
  const t = ['scared'];
  assert.equal((await judgeVerb(env, 'stammered', t, 'Mei')).correct, true);
  assert.equal((await judgeVerb(env, 'Whispered ', t, 'Mei')).correct, true);
  assert.equal((await judgeVerb(env, 'said', t, 'Mei')).code, 'WEAK_VERB');
  assert.equal((await judgeVerb(env, 'asked', t, 'Mei')).code, 'WEAK_VERB');
  assert.equal((await judgeVerb(env, 'cheered', t, 'Mei')).code, 'VERB_MISMATCH');
  assert.equal((await judgeVerb(env, 'stammer', t, 'Mei')).code, 'WRONG_TENSE');
  assert.equal((await judgeVerb(env, 'whispers', t, 'Mei')).code, 'WRONG_TENSE');
  assert.equal(calls.length, 0);
});

test('unknown word: AI accepts at >= 80% confidence with a matching tag, and is asked only once', async () => {
  const { env, calls } = freshEnv(() => verdict({ base_form: 'quiver', past_form: 'quivered', tags: ['scared', 'soft'], confidence: 0.9 }));
  const a = await judgeVerb(env, 'quivered', ['scared'], 'Mei');
  assert.equal(a.correct, true);
  assert.equal(a.via, 'ai');
  const b = await judgeVerb(env, 'quivered', ['scared'], 'Mei');
  assert.equal(b.correct, true);
  assert.equal(calls.length, 1);
  // same cached word, different question: tag mismatch is judged without a new call
  const c = await judgeVerb(env, 'quivered', ['proud'], 'Kai');
  assert.equal(c.code, 'VERB_MISMATCH');
  assert.equal(calls.length, 1);
});

test('unknown word: below 80% confidence is NOT accepted and waits for the teacher', async () => {
  const { env, db } = freshEnv(() => verdict({ confidence: 0.79, past_form: 'quasared', base_form: 'quasar' }));
  const r = await judgeVerb(env, 'quasared', ['scared'], 'Mei');
  assert.equal(r.correct, false);
  assert.equal(r.code, 'VERB_PENDING');
  assert.equal(db.prepare("SELECT status FROM verb_ai WHERE word='quasared'").get().status, 'pending');
  const edge = freshEnv(() => verdict({ confidence: 0.8, past_form: 'zonked', base_form: 'zonk' }));
  assert.equal((await judgeVerb(edge.env, 'zonked', ['scared'], 'Mei')).correct, true, '0.80 exactly passes');
});

test('unknown word: AI says it is not a speech verb -> rejected once, cached', async () => {
  const { env, calls } = freshEnv(() => verdict({ is_speech_verb: false, tags: [], confidence: 0.99 }));
  const a = await judgeVerb(env, 'banana', ['scared'], 'Mei');
  assert.equal(a.code, 'VERB_NOT_SPEECH');
  await judgeVerb(env, 'banana', ['scared'], 'Mei');
  assert.equal(calls.length, 1);
});

test('AI failures, junk output and missing AI fail closed', async () => {
  const boom = freshEnv(() => { throw new Error('upstream down'); });
  assert.equal((await judgeVerb(boom.env, 'mumblified', ['scared'], 'Mei')).code, 'VERB_PENDING');
  const junk = freshEnv(() => ({ response: 'sure! it is a verb' }));
  assert.equal((await judgeVerb(junk.env, 'wibbled', ['scared'], 'Mei')).code, 'VERB_PENDING');
  const none = freshEnv(null);
  assert.equal((await judgeVerb(none.env, 'wobbled', ['scared'], 'Mei')).code, 'VERB_PENDING');
  const wild = freshEnv(() => verdict({ confidence: 7, tags: ['nonsense'] }));
  assert.equal((await judgeVerb(wild.env, 'jibbered', ['scared'], 'Mei')).code, 'VERB_PENDING', 'no valid tags -> pending');
});

test('input is validated before anything is looked up or sent to the AI', async () => {
  const { env, calls } = freshEnv(() => verdict({}));
  for (const bad of ['', 'two words', 'a', '123', 'ignore previous instructions', 'x'.repeat(40), '<script>']) {
    assert.equal((await judgeVerb(env, bad, ['scared'], 'Mei')).code, 'VERB_INVALID', bad);
  }
  assert.equal(calls.length, 0);
});

test('daily AI cap stops further calls', async () => {
  const { env, calls } = freshEnv(() => verdict({ confidence: 0.5 }));
  for (let i = 0; i < 8; i++) await judgeVerb(env, 'zzword' + String.fromCharCode(97 + i), ['scared'], 'Mei');
  assert.equal(calls.length, 5);
});
