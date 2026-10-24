# Changelog

## 1.7.0 — Class dashboard, unlock grid, game settings, a better play screen, saved choices, install

**Teachers**
- **Dashboard** is now the first tab and the page you land on. Pick a class to see, for the last 7 days: how many pupils played, XP and routes, where the class is by level (and how many can already reach districts 4–6 and 7–12), who is **stuck** (five or more first-try slips on one rule in two weeks), who **hasn't played** this week, the most-missed rules, and a sortable pupil table. Printable.
- **Unlock grid** (Districts tab). Every class against every district in one table. Tick a cell to open that district for the whole class and it saves on the spot, with "Open all" and "Levels only" per class. Each row shows how many pupils have reached level 10 and 20, so you can see whether an early unlock is needed.
- **Game settings** (admin) is now its own tab, split from Districts. XP per level, ranks, vehicles and the two switches live in one **draft**: nothing changes until you press Save, a bar appears when something is unsaved, Discard puts it back, and leaving with unsaved changes asks first. A **chart** of XP against level shows the saved curve and your draft, and a **live preview** tells you what the change would do ("3 pupils would lose districts 4–6", "Amy (5 Honesty) level 10 to 5") before you commit. The save confirmation repeats it.

**Pupils**
- **Play screen on phones.** The Check and Continue buttons stay in reach, and for typed answers the **answer bar sits above the on-screen keyboard** so the punctuation keys and Check are never hidden by it. Bigger tap targets, 16px text in boxes so iPhones don't zoom, and a tidier header.
- **Punctuation keys** for speech marks, apostrophes, commas, full stops, question and exclamation marks, colon, semicolon, dash and ellipsis. They appear straight away on touch screens, can be shown or hidden with one tap on any device, and typing with them keeps the keyboard open. They also work when typing a fix in Spot the error.
- **Garage, sound and keys follow the pupil.** Their ride's paint, helmet and sticker, and the sound and punctuation-key choices, are saved on their account, so they are the same on the classroom computer, a tablet and a phone. Only items they have unlocked can be chosen.
- **Install to the home screen.** The pupil app is an installable web app: an icon, a full-screen launch with no browser bars, a service worker so it opens quickly and shows the app even with a poor connection (answers and progress always go to the server, and the teacher console is never cached), and a button under Me (or "Share, Add to Home Screen" instructions on iPhones). Layout keeps clear of notches and the home bar.

**Under the hood**
- One new table, `pupil_prefs`. Run `npm run db:prefs:remote` (safe to repeat, and safe before deploying). Until it runs, choices still work on the device and just aren't saved to the account.
- New files: `manifest.webmanifest`, `sw.js`, `_headers`, `icons/`, `prefs.js`. `scripts/make-icons.py` redraws the icons (optional).
- Tests: 194 in total, including browser tests for every new screen and the install files.

## 1.6.0 — Phones, dialogs, a searchable question bank, keyboard and sound

**Pupils**
- **Phone navigation.** On phones a bottom bar with Town, Depot, Garage and Me replaces the wrapping row of tabs. Redeliveries and the Handbook live under Me. It steps aside while a question is on screen. Tablets and laptops keep the top tabs.
- **Simple sounds** made in the browser (no files): right, wrong, combo, a slip on a Big Delivery, route done, and level-up. A speaker button in the header and a switch under Me turn them off; the choice is remembered. Sounds never play before the pupil has tapped something.
- **Loading and error states.** Loading placeholders instead of a blank page, "Packing your parcels" while a route loads, an "offline" banner, and a "Can't reach Dash Express" screen with Try again. Losing signal no longer signs a pupil out, and a failed route start explains itself and stays on the same screen.
- **Focus and keyboard.** A visible focus ring everywhere, a "Skip to main content" link, focus moves into the new screen when you change section, the page stays where it was when you tap a swatch or switch (it only jumps to the top on a new screen or question), screen-reader announcements for correct and incorrect answers, and tap targets of at least 44px on phones.

**Teachers**
- **Custom dialogs** replace all 14 browser pop-ups. Risky ones start on Cancel, deleting a class asks you to type its name, and Escape cancels. Messages are toasts that stay out of the way, and errors stay longer and are announced to screen readers.
- **Question bank:** search (the question and its answers), filters for type, district and whose, sort by newest, oldest, hardest or most answered, paging (25, 50 or 100), "Showing 26 to 50 of 504", and the filters are remembered while you move between tabs.
- **Loading and error states** in the console too: placeholders, a retry panel with a clear message when the connection drops, and an offline banner. The page keeps its place and scroll position when it reloads.
- Console headings and tabs are reachable by keyboard, with a skip link and visible focus.

**Under the hood**
- New shared files: `ui.js` (dialogs, toasts, announcements, loading and error panels) and `sfx.js`.
- Browser tests: `npm run test:ui` runs the real pupil app and teacher console in a simulated browser (jsdom) against the real server code, including an automatic accessibility check on every screen. `npm test` runs everything. No database change.

## 1.5.0 — XP for each rank and each vehicle

- **The super admin can set the XP for every rank and every delivery vehicle.** Districts tab, "XP for ranks and vehicles". The two lists are separate, so a new ride can arrive earlier or later than a new rank. They start out the same as before: 0, 60, 160, 320, 560 and 900 XP.
- Rules: the first of each list is always 0, each amount must be a whole number higher than the one before, and the whole save is refused if anything is wrong (nothing changes). "Reset to the standard amounts" goes back to the defaults.
- Changes apply to everyone straight away, and count XP from answers plus tips. Rank and ride names don't change. Paint, helmets and stickers keep their own fixed XP. Levels and unlocks are separate and unaffected.
- Pupils now see their rank and ride progress separately ("XP to the next rank", "XP to a new ride"), the garage lists each ride's XP, and a finished route shows a separate "New rank" and "New ride" banner.
- Teachers can read but not change these amounts. No database change: they are stored in the existing `meta` table, and a damaged value falls back to the standard amounts.
- Tests: 148 in total (11 new).

## 1.4.0 — Super admin, and teachers who run their own classes

- **Super admin.** The Cloudflare sign-in (`teacher_user` / `teacher_password`) is now called the super admin in the console. It keeps every power it had.
- **Teachers are the admins of their own classes.** A teacher account can now **create classes**. The creator is assigned automatically and **owns** the class. They can add pupils, manage class codes, write class questions, open districts, see analytics, rename or archive it, and **delete a class they created** (with its pupils and results).
- **Still the super admin's alone:** creating, assigning, switching off and deleting teacher accounts; the shared question bank and verb list; town-wide settings (XP per level, delivery clock, open everything); guest players; and deleting classes nobody owns.
- **Classes given to a teacher.** The super admin can still assign an existing class to a teacher (for example a co-teacher). They can run it but not delete it; only its creator or the super admin can.
- **Limit.** A teacher account can create up to 30 classes. The super admin has no limit.
- **Deleting a teacher account** keeps its classes and pupils. Those classes lose their owner, so afterwards only the super admin can delete them.
- **Database.** One new table, `class_owners`. Run `npm run db:accounts:remote` (now runs both account migrations; safe to repeat) **before** deploying. Until it runs, teachers can still create and run classes; only deleting them needs the super admin.
- Tests: 137 in total (8 new).

## 1.3.1 — XP per level you can change

- **XP per level now varies by range**, and the admin can change it. Level 1 is free; each later level costs the XP of the range it falls in. Standard amounts: levels 2-10 cost 50 each, 11-20 cost 75, 21-30 cost 100, 31-40 cost 150, and 41 onwards cost 200. So level 10 is reached at 450 XP, level 20 at 1,200 XP, level 30 at 2,200 XP and level 41 at 3,900 XP.
- **Admin editor.** Districts tab, "XP per level": edit the XP, change where each range ends, add up to 8 ranges, or reset to the standard amounts. It shows the XP at which levels 10 and 20 open as you type. Saving changes every pupil's level straight away (so some districts can lock or unlock). Teachers can see the effect but not change it.
- The districts still open at **level 10** (4-6) and **level 20** (7-12), whatever the XP amounts are. Teachers' unlock panel shows the current XP for each.
- No database change: the ranges are stored in the existing `meta` table. A damaged or invalid saved value falls back to the standard amounts.
- Tests: 129 in total (8 new).

## 1.3.0 — Levels, teacher accounts, class unlocks

- **Levels.** A pupil's level comes from their total XP (answers + tips): the XP for each level depends on the range it is in (see 1.3.1; by default level 10 is 450 XP and level 20 is 1,200 XP). Ranks and vehicles are unchanged.
- **Districts open by level.** Districts 1-3 are open from the start, 4-6 open at level 10, and 7-12 open at level 20. This replaces the 1.2 rule of clearing each district to open the next; clearing a district now only counts toward Rush Hour. The lock is enforced on the server: locked parcels are never sent to the browser and answering or delivering one is refused. The Depot and Redeliveries counts only include parcels the pupil can reach.
- **Manual unlocks.** A teacher (or the admin) can open any districts for a whole class from the Districts tab, ahead of the level. Unticking puts the level rule back. The admin's old "open every district" switch still opens everything for everyone, for testing.
- **Teacher accounts.** The Cloudflare secrets (`teacher_user` / `teacher_password`) are now the **admin** sign-in, and keep working exactly as before. The admin adds teacher accounts on a new **Teachers** tab (a generated password is shown once), assigns them to classes, can re-assign, reset a password, switch an account off, or delete it. Passwords are stored as salted PBKDF2 hashes. Switching an account off or resetting its password signs it out.
- **What a teacher can do** in their assigned classes: everything about pupils (add, rename, reset, delete, class codes, archive), class questions (add, edit, remove, import, choose districts), analytics, manual district unlocks, and approve or reject verbs pupils proposed. They can change their own password.
- **What only the admin can do:** add or delete classes, edit the shared question bank and the shared verb list, see guest players, town-wide switches (delivery clock, open everything), and manage teacher accounts. These are checked on the server, not just hidden in the console.
- **Database.** Three new tables (`teachers`, `teacher_classes`, `class_settings`). Run `npm run db:accounts:remote` **before** deploying (safe to repeat). Until it runs the app still works; only the admin can sign in and manual unlocks are ignored.
- Tests: `test/accounts.test.mjs` (24 tests).

## 1.2.0 — Dash Express

A courier story and arcade loop on top of the existing questions. Marking, feedback and per-answer XP are unchanged.

- **Story.** Chatterbury, Dot the depot boss, and the careless rival firm the Smudge. A first-visit intro, a Town map, a Depot (the six question types as couriers' jobs), a Garage and a Handbook (the rules page).
- **Districts.** Twelve districts, one per rule: Speech Mark Street, Capital Corner, Full Stop Market, Comma Lane, Inside Row, Crossroads, Verb Garage, Doorstep Row, Action Alley, Relay Road, Diary Docks and Customer Quarter. Districts 1-7 are the original seven; 8-12 cover the rules added in 1.1. A district opens when the one before is cleared; a district with no questions shows as "coming soon" and never blocks the road.
- **Routes.** Five stops. A soft, route-wide delivery clock (never ends a route). First-try answers build a combo; the route pays **tips** (bonus XP) for right answers, combo, speed and three stars. Tips are worked out on the server from the attempts it recorded, never from numbers the browser sends.
- **Big Delivery.** Opens after 8 correct parcels in a district. Six stops, three patience envelopes (a slip is any stop not right first time). Pass it to clear the district. Linked questions (`group`) still arrive back to back. Districts with fewer than 4 questions are cleared by finishing them all.
- **Rush Hour.** A mixed six-stop route, open after three districts are cleared.
- **Rank vehicles and Garage.** The six ranks keep their names and XP; each now comes with a vehicle (on foot, bike, scooter, van, truck, rocket). Paint, helmets and stickers unlock with XP and tips; the choice is kept in the pupil's browser.
- **Dot's tip.** Suggests the open district where the pupil has slipped most on recent first tries.
- **Teacher console.** New **Districts** tab: pick or accept a district for each question, see how many parcels each district holds, switch the delivery clock off, or open every district at once. The question form gets a District field for every mode.
- **District of a question.** An optional `rule` (1-12) in the question's JSON. Without it a district is suggested from the question itself (`autoRule` in `src/districts.js`).
- **Removed.** The `floors` field (and its form fields and seed values). Stored `floors` values on existing questions are simply ignored.
- **Database.** One new table, `route_runs`, for finished routes. Run `npm run db:express:remote` **before** deploying (it is safe to run first, and any number of times). Until it exists the app still works; routes just earn no tips.
- Tests: `test/express.test.mjs` (21 tests).

## 1.1.0

New question types, with feedback, XP, teacher authoring, seed content and tests. Nothing existing was changed or removed.

- **Mode 1: new speaker, new line.** Per-question `lines: true` makes line breaks significant. Pupils get a taller box where Enter starts a new line (Ctrl/Cmd+Enter checks) and a "new line" key. Missing and misplaced breaks have their own codes (`NO_NEW_LINE`, `EXTRA_NEW_LINE`, new Rule 8); punctuation inside a line keeps the existing codes.
- **Mode 1: action beat plus speech.** Per-question `beat: true`. A comma (or nothing) where the action's full stop belongs gets `ACTION_COMMA` / `ACTION_NO_STOP` (new Rule 9). "Comma after said" (`NO_COMMA_BEFORE`) cannot fire on these questions.
- **Mode 4: multiple choice**, one answer or "pick N" (correct when every chosen option is valid). Options are shuffled by the server for each pupil, with per-option "why it's wrong" notes shown only for the options a pupil actually chose. Covers the verb upgrade and the three "reading between the lines" questions. Questions that share a `group` are served back to back.
- **Mode 5: change the speech** (direct to reported, reported to direct). Capitals, spacing, curly/straight/single quotes and a missing final full stop are forgiven (with a gentle note). `(optional words)` and `[a|b]` alternatives in accepted answers. Wrong punctuation or speech marks in direct speech reuse the dialogue engine's precise feedback.
- **Mode 6: fix the tense.** Tap the wrong word, then type the fix. Wrong words and accepted fixes are stored as lists.
- **Teacher console:** authoring forms with live preview for all six modes, in the existing question list and edit / remove flow. Bulk import added for Modes 5 and 6.
- **Rules 8-12, new error codes and heat-map colours**; the Rules page now lists every rule.
- **Seed content:** `seed-new-types.sql` (the nine questions from the brief) and `seed-new-types-extra.sql` (45 extras for review). INSERT-only and re-runnable.
- **Migration:** `migrations/0002_new_question_types.sql` only records the schema level. No table changes are needed.
- `/api/meta` now reports `version`.
- Tests: checkers per mode, seed checks, answer-leak checks over the real Worker code running against an in-memory SQLite.

## 1.0.0

First release: Modes 1-3, teacher console, verb bank, analytics.
