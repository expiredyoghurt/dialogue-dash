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
  // Not shown in analytics (not the pupil's mistake):
  VERB_PENDING: { rule: 7, label: 'Word awaiting teacher review', hidden: true },
  VERB_INVALID: { rule: 7, label: 'Not a single word', hidden: true },
};

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

export function rankFor(xp) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) idx = i;
  const next = RANKS[idx + 1] || null;
  return { index: idx, name: RANKS[idx].name, from: RANKS[idx].xp, next: next ? next.xp : null, nextName: next ? next.name : null };
}
