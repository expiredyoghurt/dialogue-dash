# Dash Express (Dialogue Dash)

Pupil game + teacher console for practising dialogue punctuation (speech marks, capitals, end punctuation, commas, speech tags, strong verbs).
Cloudflare Worker + static assets + D1 (+ optional Workers AI). No build step.

## Dash Express (v1.2)

Pupils are couriers in Chatterbury. Each question is a parcel; fixing the message delivers it.

- **Town**: twelve districts (one per rule). Routes of five stops, a Big Delivery to clear each district, and Rush Hour once three are cleared.
- **Depot**: the six question types by kind of job (Repack the parcel, Inspect the parcel, Build your ride, The garage, Relay the message, Fix the dispatch diary).
- **Garage**: a new vehicle with each rank, plus paint, helmets and stickers.
- **Teacher console, Districts tab**: choose or accept a district for each question; switch the delivery clock off; open every district.

**Levels and unlocking (v1.3).** Districts 1-3 are open at the start, 4-6 at level 10 and 7-12 at level 20. XP per level rises with the range (50, 75, 100, 150, then 200 by default) and the admin can change it on the Districts tab. Teachers can open districts early for a class on the Districts tab.

**Accounts (v1.3-1.4).** The `teacher_user` / `teacher_password` secrets are the **super admin**. The super admin adds teacher accounts on the Teachers tab. Each teacher is the admin of their own classes: they create them, run them and can delete the ones they created, and see nothing of other teachers' classes. See CHANGELOG.md for exactly what each can do.

Upgrading from 1.1 or 1.2: run `npm run db:express:remote` and `npm run db:accounts:remote` (add the new tables; safe to repeat), then `npm run deploy`. No question is changed; each one is placed in a district automatically until you choose one. See CHANGELOG.md.

## Modes
1. **Rewrite it** – retype a stripped sentence with correct marks (3 tries, feedback per rule).
2. **Spot the error** – tap the mistakes, then type the fix. Mistake lists are worked out automatically from your correct + faulty versions.
3. **Upgrade the tag** – replace "said" with a verb that shows the feeling. Checked against your verb bank first; the AI is asked only for unknown words, once, and is rejected below 80% confidence.

4. **Choose the best answer** (Mode 4) – multiple choice, one answer or "choose two". Verb upgrades and "reading between the lines" passages (questions that share a `group` are served back to back).
5. **Change the speech** (Mode 5) – direct to reported speech and back. Forgives capitals, spacing, quote style and a missing final full stop; `(optional)` words and `[a|b]` alternatives in accepted answers.
6. **Fix the tense** (Mode 6) – tap the verb in the wrong time, then type the fix.

Mode 1 also supports two per-question options: `lines` (new speaker, new line) and `beat` (action, then speech).

## Upgrading from 1.0 to 1.1
No table changes. Order matters: **deploy first, seed second** (a 1.0 Worker cannot mark the new questions).
```bash
npm run deploy
npm run db:migrate:remote        # records schema level 2 (idempotent)
npm run db:newtypes:remote       # the nine questions from the brief (INSERT-only, re-runnable)
npm run db:newtypes-extra:remote # optional: 45 extras, review seed-new-types-extra.sql first
```
Use `:local` instead of `:remote` for `wrangler dev`. Regenerate the SQL with `npm run seed:new` after editing `scripts/seed-new-types-data.mjs`.

## Deploy
```bash
npm install
npx wrangler d1 create dialogue-dash        # paste the database_id into wrangler.jsonc
npm run db:init:remote                      # schema + 450 questions (150 per mode) + 107 verbs
npx wrangler secret put teacher_user
npx wrangler secret put teacher_password
npx wrangler secret put session_secret      # optional but recommended (any long random string)
npm run deploy
```
Pupils use `/`; teachers use `/teacher`. Teacher sign-in fails closed until the two secrets exist.

### Question bank file
`questions-450.sql` holds all 450 questions (150 per mode) and is safe to run on any database that already has the schema:
fresh, one seeded with questions 1-35, one with questions your teachers added, or repeatedly. A question is inserted only if the
same question is not already there; existing questions, ids and pupil results are never changed. Top up a live database with:
```bash
npm run db:questions:remote
```
Edit `scripts/seed-*.mjs` and run `npm run seed:build` to regenerate both `seed.sql` and `questions-450.sql`.

## Local dev
```bash
cp .dev.vars.example .dev.vars              # Teacher1 / Password1 – local only
npm run db:init:local
npm run dev                                  # needs the AI binding (remote); for AI-free local runs use wrangler.test.jsonc
npm test                                     # unit tests (engine + verb logic)
```

## Notes
- Class codes: 6 characters. Regenerating can also sign the whole class out. Archiving a class signs it out.
- Guests get `guest_0001`-style names; guest accounts are purged after 30 days (daily cron).
- Free-tier budget: each answer costs about 3 D1 row writes, so roughly 24k answers/day on the free plan (100k writes/day). Workers AI free allowance is 10,000 neurons/day; `AI_DAILY_CAP` limits AI calls.
- `regularPast` adds -ed/-d only; check doubled-letter verbs (begged, snapped) when adding to the bank.
- Prefer first names or nicknames for pupils (PDPA).
- Not built yet: full-dialogue action/feeling marking (3B) and the "Character Through Dialogue" mode.
