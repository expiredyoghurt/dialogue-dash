import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMode1, buildSlots, checkSlot, stripToPrompt, displayText, clientTokens, normalizeText } from '../src/engine.js';

const codes = (r) => r.errors.map((e) => e.code);
const q1 = (correct, alts) => ({ correct, alts });

test('Mode 1: the three examples from the brief are accepted', () => {
  assert.equal(checkMode1(q1('Raj said, “I want to be a doctor.”'), 'Raj said, “I want to be a doctor.”').correct, true);
  assert.equal(checkMode1(q1('“Can I have some water?” asked Noor.'), '“Can I have some water?” asked Noor.').correct, true);
  assert.equal(checkMode1(q1('“That’s so funny!” laughed Mei.'), '"That\'s so funny!" laughed Mei.').correct, true);
});

test('Mode 1: straight, curly and single quotes all parse; spacing is ignored', () => {
  const k = q1('Raj said, “I want to be a doctor.”');
  assert.equal(checkMode1(k, 'Raj said,"I want to be a doctor."').correct, true);
  assert.equal(checkMode1(k, 'Raj   said,  " I want to be a doctor. "').correct, true);
  const single = checkMode1(k, "Raj said, 'I want to be a doctor.'");
  assert.equal(single.correct, true);
  assert.equal(single.note, 'single');
});

test('Mode 1: stripped prompts from the brief give the right errors', () => {
  const k1 = q1('Raj said, “I want to be a doctor.”');
  assert.deepEqual(codes(checkMode1(k1, 'Raj said I want to be a doctor')), ['NO_COMMA_BEFORE', 'NO_QUOTES', 'NO_END_PUNCT', 'NO_QUOTES']);
  const k2 = q1('“Can I have some water?” asked Noor.');
  const r2 = checkMode1(k2, 'Can I have some water asked Noor');
  assert.deepEqual(codes(r2), ['NO_QUOTES', 'NO_END_PUNCT', 'NO_QUOTES', 'NO_END_PUNCT']);
  assert.match(r2.errors[1].what, /question mark/);
  assert.match(r2.errors[3].what, /full stop/);
  const k3 = q1('“That’s so funny!” laughed Mei.');
  assert.deepEqual(codes(checkMode1(k3, "That's so funny laughed Mei")), ['NO_QUOTES', 'NO_END_PUNCT', 'NO_QUOTES', 'NO_END_PUNCT']);
});

test('Mode 1: punctuation outside the speech marks is its own error', () => {
  const k = q1('“Let’s go,” said Chen.');
  const r = checkMode1(k, '“Let’s go”, said Chen.');
  assert.deepEqual(codes(r), ['PUNCT_OUTSIDE']);
  assert.equal(r.errors[0].rule, 5);
});

test('Mode 1: full stop instead of comma before the saying words, and capitalised tag', () => {
  const k = q1('“Let’s go,” said Chen.');
  assert.deepEqual(codes(checkMode1(k, '“Let’s go.” said Chen.')), ['STOP_BEFORE_TAG']);
  assert.deepEqual(codes(checkMode1(k, '“Let’s go.” Said Chen.')), ['STOP_BEFORE_TAG', 'TAG_CAPITAL']);
  assert.deepEqual(codes(checkMode1(k, '“Let’s go,” Said Chen.')), ['TAG_CAPITAL']);
  assert.deepEqual(codes(checkMode1(k, '“Let’s go” said Chen.')), ['NO_COMMA_AFTER']);
});

test('Mode 1: capitals', () => {
  const k = q1('Raj said, “I want to be a doctor.”');
  assert.deepEqual(codes(checkMode1(k, 'Raj said, “i want to be a doctor.”')), ['NO_CAPITAL']);
  const kI = q1('Raj said, “Today I won.”');
  assert.deepEqual(codes(checkMode1(kI, 'Raj said, “Today i won.”')), ['CAPITAL_PROPER']);
  const k2 = q1('Raj said, “We won the game.”');
  assert.deepEqual(codes(checkMode1(k2, 'Raj said, “we won the game.”')), ['NO_CAPITAL']);
  assert.deepEqual(codes(checkMode1(k2, 'raj said, “We won the game.”')), ['NO_CAPITAL_SENT']);
  const k3 = q1('“We won,” said Raj.');
  assert.deepEqual(codes(checkMode1(k3, '“We won,” said raj.')), ['CAPITAL_PROPER']);
});

test('Mode 1: two sentences of speech and resumed speech (Rule 6)', () => {
  const k = q1('“I’m tired,” said Raj. “Let’s go home.”');
  assert.equal(checkMode1(k, '“I’m tired,” said Raj. “Let’s go home.”').correct, true);
  assert.deepEqual(codes(checkMode1(k, '“I’m tired,” said Raj. “let’s go home.”')), ['NO_CAPITAL_RESUME']);
  assert.deepEqual(codes(checkMode1(k, '“I’m tired,” said Raj “Let’s go home.”')), ['NO_FULLSTOP_TAG']);
  const k2 = q1('“I think,” said Raj, “that we should go.”');
  assert.equal(checkMode1(k2, '“I think,” said Raj, “that we should go.”').correct, true);
  assert.deepEqual(codes(checkMode1(k2, '“I think,” said Raj, “That we should go.”')), ['RESUME_CAPITAL']);
  assert.deepEqual(codes(checkMode1(k2, '“I think,” said Raj “that we should go.”')), ['NO_COMMA_BEFORE']);
});

test('Mode 1: apostrophes and changed words', () => {
  const k = q1('“That’s so funny!” laughed Mei.');
  assert.deepEqual(codes(checkMode1(k, '“Thats so funny!” laughed Mei.')), ['APOSTROPHE']);
  const r = checkMode1(k, '“That is so funny!” laughed Mei.');
  assert.deepEqual(codes(r), ['CHANGED_WORDS']);
  assert.equal(r.errors[0].missing[0], 'thats');
  const r2 = checkMode1(k, '“That’s funny!” laughed Mei.');
  assert.deepEqual(r2.errors[0].missing, ['so']);
});

test('Mode 1: alternative accepted answers', () => {
  const k = q1('“I’m hungry,” said Tan.', ['“I’m hungry”, said Tan.']);
  assert.equal(checkMode1(k, '“I’m hungry”, said Tan.').correct, true);
});

test('Mode 2: the example from the brief is auto-diffed', () => {
  const correct = '“Let’s go to the library,” said Chen.\n“OK,” said Vera. “Can we read comics?”';
  const faulty = '“lets go to the library said Chen.\n"ok" said Vera can we read comics';
  const r = buildSlots(correct, faulty);
  assert.equal(r.valid, true);
  const flat = r.slots.flatMap((s) => s.errors.map((e) => e.code));
  for (const c of ['NO_CAPITAL', 'APOSTROPHE', 'NO_COMMA_AFTER', 'NO_QUOTES', 'NO_END_PUNCT']) assert.ok(flat.includes(c), `missing ${c}: ${flat}`);
  // "lets" has two problems in one slot
  const lets = r.slots.find((s) => s.kind === 'w' && s.index === 0);
  assert.deepEqual(lets.errors.map((e) => e.code).sort(), ['APOSTROPHE', 'NO_CAPITAL']);
  // "OK": the faulty text has "ok" — lowercase
  assert.ok(r.slots.find((s) => s.kind === 'w' && s.current === 'ok'));
});

test('Mode 2: slot checking', () => {
  const correct = '“Let’s go to the library,” said Chen.';
  const faulty = '“lets go to the library said Chen.';
  const r = buildSlots(correct, faulty);
  const wordSlot = r.slots.find((s) => s.kind === 'w');
  const gapSlot = r.slots.find((s) => s.kind === 'g' && s.expected === ',"');
  assert.ok(wordSlot && gapSlot);
  assert.equal(checkSlot(r.cTk, wordSlot, 'Let’s').correct, true);
  assert.equal(checkSlot(r.cTk, wordSlot, "Let's").correct, true);
  const half = checkSlot(r.cTk, wordSlot, 'Lets');
  assert.equal(half.correct, false);
  assert.deepEqual(half.errors.map((e) => e.code), ['APOSTROPHE']);
  assert.equal(checkSlot(r.cTk, wordSlot, 'let’s').correct, false);
  assert.equal(checkSlot(r.cTk, wordSlot, 'cat').invalid, true);
  assert.equal(checkSlot(r.cTk, gapSlot, ',”').correct, true);
  assert.equal(checkSlot(r.cTk, gapSlot, ', "').correct, true);
  const outside = checkSlot(r.cTk, gapSlot, '",');
  assert.equal(outside.correct, false);
  assert.equal(outside.errors[0].code, 'PUNCT_OUTSIDE');
  assert.equal(checkSlot(r.cTk, gapSlot, 'abc').invalid, true);
});

test('Mode 2: rejects faulty text with different words, or no mistakes', () => {
  assert.equal(buildSlots('“Hi,” said Raj.', '“Hello,” said Raj.').valid, false);
  assert.equal(buildSlots('“Hi,” said Raj.', '“Hi,” said Raj.').valid, false);
});

test('prompt generation', () => {
  assert.equal(stripToPrompt('Raj said, “I want to be a doctor.”'), 'Raj said I want to be a doctor');
  assert.equal(stripToPrompt('“Can I have some water?” asked Noor.'), 'Can I have some water asked Noor');
  assert.equal(stripToPrompt('“Let’s go home,” said Chen.', { lowerFirstSpoken: true }), 'let’s go home said Chen');
  assert.equal(stripToPrompt('Raj said, “I want to be a doctor.”', { lowerFirstSpoken: true }), 'Raj said I want to be a doctor');
  assert.equal(stripToPrompt('“We won!” cheered Dan.', { lowerFirstSpoken: true }), 'we won cheered Dan');
});

test('display helpers', () => {
  assert.equal(displayText('Raj said, "I\'m here."'), 'Raj said, “I’m here.”');
  const t = clientTokens('"lets go" said Chen');
  assert.equal(t.words.length, 4);
  assert.equal(t.gaps.length, 5);
  assert.equal(normalizeText("'Hi,' said Raj.").singleQuotes, true);
});
