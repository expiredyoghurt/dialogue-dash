// Starter content. Edit freely, then run `npm run seed:build` to regenerate seed.sql.

// Mode 1: rewrite with correct speech marks and punctuation.
// lowerFirst: also lowercase the first spoken word in the prompt (tests Rule 2).
export const MODE1 = [
  { correct: 'Raj said, “I want to be a doctor.”' },
  { correct: '“Can I have some water?” asked Noor.' },
  { correct: '“That’s so funny!” laughed Mei.' },
  { correct: '“Let’s go to the library,” said Chen.', lowerFirst: true },
  { correct: 'Mrs Tan said, “Please open your books.”', lowerFirst: true },
  { correct: '“Where did you put my bag?” asked Hana.' },
  { correct: '“I won the race!” cheered Dan.' },
  { correct: 'Aisha whispered, “The teacher is coming.”', lowerFirst: true },
  { correct: '“We’re going to be late,” said Ben.', lowerFirst: true },
  { correct: '“Watch out!” shouted Kai.', lowerFirst: true },
  { correct: 'Lina asked, “Are we there yet?”' },
  { correct: '“Do you like my new shoes?” asked Zack.' },
  { correct: 'Mr Lim announced, “The bus has arrived.”' },
  // Rule 6: two sentences of speech, and a sentence paused by the saying words
  { correct: '“I’m tired,” said Raj. “Let’s go home.”', lowerFirst: true },
  { correct: '“I think,” said Priya, “that we should wait.”' },
];

// Mode 2: spot the error. `faulty` must use the same words as `correct`.
export const MODE2 = [
  {
    correct: '“Let’s go to the library,” said Chen.\n“OK,” said Vera. “Can we read comics?”',
    faulty: '“lets go to the library said Chen.\n"ok" said Vera can we read comics',
  },
  {
    correct: 'Mei said, “I left my lunch at home.”\n“You can share mine,” said Raj.',
    faulty: 'Mei said “I left my lunch at home”\n“You can share mine.” said Raj.',
  },
  {
    correct: '“Stop!” shouted Mr Lim. “Don’t run in the corridor.”',
    faulty: '“Stop,” shouted Mr Lim. “dont run in the corridor.”',
  },
  {
    correct: '“I think,” said Priya, “that we should wait.”',
    faulty: '“I think” said Priya “That we should wait.”',
  },
  {
    correct: 'Hana asked, “Where is my bag?”\n“It’s under your desk,” replied Ben.',
    faulty: 'Hana asked “Where is my bag.”\n“It\'s under your desk”, replied ben.',
  },
  {
    correct: '“What a lovely day!” sang Dina.',
    faulty: 'What a lovely day, sang Dina',
  },
  {
    correct: '“Can we play outside?” asked Zack. “It’s sunny today.”',
    faulty: '“can we play outside” asked Zack. “its sunny today.”',
  },
  {
    correct: 'Mrs Tan said, “Please hand in your homework.”\n“Yes, Mrs Tan,” answered the class.',
    faulty: 'Mrs Tan said "please hand in your homework"\n"Yes Mrs Tan," answered the class.',
  },
];

// Mode 3: upgrade the saying verb. `target` = tags the verb must carry (see src/rules.js TAGS).
export const MODE3 = [
  { speaker: 'Mei', line: 'I can’t find my homework,', context: 'Mei has lost her homework. The teacher is walking down the aisle to collect it.', target: ['scared'] },
  { speaker: 'Daniel', line: 'We won the championship!', context: 'The whistle blows. Daniel’s team has just scored the winning goal.', target: ['happy', 'excited'] },
  { speaker: 'Aisha', line: 'Give that back right now!', context: 'Aisha’s little brother has grabbed her new phone and run off with it.', target: ['angry', 'loud'] },
  { speaker: 'Ben', line: 'Please don’t switch off the light,', context: 'Ben is afraid of the dark. His mum is about to leave his room.', target: ['pleading', 'scared'] },
  { speaker: 'Kai', line: 'I got full marks again,', context: 'Kai holds up his test paper so the whole class can see it.', target: ['proud'] },
  { speaker: 'Priya', line: 'Did you hear that noise?', context: 'It is late at night. Priya hears footsteps in the empty hall.', target: ['scared', 'soft'] },
  { speaker: 'Zack', line: 'Nice shoes — did your little sister pick them?', context: 'Zack wants to embarrass Hana in front of the others.', target: ['mocking'] },
  { speaker: 'Lina', line: 'I miss my grandma so much,', context: 'Lina’s grandma has moved overseas and Lina is looking at her photo.', target: ['sad', 'soft'] },
  { speaker: 'Farah', line: 'That’s the best cake I’ve ever tasted!', context: 'Farah has just taken her first bite of her birthday cake.', target: ['happy', 'excited'] },
  { speaker: 'Marcus', line: 'Watch out for that car!', context: 'A car swerves towards a little boy crossing the road.', target: ['loud', 'shocked'] },
  { speaker: 'Ravi', line: 'I don’t understand how this experiment works,', context: 'Ravi is staring at a science experiment that did not turn out as expected.', target: ['curious'] },
  { speaker: 'Mr Lim', line: 'It’s all right; we can try again tomorrow,', context: 'The class football team has just lost, and the players are upset. Mr Lim stays gentle.', target: ['kind', 'calm'] },
];

// Saying verbs: base:past:tag,tag
export const VERBS = `
shout:shouted:loud
yell:yelled:loud,angry
bellow:bellowed:loud,angry
scream:screamed:loud,scared,shocked
shriek:shrieked:loud,scared,shocked,excited
screech:screeched:loud,angry,scared
roar:roared:loud,angry
thunder:thundered:loud,angry
holler:hollered:loud
call:called:loud
boom:boomed:loud,proud
exclaim:exclaimed:excited,shocked,loud
cheer:cheered:happy,excited,loud
squeal:squealed:excited,happy,loud
whisper:whispered:soft,scared
murmur:murmured:soft,calm
mutter:muttered:soft,angry
mumble:mumbled:soft,scared,sad
hiss:hissed:soft,angry
sigh:sighed:sad,soft
sob:sobbed:sad
wail:wailed:sad,loud
moan:moaned:sad
groan:groaned:sad,angry
whimper:whimpered:sad,scared,soft,pleading
sniffle:sniffled:sad,soft
lament:lamented:sad
weep:wept:sad
cry:cried:sad,loud
laugh:laughed:happy
chuckle:chuckled:happy,soft
giggle:giggled:happy,soft,excited
grin:grinned:happy
beam:beamed:happy,proud
chirp:chirped:happy,excited
gush:gushed:happy,excited
rejoice:rejoiced:happy,excited
sing:sang:happy
snap:snapped:angry
snarl:snarled:angry
growl:growled:angry,soft
fume:fumed:angry
rage:raged:angry,loud
bark:barked:angry,loud
retort:retorted:angry,mocking
demand:demanded:angry
grumble:grumbled:angry,soft
complain:complained:angry,sad
huff:huffed:angry
stammer:stammered:scared,shocked
stutter:stuttered:scared
squeak:squeaked:scared,soft
quaver:quavered:scared,soft,sad
falter:faltered:scared,sad
gasp:gasped:shocked,scared
blurt:blurted:shocked,excited
warn:warned:scared,loud
boast:boasted:proud
brag:bragged:proud
declare:declared:proud,calm
announce:announced:proud,calm
proclaim:proclaimed:proud,loud
insist:insisted:proud,angry
assert:asserted:proud
claim:claimed:proud
wonder:wondered:curious
inquire:inquired:curious,calm
query:queried:curious
question:questioned:curious
ponder:pondered:curious,calm
muse:mused:curious,calm,soft
beg:begged:pleading
plead:pleaded:pleading
implore:implored:pleading
urge:urged:pleading
entreat:entreated:pleading
coax:coaxed:kind,pleading
sneer:sneered:mocking
scoff:scoffed:mocking
jeer:jeered:mocking,loud
tease:teased:mocking,happy
taunt:taunted:mocking
mock:mocked:mocking
joke:joked:happy,mocking
reply:replied:calm
respond:responded:calm
explain:explained:calm
remark:remarked:calm
suggest:suggested:calm,kind
comment:commented:calm
observe:observed:calm
add:added:calm
continue:continued:calm
answer:answered:calm
state:stated:calm
advise:advised:calm,kind
reassure:reassured:kind,calm,soft
soothe:soothed:kind,calm,soft
comfort:comforted:kind,soft
console:consoled:kind,soft
encourage:encouraged:kind,proud
praise:praised:kind,happy,proud
`
  .trim()
  .split('\n')
  .map((l) => {
    const [base, past, tags] = l.split(':');
    return { base, past, tags: tags.split(',') };
  });
