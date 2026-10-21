// Checker tests for the v1.1 question types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMode1, tokenize, normalizeText } from '../src/engine.js';
import { wordsFeedback, checkMode4, checkMode5, checkFix, tapTargets, expandVariants, allVariants, fixedSentence, validateMode4, validateMode5, validateMode6 } from '../src/modes.js';

const codes = (r) => r.errors.map((e) => e.code);

// ---------- Mode 1: new speaker, new line ----------
const L = {
  correct: '“Did you tell Mei the bridge is closed?” asked Raj.\n“No, I never said that,” replied Tally.',
  lines: true,
};
test('lines: the key, straight quotes, extra spaces and blank lines are accepted', () => {
  assert.equal(checkMode1(L, L.correct).correct, true);
  assert.equal(checkMode1(L, '"Did you tell Mei the bridge is closed?" asked Raj.\n"No, I never said that," replied Tally.').correct, true);
  assert.equal(checkMode1(L, '  “Did you tell Mei the bridge is closed?”   asked Raj.  \n\n  “No, I never said that,” replied Tally.\n').correct, true);
  assert.equal(checkMode1(L, '“Did you tell Mei the bridge is closed?” asked Raj.\r\n“No, I never said that,” replied Tally.').correct, true);
});
test('lines: a missing break has its own code, and nothing else fires', () => {
  const r = checkMode1(L, '“Did you tell Mei the bridge is closed?” asked Raj. “No, I never said that,” replied Tally.');
  assert.deepEqual(codes(r), ['NO_NEW_LINE']);
  assert.equal(r.errors[0].rule, 8);
  assert.match(r.errors[0].what, /different person/);
});
test('lines: a break in the wrong place is flagged, and punctuation errors keep their existing codes', () => {
  assert.deepEqual(codes(checkMode1(L, '“Did you tell Mei the bridge is closed?”\nasked Raj.\n“No, I never said that,” replied Tally.')), ['EXTRA_NEW_LINE']);
  assert.deepEqual(codes(checkMode1(L, '“Did you tell Mei the bridge is closed?” asked Raj.\n“No, I never said that” replied Tally.')), ['NO_COMMA_AFTER']);
  assert.deepEqual(codes(checkMode1(L, '“Did you tell Mei the bridge is closed?” asked Raj. “No, I never said that” replied Tally.')), ['NO_NEW_LINE', 'NO_COMMA_AFTER']);
});
test('lines: without the flag, line breaks stay insignificant (existing questions are unchanged)', () => {
  const plain = { correct: L.correct };
  assert.equal(checkMode1(plain, L.correct.replace('\n', ' ')).correct, true);
});
test('lines: three speakers', () => {
  const k = { correct: '“Ready?” called Zara.\n“Ready!” shouted Omar.\n“Wait for me,” puffed Lily.', lines: true };
  assert.equal(checkMode1(k, k.correct).correct, true);
  assert.deepEqual(codes(checkMode1(k, '“Ready?” called Zara.\n“Ready!” shouted Omar. “Wait for me,” puffed Lily.')), ['NO_NEW_LINE']);
  assert.deepEqual(codes(checkMode1(k, '“Ready?” called Zara. “Ready!” shouted Omar. “Wait for me,” puffed Lily.')), ['NO_NEW_LINE', 'NO_NEW_LINE']);
});

// ---------- Mode 1: action beat ----------
const B = { correct: 'Mei looked at the clock. “We’re going to be late,” groaned Mei.', beat: true };
test('beat: the key and straight-quote version are accepted', () => {
  assert.equal(checkMode1(B, B.correct).correct, true);
  assert.equal(checkMode1(B, `Mei looked at the clock. "We're going to be late," groaned Mei.`).correct, true);
});
test('beat: a comma after the action gets ACTION_COMMA, never the "comma after said" code', () => {
  const r = checkMode1(B, 'Mei looked at the clock, “We’re going to be late,” groaned Mei.');
  assert.deepEqual(codes(r), ['ACTION_COMMA']);
  assert.equal(r.errors[0].rule, 9);
  assert.match(r.errors[0].what, /not a saying verb/);
});
test('beat: the "comma before the opening quote" rule (NO_COMMA_BEFORE) never fires on this question', () => {
  for (const wrong of [
    'Mei looked at the clock, “We’re going to be late,” groaned Mei.',
    'Mei looked at the clock “We’re going to be late,” groaned Mei.',
    'mei looked at the clock we’re going to be late groaned mei',
    'Mei looked at the clock; “We’re going to be late,” groaned Mei.',
    'Mei looked at the clock “we’re going to be late” groaned Mei',
  ]) {
    assert.ok(!codes(checkMode1(B, wrong)).includes('NO_COMMA_BEFORE'), wrong);
  }
});
test('beat: a missing full stop is ACTION_NO_STOP, and the rest still uses existing codes', () => {
  assert.deepEqual(codes(checkMode1(B, 'Mei looked at the clock “We’re going to be late,” groaned Mei.')), ['ACTION_NO_STOP']);
  assert.deepEqual(codes(checkMode1(B, 'Mei looked at the clock. “We’re going to be late.” groaned Mei.')), ['STOP_BEFORE_TAG']);
  assert.deepEqual(codes(checkMode1(B, 'Mei looked at the clock. “We’re going to be late” groaned Mei.')), ['NO_COMMA_AFTER']);
  assert.ok(codes(checkMode1(B, 'mei looked at the clock. “We’re going to be late,” groaned mei.')).includes('NO_CAPITAL_SENT'));
});
test('beat: an ordinary question keeps the old code for the same mistake', () => {
  const k = { correct: '“I’m tired,” said Raj. “Let’s go home.”' };
  assert.deepEqual(codes(checkMode1(k, '“I’m tired,” said Raj, “Let’s go home.”')), ['NO_FULLSTOP_TAG']);
});

// ---------- Mode 4: multiple choice ----------
const MC1 = validateMode4({
  stem: '“Open the gate!” said the guard. Which verb is the best upgrade for “said”?',
  options: [{ text: 'whispered' }, { text: 'bellowed' }, { text: 'giggled' }, { text: 'wondered' }],
  correct: ['b'],
  explanation: 'x',
});
test('mode 4 single: only the key is accepted, every distractor is rejected', () => {
  assert.equal(checkMode4(MC1, ['b']).correct, true);
  for (const id of ['a', 'c', 'd']) assert.equal(checkMode4(MC1, [id]).correct, false, id);
});
test('mode 4: the wrong count or unknown ids are invalid, not wrong', () => {
  assert.equal(checkMode4(MC1, []).invalid, true);
  assert.equal(checkMode4(MC1, ['a', 'b']).invalid, true);
  assert.equal(checkMode4(MC1, ['zz']).invalid, true);
  assert.equal(checkMode4(MC1, 'b').invalid, true);
});
test('mode 4: "why" notes come back only for the wrong options chosen', () => {
  const d = validateMode4({ stem: 's', options: [{ text: 'one' }, { text: 'two', why: 'because' }, { text: 'three', why: 'nope' }], correct: ['a'], explanation: 'e' });
  const r = checkMode4(d, ['b']);
  assert.deepEqual(r.whys, { b: 'because' });
  assert.deepEqual(r.wrongIds, ['b']);
});
const MC2 = validateMode4({
  stem: 'Which TWO details show she isn’t “fine”?',
  options: ['folding her arms', 'staring at the door for an hour', 'muttered', 'did not turn around', 'Wren smiled', 'the door is mentioned'].map((text) => ({ text })),
  correct: ['a', 'b', 'c', 'd'],
  pick: 2,
  explanation: 'x',
});
test('mode 4 pick-two: any two valid details pass, anything with a distractor fails', () => {
  const valid = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.equal(checkMode4(MC2, [valid[i], valid[j]]).correct, true, valid[i] + valid[j]);
  for (const v of valid) for (const x of ['e', 'f']) assert.equal(checkMode4(MC2, [v, x]).correct, false, v + x);
  assert.equal(checkMode4(MC2, ['e', 'f']).correct, false);
  assert.deepEqual(checkMode4(MC2, ['a', 'e']).wrongIds, ['e']);
  assert.equal(checkMode4(MC2, ['a', 'a']).invalid, true); // the same option twice is not two choices
  assert.equal(checkMode4(MC2, ['a']).invalid, true);
  assert.equal(checkMode4(MC2, ['a', 'b', 'c']).invalid, true);
});
test('mode 4 validation catches bad authoring', () => {
  const ok = { stem: 's', options: [{ text: 'a' }, { text: 'b' }], correct: ['a'], explanation: 'e' };
  assert.doesNotThrow(() => validateMode4(ok));
  assert.throws(() => validateMode4({ ...ok, correct: [] }), /Mark at least one/);
  assert.throws(() => validateMode4({ ...ok, correct: ['a', 'b'] }), /must be wrong/);
  assert.throws(() => validateMode4({ ...ok, correct: ['z'] }), /isn’t one of the options/);
  assert.throws(() => validateMode4({ ...ok, pick: 2 }), /between 1 and 1/);
  assert.throws(() => validateMode4({ ...ok, explanation: '' }), /explanation/);
  assert.throws(() => validateMode4({ ...ok, options: [{ text: 'a' }] }), /at least two/);
  assert.throws(() => validateMode4({ ...ok, options: [{ text: 'a' }, { text: 'A' }] }), /same thing/);
});

// ---------- Mode 5: free-text transform ----------
const T4 = validateMode5({ prompt: '“I am going to the Warren,” said Brisk.', instruction: 'Rewrite as reported speech.', accepted: ['Brisk said (that) she was going to the Warren.'] });
test('mode 5 reported: with or without “that”, case, spacing and final full stop', () => {
  for (const a of [
    'Brisk said that she was going to the Warren.',
    'Brisk said she was going to the Warren.',
    'Brisk said she was going to the Warren',
    'brisk said she was going to the warren.',
    '  Brisk   said   that she was  going to the Warren . ',
    'BRISK SAID THAT SHE WAS GOING TO THE WARREN',
  ]) assert.equal(checkMode5(T4, a).correct, true, a);
});
test('mode 5: case and final-stop slips are accepted with a gentle note', () => {
  assert.deepEqual(checkMode5(T4, 'Brisk said she was going to the Warren.').notes, []);
  assert.deepEqual(checkMode5(T4, 'brisk said she was going to the warren.').notes, ['case']);
  assert.deepEqual(checkMode5(T4, 'Brisk said she was going to the Warren').notes, ['end']);
});
test('mode 5 reported: wrong tense, wrong pronoun, unchanged text and extra words are rejected', () => {
  for (const a of [
    'Brisk said she is going to the Warren.',
    'Brisk said she am going to the Warren.',
    'Brisk said I was going to the Warren.',
    'Brisk said he was going to the Warren.',
    'Brisk said she was going to the Burrow.',
    '“I am going to the Warren,” said Brisk.',
    'Brisk said she was going to the Warren yesterday.',
    'Brisk was going to the Warren.',
  ]) {
    const r = checkMode5(T4, a);
    assert.equal(r.correct, false, a);
  }
});
test('mode 5 reported: speech marks in reported speech are flagged with the engine’s own feedback', () => {
  const r = checkMode5(T4, 'Brisk said, “she was going to the Warren.”');
  assert.equal(r.correct, false);
  assert.ok(r.codes.length > 0);
  assert.notEqual(r.codes[0], 'SPEECH_WORDS');
});
const T5 = validateMode5({
  prompt: 'Daisy told Erica that she would ring the bell the next day.',
  instruction: 'Rewrite as direct speech.',
  accepted: ['Daisy said to Erica, “I will ring the bell tomorrow.”', 'Daisy told Erica, “I will ring the bell tomorrow.”', 'Daisy said to Erica, “I’ll ring the bell tomorrow.”'],
});
test('mode 5 direct: all listed answers, straight or curly quotes, case and spacing', () => {
  for (const a of [
    'Daisy said to Erica, “I will ring the bell tomorrow.”',
    'Daisy told Erica, “I will ring the bell tomorrow.”',
    'Daisy said to Erica, “I’ll ring the bell tomorrow.”',
    'Daisy said to Erica, "I will ring the bell tomorrow."',
    `Daisy said to Erica, "I'll ring the bell tomorrow."`,
    'daisy told erica, “i will ring the bell tomorrow.”',
    'Daisy  told  Erica ,  “ I will ring the bell tomorrow. ”',
    `Daisy told Erica, 'I will ring the bell tomorrow.'`,
  ]) assert.equal(checkMode5(T5, a).correct, true, a);
  assert.deepEqual(checkMode5(T5, `Daisy told Erica, 'I will ring the bell tomorrow.'`).notes, ['single']);
});
test('mode 5 direct: punctuation mistakes are caught with specific feedback', () => {
  const miss = checkMode5(T5, 'Daisy told Erica “I will ring the bell tomorrow.”');
  assert.equal(miss.correct, false);
  assert.ok(miss.codes.includes('NO_COMMA_BEFORE'));
  const outside = checkMode5(T5, 'Daisy told Erica, “I will ring the bell tomorrow”.');
  assert.equal(outside.correct, false);
  assert.deepEqual(outside.codes, ['PUNCT_OUTSIDE']);
  const noQuotes = checkMode5(T5, 'Daisy told Erica, I will ring the bell tomorrow.');
  assert.equal(noQuotes.correct, false);
  assert.ok(noQuotes.codes.includes('NO_QUOTES'));
  const noStop = checkMode5(T5, 'Daisy told Erica, “I will ring the bell tomorrow”');
  assert.equal(noStop.correct, false);
  assert.ok(noStop.codes.includes('NO_END_PUNCT'));
});
test('mode 5 direct: wrong words are rejected with a hint that does not give the answer away', () => {
  for (const a of [
    'Daisy told Erica, “She would ring the bell the next day.”',
    'Daisy told Erica, “I would ring the bell tomorrow.”',
    'Daisy told Erica, “I will ring the bell the next day.”',
    'Daisy told Erica, “I will ring the bell yesterday.”',
    'Daisy told Erica that she would ring the bell the next day.',
  ]) assert.equal(checkMode5(T5, a).correct, false, a);
  const r = checkMode5(T5, 'Daisy told Erica, “I would ring the bell tomorrow.”');
  assert.deepEqual(r.codes, ['SPEECH_WORDS']);
  const fb = wordsFeedback(r.words, tokenize(normalizeText('Daisy told Erica, “I would ring the bell tomorrow.”').text).words);
  assert.match(fb.what, /would/); // points at the pupil's own word
  assert.ok(!/\bwill\b/.test(fb.what + fb.fix)); // but never says what the answer is
});
test('mode 5 expansion: optional words and alternatives, with a cap', () => {
  assert.deepEqual(expandVariants('He said (that) it was [big|large].').sort(), ['He said it was big.', 'He said it was large.', 'He said that it was big.', 'He said that it was large.']);
  assert.equal(allVariants(T4).length, 2);
  assert.throws(() => validateMode5({ prompt: 'p', instruction: 'i', accepted: ['[a|b] [a|b] [a|b] [a|b] [a|b] [a|b] [a|b]'] }), /limit/);
  assert.throws(() => validateMode5({ prompt: 'p', instruction: 'i', accepted: [] }), /at least one/);
  assert.throws(() => validateMode5({ prompt: 'x y', instruction: 'i', accepted: ['x y'] }), /same as/);
});

// ---------- Mode 6: tap the wrong word, type the fix ----------
const T6 = validateMode6({ sentence: 'The knight walked into the hall and sees a crown.', wrong: ['sees'], fixes: ['saw'] });
test('mode 6: only the wrong word is a tap target', () => {
  assert.deepEqual(tapTargets(T6), [7]);
});
test('mode 6 fix: saw in any case, spacing or with a full stop; everything else rejected', () => {
  for (const f of ['saw', 'Saw', '  SAW ', 'saw.']) assert.equal(checkFix(T6, f).ok, true, f);
  assert.equal(checkFix(T6, 'sees').kind, 'same');
  for (const f of ['see', 'seen', 'sawed', 'looks', 'walked']) assert.equal(checkFix(T6, f).ok, false, f);
  assert.equal(checkFix(T6, '').kind, 'empty');
  assert.equal(checkFix(T6, '“saw”').ok, true); // stray speech marks are forgiven
  assert.equal(checkFix(T6, 'he saw a big old crown').kind, 'format');
});
test('mode 6: the wrong word and the accepted fixes are lists, and more variants can be added', () => {
  const d = validateMode6({ sentence: 'Yesterday the class visited the museum and learn about dinosaurs.', wrong: 'learn', fixes: 'learned, learnt' });
  assert.deepEqual(d.wrong, ['learn']);
  assert.deepEqual(d.fixes, ['learned', 'learnt']);
  assert.equal(checkFix(d, 'learnt').ok, true);
  const more = { ...d, fixes: [...d.fixes, 'studied'] };
  assert.equal(checkFix(more, 'studied').ok, true);
});
test('mode 6: the corrected sentence swaps the word', () => {
  assert.equal(fixedSentence(T6, 7), 'The knight walked into the hall and saw a crown.');
});
test('mode 6 validation', () => {
  assert.throws(() => validateMode6({ sentence: 'The knight walked in.', wrong: ['flew'], fixes: ['x'] }), /isn’t in the sentence/);
  assert.throws(() => validateMode6({ sentence: 'The knight walked in and sees.', wrong: ['sees'], fixes: ['sees'] }), /same as the wrong word/);
  assert.throws(() => validateMode6({ sentence: 'The knight walked in and sees.', wrong: ['sees'], fixes: [] }), /at least one/);
});
