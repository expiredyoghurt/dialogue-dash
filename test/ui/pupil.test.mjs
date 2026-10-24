// The pupil app, run for real in jsdom against the real Worker code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, mount, sleep, a11yProblems, closeAll } from './helpers.mjs';

test.after(closeAll);
import { ruleOf } from '../../src/districts.js';

const signInAsGuest = async (page) => {
  await page.until(() => page.btn('Guest'), 'auth screen');
  page.btn('Guest').click();
  await sleep();
  page.btn('Play as a guest').click();
  await page.until(() => page.$$('.dcard').length === 12, 'the town');
  await sleep(150);
};
const finishIntro = async (page) => {
  for (let i = 0; i < 3; i++) {
    page.$('dialog.intro .btn').click();
    await sleep();
  }
};
// Type the right answer for the Mode 1 question on screen (found by its prompt).
const answerRight = (world, page) => {
  const prompt = page.$('.bubble.pre').textContent;
  const row = world.db.prepare('SELECT data FROM questions WHERE mode = 1').all().find((r) => JSON.parse(r.data).prompt === prompt);
  page.type(page.$('textarea.answer'), JSON.parse(row.data).correct);
};
const onlyMode1 = (world) => world.db.prepare('UPDATE questions SET active = 0 WHERE mode != 1').run();
const pupilId = (world) => world.db.prepare('SELECT id FROM pupils ORDER BY id DESC LIMIT 1').get().id;

test('a guest signs in and the town shows levels, locks and Dot’s intro', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  assert.match(page.text(), /Dash Express/);
  await signInAsGuest(page);
  assert.ok(page.$('dialog.intro').hasAttribute('open'), 'Dot’s intro opens on the first visit');
  await finishIntro(page);
  assert.ok(!page.$('dialog.intro').hasAttribute('open'));
  const names = page.$$('.dcard h3').map((e) => e.textContent);
  assert.deepEqual(names.slice(0, 3), ['Speech Mark Street', 'Capital Corner', 'Full Stop Market']);
  assert.equal(page.$$('.dcard.open').length, 3, 'districts 1-3 are open at level 1');
  assert.equal(page.$$('.dcard.locked').length, 9);
  assert.match(page.text(), /Level 1/);
  assert.match(page.text(), /Level 10 opens/);
  assert.match(page.text(), /Reach level 10 to open this district/);
  assert.match(page.text(), /Reach level 20 to open this district/);
  assert.ok(!/floor|dungeon|knight|castle|medieval|fantasy/i.test(page.text()), 'no floors, dungeon or fantasy wording');
  assert.deepEqual(page.errors, []);
});

test('every section renders, on desktop tabs and the phone bottom bar', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  await signInAsGuest(page);
  await finishIntro(page);
  // the bottom bar is always in the page; CSS shows it on phones
  const bar = page.$('nav.bottomnav');
  assert.ok(bar, 'a phone navigation bar exists');
  assert.deepEqual([...bar.querySelectorAll('button')].map((b) => b.textContent.replace(/\d+$/, '')), ['Town', 'Depot', 'Garage', 'Me']);
  assert.equal(bar.querySelector('[aria-current="page"]').textContent, 'Town');
  const go = async (label, expect) => {
    [...bar.querySelectorAll('button')].find((b) => b.textContent.startsWith(label)).click();
    await sleep(80);
    assert.match(page.text(), expect, label);
  };
  for (const [label, expect] of [['Depot', /Repack the parcel/], ['Garage', /Your rides/], ['Me', /Districts/], ['Town', /Chatterbury/]]) await go(label, expect);
  // Me holds the things that no longer have a tab on phones
  const me = [...page.$$('nav.bottomnav button')].find((b) => b.textContent.startsWith('Me'));
  me.click();
  await sleep(60);
  assert.ok(page.btn('Redeliveries') && page.btn('Handbook'), 'Redeliveries and the Handbook are reachable from Me');
  assert.equal(page.$('nav.bottomnav [aria-current="page"]').textContent.replace(/\d+$/, ''), 'Me');
  page.btn('Handbook').click();
  await sleep(60);
  assert.match(page.text(), /handbook/i);
  assert.equal(page.$('nav.bottomnav [aria-current="page"]').textContent.replace(/\d+$/, ''), 'Me', 'Handbook counts as part of Me');
  // desktop tabs still there
  assert.equal(page.$$('nav.tabs button').length, 6);
  assert.deepEqual(page.errors, []);
});

test('moving to a new screen puts focus in the content; the skip link and main landmark exist', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  assert.ok(page.$('a.skip-link[href="#main"]'));
  await signInAsGuest(page);
  await finishIntro(page);
  assert.ok(page.$('#main'), 'a main landmark to skip to');
  page.$$('nav.bottomnav button')[1].click(); // Depot
  await sleep(60);
  const main = page.$('#main');
  assert.ok(main.contains(page.w.document.activeElement) || page.w.document.activeElement === main, 'focus moved into the new screen');
});

test('sound: a switch in the header and under Me, remembered, and quiet when the browser has no audio', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  await signInAsGuest(page);
  await finishIntro(page);
  const btn = () => page.$('#soundbtn');
  assert.equal(btn().getAttribute('aria-pressed'), 'true', 'on by default');
  btn().click();
  assert.equal(btn().getAttribute('aria-pressed'), 'false');
  assert.equal(page.w.localStorage.getItem('dd_sound'), '0');
  assert.equal(page.w.DashSfx.enabled(), false);
  page.w.DashSfx.play('right'); // a no-op while off, and must never throw
  btn().click();
  assert.equal(page.w.localStorage.getItem('dd_sound'), '1');
  page.w.DashSfx.play('done'); // jsdom has no audio: must still not throw
  assert.deepEqual(page.errors, []);
});

test('a route: five stops, a combo, and a receipt with tips', async () => {
  const world = makeWorld();
  onlyMode1(world);
  const page = mount(world, 'index.html');
  await signInAsGuest(page);
  await finishIntro(page);
  page.btn('Start').click();
  await page.until(() => page.$('#strip'), 'the route strip');
  assert.equal(page.$$('.stop').length, 5);
  assert.ok(page.w.document.body.classList.contains('playing'), 'the phone bar steps aside while playing');
  for (let n = 0; n < 5; n++) {
    await page.until(() => page.$('textarea.answer'), 'question ' + n);
    answerRight(world, page);
    page.btn('Check').click();
    await page.until(() => page.btn('Next stop') || page.btn('Finish route'), 'result ' + n);
    if (n >= 1) assert.match(page.$('#strip').textContent, /Combo/);
    (page.btn('Next stop') || page.btn('Finish route')).click();
    await sleep(60);
  }
  await page.until(() => page.$('.receipt'), 'the receipt');
  assert.match(page.text(), /Perfect route!/);
  assert.ok(page.$$('.stars svg').length >= 3);
  assert.ok(+page.text().match(/\+(\d+) tips/)[1] > 0);
  assert.ok(!page.w.document.body.classList.contains('playing'));
  page.btn('Back to town').click();
  await sleep(80);
  assert.match(page.text(), /\d+ tips earned/);
  assert.deepEqual(page.errors, []);
});

test('Big Delivery: the customer runs out of patience, then is delighted', async () => {
  const world = makeWorld();
  onlyMode1(world);
  const page = mount(world, 'index.html');
  await signInAsGuest(page);
  await finishIntro(page);
  const id = pupilId(world);
  const d1 = world.db.prepare('SELECT id, data FROM questions WHERE mode = 1 AND active = 1').all().filter((r) => ruleOf(1, JSON.parse(r.data)) === 1);
  for (const r of d1.slice(0, 8)) world.db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (?, NULL, ?, 1, 1, 0, 1, 10, 'x', '[]', ?)").run(id, r.id, Date.now() - 600000);
  // refresh what the app knows about the pupil
  page.btn('Start').click();
  await page.until(() => page.$('#strip'), 'a route');
  page.btn('Quit').click();
  await sleep(150);
  page.btn('Big Delivery').click();
  await page.until(() => page.$('#strip'), 'the big route');
  assert.equal(page.$$('.stop').length, 6);
  assert.equal(page.$$('.patience svg').length, 3);
  for (let n = 0; n < 3; n++) {
    await page.until(() => page.$('textarea.answer'), 'q' + n);
    for (let t = 0; t < 3; t++) {
      page.type(page.$('textarea.answer'), 'wrong ' + t);
      page.btn('Check').click();
      await sleep(120);
    }
    await page.until(() => page.btn('Next stop') || page.btn('Finish route'), 'result ' + n);
    if (n < 2) {
      page.btn('Next stop').click();
      await sleep(60);
    }
  }
  assert.ok(page.btn('Finish route'), 'the route ends early at zero patience');
  page.btn('Finish route').click();
  await page.until(() => page.$('.receipt'), 'the receipt');
  assert.match(page.text(), /Customer not happy yet/);
  assert.ok(!/District cleared/.test(page.text()));
  page.btn('Try again').click();
  await page.until(() => page.$('#strip'), 'the retry');
  for (let n = 0; n < 6; n++) {
    await page.until(() => page.$('textarea.answer'), 'retry q' + n);
    answerRight(world, page);
    page.btn('Check').click();
    await page.until(() => page.btn('Next stop') || page.btn('Finish route'), 'retry result ' + n);
    (page.btn('Next stop') || page.btn('Finish route')).click();
    await sleep(60);
  }
  await page.until(() => page.$('.receipt'), 'the pass receipt');
  assert.match(page.text(), /Customer delighted!/);
  assert.match(page.text(), /District cleared!/);
  assert.deepEqual(page.errors, []);
});

test('no signal on start-up: a retry screen, not a silent sign-out', async () => {
  const world = makeWorld();
  const page0 = mount(world, 'index.html');
  await signInAsGuest(page0);
  const token = page0.w.localStorage.getItem('dd_token');
  assert.ok(token);
  world.offline = true;
  const page = mount(world, 'index.html', { pre: (w) => w.localStorage.setItem('dd_token', token) });
  await page.until(() => /Can’t reach Dash Express/.test(page.text()), 'the error screen');
  assert.ok(page.btn('Try again') && page.btn('Sign out'));
  assert.equal(page.w.localStorage.getItem('dd_token'), token, 'still signed in');
  world.offline = false;
  page.btn('Try again').click();
  await page.until(() => page.$$('.dcard').length === 12, 'the town after retry');
  assert.ok(!/Can’t reach/.test(page.text()));
});

test('starting a route with no signal explains it and stays on the same screen', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  await signInAsGuest(page);
  await finishIntro(page);
  world.offline = true;
  page.btn('Start').click();
  await page.until(() => /Can’t reach the server/.test(page.text()), 'the message');
  assert.ok(!page.$('#strip'), 'did not start a route');
  assert.ok(!page.$('.skel'), 'the loading screen cleared');
  assert.equal(page.$$('.dcard').length, 12, 'back on the town');
  world.offline = false;
});

test('the offline banner appears and disappears with the connection', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  await signInAsGuest(page);
  page.w.dispatchEvent(new page.w.Event('offline'));
  assert.ok(page.$('.offline-banner'));
  page.w.dispatchEvent(new page.w.Event('online'));
  assert.ok(!page.$('.offline-banner'));
});

test('accessibility basics hold on every pupil screen', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  assert.deepEqual(a11yProblems(page), [], 'sign-in screen');
  await signInAsGuest(page);
  await finishIntro(page);
  const bar = () => [...page.$$('nav.bottomnav button')];
  for (const [i, name] of [[0, 'town'], [1, 'depot'], [2, 'garage'], [3, 'me']]) {
    bar()[i].click();
    await sleep(80);
    assert.deepEqual(a11yProblems(page), [], name);
  }
  page.btn('Handbook').click();
  await sleep(80);
  assert.deepEqual(a11yProblems(page), [], 'handbook');
  bar()[0].click();
  await sleep(60);
  page.btn('Start').click();
  await page.until(() => page.$('#strip'), 'a route');
  await sleep(60);
  assert.deepEqual(a11yProblems(page), [], 'a question on screen');
});

// ---------------------------------------------------------------- 1.7

const startMode1 = async (world, page) => {
  onlyMode1(world);
  await signInAsGuest(page);
  await finishIntro(page);
  page.btn('Start').click();
  await page.until(() => page.$('textarea.answer'), 'a typed question');
};

test('punctuation keys: off by default on a mouse-and-keyboard device, on with one tap, remembered, and they type into the box', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  await startMode1(world, page);
  assert.ok(page.$('.dock'), 'the answer bar is on the page');
  assert.equal(page.$('.keys').hidden, true, 'hidden when there is no touch screen');
  assert.equal(page.$('.keys-toggle').textContent, 'Show punctuation keys');
  page.$('.keys-toggle').click();
  assert.equal(page.$('.keys').hidden, false);
  assert.equal(page.w.localStorage.getItem('dd_keys'), '1');
  assert.equal(page.$('.keys-toggle').textContent, 'Hide punctuation keys');
  assert.equal(page.$('.keys').getAttribute('role'), 'group');
  const labels = [...page.$$('.keys button')].map((b) => b.getAttribute('aria-label'));
  assert.ok(labels.includes('open speech marks') && labels.includes('close speech marks') && labels.includes('comma') && labels.includes('apostrophe or close single quote'));
  // typing with the keys, at the cursor
  const ta = page.$('textarea.answer');
  ta.value = 'Raj said hello';
  ta.setSelectionRange(8, 8);
  let inputs = 0;
  ta.addEventListener('input', () => inputs++);
  [...page.$$('.keys button')].find((b) => b.getAttribute('aria-label') === 'comma').click();
  assert.equal(ta.value, 'Raj said, hello');
  [...page.$$('.keys button')].find((b) => b.getAttribute('aria-label') === 'open speech marks').click();
  assert.equal(ta.value, 'Raj said,“ hello');
  assert.equal(inputs, 2, 'the app is told the box changed');
  assert.equal(page.w.document.activeElement, ta, 'focus stays in the box so the phone keyboard stays open');
  // a key press must not take focus away
  const down = new page.w.Event('mousedown', { cancelable: true });
  page.$('.keys button').dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  // and it is remembered on the next screen
  page.$('.keys-toggle').click();
  assert.equal(page.$('.keys').hidden, true);
  assert.equal(page.w.localStorage.getItem('dd_keys'), '0');
});

test('punctuation keys: shown straight away on a touch screen, and the answer bar goes once the answer is in', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html', { pre: (w) => { w.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q), addEventListener() {}, removeEventListener() {} }); } });
  await startMode1(world, page);
  assert.equal(page.$('.keys').hidden, false, 'a phone or tablet starts with the keys showing');
  answerRight(world, page);
  page.btn('Check').click();
  await page.until(() => page.btn('Next stop') || page.btn('Finish route'), 'the result');
  assert.equal(page.$('.dock').hidden, true, 'the bar with the keys and Check is gone');
});

test('what a pupil chooses is saved to their account and follows them to another device', async () => {
  const world = makeWorld();
  const a = mount(world, 'index.html');
  await signInAsGuest(a);
  await finishIntro(a);
  a.$$('nav.bottomnav button')[2].click(); // Garage
  await sleep(80);
  const swatch = (page, name) => page.$$('.swatch').find((s) => s.getAttribute('aria-label') === name);
  swatch(a, 'Sky blue').click();
  await sleep(100);
  a.$$('nav.bottomnav button')[3].click(); // Me
  await sleep(60);
  const sound = a.$('#soundbtn');
  sound.click(); // sound off
  a.$$('input[type=checkbox]').find((c) => c.checked === false);
  await sleep(700); // saved a moment after the last change
  const row = world.db.prepare('SELECT prefs FROM pupil_prefs').get();
  assert.ok(row, 'saved on the server');
  assert.deepEqual(JSON.parse(row.prefs), { garage: { paint: 'sky', helmet: 'none', sticker: 'none' }, sound: false });
  // a different device: nothing in its own storage, same pupil
  const token = a.w.localStorage.getItem('dd_token');
  const b = mount(world, 'index.html', { pre: (w) => w.localStorage.setItem('dd_token', token) });
  await b.until(() => b.$$('.dcard').length === 12, 'the town on the other device');
  assert.equal(b.w.DashSfx.enabled(), false, 'sound stays off');
  assert.equal(b.$('#soundbtn').getAttribute('aria-pressed'), 'false');
  b.$$('nav.bottomnav button')[2].click();
  await sleep(80);
  assert.equal(swatch(b, 'Sky blue').getAttribute('aria-pressed'), 'true', 'the same paint is chosen');
  assert.deepEqual(a.errors.concat(b.errors), []);
});

test('install: a button when the browser offers it, steps for iPhones, nothing once installed', async () => {
  const world = makeWorld();
  const page = mount(world, 'index.html');
  await signInAsGuest(page);
  await finishIntro(page);
  const toMe = async () => { page.$$('nav.bottomnav button')[3].click(); await sleep(80); };
  await toMe();
  assert.ok(!page.$('.install'), 'nothing to install from while the browser has not offered it');
  let prompted = false;
  const ev = new page.w.Event('beforeinstallprompt', { cancelable: true });
  ev.prompt = async () => { prompted = true; };
  page.w.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'we keep the prompt for our own button');
  await sleep(60);
  assert.match(page.$('.install').textContent, /home screen/);
  page.btn('Install').click();
  await sleep(60);
  assert.equal(prompted, true);
  assert.ok(!page.$('.install'), 'the panel goes after one use');
  page.w.dispatchEvent(new page.w.Event('appinstalled'));
  assert.ok(page.$$('.toast').some((t) => /Installed/.test(t.textContent)));
  assert.deepEqual(page.errors, []);

  const ios = mount(world, 'index.html', { pre: (w) => Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', configurable: true }) });
  await signInAsGuest(ios);
  await finishIntro(ios);
  ios.$$('nav.bottomnav button')[3].click();
  await sleep(80);
  assert.match(ios.$('.install').textContent, /Add to Home Screen/);

  const app = mount(world, 'index.html', { pre: (w) => { w.matchMedia = (q) => ({ matches: /standalone/.test(q), addEventListener() {}, removeEventListener() {} }); } });
  await signInAsGuest(app);
  await finishIntro(app);
  app.$$('nav.bottomnav button')[3].click();
  await sleep(80);
  assert.ok(!app.$('.install'), 'already installed: no panel');
});
