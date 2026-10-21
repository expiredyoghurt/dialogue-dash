// Content for the v1.1 question types. Edit, then run `npm run seed:new` to regenerate
//   seed-new-types.sql         the nine questions from the brief, exactly as written
//   seed-new-types-extra.sql   45 extra items (5 per type) for you to review before running
// Straight quotes are fine here; the builder turns them into curly quotes for every stored key.

// ---------------------------------------------------------------------------------------------
// The nine questions from the brief
// ---------------------------------------------------------------------------------------------
const ILSE = `"I'm fine," said Ilse, folding her arms.
Wren smiled gently. "You've been staring at that door for an hour."
"It's just a door," Ilse muttered, but she did not turn around.`;

export const REQUIRED = [
  // 1a. New speaker, new line (Mode 1)
  {
    mode: 1,
    data: {
      correct: `"Did you tell Mei the bridge is closed?" asked Raj.\n"No, I never said that," replied Tally.`,
      prompt: `"Did you tell Mei the bridge is closed?" asked Raj. "No, I never said that," replied Tally.`,
      instruction: 'Give each speaker their own line.',
      lines: true,
      tip: `A new speaker means a new line. It's how readers keep track of who's talking.`,
    },
  },
  // 2. Action beat plus speech tag (Mode 1)
  {
    mode: 1,
    data: {
      correct: `Mei looked at the clock. "We're going to be late," groaned Mei.`,
      prompt: `mei looked at the clock we're going to be late groaned mei`,
      beat: true,
      tip: `Looking isn't a saying verb, so that sentence ends with a full stop. The speech starts fresh, and the saying verb comes after the comma inside the speech marks.`,
    },
  },
  // 3. Upgrade the verb, multiple choice (Mode 4)
  {
    mode: 4,
    data: {
      stem: `"Open the gate!" said the guard. Which verb is the best upgrade for "said"?`,
      options: [
        { id: 'a', text: 'whispered', why: 'A whisper is quiet. An order has to be heard.' },
        { id: 'b', text: 'bellowed' },
        { id: 'c', text: 'giggled', why: 'Giggling shows amusement. An order is not a joke.' },
        { id: 'd', text: 'wondered', why: 'Wondering is a quiet thought or question, not a command.' },
      ],
      correct: ['b'],
      pick: 1,
      code: 'MC_VERB',
      explanation: `It's an order, and orders are shouted. Bellowed shows the volume and the guard's attitude.`,
    },
  },
  // 4. Direct to reported speech (Mode 5)
  {
    mode: 5,
    data: {
      prompt: `"I am going to the Warren," said Brisk.`,
      instruction: 'Rewrite as reported speech.',
      accepted: ['Brisk said (that) she was going to the Warren.'],
      tip: 'In reported speech the tense steps back (am going becomes was going) and I becomes she.',
    },
  },
  // 5. Reported to direct speech (Mode 5)
  {
    mode: 5,
    data: {
      prompt: 'Daisy told Erica that she would ring the bell the next day.',
      instruction: 'Rewrite as direct speech.',
      accepted: [
        'Daisy said to Erica, "I will ring the bell tomorrow."',
        'Daisy told Erica, "I will ring the bell tomorrow."',
        `Daisy said to Erica, "I'll ring the bell tomorrow."`,
        `Daisy told Erica, "I'll ring the bell tomorrow."`,
      ],
      tip: 'Go back to the speaker\'s own words: she would becomes I will, and the next day becomes tomorrow.',
    },
  },
  // 6. Tense fix (Mode 6)
  {
    mode: 6,
    data: {
      sentence: 'The knight walked into the hall and sees a crown.',
      wrong: ['sees'],
      fixes: ['saw'],
      tip: 'Keep the verbs in the same time. The story is in the past, so sees should be saw.',
    },
  },
  // 7, 8, 9. Reading between the lines: three questions, one passage, one group
  {
    mode: 4,
    data: {
      context: ILSE,
      stem: 'How does Ilse really feel?',
      options: [
        { id: 'a', text: 'calm', why: 'She says she is fine, but what she does tells a different story.' },
        { id: 'b', text: 'worried but hiding it' },
        { id: 'c', text: 'bored', why: 'Nobody who was bored would stare at one door for an hour.' },
        { id: 'd', text: 'angry with Wren', why: 'Wren is gentle, and Ilse is not snapping at her. Something else is on her mind.' },
      ],
      correct: ['b'],
      pick: 1,
      code: 'MC_INFER',
      group: 'rbtl-ilse',
      explanation: `Her words say "fine", but her folded arms, the hour spent staring at the door and her refusal to turn around all show she is worried and trying to hide it.`,
    },
  },
  {
    mode: 4,
    data: {
      context: ILSE,
      stem: `Which TWO details show she isn't "fine"?`,
      options: [
        { id: 'a', text: 'She is folding her arms.' },
        { id: 'b', text: 'She has been staring at the door for an hour.' },
        { id: 'c', text: 'She muttered her reply.' },
        { id: 'd', text: 'She did not turn around.' },
        { id: 'e', text: 'Wren smiled.', why: "Wren's smile shows how Wren feels, not Ilse." },
        { id: 'f', text: 'The door is mentioned.', why: 'The door only matters because of how long Ilse has been staring at it.' },
      ],
      correct: ['a', 'b', 'c', 'd'],
      pick: 2,
      code: 'MC_INFER',
      group: 'rbtl-ilse',
      explanation: 'Four details give her away: the folded arms, the hour of staring, the muttered reply and the refusal to turn around. Wren smiling and the door being mentioned say nothing about how Ilse feels.',
    },
  },
  {
    mode: 4,
    data: {
      context: ILSE,
      stem: 'Why does Wren smile gently?',
      options: [
        { id: 'a', text: "To show she understands and isn't scolding" },
        { id: 'b', text: 'To laugh at Ilse for staring at the door', why: 'Gently tells us the smile is kind, not mocking.' },
        { id: 'c', text: 'To hide that she is annoyed with Ilse', why: 'Nothing in the passage shows Wren is annoyed.' },
        { id: 'd', text: 'To agree that Ilse is fine', why: 'Wren has just pointed out that Ilse is not acting fine.' },
      ],
      correct: ['a'],
      pick: 1,
      code: 'MC_INFER',
      group: 'rbtl-ilse',
      explanation: 'The word gently and what Wren says next show she has noticed how Ilse is feeling and wants to help, not tell her off.',
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Extras: five of each type, for review
// ---------------------------------------------------------------------------------------------
const NEWLINE_TIP = `A new speaker means a new line. It's how readers keep track of who's talking.`;
const lines = (correct) => ({
  mode: 1,
  data: {
    correct,
    prompt: correct.replace(/\n/g, ' '),
    instruction: 'Give each speaker their own line.',
    lines: true,
    tip: NEWLINE_TIP,
  },
});
const BEAT_TIP = `An action isn't a saying verb, so that sentence ends with a full stop. The speech starts fresh with a capital letter.`;
const beat = (correct, prompt) => ({ mode: 1, data: { correct, prompt, beat: true, tip: BEAT_TIP } });
const verbMc = (stem, good, others, explanation) => ({
  mode: 4,
  data: {
    stem,
    options: [{ id: 'a', text: good }, ...others.map(([text, why], i) => ({ id: String.fromCharCode(98 + i), text, why }))],
    correct: ['a'],
    pick: 1,
    code: 'MC_VERB',
    explanation,
  },
});
const transform = (prompt, instruction, accepted, tip) => ({ mode: 5, data: { prompt, instruction, accepted, tip } });
const tense = (sentence, wrong, fixes, tip) => ({ mode: 6, data: { sentence, wrong, fixes, tip } });
const passage = (id, text, feel, details, why) => [
  {
    mode: 4,
    data: {
      context: text,
      stem: feel.stem,
      options: feel.options.map(([t, w], i) => ({ id: String.fromCharCode(97 + i), text: t, ...(w ? { why: w } : {}) })),
      correct: [feel.key],
      pick: 1,
      code: 'MC_INFER',
      group: id,
      explanation: feel.explanation,
    },
  },
  {
    mode: 4,
    data: {
      context: text,
      stem: details.stem,
      options: details.options.map(([t, w], i) => ({ id: String.fromCharCode(97 + i), text: t, ...(w ? { why: w } : {}) })),
      correct: details.correct,
      pick: 2,
      code: 'MC_INFER',
      group: id,
      explanation: details.explanation,
    },
  },
  {
    mode: 4,
    data: {
      context: text,
      stem: why.stem,
      options: why.options.map(([t, w], i) => ({ id: String.fromCharCode(97 + i), text: t, ...(w ? { why: w } : {}) })),
      correct: [why.key],
      pick: 1,
      code: 'MC_INFER',
      group: id,
      explanation: why.explanation,
    },
  },
];

export const EXTRA = [
  // --- 1a. New speaker, new line
  lines(`"Is the library open on Sundays?" asked Priya.\n"Not any more," answered Mr Goh.`),
  lines(`"Have you seen my umbrella?" asked Kai.\n"It's by the door," said Nadia.`),
  lines(`"Who left the window open?" demanded Mrs Lee.\n"It wasn't me," whispered Danial.`),
  lines(`"Can we start the experiment now?" asked Hui Min.\n"Not until the goggles are on," replied Mr Pillai.`),
  lines(`"Ready?" called Zara.\n"Ready!" shouted Omar.\n"Wait for me," puffed Lily.`),

  // --- 2. Action beat plus speech tag
  beat(`Raj dropped his pencil. "Oh no, not again," he sighed.`, `raj dropped his pencil oh no not again he sighed`),
  beat(`Hana stamped her foot. "That isn't fair!" she cried.`, `hana stamped her foot that isn't fair she cried`),
  beat(`The teacher glanced at the door. "Who is there?" she asked.`, `the teacher glanced at the door who is there she asked`),
  beat(`Ben grinned at his sister. "You'll never catch me," he teased.`, `ben grinned at his sister you'll never catch me he teased`),
  beat(`Farah shut her book. "That was the best chapter yet," she announced.`, `farah shut her book that was the best chapter yet she announced`),

  // --- 3. Upgrade the verb (multiple choice)
  verbMc(
    `"I can't believe we won!" said the captain. Which verb is the best upgrade for "said"?`,
    'cheered',
    [
      ['muttered', 'Muttering is low and grumpy. The captain is thrilled.'],
      ['sighed', 'A sigh shows tiredness or disappointment, not joy.'],
      ['grumbled', 'Grumbling is a complaint. Winning is good news.'],
    ],
    'Winning is exciting news, so the captain shouts with joy. Cheered shows both the volume and the happiness.',
  ),
  verbMc(
    `"Please don't leave me here," said the little boy. Which verb is the best upgrade for "said"?`,
    'pleaded',
    [
      ['boasted', 'Boasting is showing off. The boy is frightened.'],
      ['announced', 'Announcing is loud and confident. He is begging.'],
      ['snapped', 'Snapping is sharp and cross. He is scared, not angry.'],
    ],
    'He is frightened and begging someone to stay. Pleaded shows the fear and the request.',
  ),
  verbMc(
    `"That was the funniest thing I've ever seen," said Ana. Which verb is the best upgrade for "said"?`,
    'giggled',
    [
      ['warned', 'A warning is about danger. Nothing here is dangerous.'],
      ['groaned', 'A groan shows pain or annoyance, not delight.'],
      ['demanded', 'Demanding is forceful. Ana is amused, not bossy.'],
    ],
    'Ana found it hilarious, so a laughing verb fits. Giggled shows her amusement.',
  ),
  verbMc(
    `"Don't touch that wire," said the electrician. Which verb is the best upgrade for "said"?`,
    'warned',
    [
      ['giggled', 'Giggling is playful. This is serious.'],
      ['boasted', 'Boasting is showing off. This is about safety.'],
      ['wondered', 'Wondering is an uncertain thought. The electrician is giving an order.'],
    ],
    'The electrician is telling someone to avoid danger. Warned shows the seriousness of the message.',
  ),
  verbMc(
    `"I think I heard a noise downstairs," said Mei. Which verb is the best upgrade for "said"?`,
    'whispered',
    [
      ['bellowed', 'Bellowing is very loud. It would give her hiding place away.'],
      ['boasted', 'Boasting is showing off. Mei is worried.'],
      ['cheered', 'Cheering shows joy. A strange noise is not good news.'],
    ],
    'Mei is nervous and does not want to be heard. Whispered shows the quiet voice and the fear.',
  ),

  // --- 4. Direct to reported speech
  transform(`"We are late for the bus," said Imran.`, 'Rewrite as reported speech.', ['Imran said (that) they were late for the bus.'], 'In reported speech the tense steps back (are becomes were) and we becomes they.'),
  transform(
    `"I will help you tomorrow," Mei said to Raj.`,
    'Rewrite as reported speech.',
    ['Mei [told|said to] Raj (that) she would help him [the next day|the following day].', 'Mei said (that) she would help Raj [the next day|the following day].'],
    'Will steps back to would, I becomes she, you becomes him, and tomorrow becomes the next day.',
  ),
  transform(`"I am reading a funny book," said Dan.`, 'Rewrite as reported speech.', ['Dan said (that) he was reading a funny book.'], 'Am reading steps back to was reading, and I becomes he.'),
  transform(`"The shop closes at six," said Mrs Tan.`, 'Rewrite as reported speech.', ['Mrs Tan said (that) the shop closed at six.'], 'The verb steps back in time: closes becomes closed.'),
  transform(`"I have finished my homework," said Hana.`, 'Rewrite as reported speech.', ['Hana said (that) she had finished her homework.'], 'Have finished steps back to had finished, and I and my become she and her.'),

  // --- 5. Reported to direct speech
  transform('Kai told Lena that he was hungry.', 'Rewrite as direct speech.', [`Kai [said to|told] Lena, "I[ am|'m] hungry."`], 'Go back to the speaker\'s own words: he was becomes I am. Put them in speech marks after a comma.'),
  transform('Mr Lim said that the bus had left.', 'Rewrite as direct speech.', ['Mr Lim said, "The bus has left."', '"The bus has left," said Mr Lim.', '"The bus has left," Mr Lim said.'], 'Go back to the speaker\'s own words: had left becomes has left.'),
  transform('Nadia told Omar that she would meet him the next day.', 'Rewrite as direct speech.', [`Nadia [said to|told] Omar, "I[ will|'ll] meet you tomorrow."`], 'she would becomes I will, him becomes you, and the next day becomes tomorrow.'),
  transform('Zack said that he was going to the park.', 'Rewrite as direct speech.', [`Zack said, "I[ am|'m] going to the park."`, `"I[ am|'m] going to the park," said Zack.`], 'Go back to the speaker\'s own words: he was going becomes I am going.'),
  transform('Hui Min told Raj that she had lost her key.', 'Rewrite as direct speech.', [`Hui Min [said to|told] Raj, "I[ have|'ve] lost my key."`], 'she had lost becomes I have lost, and her becomes my.'),

  // --- 6. Tense fix
  tense('The pirates sailed across the bay and find a hidden cave.', ['find'], ['found'], 'Keep the verbs in the same time. The story is in the past, so find should be found.'),
  tense('Mei opened the door and walks into the dark room.', ['walks'], ['walked'], 'Keep the verbs in the same time. Opened is in the past, so walks should be walked.'),
  tense('Yesterday the class visited the museum and learn about dinosaurs.', ['learn'], ['learned', 'learnt'], 'Yesterday tells us this is in the past, so learn should be learned (or learnt).'),
  tense('The dragon roared, shakes its wings and flew away.', ['shakes'], ['shook'], 'Roared and flew are in the past, so shakes should be shook.'),
  tense('Raj picked up the letter and reads it slowly.', ['reads'], ['read'], 'Picked up is in the past, so reads should be read (said "red").'),

  // --- 7, 8, 9. Reading between the lines: five new passages, each with its three questions
  ...passage(
    'rbtl-tomas',
    `"I don't need a torch," said Tomas, gripping the railing.\nPia held the light steady. "The stairs are very dark, though."\n"I said I'm fine," Tomas replied, but he did not take a step.`,
    {
      stem: 'How does Tomas really feel?',
      options: [['confident', 'He says so, but his actions say otherwise.'], ['scared but hiding it'], ['sleepy', 'Nothing in the passage suggests he is tired.'], ['annoyed that Pia is late', 'Pia is already there holding the light.']],
      key: 'b',
      explanation: 'He says he does not need a torch, but he grips the railing and will not take a step. He is scared and does not want to admit it.',
    },
    {
      stem: 'Which TWO details show he is not as brave as he says?',
      options: [['He is gripping the railing.'], ['He does not take a step.'], ['He says again that he is fine.'], ['Pia holds the light steady.', 'This shows what Pia does, not how Tomas feels.'], ['The stairs are very dark.', 'This describes the place, not how Tomas behaves.'], ['Tomas speaks to Pia.', 'Speaking tells us nothing about his feelings.']],
      correct: ['a', 'b', 'c'],
      explanation: 'Gripping the railing, refusing to move and insisting a second time that he is fine all show fear. The light, the dark stairs and the fact that he speaks do not.',
    },
    {
      stem: 'Why does Pia say, "The stairs are very dark, though"?',
      options: [['To gently show she has noticed he might need the light'], ['To warn him that she is leaving', 'She stays and holds the light steady.'], ['To boast that she is not afraid', 'Nothing she says is about herself.'], ['To complain about the electricity', 'She is talking about the stairs, not complaining.']],
      key: 'a',
      explanation: 'The word though shows she does not quite believe him. She is offering help without teasing him.',
    },
  ),
  ...passage(
    'rbtl-hana',
    `"It doesn't matter," said Hana, shrugging. She kept her eyes on the empty scoreboard.\nDev nudged her. "You played brilliantly, you know."\n"Mm," Hana said, and pulled her cap lower.`,
    {
      stem: 'How does Hana really feel after the match?',
      options: [['delighted', 'A delighted player would not hide under her cap.'], ['disappointed but pretending not to care'], ['relaxed', 'A relaxed person would not avoid looking at anyone.'], ['jealous of Dev', 'Dev is kind to her, and nothing suggests jealousy.']],
      key: 'b',
      explanation: 'She says it does not matter, but she stares at the scoreboard, answers with one word and hides under her cap. She cares a lot.',
    },
    {
      stem: 'Which TWO details suggest the result matters to Hana?',
      options: [['She keeps her eyes on the scoreboard.'], ['She pulls her cap lower.'], ['She answers with only "Mm".'], ['Dev nudges her.', 'This is what Dev does, not Hana.'], ['Dev says she played brilliantly.', 'This is Dev\'s opinion, not a clue about Hana.'], ['The scoreboard is mentioned.', 'It matters only because Hana will not stop looking at it.']],
      correct: ['a', 'b', 'c'],
      explanation: 'Staring at the scoreboard, hiding under her cap and giving a one-word reply all show she is upset. Dev\'s nudge and praise show how Dev feels.',
    },
    {
      stem: 'Why does Dev nudge Hana and praise her?',
      options: [['To comfort her and show he has noticed she is upset'], ['To tease her about losing', 'His words are kind, not teasing.'], ['To take the credit for the match', 'Dev says she played well, not himself.'], ['To end the conversation', 'Praise invites her to talk.']],
      key: 'a',
      explanation: 'A nudge and a kind word are what a friend does when he can tell someone is hurting.',
    },
  ),
  ...passage(
    'rbtl-zane',
    `"I'm not nervous," said Zane, tapping his foot against the chair leg.\nMum smiled. "Your hands are shaking."\nZane hid them under his legs. "It's cold in here."`,
    {
      stem: 'How does Zane really feel?',
      options: [['relaxed', 'A relaxed person would not tap and shake.'], ['nervous but denying it'], ['cold and nothing else', 'He offers the cold as an excuse for his shaking hands.'], ['bored', 'Boredom would not make his hands shake.']],
      key: 'b',
      explanation: 'He says he is not nervous, but he taps his foot, his hands shake and he hides them. The cold is only an excuse.',
    },
    {
      stem: 'Which TWO details show Zane is nervous?',
      options: [['He taps his foot against the chair.'], ['He hides his shaking hands.'], ['He says it is cold in the room.'], ['Mum smiles.', 'This is what Mum does, not Zane.'], ['Mum speaks to him.', 'Mum speaking is not a clue about Zane.'], ['He is sitting on a chair.', 'Sitting says nothing about nerves.']],
      correct: ['a', 'b', 'c'],
      explanation: 'Foot-tapping, hiding his hands and blaming the cold all point to nerves. Mum smiling or speaking, and the chair, do not.',
    },
    {
      stem: 'Why does Mum smile before she speaks?',
      options: [['To show she is kind and is not cross with him'], ['To laugh at his shaking hands', 'Nothing in the passage suggests she is mocking him.'], ['To pretend she has not noticed', 'She goes on to mention his hands.'], ['To show she is bored', 'She is paying close attention to him.']],
      key: 'a',
      explanation: 'Her smile makes what she says gentle. She has noticed his nerves and wants him to feel safe.',
    },
  ),
  ...passage(
    'rbtl-lee',
    `"Great news," said Lee, clapping slowly. "Another trophy for Mina."\nMina's smile faded. "You could sound happier about it."\nLee looked out of the window instead of answering.`,
    {
      stem: 'How does Lee really feel about Mina\'s trophy?',
      options: [['proud of her', 'Proud people sound warm, not flat.'], ['jealous but pretending to be pleased'], ['confused by the news', 'He is not asking questions.'], ['sleepy', 'Nothing suggests he is tired.']],
      key: 'b',
      explanation: 'Slow clapping, a flat voice and turning away show he is not truly happy for her. He is jealous.',
    },
    {
      stem: 'Which TWO details show Lee is not sincere?',
      options: [['He claps slowly.'], ['He looks out of the window instead of answering.'], ['He says "Another trophy for Mina" in a flat way.'], ['Mina\'s smile fades.', 'This shows how Mina feels, not Lee.'], ['Mina speaks to him.', 'Mina speaking is not a clue about Lee.'], ['The news is mentioned.', 'The news is the reason, not a clue about how Lee feels.']],
      correct: ['a', 'b', 'c'],
      explanation: 'Slow clapping, a flat remark and refusing to look at her all show he does not mean it. Mina\'s reaction shows she noticed.',
    },
    {
      stem: 'Why does Mina say, "You could sound happier about it"?',
      options: [['Because she can tell his words and clapping are not sincere'], ['Because she did not hear what he said', 'She heard well enough to answer him.'], ['Because she wants him to be louder', 'She is talking about his feelings, not his volume.'], ['Because she is bored of the trophy', 'Her smile only fades after Lee speaks.']],
      key: 'a',
      explanation: 'Her smile fades because she has seen through him. She is gently pointing out that he does not sound pleased.',
    },
  ),
  ...passage(
    'rbtl-grandpa',
    `"Don't fuss," said Grandpa, straightening the photo on the shelf for the third time.\nNora set down her bag. "You've been up since five, haven't you?"\n"The house is just quiet," he said, and turned the photo to face the chair again.`,
    {
      stem: 'How does Grandpa really feel?',
      options: [['cheerful', 'A cheerful person would not keep fiddling with a photo.'], ['lonely but not wanting to say so'], ['angry that Nora has arrived', 'He does not tell her to leave.'], ['hungry', 'Food is never mentioned.']],
      key: 'b',
      explanation: 'He tells her not to fuss, but he keeps touching the photo, has been up since five and says the house is quiet. He is lonely.',
    },
    {
      stem: 'Which TWO details show Grandpa is missing someone?',
      options: [['He straightens the photo for the third time.'], ['He turns the photo to face the chair.'], ['He says the house is just quiet.'], ['Nora sets down her bag.', 'This is what Nora does, not Grandpa.'], ['Nora asks a question.', 'Her question is a clue about Nora\'s guess, not Grandpa\'s behaviour.'], ['There is a shelf.', 'The shelf is only where the photo sits.']],
      correct: ['a', 'b', 'c'],
      explanation: 'Fussing over the photo three times, turning it towards the chair and mentioning the quiet house all show how much he misses someone.',
    },
    {
      stem: 'Why does Nora ask whether he has been up since five?',
      options: [['She has guessed that he could not sleep because he feels lonely'], ['She is checking the time', 'She is asking about him, not the clock.'], ['She wants to tell him off for being awake', 'Her tone is caring, not cross.'], ['She is hungry and wants breakfast', 'Food is never mentioned.']],
      key: 'a',
      explanation: 'She has noticed the signs and is gently trying to get him to talk.',
    },
  ),
];
