// The teacher console, run for real in jsdom against the real Worker code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, mount, sleep, adminToken, SECRETS, a11yProblems, closeAll } from './helpers.mjs';

test.after(closeAll);

const openConsole = async (world, { token } = {}) => {
  const t = token || (await adminToken(world));
  const page = mount(world, 'teacher.html', { pre: (w) => w.localStorage.setItem('dd_ttoken', t) });
  await page.until(() => page.$('nav.tabs'), 'the console tabs');
  return page;
};
const signInForm = async (page, user, pass) => {
  await page.until(() => page.$('#tu'), 'the sign-in form');
  page.type(page.$('#tu'), user);
  page.type(page.$('#tp'), pass);
  page.$('form').dispatchEvent(new page.w.Event('submit', { cancelable: true }));
};
const tab = async (page, label) => {
  [...page.$$('nav.tabs button')].find((b) => b.textContent.trim() === label).click();
  await sleep(120);
};
const addClasses = (world) => world.db.exec("INSERT INTO classes (name, code, created_at) VALUES ('5 Integrity', 'AAAA1', 1), ('5 Honesty', 'BBBB2', 1)");

test('nothing in the console uses the browser’s own pop-ups', async () => {
  const world = makeWorld();
  const page = await openConsole(world);
  const calls = [];
  for (const k of ['confirm', 'prompt', 'alert']) page.w[k] = (...a) => { calls.push(k + ':' + a[0]); return false; };
  assert.ok(page.w.DashUI, 'the shared dialog toolkit loaded');
  // every tab opens without touching them
  for (const t of ['Teachers', 'Questions', 'Districts', 'Game settings', 'Verb bank', 'Analytics', 'Classes & pupils', 'Dashboard']) await tab(page, t);
  assert.deepEqual(calls, []);
  assert.deepEqual(page.errors, []);
});

test('custom dialogs: confirm, cancel with Escape, and type-the-name before deleting', async () => {
  const world = makeWorld();
  const page = await openConsole(world);
  const UI = page.w.DashUI;
  const asked = UI.confirm({ title: 'Sure?', body: 'Line one\nLine two', confirmLabel: 'Do it', danger: true });
  await page.until(() => page.$('dialog.ddlg[open]'), 'the dialog');
  const dlg = page.$('dialog.ddlg');
  assert.equal(dlg.querySelector('h2').textContent, 'Sure?');
  assert.equal(dlg.querySelectorAll('.ddlg-body p').length, 2);
  assert.equal(dlg.getAttribute('aria-labelledby'), dlg.querySelector('h2').id, 'the dialog is named for screen readers');
  assert.equal(page.w.document.activeElement.textContent, 'Cancel', 'a risky action starts on Cancel');
  dlg.dispatchEvent(new page.w.Event('cancel', { cancelable: true })); // the Escape key
  assert.equal(await asked, false);
  assert.ok(!page.$('dialog.ddlg'), 'the dialog is gone');

  const del = UI.ask({ title: 'Delete?', typeToConfirm: '5 Honesty', danger: true, confirmLabel: 'Delete class' });
  await page.until(() => page.$('dialog.ddlg[open]'), 'the type-to-confirm dialog');
  const go = [...page.$$('dialog.ddlg button')].find((b) => b.type === 'submit');
  assert.equal(go.disabled, true, 'the button waits for the name');
  page.type(page.$('dialog.ddlg input'), '5 honest');
  assert.equal(go.disabled, true);
  page.type(page.$('dialog.ddlg input'), '5 Honesty');
  assert.equal(go.disabled, false);
  go.click();
  assert.equal((await del).ok, true);

  const name = UI.prompt({ title: 'Rename', label: 'Class name', value: 'Old' });
  await page.until(() => page.$('dialog.ddlg[open]'), 'the prompt');
  assert.equal(page.$('dialog.ddlg input').value, 'Old');
  page.type(page.$('dialog.ddlg input'), 'New');
  await page.dialog();
  assert.equal(await name, 'New');
  const none = UI.prompt({ title: 'Rename', value: 'x' });
  await page.dialog(false);
  assert.equal(await none, null);
});

test('toasts announce results and can be dismissed; errors use role alert', async () => {
  const world = makeWorld();
  const page = await openConsole(world);
  const UI = page.w.DashUI;
  UI.toast('Saved.', { kind: 'ok' });
  UI.toast('That failed.', { kind: 'error' });
  const [ok, bad] = page.$$('.toast');
  assert.equal(ok.getAttribute('role'), 'status');
  assert.equal(bad.getAttribute('role'), 'alert');
  bad.querySelector('.toast-x').click();
  assert.equal(page.$$('.toast').length, 1);
  let undone = false;
  UI.toast('Removed.', { action: { label: 'Undo', onClick: () => { undone = true; } } });
  page.$$('.toast button').find((b) => b.textContent === 'Undo').click();
  assert.equal(undone, true);
  UI.announce('Hello');
  await sleep(60);
  assert.equal(page.$('#dd-live').textContent, 'Hello');
});

test('the console shows a loading placeholder, and a retry panel when a page fails to load', async () => {
  const world = makeWorld();
  const token = await adminToken(world);
  const page = mount(world, 'teacher.html', { pre: (w) => w.localStorage.setItem('dd_ttoken', token) });
  assert.ok(page.$('.skel-wrap'), 'a loading placeholder shows at once');
  await page.until(() => page.$('nav.tabs'), 'the console');
  await sleep(100);
  world.offline = true;
  await tab(page, 'Questions');
  await page.until(() => page.$('.errpanel'), 'the error panel');
  assert.match(page.text(), /Can’t reach the server/);
  assert.ok(page.$$('.toast.error').length >= 1);
  world.offline = false;
  page.btn('Try again').click();
  await page.until(() => !page.$('.errpanel') && page.$('table.tbl'), 'the page after retry');
});

test('question bank: search, filter, sort and page through the whole bank', async () => {
  const world = makeWorld();
  const page = await openConsole(world);
  await tab(page, 'Questions');
  await page.until(() => /Question bank \(\d+\)/.test(page.text()), 'the bank');
  const total = +page.text().match(/Question bank \((\d+)\)/)[1];
  assert.ok(total > 400);
  assert.equal(page.$$('tbody tr').length, 25, 'one page of 25, not the whole bank');
  assert.match(page.text(), new RegExp('Showing 1 to 25 of ' + total));
  // paging
  page.btn('Next').click();
  assert.match(page.text(), /Page 2 of/);
  assert.match(page.text(), new RegExp('Showing 26 to 50 of ' + total));
  page.$('select[aria-label="Questions per page"]').value = '100';
  page.$('select[aria-label="Questions per page"]').dispatchEvent(new page.w.Event('change'));
  assert.equal(page.$$('tbody tr').length, 100);
  assert.match(page.text(), /Page 1 of/);
  // search
  const search = page.$('input[type=search]');
  page.type(search, 'librarian');
  const hits = page.$$('tbody tr').length;
  assert.ok(hits > 0 && hits < 100, 'search narrows the list (' + hits + ')');
  assert.match(page.text(), /Question bank: \d+ of \d+ match/);
  page.type(search, 'zzzz-nothing-matches');
  assert.match(page.text(), /No questions match/);
  page.type(search, '');
  // filters
  const byLabel = (l) => page.$('select[aria-label="Filter: ' + l + '"]');
  byLabel('Type').value = '3';
  byLabel('Type').dispatchEvent(new page.w.Event('change'));
  assert.ok(page.$$('tbody tr').every((r) => r.firstChild.textContent === 'M3'));
  byLabel('Type').value = '0';
  byLabel('Type').dispatchEvent(new page.w.Event('change'));
  byLabel('District').value = '12';
  byLabel('District').dispatchEvent(new page.w.Event('change'));
  assert.ok(page.$$('tbody tr').length > 0 && page.$$('tbody tr').every((r) => /12\. Customer Quarter/.test(r.textContent)));
  page.btn('Clear filters').click();
  await page.until(() => page.$$('tbody tr').length === 25, 'a cleared bank');
  assert.deepEqual(page.errors, []);
});

test('question bank: the filters survive editing and stay put across a reload of the same tab', async () => {
  const world = makeWorld();
  const page = await openConsole(world);
  await tab(page, 'Questions');
  await page.until(() => page.$('input[type=search]'), 'the bank');
  page.type(page.$('input[type=search]'), 'librarian');
  const before = page.$$('tbody tr').length;
  await tab(page, 'Districts');
  await tab(page, 'Questions');
  await page.until(() => page.$('input[type=search]'), 'the bank again');
  assert.equal(page.$('input[type=search]').value, 'librarian', 'the search is remembered');
  assert.equal(page.$$('tbody tr').length, before);
});

test('teacher accounts: the super admin creates one, assigns classes and sees the password once', async () => {
  const world = makeWorld();
  addClasses(world);
  const page = await openConsole(world);
  assert.match(page.text(), /\(super admin\)/);
  await tab(page, 'Teachers');
  await page.until(() => /Add a teacher/.test(page.text()), 'the teachers tab');
  const inputs = page.$$('input[type=text]');
  page.type(inputs.find((i) => i.getAttribute('aria-label') === 'Teacher name'), 'Ms Tan');
  page.type(inputs.find((i) => i.getAttribute('aria-label') === 'Username'), 'mstan');
  const boxes = page.$$('.tagpick input[type=checkbox]');
  assert.equal(boxes.length, 2);
  boxes[0].checked = true;
  page.btn('Create account').click();
  await page.until(() => page.$('#tshown .notice'), 'the password');
  const pw = page.$('#tshown .code-big').textContent;
  assert.match(pw, /^[A-Za-z2-9]{10}$/);
  assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM teacher_classes').get().n, 1);
  // resetting needs a real dialog
  page.$$('td button').find((b) => b.textContent.trim() === 'New password').click();
  await page.dialog('Make new password');
  await page.until(() => page.$('#tshown .code-big') && page.$('#tshown .code-big').textContent !== pw, 'a new password');
  assert.deepEqual(page.errors, []);
});

test('game settings: edit a draft, see what it would do, and save it all at once', async () => {
  const world = makeWorld();
  addClasses(world);
  const c = world.db.prepare("SELECT id FROM classes WHERE name = '5 Honesty'").get().id;
  const pid = world.db.prepare("INSERT INTO pupils (class_id, name, username, is_guest, created_at) VALUES (?, 'Amy', 'amy', 0, 1) RETURNING id").get(c).id;
  world.db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (?, ?, 1, 1, 1, 0, 1, 450, 'x', '[]', ?)").run(pid, c, Date.now());
  const page = await openConsole(world);
  await tab(page, 'Game settings');
  await page.until(() => /XP per level/.test(page.text()) && page.$('.lvchart'), 'the settings');
  assert.ok(!page.$('.savebar') || page.$('.savebar').hidden, 'no save bar until something changes');
  assert.equal(page.$$('input[aria-label^="XP per level in range"]').length, 5);
  assert.match(page.text(), /Level 10 at 450 XP/);
  assert.match(page.text(), /level 20 at 1,200 XP/);
  assert.ok(page.$('.lvchart').getAttribute('aria-label').includes('Level 10 at 450 XP'), 'the chart has a text description');
  // a change goes into the draft, not to the server
  page.type(page.$('input[aria-label="XP per level in range 1"]'), '100');
  assert.match(page.text(), /Level 10 at 900 XP/);
  assert.equal(page.$('.savebar').hidden, false);
  assert.match(page.$('.savebar').textContent, /unsaved changes/);
  assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'level_bands'").get().n, 0, 'nothing saved yet');
  await page.until(() => /What this would do/.test(page.text()) && /would drop a level/.test(page.text()), 'the impact preview');
  assert.match(page.text(), /would lose districts 4–6/);
  assert.match(page.text(), /Amy \(5 Honesty\) level 10 to 5/);
  // a bad number stops the save
  page.type(page.$('input[aria-label="XP per level in range 2"]'), '');
  assert.equal(page.exact('Save changes').disabled, true);
  assert.match(page.$('.savebar').textContent, /Fix the highlighted numbers/);
  page.type(page.$('input[aria-label="XP per level in range 2"]'), '75');
  assert.equal(page.exact('Save changes').disabled, false);
  // ranks and vehicles, in the same draft
  page.type(page.$('input[aria-label="XP for Delivery bike"]'), '100');
  page.exact('Save changes').click();
  await page.until(() => /Save these changes\?/.test(page.text()), 'the confirmation');
  assert.match(page.$('dialog.ddlg').textContent, /would lose districts 4–6/, 'the dialog repeats what will happen');
  await page.dialog('Save changes');
  await sleep(400);
  assert.match(world.db.prepare("SELECT v FROM meta WHERE k = 'level_bands'").get().v, /"xp":100/);
  assert.match(world.db.prepare("SELECT v FROM meta WHERE k = 'vehicle_xp'").get().v, /^\[0,100,/);
  assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'rank_xp'").get().n, 0, 'unchanged settings are not touched');
  // the standard amounts button, then save, removes the custom value
  await page.until(() => page.$('input[aria-label="XP per level in range 1"]').value === '100' && page.$('.savebar').hidden, 'reloaded');
  page.$$('button').find((b) => b.textContent.trim() === 'Standard amounts').click();
  assert.equal(page.$('input[aria-label="XP per level in range 1"]').value, '50');
  page.exact('Save changes').click();
  await page.dialog('Save changes');
  await sleep(400);
  assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'level_bands'").get().n, 0);
  assert.deepEqual(page.errors, []);
});

test('game settings: discarding, and being asked before leaving with unsaved changes', async () => {
  const world = makeWorld();
  const page = await openConsole(world);
  await tab(page, 'Game settings');
  await page.until(() => page.$('.lvchart'), 'the settings');
  const clock = page.$('input[type=checkbox]');
  clock.checked = false;
  clock.dispatchEvent(new page.w.Event('change'));
  assert.equal(page.$('.savebar').hidden, false);
  page.exact('Discard').click();
  assert.equal(page.$('.savebar').hidden, true);
  assert.equal(page.$('input[type=checkbox]').checked, true, 'the switch went back');
  // leave with a change pending
  page.$('input[type=checkbox]').checked = false;
  page.$('input[type=checkbox]').dispatchEvent(new page.w.Event('change'));
  [...page.$$('nav.tabs button')].find((b) => b.textContent.trim() === 'Questions').click();
  await page.dialog('Stay');
  assert.ok(page.$('.lvchart'), 'still on the settings');
  [...page.$$('nav.tabs button')].find((b) => b.textContent.trim() === 'Questions').click();
  await page.dialog('Leave');
  await page.until(() => /Question bank/.test(page.text()), 'the questions tab');
  assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE k = 'clock'").get().n, 0, 'nothing was saved');
});

test('the dashboard: how the class is getting on, who is quiet, who is stuck', async () => {
  const world = makeWorld();
  addClasses(world);
  const c = world.db.prepare("SELECT id FROM classes WHERE name = '5 Honesty'").get().id;
  const ins = world.db.prepare("INSERT INTO pupils (class_id, name, username, is_guest, created_at) VALUES (?, ?, ?, 0, 1) RETURNING id");
  const [amy, ben] = [ins.get(c, 'Amy', 'amy').id, ins.get(c, 'Ben', 'ben').id];
  const att = world.db.prepare("INSERT INTO attempts (pupil_id, class_id, question_id, mode, try_no, practice, correct, xp, answer, codes, ts) VALUES (?, ?, 1, 1, 1, 0, ?, ?, 'x', ?, ?)");
  att.run(amy, c, 1, 500, '[]', Date.now());
  for (let i = 0; i < 5; i++) att.run(amy, c, 0, 0, '["NO_QUOTES"]', Date.now());
  const page = await openConsole(world);
  await page.until(() => /Where the class is/.test(page.text()), 'the dashboard');
  assert.ok([...page.$$('nav.tabs button')][0].textContent.includes('Dashboard'), 'it is the first tab');
  assert.equal([...page.$$('nav.tabs button')][0].getAttribute('aria-current'), 'page', 'and the one you land on');
  // classes are listed A to Z, so the first is 5 Honesty
  assert.match(page.text(), /1 of 2played this week/);
  assert.match(page.text(), /Levels 10 to 19/);
  assert.match(page.text(), /Amy keeps slipping on Speech Mark Street/);
  assert.match(page.text(), /Haven’t played this week/);
  assert.match(page.text(), /Ben \(never\)/);
  assert.match(page.text(), /Most missed, last two weeks/);
  assert.match(page.text(), /1 pupil has reached level 10/);
  // sorting the pupil list
  const sort = page.$('select[aria-label="Sort pupils by"]');
  sort.value = 'level';
  sort.dispatchEvent(new page.w.Event('change'));
  assert.match(page.$$('tbody tr')[0].textContent, /Amy/);
  // a second class
  const other = page.$('select[aria-label="Class"]');
  other.value = String(world.db.prepare("SELECT id FROM classes WHERE name = '5 Integrity'").get().id);
  other.dispatchEvent(new page.w.Event('change'));
  await page.until(() => /No pupils in this class yet/.test(page.text()), 'the empty class');
  assert.deepEqual(page.errors, []);
});

test('the dashboard has a friendly empty state', async () => {
  const world = makeWorld();
  const page = await openConsole(world);
  await page.until(() => /Add a class on the Classes tab/.test(page.text()), 'the empty state');
  page.btn('Go to Classes').click();
  await page.until(() => page.btn('Create class'), 'the classes tab');
});

test('the unlock grid: tick a district for a class and it saves on the spot', async () => {
  const world = makeWorld();
  addClasses(world);
  const page = await openConsole(world);
  await tab(page, 'Districts');
  await page.until(() => /Open districts for your classes/.test(page.text()) && page.$('table.gridtbl'), 'the grid');
  assert.equal(page.$$('table.gridtbl tbody tr').length, 2, 'one row per class');
  assert.match(page.$('table.gridtbl thead').textContent, /Open from the start/);
  assert.match(page.$('table.gridtbl thead').textContent, /Level 10 \(450 XP\)/);
  assert.match(page.$('table.gridtbl thead').textContent, /Level 20 \(1,200 XP\)/);
  const row = page.$$('table.gridtbl tbody tr').find((r) => /5 Honesty/.test(r.textContent));
  assert.equal(row.querySelectorAll('input[type=checkbox]').length, 9, 'districts 1-3 are always open, so 9 can be ticked');
  const box = row.querySelector('input[aria-label="Open Comma Lane for 5 Honesty"]');
  assert.ok(box);
  box.checked = true;
  box.dispatchEvent(new page.w.Event('change'));
  await sleep(300);
  const id = world.db.prepare("SELECT id FROM classes WHERE name = '5 Honesty'").get().id;
  assert.equal(world.db.prepare('SELECT unlocked FROM class_settings WHERE class_id = ?').get(id).unlocked, '[4]');
  assert.ok(page.$$('.toast').some((t) => /Saved for 5 Honesty/.test(t.textContent)));
  [...row.querySelectorAll('button')].find((b) => b.textContent === 'Open all').click();
  await sleep(300);
  assert.equal(world.db.prepare('SELECT unlocked FROM class_settings WHERE class_id = ?').get(id).unlocked, '[4,5,6,7,8,9,10,11,12]');
  [...row.querySelectorAll('button')].find((b) => b.textContent === 'Levels only').click();
  await sleep(300);
  assert.equal(world.db.prepare('SELECT unlocked FROM class_settings WHERE class_id = ?').get(id).unlocked, '[]');
});

test('a teacher account sees only their own classes and tools, and can make and delete a class', async () => {
  const world = makeWorld();
  addClasses(world);
  const admin = await openConsole(world);
  await tab(admin, 'Teachers');
  await admin.until(() => /Add a teacher/.test(admin.text()), 'teachers');
  const inputs = admin.$$('input[type=text]');
  admin.type(inputs.find((i) => i.getAttribute('aria-label') === 'Teacher name'), 'Ms Tan');
  admin.type(inputs.find((i) => i.getAttribute('aria-label') === 'Username'), 'mstan');
  admin.$$('.tagpick input[type=checkbox]')[0].checked = true; // 5 Honesty (classes are listed A to Z)
  admin.btn('Create account').click();
  await admin.until(() => admin.$('#tshown .code-big'), 'the password');
  const pw = admin.$('#tshown .code-big').textContent;

  const page = mount(world, 'teacher.html');
  await signInForm(page, 'mstan', pw);
  await page.until(() => page.btn('Change password'), 'the teacher console');
  assert.ok(!page.btn('Teachers') && !page.btn('Verb bank') && !page.btn('Game settings') && page.btn('My classes') && page.btn('Verb review') && page.btn('Dashboard'));
  assert.ok(!/admin\)/.test(page.text()));
  await tab(page, 'My classes');
  await page.until(() => page.$$('table.tbl').length, 'the class list');
  assert.match(page.text(), /5 Honesty/);
  assert.ok(!/5 Integrity/.test(page.text()));
  // a class they were given: can run it, can't delete it
  page.$$('tr').find((r) => /5 Honesty/.test(r.textContent)).querySelector('button').click();
  await page.until(() => page.btn('New class code'), 'the class');
  assert.ok(!page.btn('Delete class') && page.btn('Archive') && page.btn('Rename'));
  // make their own, then delete it with the typed name
  page.btn('My classes').click();
  await page.until(() => page.btn('Create class'), 'the list again');
  page.type(page.$('form input[type=text]'), '6 Courage');
  page.btn('Create class').click();
  await page.until(() => /6 Courage/.test(page.text()), 'the new class');
  assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM class_owners').get().n, 1);
  page.$$('tr').find((r) => /6 Courage/.test(r.textContent)).querySelector('button').click();
  await page.until(() => page.btn('Delete class'), 'own class detail');
  page.btn('Delete class').click();
  await page.until(() => page.$('dialog.ddlg[open]'), 'the delete dialog');
  const go = [...page.$$('dialog.ddlg button')].find((b) => b.type === 'submit');
  assert.equal(go.disabled, true);
  page.type(page.$('dialog.ddlg input'), '6 Courage');
  go.click();
  await page.until(() => !/6 Courage/.test(page.text()), 'the class gone');
  assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM classes WHERE name = '6 Courage'").get().n, 0);
  // districts: the unlock panel only
  await tab(page, 'Districts');
  await page.until(() => /Open districts for your classes/.test(page.text()), 'unlock grid');
  assert.ok(!/Town settings/.test(page.text()) && !/Accept all suggestions/.test(page.text()));
  const lv = page.$$('table.gridtbl input[type=checkbox]');
  assert.equal(lv.length, 9);
  lv[1].checked = true; // district 5
  lv[1].dispatchEvent(new page.w.Event('change'));
  await sleep(400);
  assert.equal(world.db.prepare('SELECT unlocked FROM class_settings').get().unlocked, '[5]');
  // questions: shared bank is read-only and there's no "every class" choice
  await tab(page, 'Questions');
  await page.until(() => /Question bank/.test(page.text()), 'questions');
  assert.ok(![...page.$$('option')].some((o) => /Every class and guests/.test(o.textContent)));
  assert.match(page.text(), /shared bank/);
  await tab(page, 'Verb review');
  await page.until(() => /Words the AI has judged/.test(page.text()), 'verb review');
  assert.ok(!/Add a verb/.test(page.text()));
  assert.deepEqual(page.errors, []);
});

test('wrong teacher password gives a clear message', async () => {
  const world = makeWorld();
  const page = mount(world, 'teacher.html');
  await signInForm(page, SECRETS.teacher_user, 'not-the-password');
  await page.until(() => /Wrong username or password/.test(page.text()), 'the error');
});

test('accessibility basics hold on every console tab', async () => {
  const world = makeWorld();
  addClasses(world);
  const page = await openConsole(world);
  for (const t of ['Dashboard', 'Classes & pupils', 'Teachers', 'Questions', 'Districts', 'Game settings', 'Verb bank', 'Analytics']) {
    await tab(page, t);
    await sleep(150);
    assert.deepEqual(a11yProblems(page), [], t);
  }
});
