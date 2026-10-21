// Marking engine for dialogue punctuation (Modes 1 and 2).
//
// Idea: tokenise the correct answer and the pupil's attempt into
//   gap0 word1 gap1 word2 ... wordN gapN
// where a "gap" is the run of punctuation / speech marks between two words.
// If the words line up (ignoring capitals and apostrophes), every difference is
// either a gap difference (punctuation, speech marks) or a word difference
// (capital letter, apostrophe), and each one maps to a specific error code.

import { CODES } from './rules.js';

const PUNCT = new Set(['.', ',', '!', '?', ';', ':', '…', '—']);
const isQuoteCh = (c) => c === '"' || c === '“' || c === '”';
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/uy;

export function keyOf(w) {
  return w.toLowerCase().replace(/['’\-]/g, '');
}
const lowerRaw = (w) => w.toLowerCase().replace(/’/g, "'");
const isCap = (w) => /^\p{Lu}/u.test(w);

// ---------- normalising / tokenising ----------

export function normalizeText(s) {
  let t = String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
  t = t.replace(/[“”„‟«»]/g, '"');
  t = t.replace(/[‘’‚‛ʼ`´]/g, "'");
  let singleQuotes = false;
  // A single quote that is not an apostrophe inside a word is treated as a speech mark.
  t = t.replace(/(?<![\p{L}\p{N}])'|'(?![\p{L}\p{N}])/gu, () => {
    singleQuotes = true;
    return '"';
  });
  t = t.replace(/\.{2,}|…/g, '…');
  t = t.replace(/—|–|--+/g, '—');
  return { text: t, singleQuotes };
}

export function tokenize(text) {
  const words = [];
  const gaps = [];
  let cur = { toks: [], raw: '', nl: 0 };
  const finish = (g) => ({ p: g.toks.join(''), toks: g.toks, raw: g.raw, nl: g.nl });
  let i = 0;
  const n = text.length;
  while (i < n) {
    WORD_RE.lastIndex = i;
    const m = WORD_RE.exec(text);
    if (m) {
      gaps.push(finish(cur));
      cur = { toks: [], raw: '', nl: 0 };
      words.push({ raw: m[0], key: keyOf(m[0]), start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const c = text[i];
    cur.raw += c;
    if (isQuoteCh(c)) cur.toks.push('"');
    else if (PUNCT.has(c)) cur.toks.push(c);
    else if (c === '\n') cur.nl++;
    i++;
  }
  gaps.push(finish(cur));
  return { words, gaps };
}

// Adds open/close roles for every quote and a role for each punctuation run.
//   A = punctuation just before a closing quote (end of the spoken words)
//   B = punctuation just before an opening quote (end of the saying words)
//   I = punctuation inside speech with no quote next to it
//   N = punctuation in the narration (outside speech)
function annotate(tk) {
  let inSpeech = false;
  tk.info = [];
  for (let k = 0; k < tk.gaps.length; k++) {
    const runs = [];
    const quotes = [];
    let run = '';
    for (const t of tk.gaps[k].toks) {
      if (t === '"') {
        const open = !inSpeech;
        runs.push({ s: run, role: open ? 'B' : 'A' });
        quotes.push(open ? 'open' : 'close');
        inSpeech = !inSpeech;
        run = '';
      } else run += t;
    }
    runs.push({ s: run, role: inSpeech ? 'I' : 'N' });
    tk.info.push({ runs, quotes });
  }
  return tk;
}

export function prepare(text) {
  const { text: t } = normalizeText(text);
  return annotate(tokenize(t));
}

function splitRuns(toks) {
  const runs = [''];
  let q = 0;
  for (const t of toks) {
    if (t === '"') {
      runs.push('');
      q++;
    } else runs[runs.length - 1] += t;
  }
  return { runs, q };
}

// ---------- display helpers ----------

// Curly quotes / apostrophes for showing text to pupils.
// balanced=true: the text is a correct answer, so quotes simply alternate open / close.
// balanced=false: faulty text, so decide from the characters around each quote.
export function displayText(s, balanced = false) {
  const { text } = normalizeText(s);
  let out = '';
  let open = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (balanced) {
        out += open ? '\u201D' : '\u201C';
        open = !open;
      } else {
        const prev = out[out.length - 1];
        out += !prev || /[\s(\[—]/.test(prev) ? '\u201C' : '\u201D';
      }
    } else if (c === "'") out += '\u2019';
    else out += c;
  }
  return out;
}

// What a canonical gap looks like with proper opening / closing glyphs, e.g. ,” or .“
export function gapDisplay(cTk, k) {
  let qi = 0;
  let out = '';
  for (const t of cTk.gaps[k].toks) {
    if (t === '"') out += cTk.info[k].quotes[qi++] === 'open' ? '\u201C' : '\u201D';
    else out += t;
  }
  return out;
}

// Prompt for Mode 1: the correct sentence with punctuation removed.
export function stripToPrompt(correct, { lowerFirstSpoken = false } = {}) {
  const { text } = normalizeText(correct);
  let t = text;
  if (lowerFirstSpoken) {
    // Lowercase the first spoken word (keeping "I", "I'm", "I'll" ...) so Rule 2 gets tested.
    t = t.replace(/"(\s*)(\p{L}[\p{L}'’\-]*)/u, (m, sp, w) => {
      if (/^I(['’]|$)/.test(w)) return m;
      return `"${sp}${w[0].toLowerCase()}${w.slice(1)}`;
    });
  }
  t = t.replace(/["“”.,!?;:…—]/g, ' ');
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/'/g, '\u2019').trim();
}

// Tokens for the Mode 2 click-the-error display.
export function clientTokens(text) {
  const disp = displayText(text);
  const tk = tokenize(disp);
  return {
    words: tk.words.map((w) => w.raw),
    gaps: tk.gaps.map((g) => ({ raw: g.raw.replace(/[ \t]+/g, ' '), nl: g.nl })),
  };
}

// ---------- error explanation ----------

const NAMES = {
  '.': 'a full stop',
  ',': 'a comma',
  '!': 'an exclamation mark',
  '?': 'a question mark',
  '…': 'an ellipsis (…)',
  '—': 'a dash',
  ':': 'a colon',
  ';': 'a semicolon',
};
function punctName(s) {
  if (!s) return 'nothing';
  return [...s].map((c) => NAMES[c] || `‘${c}’`).join(' and ');
}
function why(c) {
  if (c === '?') return ' It asks a question.';
  if (c === '!') return ' It shows strong feeling or a shout.';
  if (c === '.') return ' It is a statement.';
  if (c === ',') return ' The saying words come next, so the sentence is not finished.';
  return '';
}
const q = (w) => (w ? `‘${w}’` : 'the start');

function loc(prev, next) {
  if (prev) return `after ${q(prev)}`;
  if (next) return `before ${q(next)}`;
  return 'here';
}

export function explainErr(e, cTk) {
  const cw = cTk.words;
  const prev = e.index > 0 ? cw[e.index - 1]?.raw : '';
  const next = cw[e.index]?.raw || '';
  const meta = CODES[e.code] || { rule: 0 };
  const out = { code: e.code, rule: meta.rule, kind: e.kind, index: e.index, expected: e.expected, got: e.got };
  if (e.missing) out.missing = e.missing;
  if (e.extra) out.extra = e.extra;
  const exp = e.expected;
  switch (e.code) {
    case 'NO_QUOTES': {
      const role = e.roles?.[0];
      if (role === 'open') {
        out.what = `Speech marks are missing before ${q(next)}. The spoken words start here.`;
        out.fix = `Open the speech with “ just before ${q(next)}.`;
      } else if (role === 'close') {
        out.what = `Speech marks are missing ${loc(prev, next)}. The spoken words end here.`;
        out.fix = `Close the speech with ” after the punctuation that follows ${q(prev)}.`;
      } else {
        out.what = `Speech marks are missing ${loc(prev, next)}.`;
        out.fix = 'Put “ before the first spoken word and ” after the last one (after its punctuation).';
      }
      break;
    }
    case 'EXTRA_QUOTES':
      out.what = `There are extra speech marks ${loc(prev, next)}.`;
      out.fix = 'Only the words someone says go inside speech marks. Take the extra ones out.';
      break;
    case 'NO_CAPITAL':
      out.what = `${q(e.got)} is the first spoken word, so it needs a capital letter.`;
      out.fix = `Write ${q(exp)} with a capital ${exp[0]}.`;
      break;
    case 'NO_CAPITAL_SENT':
      out.what = `A new sentence starts at ${q(e.got)}, so it needs a capital letter.`;
      out.fix = `Write ${q(exp)} with a capital ${exp[0]}.`;
      break;
    case 'CAPITAL_PROPER':
      out.what = `${q(e.got)} needs a capital letter (names and the word ‘I’ always have one).`;
      out.fix = `Write ${q(exp)}.`;
      break;
    case 'CAPITAL_EXTRA':
      out.what = `${q(e.got)} doesn’t need a capital letter here.`;
      out.fix = `Write ${q(exp)} in lowercase.`;
      break;
    case 'TAG_CAPITAL':
      out.what = `${q(e.got)} comes straight after the speech marks and is part of the same sentence, so it stays lowercase (unless it is a name).`;
      out.fix = `Write ${q(exp)} without a capital letter.`;
      break;
    case 'RESUME_CAPITAL':
      out.what = `The sentence is only paused by the saying words, so the speech carries on in lowercase: ${q(exp)}.`;
      out.fix = `Write ${q(exp)} without a capital letter.`;
      break;
    case 'NO_CAPITAL_RESUME':
      out.what = `A new sentence of speech begins at ${q(e.got)}, so it needs a capital letter.`;
      out.fix = `Write ${q(exp)} with a capital ${exp[0]}.`;
      break;
    case 'APOSTROPHE':
      out.what = `${q(e.got)} is missing its apostrophe (or has one it doesn’t need).`;
      out.fix = `Write ${q(exp)}.`;
      break;
    case 'NO_COMMA_BEFORE':
      out.what = `The saying words come first, so put a comma ${loc(prev, next)} before the speech marks open.`;
      out.fix = `Write ${q(prev)}, then open the speech marks.`;
      break;
    case 'NO_COMMA_AFTER':
      out.what = `The saying words come after the speech, so end the spoken words with a comma ${loc(prev, next)}. The comma goes inside the speech marks.`;
      out.fix = `Write ${q(prev + ',')} and then close the speech marks.`;
      break;
    case 'STOP_BEFORE_TAG':
      out.what = `The sentence isn’t finished — the saying words come next — so use a comma ${loc(prev, next)}, not a full stop.`;
      out.fix = `Write ${q(prev + ',')} inside the speech marks.`;
      break;
    case 'PUNCT_OUTSIDE':
      out.what = `The punctuation ${loc(prev, next)} must go inside the speech marks, before the closing speech marks.`;
      out.fix = `Write ${q(prev + (exp || ''))} then close the speech marks.`;
      break;
    case 'NO_END_PUNCT':
      out.what = `Needs ending punctuation ${loc(prev, next)}: ${punctName(exp)}.${why(exp[0])}`;
      out.fix = `Add ${punctName(exp)} ${loc(prev, next)}.`;
      break;
    case 'WRONG_END_PUNCT':
      out.what = `The punctuation ${loc(prev, next)} should be ${punctName(exp)}, not ${punctName(e.got)}.${why(exp[0])}`;
      out.fix = `Change it to ${punctName(exp)}.`;
      break;
    case 'NO_FULLSTOP_TAG':
      out.what = `The saying words finish a sentence, so they need ${punctName(exp)} ${loc(prev, next)} before the next speech marks.`;
      out.fix = `Add ${punctName(exp)} after ${q(prev)}.`;
      break;
    case 'PUNCT_EXTRA':
      out.what = `There is extra punctuation ${loc(prev, next)} that isn’t needed.`;
      out.fix = `Take it out. It should be ${exp ? punctName(exp) : 'nothing'}.`;
      break;
    case 'PUNCT_OTHER':
      out.what = `Check the punctuation ${loc(prev, next)}. It should be ${punctName(exp)}.`;
      out.fix = `Use ${punctName(exp)}.`;
      break;
    case 'NO_NEW_LINE':
      out.what = `A different person starts speaking ${loc(prev, next)}, so their words need their own line.`;
      out.fix = `Start a new line so that ${q(next)} (the next speaker’s opening speech marks) begins a fresh line.`;
      break;
    case 'EXTRA_NEW_LINE':
      out.what = `The line is broken ${loc(prev, next)}, but the same person is still speaking. One speaker’s words and their saying words stay together on one line.`;
      out.fix = 'Join the two parts back into one line.';
      break;
    case 'ACTION_COMMA':
      out.what = `The words before the speech tell us what someone did. They are an action, not a saying verb, so that sentence ends with a full stop, not a comma.`;
      out.fix = `Write ${q(prev + '.')} and then open the speech marks.`;
      break;
    case 'ACTION_NO_STOP':
      out.what = `The action finishes a sentence, so it needs a full stop ${loc(prev, next)} before the speech marks open.`;
      out.fix = `Write ${q(prev + '.')} and then open the speech marks.`;
      break;
    case 'CHANGED_WORDS': {
      const bits = [];
      if (e.missing?.length) bits.push(`you left out ${e.missing.map(q).join(', ')}`);
      if (e.extra?.length) bits.push(`you added or changed ${e.extra.map(q).join(', ')}`);
      out.what = `The words don’t match the sentence${bits.length ? ': ' + bits.join(' and ') : ''}.`;
      out.fix = 'Copy every word exactly. Only the punctuation and capital letters should change.';
      break;
    }
    default:
      out.what = 'Something is not right here.';
      out.fix = 'Check it against the rules.';
  }
  return out;
}

// ---------- the diff ----------

export function lcsMissingExtra(cKeys, pKeys) {
  if (cKeys.length > 120 || pKeys.length > 120) return { missing: [], extra: [] };
  const n = cKeys.length;
  const m = pKeys.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = cKeys[i] === pKeys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const missing = [];
  const extra = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (cKeys[i] === pKeys[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) missing.push(cKeys[i++]);
    else extra.push(pKeys[j++]);
  }
  while (i < n) missing.push(cKeys[i++]);
  while (j < m) extra.push(pKeys[j++]);
  return { missing, extra };
}

function runCode(role, c, p) {
  if (c === p) return null;
  if (c === '') return 'PUNCT_EXTRA';
  const isEnd = /^[.!?…]+$/.test(c);
  switch (role) {
    case 'A':
      if (c === ',') return p === '' ? 'NO_COMMA_AFTER' : p === '.' ? 'STOP_BEFORE_TAG' : 'WRONG_END_PUNCT';
      if (isEnd) return p === '' ? 'NO_END_PUNCT' : p.length > c.length && p.startsWith(c) ? 'PUNCT_EXTRA' : 'WRONG_END_PUNCT';
      return 'PUNCT_OTHER';
    case 'B':
      if (c === ',') return 'NO_COMMA_BEFORE';
      if (isEnd) return 'NO_FULLSTOP_TAG';
      return 'PUNCT_OTHER';
    case 'N':
      if (isEnd) return p === '' ? 'NO_END_PUNCT' : 'WRONG_END_PUNCT';
      return 'PUNCT_OTHER';
    default:
      return 'PUNCT_OTHER';
  }
}

// Compare one gap. `cInfo` is the canonical gap's annotation, `pToks` the pupil's tokens.
function diffGap(cInfo, pToks, k) {
  const errs = [];
  const { runs: pRuns, q: pQ } = splitRuns(pToks);
  const cRuns = cInfo.runs;
  const cQ = cInfo.quotes.length;
  const handled = new Set();
  // punctuation outside the closing speech marks: ."  vs  ".
  if (pQ === cQ && cQ >= 1) {
    for (let i = 0; i < cRuns.length - 1; i++) {
      if (cRuns[i].role === 'A' && cRuns[i].s !== '' && pRuns[i] === '' && pRuns[i + 1].startsWith(cRuns[i].s) && cRuns[i + 1].s === '') {
        errs.push({ code: 'PUNCT_OUTSIDE', kind: 'g', index: k, expected: cRuns[i].s, got: pRuns[i + 1] });
        handled.add(i);
        handled.add(i + 1);
      }
    }
  }
  const len = Math.min(cRuns.length, pRuns.length);
  for (let i = 0; i < len; i++) {
    if (handled.has(i)) continue;
    const code = runCode(cRuns[i].role, cRuns[i].s, pRuns[i]);
    if (code) errs.push({ code, kind: 'g', index: k, expected: cRuns[i].s, got: pRuns[i], role: cRuns[i].role });
  }
  // Speech-mark errors come after the punctuation that sits next to them.
  if (pQ < cQ) {
    errs.push({ code: 'NO_QUOTES', kind: 'g', index: k, roles: cInfo.quotes.slice(pQ), expected: '"', got: '' });
  } else if (pQ > cQ) {
    errs.push({ code: 'EXTRA_QUOTES', kind: 'g', index: k, expected: '', got: '"' });
  }
  return errs;
}

function capCode(cTk, k, expectCap) {
  const info = cTk.info[k];
  const hasOpen = info.quotes.includes('open');
  const hasClose = info.quotes.includes('close');
  if (expectCap) {
    if (hasOpen) {
      // first spoken word on a new line (a new speaker) is a plain Rule 2 capital
      if (cTk.gaps[k].nl > 0) return 'NO_CAPITAL';
      // narration punctuation just before the opening quote
      const idx = info.runs.findIndex((r, i) => i < info.quotes.length && info.quotes[i] === 'open');
      const before = idx >= 0 ? info.runs[idx].s : '';
      if (k > 0 && /[.!?…]/.test(before)) return 'NO_CAPITAL_RESUME';
      return 'NO_CAPITAL';
    }
    if (k === 0) return 'NO_CAPITAL_SENT';
    const punct = cTk.gaps[k].p;
    if (/[.!?…]/.test(punct)) return 'NO_CAPITAL_SENT';
    return 'CAPITAL_PROPER';
  }
  if (hasClose) return 'TAG_CAPITAL';
  if (hasOpen) return 'RESUME_CAPITAL';
  return 'CAPITAL_EXTRA';
}

// Word-level differences for word k (capital letter, apostrophe).
function diffWord(cTk, k, pRaw) {
  const cRaw = cTk.words[k].raw;
  const errs = [];
  if (lowerRaw(cRaw) !== lowerRaw(pRaw)) {
    errs.push({ code: 'APOSTROPHE', kind: 'w', index: k, expected: cRaw, got: pRaw });
  }
  const cc = isCap(cRaw);
  const pc = isCap(pRaw);
  if (cc && !pc) errs.push({ code: capCode(cTk, k, true), kind: 'w', index: k, expected: cRaw, got: pRaw });
  else if (!cc && pc) errs.push({ code: capCode(cTk, k, false), kind: 'w', index: k, expected: cRaw, got: pRaw });
  return errs;
}

// Returns { aligned, errors } for an attempt tokenised as pTk against annotated cTk.
export function diffTokens(cTk, pTk) {
  const cw = cTk.words;
  const pw = pTk.words;
  const aligned = cw.length === pw.length && cw.every((w, i) => w.key === pw[i].key);
  if (!aligned) {
    const { missing, extra } = lcsMissingExtra(cw.map((w) => w.key), pw.map((w) => w.key));
    return { aligned: false, errors: [{ code: 'CHANGED_WORDS', kind: 'x', index: 0, missing, extra }] };
  }
  const errors = [];
  for (let k = 0; k <= cw.length; k++) {
    errors.push(...diffGap(cTk.info[k], pTk.gaps[k].toks, k));
    if (k < cw.length) errors.push(...diffWord(cTk, k, pw[k].raw));
  }
  // Gap k sits before word k: gaps sort before words at the same index.
  const order = (e) => e.index * 2 + (e.kind === 'w' ? 1 : 0);
  errors.sort((a, b) => order(a) - order(b));
  return { aligned: true, errors };
}

// ---------- Mode 1 ----------

// Line breaks matter only when a question sets `lines: true` (a new speaker needs a new line).
// Only breaks between two words are compared: leading / trailing blank lines and blank-line
// spacing (two newlines = one break) are ignored.
function lineErrors(cTk, pTk) {
  const errs = [];
  for (let k = 1; k < cTk.words.length; k++) {
    const want = cTk.gaps[k].nl > 0;
    const got = pTk.gaps[k].nl > 0;
    if (want && !got) errs.push({ code: 'NO_NEW_LINE', kind: 'g', index: k, expected: '\n', got: '' });
    else if (!want && got) errs.push({ code: 'EXTRA_NEW_LINE', kind: 'g', index: k, expected: '', got: '\n' });
  }
  return errs;
}

// `beat: true` marks a question whose speech follows an action (not a saying verb). The full stop that
// must end the action gets its own codes instead of the generic "full stop after saying words" one.
function beatCodes(errs) {
  for (const e of errs) {
    if (e.code !== 'NO_FULLSTOP_TAG') continue;
    if (e.got === ',') e.code = 'ACTION_COMMA';
    else if (e.got === '') e.code = 'ACTION_NO_STOP';
  }
}
const errOrder = (e) => e.index * 2 + (e.kind === 'w' ? 1 : 0);

export function checkMode1(data, answer) {
  const { text, singleQuotes } = normalizeText(answer);
  const pTk = tokenize(text);
  const candidates = [data.correct, ...(data.alts || [])].filter(Boolean).map(prepare);
  let best = null;
  for (const cTk of candidates) {
    const r = diffTokens(cTk, pTk);
    if (r.aligned) {
      if (data.lines) {
        r.errors.push(...lineErrors(cTk, pTk));
        r.errors.sort((a, b) => errOrder(a) - errOrder(b));
      }
      if (data.beat) beatCodes(r.errors);
    }
    if (r.errors.length === 0) {
      return { correct: true, errors: [], codes: [], note: singleQuotes ? 'single' : undefined };
    }
    const score = r.aligned ? r.errors.length : 1000;
    if (!best || score < best.score) best = { ...r, cTk, score };
  }
  const errors = best.errors.map((e) => explainErr(e, best.cTk));
  return {
    correct: false,
    errors,
    codes: [...new Set(errors.map((e) => e.code))],
    note: singleQuotes ? 'single' : undefined,
  };
}

export function modelAnswer(data) {
  return displayText(data.correct, true);
}

// ---------- Mode 2 ----------

// Works out every mistake in `faulty` against `correct`. Slots group the mistakes that
// sit in the same place (e.g. a word that needs both a capital letter and an apostrophe).
export function buildSlots(correct, faulty) {
  const cTk = prepare(correct);
  const fTk = tokenize(normalizeText(faulty).text);
  const d = diffTokens(cTk, fTk);
  if (!d.aligned) {
    return { valid: false, reason: 'The faulty and correct versions must use the same words. Only punctuation, capital letters and apostrophes may differ.', slots: [] };
  }
  const map = new Map();
  for (const e of d.errors) {
    const key = `${e.kind}${e.index}`;
    if (!map.has(key)) {
      const isGap = e.kind === 'g';
      map.set(key, {
        key,
        kind: e.kind,
        index: e.index,
        expected: isGap ? cTk.gaps[e.index].p : cTk.words[e.index].raw,
        expectedDisp: isGap ? gapDisplay(cTk, e.index) : displayText(cTk.words[e.index].raw),
        current: isGap ? fTk.gaps[e.index].p : fTk.words[e.index].raw,
        errors: [],
      });
    }
    map.get(key).errors.push(explainErr(e, cTk));
  }
  const slots = [...map.values()];
  if (slots.length === 0) return { valid: false, reason: 'There are no mistakes in the faulty version.', slots: [] };
  return { valid: true, slots, cTk };
}

function gapPunctFromValue(value) {
  const { text } = normalizeText(value);
  if (/[\p{L}\p{N}]/u.test(text)) return null;
  let p = '';
  for (const c of text) {
    if (isQuoteCh(c)) p += '"';
    else if (PUNCT.has(c)) p += c;
  }
  return p;
}

// Marks one fix typed into a slot. Returns { correct, errors, invalid? }
export function checkSlot(cTk, slot, value) {
  if (slot.kind === 'g') {
    const p = gapPunctFromValue(value ?? '');
    if (p === null) return { correct: false, invalid: true, errors: [], message: 'Type only the punctuation and speech marks that belong in this gap — no letters.' };
    if (p === slot.expected) return { correct: true, errors: [] };
    const errs = diffGap(cTk.info[slot.index], [...p], slot.index).map((e) => explainErr(e, cTk));
    if (!errs.length) errs.push(explainErr({ code: 'PUNCT_OTHER', kind: 'g', index: slot.index, expected: slot.expected, got: p }, cTk));
    return { correct: false, errors: errs };
  }
  const raw = String(value ?? '').trim();
  const tk = tokenize(normalizeText(raw).text);
  if (tk.words.length !== 1 || tk.gaps.some((g) => g.p)) {
    return { correct: false, invalid: true, errors: [], message: 'Type just the one word, with its correct capital letter and apostrophe.' };
  }
  const cWord = cTk.words[slot.index];
  if (tk.words[0].key !== cWord.key) {
    return { correct: false, invalid: true, errors: [], message: 'That is a different word. Only a capital letter or an apostrophe needs to change.' };
  }
  const errs = diffWord(cTk, slot.index, tk.words[0].raw).map((e) => explainErr(e, cTk));
  return { correct: errs.length === 0, errors: errs };
}

export function describeSlot(cTk, slot) {
  // Short plain-English line for the "mistakes" list after submitting.
  const cw = cTk.words;
  if (slot.kind === 'w') {
    const bits = slot.errors.map((e) => {
      if (e.code === 'APOSTROPHE') return 'needs an apostrophe';
      if (['NO_CAPITAL', 'NO_CAPITAL_SENT', 'NO_CAPITAL_RESUME', 'CAPITAL_PROPER'].includes(e.code)) return `needs a capital ${slot.expected[0]}`;
      return 'should be lowercase';
    });
    return `‘${displayText(slot.current)}’ should be ‘${slot.expectedDisp}’ (${bits.join(' and ')})`;
  }
  const prev = cw[slot.index - 1]?.raw;
  const next = cw[slot.index]?.raw;
  const where = prev ? `after ‘${prev}’` : `before ‘${next}’`;
  return `Gap ${where}: should be ${slot.expectedDisp ? '‘' + slot.expectedDisp + '’' : 'empty'}`;
}
