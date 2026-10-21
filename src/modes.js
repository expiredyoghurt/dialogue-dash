// Question types added in v1.1, kept free of D1 and Workers APIs so they can be unit-tested in Node.
//
//   Mode 1 extras  `lines` (new speaker, new line), `beat` (action then speech), `instruction`, `tip`
//   Mode 4         multiple choice, one answer or "pick N" (choose two)
//   Mode 5         free-text transform (direct <-> reported speech)
//   Mode 6         tap the wrong word, then type the fix (tense)
//
// This file also owns payloadFor(): the ONLY place that decides what a pupil's browser is sent for a
// question. Nothing that reveals an answer (key, accepted answers, correct ids, explanations, tips, "why"
// notes) may be added to a payload; test/payload.test.mjs enforces that.

import { TAGS, MC_CODES } from './rules.js';
import { isRule } from './districts.js';
import { HttpError, clip } from './util.js';
import {
  normalizeText,
  tokenize,
  prepare,
  diffTokens,
  displayText,
  clientTokens,
  buildSlots,
  lcsMissingExtra,
  keyOf,
  checkMode1,
} from './engine.js';

export const NEW_MODES = [4, 5, 6];
export const ALL_MODES = [1, 2, 3, 4, 5, 6];

export const XP = {
  1: [10, 6, 3],
  3: [8, 5, 3],
  4: [6, 3], // multiple choice: two tries
  5: [10, 6, 3], // free-text transform: three tries
  6: { tap: [3, 1], fix: [6, 4, 2] }, // tap the wrong word (two tries), then type the fix (three tries)
};
export const MAX_TRIES = { 1: 3, 3: 3, 4: 2, 5: 3, 6: 3 };
export const xpFor = (table, tryNo) => table[Math.min(Math.max(tryNo, 1), table.length) - 1];

const shuffled = (a) => {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

// ---------------------------------------------------------------------------------------------
// Fields every new-style question may carry
// ---------------------------------------------------------------------------------------------

// rule: the district this question belongs to (1-12). Optional: without it the district is suggested from the
// question itself (see autoRule in districts.js). group: siblings that the round builder serves back to back.
export function cleanRule(d) {
  if (d.rule == null || d.rule === '') return {};
  const n = parseInt(d.rule, 10);
  if (!isRule(n)) throw new HttpError(400, 'The district must be a rule number from 1 to 12.');
  return { rule: n };
}

export function cleanCommon(d) {
  const out = {};
  const tip = clip(d.tip, 300).trim();
  if (tip) out.tip = tip;
  const group = clip(d.group, 40).trim();
  if (group) {
    if (!/^[A-Za-z0-9_-]+$/.test(group)) throw new HttpError(400, 'A group name uses only letters, numbers, dashes and underscores.');
    out.group = group;
  }
  return { ...out, ...cleanRule(d) };
}

// ---------------------------------------------------------------------------------------------
// Mode 1 extras
// ---------------------------------------------------------------------------------------------

export function validateMode1Extras(d, correct) {
  const out = {};
  if (d.lines) {
    if (!/\n/.test(String(correct).trim())) throw new HttpError(400, 'A “new speaker, new line” question needs at least one line break in the correct answer.');
    out.lines = true;
  }
  if (d.beat) out.beat = true;
  const instruction = clip(d.instruction, 150).trim();
  if (instruction) out.instruction = instruction;
  return { ...out, ...cleanCommon(d) };
}

// ---------------------------------------------------------------------------------------------
// Mode 4: multiple choice
// ---------------------------------------------------------------------------------------------

export function validateMode4(d) {
  const stem = clip(d.stem, 300).trim();
  if (!stem) throw new HttpError(400, 'Type the question.');
  const context = clip(d.context, 900).trim();
  const raw = Array.isArray(d.options) ? d.options.slice(0, 8) : [];
  const options = [];
  const seen = new Set();
  raw.forEach((o, i) => {
    const text = clip(o && o.text, 140).trim();
    if (!text) return;
    let id = clip(o.id, 8).trim().toLowerCase();
    if (!id) id = String.fromCharCode(97 + i);
    if (!/^[a-z0-9]+$/.test(id)) throw new HttpError(400, 'Option ids use only letters and numbers.');
    if (seen.has(id)) throw new HttpError(400, `Two options share the id “${id}”.`);
    seen.add(id);
    const opt = { id, text };
    const why = clip(o.why, 200).trim();
    if (why) opt.why = why;
    options.push(opt);
  });
  if (options.length < 2) throw new HttpError(400, 'Give at least two options.');
  if (new Set(options.map((o) => o.text.toLowerCase())).size !== options.length) throw new HttpError(400, 'Two options say the same thing.');
  const correct = [...new Set((Array.isArray(d.correct) ? d.correct : []).map((x) => String(x).trim().toLowerCase()))];
  if (!correct.length) throw new HttpError(400, 'Mark at least one option as correct.');
  if (correct.some((id) => !seen.has(id))) throw new HttpError(400, 'A correct answer isn’t one of the options.');
  if (correct.length === options.length) throw new HttpError(400, 'At least one option must be wrong.');
  const pick = parseInt(d.pick ?? 1, 10);
  if (!Number.isFinite(pick) || pick < 1 || pick > correct.length) throw new HttpError(400, `Pupils choose between 1 and ${correct.length} options (no more than the number marked correct).`);
  const explanation = clip(d.explanation, 400).trim();
  if (!explanation) throw new HttpError(400, 'Write the explanation pupils see afterwards.');
  const code = MC_CODES.includes(d.code) ? d.code : 'MC_WRONG';
  const data = { stem, options, correct, pick, explanation, code };
  if (context) data.context = context;
  if (d.shuffle === false) data.shuffle = false;
  // tip is not used by Mode 4 (explanation is its tip); keep group + rule only
  const common = cleanCommon(d);
  delete common.tip;
  return { ...data, ...common };
}

// Marks a choice. `chosen` = array of option ids. Returns { invalid } if the count or ids are off.
export function checkMode4(data, chosen) {
  const ids = new Set(data.options.map((o) => o.id));
  const picked = [...new Set((Array.isArray(chosen) ? chosen : []).map((x) => String(x)))];
  if (picked.length !== data.pick || picked.some((id) => !ids.has(id))) return { invalid: true, picked };
  const wrongIds = picked.filter((id) => !data.correct.includes(id));
  const whys = {};
  for (const id of wrongIds) {
    const w = data.options.find((o) => o.id === id)?.why;
    if (w) whys[id] = w;
  }
  return { invalid: false, picked, correct: wrongIds.length === 0, wrongIds, whys };
}

// ---------------------------------------------------------------------------------------------
// Mode 5: free-text transform
//   accepted answers may use  (optional words)  and  [this|that]  alternatives.
// ---------------------------------------------------------------------------------------------

const MAX_VARIANTS = 64;

export function expandVariants(str) {
  const out = new Set();
  const go = (s) => {
    if (out.size > MAX_VARIANTS * 4) return;
    const m = s.match(/\[([^[\]]*)\]|\(([^()]*)\)/);
    if (!m) {
      out.add(s);
      return;
    }
    const before = s.slice(0, m.index);
    const after = s.slice(m.index + m[0].length);
    const options = m[1] !== undefined ? m[1].split('|') : [m[2], ''];
    for (const o of options) go(before + o + after);
  };
  go(String(str));
  return [...out].map((v) => v.replace(/[ \t]+/g, ' ').replace(/ ([,.!?;:])/g, '$1').trim());
}

export function allVariants(data) {
  const set = new Map();
  for (const a of data.accepted || []) for (const v of expandVariants(a)) set.set(v.toLowerCase() + '|' + v, v);
  return [...set.values()];
}

const SENT_END = new Set(['.', '!', '?', '…']);
const LEX = /[\p{L}\p{N}]+(?:['\-][\p{L}\p{N}]+)*|["…—.,!?;:]/gu;

// Words and punctuation as a flat token list. Spaces vanish; curly / straight quotes and apostrophes are one thing.
function lex(s) {
  const { text } = normalizeText(String(s ?? '').trim());
  return text.match(LEX) || [];
}
const lc = (toks) => toks.map((t) => t.toLowerCase());
function trailing(toks) {
  let n = toks.length;
  while (n > 0 && SENT_END.has(toks[n - 1])) n--;
  return { core: toks.slice(0, n), end: toks.slice(n).join('') };
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function validateMode5(d) {
  const prompt = clip(d.prompt, 300).trim();
  if (!prompt) throw new HttpError(400, 'Type the sentence pupils must change.');
  const instruction = clip(d.instruction, 150).trim();
  if (!instruction) throw new HttpError(400, 'Type the instruction (e.g. “Rewrite as reported speech.”).');
  const accepted = (Array.isArray(d.accepted) ? d.accepted : String(d.accepted ?? '').split('\n')).map((a) => clip(a, 300).trim()).filter(Boolean).slice(0, 12);
  if (!accepted.length) throw new HttpError(400, 'Give at least one accepted answer.');
  let total = 0;
  for (const a of accepted) {
    if (/[()[\]]/.test(a.replace(/\[[^[\]]*\]|\([^()]*\)/g, ''))) throw new HttpError(400, `Unbalanced ( ) or [ ] in “${a}”.`);
    const n = expandVariants(a).length;
    total += n;
    if (!/[\p{L}]/u.test(a)) throw new HttpError(400, 'An accepted answer has no words.');
    for (const v of expandVariants(a)) {
      const q = (normalizeText(v).text.match(/"/g) || []).length;
      if (q % 2) throw new HttpError(400, `“${v}” has an unmatched speech mark.`);
    }
  }
  if (total > MAX_VARIANTS) throw new HttpError(400, `Those accepted answers expand to ${total} versions; the limit is ${MAX_VARIANTS}. Use fewer ( ) and [ ] groups.`);
  const data = { prompt, instruction, accepted };
  if (lex(prompt).join(' ').toLowerCase() === lex(accepted[0]).join(' ').toLowerCase()) throw new HttpError(400, 'The prompt is the same as the first accepted answer.');
  return { ...data, ...cleanCommon(d) };
}

// Returns { correct, notes, errors, codes }.
//   notes: 'case' (capital letters differ), 'end' (final full stop / question mark differs), 'single' (single quotes used)
export function checkMode5(data, answer) {
  const { singleQuotes } = normalizeText(answer);
  const pTok = lex(answer);
  const variants = allVariants(data);
  const pCore = trailing(pTok);

  // 1. same words and punctuation, ignoring capitals, spacing and a missing/extra final full stop
  for (const v of variants) {
    const vTok = lex(v);
    const vCore = trailing(vTok);
    if (same(lc(vCore.core), lc(pCore.core))) {
      const notes = [];
      if (!same(vCore.core, pCore.core)) notes.push('case');
      if (vCore.end !== pCore.end) notes.push('end');
      if (singleQuotes) notes.push('single');
      return { correct: true, notes, errors: [], codes: [] };
    }
  }

  // 2. same words but wrong punctuation / speech marks: use the dialogue engine for precise feedback
  const pTk = tokenize(normalizeText(answer).text);
  let best = null;
  for (const v of variants) {
    const cTk = prepare(v);
    const r = diffTokens(cTk, pTk);
    if (!r.aligned) continue;
    if (!best || r.errors.length < best.errors.length) best = { ...r, cTk };
  }
  if (best && best.errors.length) {
    return { correct: false, notes: singleQuotes ? ['single'] : [], errors: best.errors, cTk: best.cTk, codes: [...new Set(best.errors.map((e) => e.code))] };
  }

  // 3. the words are different
  let near = null;
  const pKeys = tokenize(normalizeText(answer).text).words.map((w) => w.key);
  for (const v of variants) {
    const vKeys = tokenize(normalizeText(v).text).words.map((w) => w.key);
    const d = lcsMissingExtra(vKeys, pKeys);
    const score = d.missing.length + d.extra.length;
    if (!near || score < near.score) near = { ...d, score };
  }
  return { correct: false, notes: singleQuotes ? ['single'] : [], errors: [], words: near, codes: ['SPEECH_WORDS'] };
}

// Feedback shown for a wrong Mode 5 answer (kept apart from the engine's own explanations).
export function wordsFeedback(near, pupilWords) {
  const shown = [];
  if (near && near.extra.length) {
    for (const k of near.extra) {
      const w = pupilWords.find((x) => x.key === k);
      if (w && !shown.includes(w.raw)) shown.push(w.raw);
    }
  }
  const check = shown.length ? ` Look again at: ${shown.slice(0, 4).map((w) => `‘${w}’`).join(', ')}.` : '';
  return {
    code: 'SPEECH_WORDS',
    rule: 10,
    what: `Not quite yet.${check}`,
    fix: 'Check the verb tense, the pronouns (I / he / she) and any time words (tomorrow, the next day), and copy every other word.',
  };
}

export function modelMode5(data) {
  const first = String(data.accepted[0]).replace(/\[([^[\]|]*)(?:\|[^[\]]*)?\]/g, '$1');
  return displayText(first.replace(/[ \t]+/g, ' ').trim(), true);
}

// ---------------------------------------------------------------------------------------------
// Mode 6: tap the wrong word, then type the fix
// ---------------------------------------------------------------------------------------------

const cleanFix = (s) => {
  const { text } = normalizeText(String(s ?? ''));
  return text.toLowerCase().replace(/["]/g, '').replace(/\s+/g, ' ').replace(/^[\s.,!?;:…—]+|[\s.,!?;:…—]+$/g, '').trim();
};
const listOf = (v, max) =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[,\n;]/))
    .map((x) => clip(x, 40).trim())
    .filter(Boolean)
    .slice(0, max);

export function validateMode6(d) {
  const sentence = clip(d.sentence, 300).trim();
  if (!sentence) throw new HttpError(400, 'Type the sentence with the mistake in it.');
  const words = tokenize(normalizeText(sentence).text).words;
  if (words.length < 4 || words.length > 40) throw new HttpError(400, 'The sentence should have between 4 and 40 words.');
  const wrong = [...new Set(listOf(d.wrong, 6).map((w) => w.toLowerCase()))];
  const fixes = [...new Set(listOf(d.fixes, 12).map((w) => w.toLowerCase()))];
  if (!wrong.length) throw new HttpError(400, 'Name the wrong word.');
  if (!fixes.length) throw new HttpError(400, 'Give at least one accepted fix.');
  const keys = new Set(words.map((w) => w.key));
  for (const w of wrong) {
    if (w.split(/\s+/).length !== 1) throw new HttpError(400, `“${w}”: the wrong word must be a single word.`);
    if (!keys.has(keyOf(w))) throw new HttpError(400, `The wrong word “${w}” isn’t in the sentence.`);
  }
  for (const f of fixes) {
    if (f.split(/\s+/).length > 3) throw new HttpError(400, `“${f}” is too long for a fix (three words at most).`);
    if (wrong.some((w) => keyOf(w) === keyOf(f))) throw new HttpError(400, `The fix “${f}” is the same as the wrong word.`);
  }
  return { sentence, wrong, fixes, ...cleanCommon(d) };
}

export function tapTargets(data) {
  const wrong = new Set((data.wrong || []).map((w) => keyOf(w)));
  return tokenize(normalizeText(data.sentence).text).words.flatMap((w, i) => (wrong.has(w.key) ? [i] : []));
}

export function checkFix(data, typed) {
  const t = cleanFix(typed);
  if (!t) return { ok: false, kind: 'empty' };
  if (t.split(' ').length > 4) return { ok: false, kind: 'format' };
  if (data.fixes.some((f) => cleanFix(f) === t)) return { ok: true };
  if (data.wrong.some((w) => keyOf(w) === keyOf(t))) return { ok: false, kind: 'same' };
  return { ok: false, kind: 'other' };
}

// The sentence with the wrong word swapped for the first accepted fix, keeping a leading capital.
export function fixedSentence(data, idx) {
  const { text } = normalizeText(data.sentence);
  const w = tokenize(text).words[idx];
  if (!w) return displayText(data.sentence, true);
  let fix = data.fixes[0];
  if (/^\p{Lu}/u.test(w.raw)) fix = fix[0].toUpperCase() + fix.slice(1);
  return displayText(text.slice(0, w.start) + fix + text.slice(w.end), true);
}

// ---------------------------------------------------------------------------------------------
// Pupil payloads: what the browser is allowed to see
// ---------------------------------------------------------------------------------------------

export function payloadFor(mode, data) {
  const extra = {};
  if (data.group) extra.group = data.group;
  if (mode === 1) {
    const p = { prompt: data.prompt, ...extra };
    if (data.instruction) p.instruction = data.instruction;
    if (data.lines) p.lines = true;
    return p;
  }
  if (mode === 2) {
    const r = buildSlots(data.correct, data.faulty);
    if (!r.valid) return null;
    return { ...clientTokens(data.faulty), places: r.slots.length };
  }
  if (mode === 3) {
    return {
      speaker: data.speaker,
      line: displayText(data.line),
      context: data.context || '',
      hint: (data.target || []).map((t) => TAGS[t]).filter(Boolean),
    };
  }
  if (mode === 4) {
    const opts = data.options.map((o) => ({ id: o.id, text: displayText(o.text) }));
    return {
      stem: displayText(data.stem),
      context: data.context ? displayText(data.context) : '',
      options: data.shuffle === false ? opts : shuffled(opts),
      pick: data.pick,
      ...extra,
    };
  }
  if (mode === 5) {
    return { prompt: displayText(data.prompt), instruction: data.instruction, ...extra };
  }
  if (mode === 6) {
    if (!tapTargets(data).length) return null;
    return { ...clientTokens(data.sentence), ...extra };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Teacher previews (teachers see the answers; this is never sent to pupils)
// ---------------------------------------------------------------------------------------------

export function previewMode(mode, data) {
  if (mode === 1) {
    const ans = displayText(data.correct, true);
    return { prompt: data.prompt, instruction: data.instruction || '', lines: !!data.lines, beat: !!data.beat, answer: ans, tip: data.tip || '' };
  }
  if (mode === 4) {
    return {
      stem: data.stem,
      context: data.context || '',
      pick: data.pick,
      options: data.options.map((o) => ({ text: o.text, correct: data.correct.includes(o.id), why: o.why || '' })),
      explanation: data.explanation,
      group: data.group || '',
    };
  }
  if (mode === 5) {
    return { prompt: displayText(data.prompt), instruction: data.instruction, model: modelMode5(data), variants: allVariants(data).slice(0, 16).map((v) => displayText(v, true)), tip: data.tip || '' };
  }
  if (mode === 6) {
    const words = tokenize(normalizeText(data.sentence).text).words;
    const idx = tapTargets(data);
    return { sentence: displayText(data.sentence), wrong: idx.map((i) => words[i].raw), fixes: data.fixes, corrected: fixedSentence(data, idx[0]), tip: data.tip || '' };
  }
  return null;
}

// Convenience used by tests: does this Mode 1 question's key mark itself correct, and its prompt not?
export function mode1SelfCheck(data) {
  return { keyOk: checkMode1(data, data.correct).correct, promptOk: checkMode1(data, data.prompt).correct };
}
