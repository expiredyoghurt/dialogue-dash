# Dialogue Dash

Pupil game + teacher console for practising dialogue punctuation (speech marks, capitals, end punctuation, commas, speech tags, strong verbs).
Cloudflare Worker + static assets + D1 (+ optional Workers AI). No build step.

## Modes
1. **Rewrite it** – retype a stripped sentence with correct marks (3 tries, feedback per rule).
2. **Spot the error** – tap the mistakes, then type the fix. Mistake lists are worked out automatically from your correct + faulty versions.
3. **Upgrade the tag** – replace "said" with a verb that shows the feeling. Checked against your verb bank first; the AI is asked only for unknown words, once, and is rejected below 80% confidence.

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
