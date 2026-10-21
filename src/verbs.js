// Mode 3: the saying-verb bank, plus the AI fallback for words that are not on the list.
//
// Order of checks for a pupil's word:
//   1. verbs table (via verb_forms)       -> accepted / banned / tag mismatch, no AI call
//   2. verb_ai cache                      -> a word is only ever judged by the AI once
//   3. Workers AI                         -> accepted only if it says "speech verb" with
//                                            confidence >= AI_CONFIDENCE_MIN and a matching tag

import { TAGS } from './rules.js';

export const BANNED = [
  ['say', 'said'],
  ['ask', 'asked'],
  ['tell', 'told'],
  ['talk', 'talked'],
  ['speak', 'spoke'],
];

export function thirdPerson(b) {
  if (/(s|x|z|ch|sh)$/.test(b)) return b + 'es';
  if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ies';
  return b + 's';
}
export function ingForm(b) {
  if (/ie$/.test(b)) return b.slice(0, -2) + 'ying';
  if (/[^aeiou]e$/.test(b)) return b.slice(0, -1) + 'ing';
  return b + 'ing';
}
export function regularPast(b) {
  if (/e$/.test(b)) return b + 'd';
  if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ied';
  return b + 'ed';
}

export function formsOf(base, past) {
  const out = new Map();
  const add = (f, kind) => {
    const k = f.toLowerCase();
    if (k && !out.has(k)) out.set(k, kind);
  };
  add(past, 'past');
  add(base, 'base');
  add(thirdPerson(base), 'third');
  add(ingForm(base), 'ing');
  return [...out].map(([form, kind]) => ({ form, kind }));
}

export const cleanWord = (raw) => String(raw ?? '').trim().toLowerCase().replace(/[’‘]/g, "'");
export const validWord = (w) => /^[a-z][a-z'-]{1,24}$/.test(w);
export const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : []).filter((t) => t in TAGS))];

const tagLabel = (tags) => tags.map((t) => TAGS[t]).filter(Boolean).join(' or ');
const hit = (a, b) => a.some((t) => b.includes(t));

// ---------- database helpers (also used by the teacher API and the seed) ----------

export async function saveVerb(db, { base, past, tags, banned = 0, source = 'teacher' }) {
  base = cleanWord(base);
  past = cleanWord(past);
  if (!validWord(base) || !validWord(past)) throw new Error('Enter the base form and the past tense, e.g. whisper / whispered.');
  const row = await db
    .prepare('INSERT INTO verbs (base, past, tags, banned, source, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id')
    .bind(base, past, JSON.stringify(cleanTags(tags)), banned ? 1 : 0, source, Date.now())
    .first();
  await writeForms(db, row.id, base, past);
  return row.id;
}

export async function writeForms(db, id, base, past) {
  const stmts = [db.prepare('DELETE FROM verb_forms WHERE verb_id = ?1').bind(id)];
  for (const { form, kind } of formsOf(base, past)) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO verb_forms (form, verb_id, kind) VALUES (?1, ?2, ?3)').bind(form, id, kind));
  }
  await db.batch(stmts);
}

async function lookup(db, word) {
  return db
    .prepare(
      `SELECT v.id, v.base, v.past, v.tags, v.banned, f.kind
         FROM verb_forms f JOIN verbs v ON v.id = f.verb_id WHERE f.form = ?1`,
    )
    .bind(word)
    .first();
}

// ---------- the AI call ----------

const SYSTEM = `You help a Singapore primary-school (Primary 5-6) English teacher. A pupil typed one word to replace "said" after a line of quoted speech. Decide whether the word is a verb that can introduce or follow spoken words as a dialogue tag (for example: whispered, snapped, stammered, announced).
Rules:
- is_speech_verb is true only for real verbs that describe HOW or WHY someone speaks (volume, tone, feeling, purpose). Words like "ran", "table", "happy", "smiled" or made-up words are false. "Said", "asked", "told" are true but the pupil is trying to avoid them.
- base_form and past_form: the base verb and its simple past tense.
- tags: choose from ${Object.keys(TAGS).join(', ')}. Pick only the tags the verb clearly conveys.
- confidence: a number from 0 to 1 for how sure you are about the WHOLE judgement. Use below 0.8 if the word is slangy, rare, ambiguous or you are unsure of the tags.
- reason: at most 15 words.
Reply with JSON only.`;

const SCHEMA = {
  type: 'object',
  properties: {
    is_speech_verb: { type: 'boolean' },
    base_form: { type: 'string' },
    past_form: { type: 'string' },
    tags: { type: 'array', items: { type: 'string', enum: Object.keys(TAGS) } },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['is_speech_verb', 'base_form', 'past_form', 'tags', 'confidence', 'reason'],
};

export async function askAI(env, word) {
  const model = env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const res = await env.AI.run(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ word }) },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: 200,
    temperature: 0,
  });
  let out = res?.response ?? res;
  if (typeof out === 'string') {
    const m = out.match(/\{[\s\S]*\}/);
    out = JSON.parse(m ? m[0] : out);
  }
  const conf = Number(out.confidence);
  const base = cleanWord(out.base_form);
  const past = cleanWord(out.past_form);
  return {
    is_speech: out.is_speech_verb === true,
    base: validWord(base) ? base : '',
    past: validWord(past) ? past : '',
    tags: cleanTags(out.tags),
    conf: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
    reason: String(out.reason || '').slice(0, 160),
  };
}

// ---------- the judgement ----------

// Returns { status, correct, code, message, via, tags?, verb? }
//   status: ok | weak | tense | mismatch | not_speech | pending | invalid
export async function judgeVerb(env, raw, target, speaker = 'the speaker') {
  const db = env.DB;
  const w = cleanWord(raw);
  const targetTags = cleanTags(target);
  const want = targetTags.length ? tagLabel(targetTags) : 'how the speaker feels';

  if (!validWord(w)) {
    return { status: 'invalid', correct: false, code: 'VERB_INVALID', message: 'Type just one saying verb, like ‘whispered’ — letters only.' };
  }

  const evaluate = (tags, kind, past, via) => {
    if (kind !== 'past') {
      return {
        status: 'tense', correct: false, code: 'WRONG_TENSE', via,
        message: `‘${w}’ is the right kind of word, but this sentence is in the past tense. Try ‘${past}’.`,
      };
    }
    if (targetTags.length && !hit(tags, targetTags)) {
      return {
        status: 'mismatch', correct: false, code: 'VERB_MISMATCH', via, tags,
        message: `‘${w}’ is a saying verb, but it doesn’t match how ${speaker} feels. Think: ${want}.`,
      };
    }
    const shown = targetTags.length ? tagLabel(tags.filter((t) => targetTags.includes(t))) : tagLabel(tags);
    return { status: 'ok', correct: true, code: null, via, tags, message: `‘${w}’ fits — it shows ${shown || 'the feeling'} in the way ${speaker} speaks.` };
  };

  // 1. the verb bank
  const row = await lookup(db, w);
  if (row) {
    if (row.banned) {
      return { status: 'weak', correct: false, code: 'WEAK_VERB', via: 'list', message: `‘${w}’ is a plain verb. It doesn’t show how ${speaker} feels. Choose a verb that shows: ${want}.` };
    }
    return { ...evaluate(JSON.parse(row.tags), row.kind, row.past, 'list'), verb: row.base };
  }

  // 2. cached AI verdicts (a word the AI was unavailable for is re-asked after a few minutes)
  let ai = await db.prepare('SELECT * FROM verb_ai WHERE word = ?1').bind(w).first();
  const infra = (r) => /^(AI error|AI not available|Daily AI)/.test(r || '');
  if (ai && ai.status === 'pending' && infra(ai.reason) && env.AI && Date.now() - ai.ts > 5 * 60_000) ai = null;
  // 3. ask the AI (once per word)
  if (!ai) {
    const cap = parseInt(env.AI_DAILY_CAP || '300', 10);
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const used = (await db.prepare('SELECT COUNT(*) AS n FROM verb_ai WHERE ts >= ?1').bind(dayStart.getTime()).first())?.n ?? 0;
    let verdict = null;
    let reason = '';
    if (env.AI && used < cap) {
      try {
        verdict = await askAI(env, w);
      } catch (e) {
        reason = 'AI error: ' + String(e?.message || e).slice(0, 100);
      }
    } else reason = env.AI ? 'Daily AI limit reached' : 'AI not available';
    const min = parseFloat(env.AI_CONFIDENCE_MIN || '0.8');
    let status;
    if (!verdict) status = 'pending';
    else if (!verdict.is_speech) status = 'auto_rejected';
    else if (verdict.conf >= min && verdict.tags.length && verdict.past) status = 'ai_ok';
    else status = 'pending';
    ai = {
      word: w,
      base: verdict?.base || '',
      past: verdict?.past || '',
      tags: JSON.stringify(verdict?.tags || []),
      is_speech: verdict?.is_speech ? 1 : 0,
      conf: verdict?.conf ?? 0,
      reason: verdict?.reason || reason,
      status,
      ts: Date.now(),
    };
    await db
      .prepare('INSERT OR REPLACE INTO verb_ai (word, base, past, tags, is_speech, conf, reason, status, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
      .bind(ai.word, ai.base, ai.past, ai.tags, ai.is_speech, ai.conf, ai.reason, ai.status, ai.ts)
      .run();
  }

  switch (ai.status) {
    case 'ai_ok':
    case 'approved': {
      const kind = w === ai.past ? 'past' : 'other';
      return { ...evaluate(JSON.parse(ai.tags), kind, ai.past, 'ai'), verb: ai.base };
    }
    case 'rejected':
      return { status: 'not_speech', correct: false, code: 'VERB_NOT_SPEECH', via: 'ai', message: `Your teacher has marked ‘${w}’ as not suitable here. Try a verb that shows ${want}.` };
    case 'auto_rejected':
      return { status: 'not_speech', correct: false, code: 'VERB_NOT_SPEECH', via: 'ai', message: `‘${w}’ isn’t a verb we can use to say words out loud. Think about how ${speaker}’s voice sounds: ${want}.` };
    default:
      return { status: 'pending', correct: false, code: 'VERB_PENDING', via: 'ai', message: `I’m not sure about ‘${w}’ yet, so your teacher will check it. Try a different verb for now.` };
  }
}

// A few other good verbs to show after a question is answered.
export async function suggestVerbs(db, target, exclude = '', n = 4) {
  const tags = cleanTags(target);
  const rows = (await db.prepare('SELECT past, tags FROM verbs WHERE banned = 0').all()).results || [];
  const pool = rows.filter((r) => r.past !== exclude && (!tags.length || hit(JSON.parse(r.tags), tags))).map((r) => r.past);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
