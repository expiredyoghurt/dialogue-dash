// Rules and error-code metadata, shared by the Worker (feedback + analytics labels)
// and sent to the browser through /api/meta.

export const RULES = {
  1: {
    n: 1,
    short: 'Speech marks',
    title: 'Use Speech Marks Around Spoken Words',
    tip: 'Only the words someone actually says go inside the speech marks.',
    good: 'Raj said, “I want to be a doctor.”',
  },
  2: {
    n: 2,
    short: 'Capital letters',
    title: 'Start with a Capital Letter Inside the Speech Marks',
    tip: 'The first spoken word begins with a capital. Names and the word “I” always have one too.',
    good: '“Can I have some water?” asked Noor.',
  },
  3: {
    n: 3,
    short: 'End punctuation',
    title: 'End the Spoken Words with Punctuation (. ! ?)',
    tip: 'Use a full stop, exclamation mark or question mark. If the saying words come next, use a comma instead (Rule 5).',
    good: '“That’s so funny!” laughed Mei.',
  },
  4: {
    n: 4,
    short: 'Comma after said',
    title: 'Comma After “Said” (or Any Other “Saying Verb”) When the Sentence Starts with It',
    tip: 'When the saying words come first, put a comma before the opening speech marks.',
    good: 'Raj said, “I want to be a doctor.”',
  },
  5: {
    n: 5,
    short: 'Punctuation inside',
    title: 'Punctuation Goes Inside the Speech Marks. If the Saying Words Follow, Use a Comma and Keep Them Lowercase',
    tip: 'Write “Let’s go,” said Chen — not “Let’s go”, said Chen and not “Let’s go.” Said Chen. After ? or ! the saying words are still lowercase.',
    good: '“Let’s go,” said Chen.',
  },
  6: {
    n: 6,
    short: 'New or same sentence',
    title: 'New Sentence = Capital Letter. Same Sentence Carrying On = Lowercase',
    tip: 'If the saying words only pause the sentence, the speech restarts in lowercase. If a new sentence begins, it starts with a capital.',
    good: '“I think,” said Raj, “that we should go.”   “I’m tired,” said Raj. “Let’s go home.”',
  },
  7: {
    n: 7,
    short: 'Strong verbs',
    title: 'Choose a Saying Verb That Shows How the Speaker Feels',
    tip: 'Replace said and asked with a verb that shows volume, mood or feeling.',
    good: '“I can’t find my homework,” stammered Mei.',
  },
  8: {
    n: 8,
    short: 'New speaker, new line',
    title: 'A New Speaker Means a New Line',
    tip: 'Start a new line every time a different person starts speaking. It’s how readers keep track of who’s talking.',
    good: '“Did you tell Mei?” asked Raj.\n“No,” replied Tally.',
  },
  9: {
    n: 9,
    short: 'Action, then speech',
    title: 'An Action Is Not a Saying Verb: End It with a Full Stop',
    tip: 'If someone does something (looked, nodded, sighed) before they speak, finish that sentence with a full stop. The speech starts fresh.',
    good: 'Mei looked at the clock. “We’re going to be late,” groaned Mei.',
  },
  10: {
    n: 10,
    short: 'Direct and reported speech',
    title: 'Direct Speech Uses Speech Marks. Reported Speech Does Not',
    tip: 'Reported speech steps back in time (am going → was going) and changes the pronouns (I → she). Going back to direct speech undoes those changes.',
    good: 'Brisk said that she was going to the Warren.',
  },
  11: {
    n: 11,
    short: 'Keep the tense',
    title: 'Keep the Verbs in the Same Time',
    tip: 'If the story is in the past, every verb that tells the story stays in the past.',
    good: 'The knight walked into the hall and saw a crown.',
  },
  12: {
    n: 12,
    short: 'Reading between the lines',
    title: 'Read Between the Lines',
    tip: 'What characters do and how they say things can show feelings that their words hide.',
    good: '“I’m fine,” said Ilse, folding her arms.',
  },
  0: {
    n: 0,
    short: 'Other',
    title: 'Other Mistakes',
    tip: 'Apostrophes, copying the words exactly, and other punctuation.',
    good: '',
  },
};

// code -> [rule, label for analytics, exclude-from-heatmap?]
export const CODES = {
  NO_QUOTES: { rule: 1, label: 'Missing speech marks' },
  EXTRA_QUOTES: { rule: 1, label: 'Extra speech marks' },
  NO_CAPITAL: { rule: 2, label: 'No capital at start of speech' },
  NO_CAPITAL_SENT: { rule: 2, label: 'No capital at start of sentence' },
  CAPITAL_PROPER: { rule: 2, label: 'No capital on name / “I”' },
  CAPITAL_EXTRA: { rule: 2, label: 'Capital where not needed' },
  NO_END_PUNCT: { rule: 3, label: 'Missing end punctuation' },
  WRONG_END_PUNCT: { rule: 3, label: 'Wrong end punctuation' },
  NO_FULLSTOP_TAG: { rule: 3, label: 'Missing full stop after saying words' },
  PUNCT_EXTRA: { rule: 3, label: 'Extra punctuation' },
  PUNCT_OTHER: { rule: 3, label: 'Other punctuation' },
  NO_COMMA_BEFORE: { rule: 4, label: 'No comma after said' },
  NO_COMMA_AFTER: { rule: 5, label: 'No comma before closing marks' },
  STOP_BEFORE_TAG: { rule: 5, label: 'Full stop before saying words' },
  PUNCT_OUTSIDE: { rule: 5, label: 'Punctuation outside speech marks' },
  TAG_CAPITAL: { rule: 5, label: 'Capital on the saying words' },
  NO_CAPITAL_RESUME: { rule: 6, label: 'No capital for new sentence of speech' },
  RESUME_CAPITAL: { rule: 6, label: 'Capital when sentence carries on' },
  APOSTROPHE: { rule: 0, label: 'Apostrophe' },
  CHANGED_WORDS: { rule: 0, label: 'Changed or missed words' },
  WEAK_VERB: { rule: 7, label: 'Plain verb (said / asked)' },
  VERB_NOT_SPEECH: { rule: 7, label: 'Not a saying verb' },
  VERB_MISMATCH: { rule: 7, label: 'Verb doesn’t match the feeling' },
  WRONG_TENSE: { rule: 7, label: 'Verb tense' },
  // New question types (v1.1)
  NO_NEW_LINE: { rule: 8, label: 'Two speakers on one line' },
  EXTRA_NEW_LINE: { rule: 8, label: 'Line break in the middle of one speaker’s line' },
  ACTION_COMMA: { rule: 9, label: 'Comma after an action (needs a full stop)' },
  ACTION_NO_STOP: { rule: 9, label: 'No full stop after an action' },
  MC_VERB: { rule: 7, label: 'Chose a verb that doesn’t fit the feeling' },
  MC_INFER: { rule: 12, label: 'Missed the clue (reading between the lines)' },
  MC_WRONG: { rule: 0, label: 'Multiple-choice slip' },
  SPEECH_WORDS: { rule: 10, label: 'Direct / reported speech: wrong words' },
  SPEECH_QUOTES: { rule: 10, label: 'Speech marks in reported speech' },
  TENSE_NOT_SPOTTED: { rule: 11, label: 'Didn’t spot the wrong tense' },
  TENSE_WRONG_FIX: { rule: 11, label: 'Wrong tense fix' },
  // Not shown in analytics (not the pupil's mistake):
  VERB_PENDING: { rule: 7, label: 'Word awaiting teacher review', hidden: true },
  VERB_INVALID: { rule: 7, label: 'Not a single word', hidden: true },
};

// Codes a Mode 4 question may record when a pupil chooses wrongly.
export const MC_CODES = ['MC_VERB', 'MC_INFER', 'MC_WRONG'];

export const HIDDEN_CODES = Object.entries(CODES)
  .filter(([, v]) => v.hidden)
  .map(([k]) => k);

export const TAGS = {
  loud: 'loud',
  soft: 'quiet / soft',
  happy: 'happy',
  excited: 'excited',
  sad: 'sad',
  angry: 'angry',
  scared: 'scared / nervous',
  shocked: 'shocked / surprised',
  proud: 'proud / confident',
  curious: 'curious / puzzled',
  pleading: 'pleading',
  mocking: 'mocking / sarcastic',
  calm: 'calm / matter-of-fact',
  kind: 'kind / comforting',
};

export const RANKS = [
  { xp: 0, name: 'Rookie Writer' },
  { xp: 60, name: 'Quote Keeper' },
  { xp: 160, name: 'Comma Captain' },
  { xp: 320, name: 'Tag Master' },
  { xp: 560, name: 'Dialogue Director' },
  { xp: 900, name: 'Master Storyteller' },
];

// xps: optional replacement XP thresholds (one per rank, set by the admin). The names never change.
export function rankFor(xp, xps) {
  const list = RANKS.map((r, i) => ({ name: r.name, xp: xps && Number.isInteger(xps[i]) ? xps[i] : r.xp }));
  let idx = 0;
  for (let i = 0; i < list.length; i++) if (xp >= list[i].xp) idx = i;
  const next = list[idx + 1] || null;
  return { index: idx, name: list[idx].name, from: list[idx].xp, next: next ? next.xp : null, nextName: next ? next.name : null };
}
