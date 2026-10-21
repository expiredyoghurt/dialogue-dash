/* Dialogue Dash — teacher console. Plain JS. Server text is always inserted with textContent. */
(() => {
  'use strict';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const app = document.getElementById('app');
  const mem = {};
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
    del: (k) => { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
  };

  const S = {
    token: store.get('dd_ttoken') || '',
    who: null,
    tab: 'classes',
    meta: null,
    classes: [],
    guests: 0,
    selClass: null, // id
    sheet: false,
    qMode: 0,
    editQ: null,
    ana: { cls: '', days: 30, by: 'rule' },
    msg: '',
  };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api/t' + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401) {
      S.token = '';
      store.del('dd_ttoken');
      render();
      throw new Error('Please sign in again.');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong (' + res.status + ').');
    return data;
  }

  const flash = (m, bad) => {
    const n = h('div', { class: 'notice' + (bad ? ' bad' : ''), role: 'status' }, m);
    const box = document.getElementById('flash');
    if (!box) return;
    box.replaceChildren(n);
    n.scrollIntoView({ block: 'nearest' });
  };
  const guard = (fn) => async (...a) => {
    try { await fn(...a); } catch (e) { flash(e.message, true); }
  };
  const tagLabel = (k) => (S.meta && S.meta.tags && S.meta.tags[k]) || k;
  const fmtTime = (t) => (t ? new Date(t).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const download = (name, text) => {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
  };

  // ---------- shell ----------
  function render() {
    if (!S.token) {
      S.who = null;
      return app.replaceChildren(loginView());
    }
    if (!S.who) {
      // who is signed in decides which tabs and buttons exist
      api('/me').then((w) => { S.who = w; render(); }).catch(() => {});
      return app.replaceChildren(h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Loading…')));
    }
    const admin = S.who.admin;
    const tabs = admin
      ? [['classes', 'Classes & pupils'], ['teachers', 'Teachers'], ['questions', 'Questions'], ['districts', 'Districts'], ['verbs', 'Verb bank'], ['analytics', 'Analytics']]
      : [['classes', 'My classes'], ['questions', 'Questions'], ['districts', 'Districts'], ['verbs', 'Verb review'], ['analytics', 'Analytics']];
    if (!tabs.some(([k]) => k === S.tab)) S.tab = 'classes';
    const body = h('div', { class: 'wrap' }, h('div', { id: 'flash', 'aria-live': 'polite' }), h('div', { id: 'tab' }));
    app.replaceChildren(
      h('header', { class: 'topbar no-print' },
        h('div', { class: 'brand' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Dash Express · Teacher'),
        h('div', { class: 'row', style: 'align-items:center;gap:8px' },
          h('span', { class: 'small muted' }, S.who.name + (admin ? ' (super admin)' : '')),
          admin ? null : h('button', { class: 'btn ghost small', type: 'button', onclick: passwordDialog }, 'Change password'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.token = ''; S.who = null; store.del('dd_ttoken'); render(); } }, 'Sign out'))),
      h('nav', { class: 'tabs no-print', 'aria-label': 'Sections' },
        tabs.map(([k, l]) => h('button', { class: 'tab', type: 'button', 'aria-current': S.tab === k ? 'page' : false, onclick: () => { S.tab = k; render(); } }, l))),
      body,
    );
    const view = { classes: classesView, teachers: teachersView, questions: questionsView, districts: districtsView, verbs: verbsView, analytics: analyticsView }[S.tab];
    guard(async () => {
      if (!S.meta) S.meta = await (await fetch('/api/meta')).json();
      await view(document.getElementById('tab'));
    })();
  }

  function loginView() {
    const u = h('input', { type: 'text', id: 'tu', autocomplete: 'username', required: true });
    const p = h('input', { type: 'password', id: 'tp', autocomplete: 'current-password', required: true });
    const err = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
    return h('div', { class: 'wrap' },
      h('div', { class: 'auth' },
        h('div', { class: 'brand', style: 'margin:0 0 18px' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Teacher sign-in'),
        h('form', { class: 'panel', onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          err.replaceChildren();
          try {
            const res = await fetch('/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u.value, password: p.value }) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'Could not sign in.');
            S.token = d.token;
            store.set('dd_ttoken', d.token);
            render();
          } catch (x) {
            err.replaceChildren(h('div', { class: 'notice bad', role: 'alert' }, x.message));
            btn.disabled = false;
          }
        } },
          h('label', { class: 'field' }, h('span', null, 'Username'), u),
          h('label', { class: 'field' }, h('span', null, 'Password'), p),
          err, btn)));
  }

  function passwordDialog() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
    const nxt = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'New password' });
    const dlg = h('dialog', { 'aria-label': 'Change password' },
      h('h2', { style: 'margin-top:0' }, 'Change your password'),
      h('label', { class: 'field' }, h('span', null, 'Current password'), cur),
      h('label', { class: 'field' }, h('span', null, 'New password (at least 8 characters)'), nxt),
      h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
        h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
          await api('/me/password', { method: 'POST', body: { current: cur.value, next: nxt.value } });
          dlg.close();
          flash('Password changed.');
        }) }, 'Change password'),
        h('button', { class: 'btn alt', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- teacher accounts (admin only) ----------
  async function teachersView(root) {
    const [tl, cl] = await Promise.all([api('/teachers'), api('/classes')]);
    S.classes = cl.classes;
    const cname = (id) => (S.classes.find((c) => c.id === id) || { name: 'Class ' + id }).name;
    const secret = (title, who, pw) => h('div', { class: 'notice', role: 'status' },
      h('b', null, title + ' '), who, ' Password: ',
      h('span', { class: 'code-big', style: 'font-size:1.2rem;letter-spacing:.08em' }, pw),
      h('div', { class: 'small' }, 'Copy this now. It is shown once and can’t be looked up later. You can always make a new one.'));
    const shown = h('div');

    // add a teacher
    const name = h('input', { type: 'text', maxlength: '60', placeholder: 'e.g. Ms Tan', 'aria-label': 'Teacher name' });
    const user = h('input', { type: 'text', maxlength: '30', placeholder: 'e.g. mstan', autocapitalize: 'none', 'aria-label': 'Username' });
    const picks = classPicker([]);
    const add = h('section', { class: 'panel' },
      h('h2', null, 'Add a teacher'),
      h('div', { class: 'grid-form' }, h('label', { class: 'field' }, h('span', null, 'Name'), name), h('label', { class: 'field' }, h('span', null, 'Username'), user)),
      h('p', { class: 'small', style: 'margin:8px 0 4px' }, 'Teachers can create and run their own classes. You can also give them classes that already exist (optional):'),
      picks.el,
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
        const r = await api('/teachers', { method: 'POST', body: { name: name.value, username: user.value, classes: picks.get() } });
        await teachersView(root);
        document.getElementById('tshown').replaceChildren(secret('Account created.', r.teacher.name + ' signs in as ' + r.teacher.username + '.', r.password));
      }) }, 'Create account')));

    const rows = tl.teachers.map((t) => h('tr', null,
      h('td', null, h('b', null, t.name), h('div', { class: 'small muted' }, t.username + (t.active ? '' : ' · switched off'))),
      h('td', null, t.classes.length ? t.classes.map((id) => h('span', { class: 'pill', style: 'margin-right:4px' }, cname(id))) : h('span', { class: 'muted small' }, 'no classes yet')),
      h('td', { class: 'small muted' }, t.last_login ? fmtTime(t.last_login) : 'never'),
      h('td', null,
        h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.editT = S.editT === t.id ? null : t.id; teachersView(root); } }, 'Classes'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          if (!confirm('Make a new password for ' + t.name + '? They will be signed out.')) return;
          const r = await api(`/teachers/${t.id}/reset-password`, { method: 'POST' });
          document.getElementById('tshown').replaceChildren(secret('New password.', t.name + ' (' + t.username + ').', r.password));
        }) }, 'New password'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          await api('/teachers/' + t.id, { method: 'PATCH', body: { active: !t.active } });
          teachersView(root);
        }) }, t.active ? 'Switch off' : 'Switch on'),
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          if (!confirm('Delete the account for ' + t.name + '? Their classes stay as they are.')) return;
          await api('/teachers/' + t.id, { method: 'DELETE' });
          teachersView(root);
        }) }, 'Delete'))));

    const editing = tl.teachers.find((t) => t.id === S.editT);
    let editor = null;
    if (editing) {
      const ep = classPicker(editing.classes);
      editor = h('section', { class: 'panel sel' },
        h('h2', null, 'Classes for ' + editing.name),
        ep.el,
        h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
          h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
            await api('/teachers/' + editing.id, { method: 'PATCH', body: { classes: ep.get() } });
            S.editT = null;
            await teachersView(root);
            flash('Classes saved for ' + editing.name + '.');
          }) }, 'Save classes'),
          h('button', { class: 'btn alt', type: 'button', onclick: () => { S.editT = null; teachersView(root); } }, 'Cancel')));
    }

    root.replaceChildren(
      h('div', { id: 'tshown' }),
      add,
      editor,
      h('section', { class: 'panel' },
        h('h2', null, `Teachers (${tl.teachers.length})`),
        h('p', { class: 'muted small' }, 'You are the super admin. Each teacher is the admin of their own classes: they create them, add pupils, manage class codes and class questions, open districts and see analytics, and they can delete the classes they created. They can’t see other teachers’ classes, change the shared question bank or verb list, or see guest players. Classes you give them can be run but not deleted by them.'),
        tl.teachers.length
          ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Teacher', 'Classes', 'Last signed in', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
          : h('p', { class: 'muted' }, 'No teacher accounts yet. Add one above.')));
    void shown;
  }

  // tick boxes for a set of classes
  function classPicker(selected) {
    const boxes = S.classes.map((c) => ({ c, box: h('input', { type: 'checkbox', value: String(c.id), checked: selected.includes(c.id) }) }));
    const el = boxes.length
      ? h('div', { class: 'tagpick' }, boxes.map(({ c, box }) => h('label', null, box, c.name + (c.archived ? ' (archived)' : ''))))
      : h('p', { class: 'muted small' }, 'There are no classes yet. Add one on the Classes tab first.');
    return { el, get: () => boxes.filter((b) => b.box.checked).map((b) => b.c.id) };
  }

  // ---------- XP per level (admin) ----------
  const xpForLevelC = (level, bands) => {
    let xp = 0;
    let at = 1;
    for (const b of bands) {
      if (at >= level) break;
      const top = b.upTo === null ? level : Math.min(b.upTo, level);
      if (top <= at) continue;
      xp += (top - at) * b.xp;
      at = top;
    }
    return xp;
  };
  function levelsPanel(st) {
    const fmt = (n) => Number(n).toLocaleString('en-SG');
    let rows = st.levelBands.map((b) => ({ upTo: b.upTo, xp: b.xp }));
    const host = h('div');
    const prevEl = h('p', { class: 'small', style: 'margin:8px 0 0', 'aria-live': 'polite' });
    const tiers = (S.meta.levels && S.meta.levels.tiers ? S.meta.levels.tiers : []).filter((t) => t.level > 1);
    const draw = () => {
      let prev = 1;
      const lines = rows.map((r, i) => {
        const last = i === rows.length - 1;
        const from = prev + 1;
        const upIn = last ? null : h('input', { type: 'number', min: String(from), max: '1000', value: String(r.upTo), style: 'width:5.5em', 'aria-label': 'Last level in range ' + (i + 1), oninput: (e) => { r.upTo = +e.target.value; preview(); } });
        const xpIn = h('input', { type: 'number', min: '1', max: '100000', value: String(r.xp), style: 'width:6.5em', 'aria-label': 'XP per level in range ' + (i + 1), oninput: (e) => { r.xp = +e.target.value; preview(); } });
        if (!last) prev = r.upTo;
        return h('tr', null,
          h('td', null, last ? `Level ${from} onwards` : [`Levels ${from} to `, upIn]),
          h('td', null, xpIn, ' XP per level'),
          h('td', null, rows.length > 1 ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { if (last) { rows.splice(i, 1); rows[rows.length - 1].upTo = null; } else rows.splice(i, 1); draw(); } }, 'Remove') : null));
      });
      host.replaceChildren(h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Levels', 'Cost', ''].map((t) => h('th', null, t)))), h('tbody', null, lines))), prevEl);
      preview();
    };
    const preview = () => {
      const el = prevEl;
      const ok = rows.every((r, i) => (i === rows.length - 1 ? r.xp >= 1 : r.upTo > (i ? rows[i - 1].upTo : 1) && r.xp >= 1));
      el.textContent = ok ? tiers.map((t) => `Level ${t.level} is reached at ${fmt(xpForLevelC(t.level, rows))} XP`).join(' · ') + ' · Level 1 is free.' : 'Each range must end at a higher level than the one before.';
    };
    draw();
    const wrap = (r) => r.map((x, i) => ({ upTo: i === r.length - 1 ? null : x.upTo, xp: x.xp }));
    return h('section', { class: 'panel' },
      h('h2', null, 'XP per level'),
      h('p', { class: 'muted small' }, 'Level 1 is free. Every later level costs the XP of the range it falls in. Districts open at level 10 and level 20 whatever these numbers are. Changing them changes every pupil’s level straight away, so some districts may lock or unlock.'),
      host,
      h('div', { class: 'row', style: 'gap:8px;margin-top:10px;flex-wrap:wrap' },
        h('button', { class: 'btn small alt', type: 'button', onclick: () => { if (rows.length >= 8) return flash('That is the most ranges you can have.', true); const last = rows[rows.length - 1]; const before = rows.length > 1 ? rows[rows.length - 2].upTo : 1; rows.splice(rows.length - 1, 0, { upTo: before + 10, xp: last.xp }); draw(); } }, 'Add a range'),
        h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
          if (!confirm('Save these XP-per-level amounts? Every pupil’s level changes straight away.')) return;
          const r = await api('/settings', { method: 'PUT', body: { levelBands: wrap(rows) } });
          flash('Saved. ' + r.tierXp.map((t) => `Level ${t.level} is at ${fmt(t.xp)} XP`).join(', ') + '.');
          render();
        }) }, 'Save'),
        h('button', { class: 'btn ghost', type: 'button', onclick: guard(async () => {
          if (!confirm('Go back to the standard amounts (50, 75, 100, 150, then 200 XP per level)?')) return;
          await api('/settings', { method: 'PUT', body: { levelBands: null } });
          flash('Back to the standard amounts.');
          render();
        }) }, 'Reset to the standard amounts'),
        st.levelBandsCustom ? h('span', { class: 'pill warn' }, 'customised') : h('span', { class: 'pill' }, 'standard')));
  }

  // ---------- opening districts by hand for a class ----------
  async function unlockPanel() {
    const classes = (await api('/classes')).classes.filter((c) => !c.archived);
    S.classes = classes;
    if (!classes.length) return h('section', { class: 'panel' }, h('h2', null, 'Open districts for a class'), h('p', { class: 'muted' }, 'Add a class on the Classes tab first.'));
    if (!classes.some((c) => c.id === S.unlockClass)) S.unlockClass = classes[0].id;
    const cur = await api(`/classes/${S.unlockClass}/unlocks`);
    const D = (S.meta && S.meta.districts) || [];
    const tiers = cur.tiers;
    const on = new Set(cur.unlocked);
    const boxes = new Map();
    const box = (n) => {
      const b = h('input', { type: 'checkbox', checked: on.has(n) });
      boxes.set(n, b);
      return h('label', { class: 'small', style: 'display:flex;gap:6px;align-items:center' }, b, ((D.find((d) => d.n === n) || {}).name) || 'District ' + n);
    };
    const setAll = (list, v) => list.forEach((n) => { boxes.get(n).checked = v; });
    const save = guard(async () => {
      await api(`/classes/${S.unlockClass}/unlocks`, { method: 'PUT', body: { unlocked: [...boxes].filter(([, b]) => b.checked).map(([n]) => n) } });
      flash('Saved. Pupils in this class see the change straight away.');
    });
    return h('section', { class: 'panel' },
      h('h2', null, 'Open districts for a class'),
      h('p', { class: 'muted small' }, 'Pupils open districts as they level up. Tick a district here to open it for the whole class now, whatever their level. Unticked districts still open as pupils reach the level.'),
      h('label', { class: 'field', style: 'max-width:320px' }, h('span', null, 'Class'),
        h('select', { onchange: (e) => { S.unlockClass = +e.target.value; render(); } }, classes.map((c) => h('option', { value: String(c.id), selected: c.id === S.unlockClass }, c.name)))),
      tiers.map((t) => h('div', { style: 'margin:12px 0' },
        h('div', { class: 'row', style: 'align-items:center;gap:10px;flex-wrap:wrap' },
          h('b', null, t.level === 1 ? 'Open from the start' : `Opens at level ${t.level} (${(cur.tierXp.find((x) => x.level === t.level) || {}).xp} XP)`),
          h('button', { class: 'btn small alt', type: 'button', onclick: () => setAll(t.districts, true) }, 'Open all of these'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => setAll(t.districts, false) }, 'Clear')),
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;margin-top:6px' }, t.districts.map(box)))),
      h('div', { class: 'row', style: 'gap:8px' },
        h('button', { class: 'btn', type: 'button', onclick: save }, 'Save for this class'),
        h('button', { class: 'btn alt', type: 'button', onclick: () => setAll(DISTRICT_ALL(), true) }, 'Tick everything'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => setAll(DISTRICT_ALL(), false) }, 'Back to levels only')));
  }
  const DISTRICT_ALL = () => ((S.meta && S.meta.districts) || []).map((d) => d.n);

  // ---------- classes & pupils ----------
  async function classesView(root) {
    const d = await api('/classes');
    S.classes = d.classes;
    S.guests = d.guests;
    const nameIn = h('input', { type: 'text', maxlength: '60', placeholder: 'e.g. 5 Integrity', 'aria-label': 'New class name' });
    const create = h('form', { class: 'row', onsubmit: guard(async (e) => {
      e.preventDefault();
      const r = await api('/classes', { method: 'POST', body: { name: nameIn.value } });
      S.selClass = r.class.id;
      S.sheet = false;
      render();
    }) }, nameIn, h('button', { class: 'btn small', type: 'submit' }, 'Create class'));

    const rows = S.classes.map((c) => h('tr', { class: c.id === S.selClass ? 'sel' : '' },
      h('td', null, c.name, c.archived ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'archived') : null),
      h('td', null, h('span', { style: 'font-family:var(--display);letter-spacing:.15em;font-weight:700' }, c.code)),
      h('td', null, c.pupils),
      h('td', null, h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.selClass = c.id; S.sheet = false; render(); } }, 'Open'))));

    const admin = S.who.admin;
    root.replaceChildren(
      h('section', { class: 'panel' },
        h('h2', null, admin ? 'Classes' : 'My classes'),
        S.classes.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Class', 'Class code', 'Pupils', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
          : h('p', { class: 'muted' }, 'No classes yet. Create one below, then add pupils.'),
        admin ? h('p', { class: 'muted small' }, 'Guest players (not in any class): ' + S.guests + '. Guest accounts are deleted automatically after 30 days.') : null,
        create),
      h('div', { id: 'cdetail' }));
    if (S.selClass && S.classes.some((c) => c.id === S.selClass)) await classDetail(document.getElementById('cdetail'));
  }

  async function classDetail(root) {
    const c = S.classes.find((x) => x.id === S.selClass);
    const pd = await api(`/classes/${c.id}/pupils`);
    const signOut = h('input', { type: 'checkbox', id: 'so', checked: true });
    const codeBox = h('span', { class: 'code-big', 'aria-label': 'Class code ' + c.code.split('').join(' ') }, c.code);

    const head = h('section', { class: 'panel sel' },
      h('div', { class: 'row', style: 'align-items:center;gap:14px;flex-wrap:wrap' },
        h('h2', { class: 'grow', style: 'margin:0' }, c.name),
        codeBox),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center' },
        h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
          const msg = signOut.checked ? 'Make a new code and sign everyone in this class out?' : 'Make a new code? Pupils already signed in stay signed in.';
          if (!confirm(msg)) return;
          const r = await api(`/classes/${c.id}/regen`, { method: 'POST', body: { signOut: signOut.checked } });
          c.code = r.code;
          await classesView(document.getElementById('tab'));
          flash('New class code: ' + r.code + (r.signedOut ? ' (everyone was signed out).' : '.'));
        }) }, 'New class code'),
        h('label', { class: 'small' }, signOut, ' also sign everyone out'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          const n = prompt('Rename class', c.name);
          if (n == null || !n.trim()) return;
          await api(`/classes/${c.id}`, { method: 'PATCH', body: { name: n } });
          render();
        }) }, 'Rename'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          if (!c.archived && !confirm('Archive this class? Its pupils are signed out and can’t sign in until you restore it.')) return;
          await api(`/classes/${c.id}`, { method: 'PATCH', body: { archived: !c.archived } });
          render();
        }) }, c.archived ? 'Restore' : 'Archive'),
        !(S.who.admin || c.owned) ? null : h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          const t = prompt(`This permanently deletes the class, its ${pd.pupils.length} pupils and all their results.\nType the class name to confirm:`);
          if (t !== c.name) return t == null ? null : flash('The name didn’t match, so nothing was deleted.', true);
          await api(`/classes/${c.id}`, { method: 'DELETE' });
          S.selClass = null;
          render();
        }) }, 'Delete class')));

    // add pupils
    const ta = h('textarea', { class: 'mono', rows: '6', 'aria-label': 'Pupils to add', placeholder: 'One pupil per line.\nRaj Tan\nMei Lin, mei.l\n(or paste two columns from a spreadsheet: name, username)' });
    const pv = h('div');
    let rowsPv = [];
    const showPv = (list) => {
      rowsPv = list;
      const good = list.filter((r) => r.status === 'ok');
      pv.replaceChildren(
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Name', 'Username', ''].map((t) => h('th', null, t)))),
          h('tbody', null, list.map((r) => h('tr', null, h('td', null, r.name), h('td', null, r.username),
            h('td', null, h('span', { class: 'pill ' + (r.status === 'ok' ? 'ok' : 'bad') }, r.status === 'ok' ? 'ok' : r.status === 'duplicate' ? 'username taken' : 'invalid username'))))))),
        good.length ? h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
          const r = await api(`/classes/${c.id}/pupils`, { method: 'POST', body: { pupils: good } });
          ta.value = '';
          await classesView(document.getElementById('tab'));
          flash(`Added ${r.added} pupil${r.added === 1 ? '' : 's'}.` + (r.skipped.length ? ` Skipped ${r.skipped.length}.` : ''));
        }) }, `Add ${good.length} pupil${good.length === 1 ? '' : 's'}`) : h('p', { class: 'muted small' }, 'Nothing valid to add yet. Fix the flagged lines and preview again.'));
    };
    const adder = h('section', { class: 'panel' },
      h('h2', null, 'Add pupils'),
      h('p', { class: 'muted small' }, 'Usernames you leave blank are made from the name (e.g. Raj Tan → rajt). Pupils sign in with their username and the class code. Use first names or nicknames rather than full names where you can.'),
      ta,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
        if (!ta.value.trim()) return flash('Paste some names first.', true);
        showPv((await api(`/classes/${c.id}/pupils/preview`, { method: 'POST', body: { text: ta.value } })).rows);
      }) }, 'Preview')),
      pv);

    // pupils table
    const prow = (p) => h('tr', null,
      h('td', null, p.name), h('td', null, h('code', null, p.username)), h('td', null, p.attempts), h('td', null, p.xp), h('td', null, fmtTime(p.last_active)),
      h('td', null,
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          const n = prompt('Name', p.name);
          if (n == null) return;
          const u = prompt('Username', p.username);
          if (u == null) return;
          await api(`/pupils/${p.id}`, { method: 'PATCH', body: { name: n, username: u } });
          await classesView(document.getElementById('tab'));
        }) }, 'Edit'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          if (!confirm(`Erase all of ${p.name}'s results? The account stays.`)) return;
          await api(`/pupils/${p.id}/reset`, { method: 'POST' });
          await classesView(document.getElementById('tab'));
        }) }, 'Reset'),
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          if (!confirm(`Delete ${p.name} and all their results?`)) return;
          await api(`/pupils/${p.id}`, { method: 'DELETE' });
          await classesView(document.getElementById('tab'));
        }) }, 'Delete')));
    const list = h('section', { class: 'panel' },
      h('div', { class: 'row no-print', style: 'align-items:center;flex-wrap:wrap;gap:8px' },
        h('h2', { class: 'grow', style: 'margin:0' }, `Pupils (${pd.pupils.length})`),
        pd.pupils.length ? h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.sheet = !S.sheet; render(); } }, S.sheet ? 'Hide sign-in cards' : 'Sign-in cards') : null),
      pd.pupils.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Name', 'Username', 'Answers', 'XP', 'Last active', ''].map((t) => h('th', null, t)))),
        h('tbody', null, pd.pupils.map(prow)))) : h('p', { class: 'muted' }, 'No pupils yet.'));

    const nodes = [head, adder, list];
    if (S.sheet) {
      nodes.push(h('section', { class: 'panel' },
        h('div', { class: 'row no-print', style: 'align-items:center;gap:10px' },
          h('h2', { class: 'grow', style: 'margin:0' }, 'Sign-in cards'),
          h('button', { class: 'btn small', type: 'button', onclick: () => window.print() }, 'Print')),
        h('p', { class: 'muted small no-print' }, 'Cut along the dashed lines. Share the class code only with this class.'),
        h('div', { class: 'sheet' }, pd.pupils.map((p) => h('div', { class: 'sheet-card' },
          h('div', null, c.name), h('div', null, 'Name: ', h('b', null, p.name)), h('div', null, 'Username: ', h('b', null, p.username)),
          h('div', null, 'Class code: ', h('b', null, c.code)), h('div', { class: 'small' }, location.origin))))));
    }
    root.replaceChildren(...nodes);
  }

  // ---------- questions ----------
  const MODE_NAME = { 1: 'Mode 1 · Rewrite it', 2: 'Mode 2 · Spot the error', 3: 'Mode 3 · Upgrade the tag', 4: 'Mode 4 · Multiple choice', 5: 'Mode 5 · Change the speech', 6: 'Mode 6 · Fix the tense' };

  const dName = (n) => {
    const x = ((S.meta && S.meta.districts) || []).find((d) => d.n === n);
    return x ? x.n + '. ' + x.name : 'Rule ' + n;
  };

  // ---------- districts: where each question is delivered, plus the two switches ----------
  async function districtsView(root) {
    const unlocks = await unlockPanel();
    if (!S.who.admin) return root.replaceChildren(unlocks);
    const [qs, st] = await Promise.all([api('/questions'), api('/settings')]);
    const D = (S.meta && S.meta.districts) || [];
    const tally = Object.fromEntries(D.map((d) => [d.n, { n: 0, tagged: 0 }]));
    for (const q of qs.questions) {
      if (!tally[q.rule]) continue;
      tally[q.rule].n++;
      if (q.ruleSet) tally[q.rule].tagged++;
    }
    const pending = new Map();
    const untagged = qs.questions.filter((q) => !q.ruleSet);
    const qText = (q) => {
      const d = q.data;
      if (q.mode === 1) return d.prompt;
      if (q.mode === 2) return d.faulty;
      if (q.mode === 4) return d.stem;
      if (q.mode === 5) return d.prompt;
      if (q.mode === 6) return d.sentence;
      return '“' + d.line + '” ____ ' + d.speaker;
    };
    const push = async (items) => {
      for (let i = 0; i < items.length; i += 40) await api('/questions/rules', { method: 'POST', body: { items: items.slice(i, i + 40) } });
    };
    const sw = (key, label, hint) => h('label', { class: 'field' }, h('span', null, h('input', { type: 'checkbox', checked: !!st[key], onchange: guard(async (e) => { await api('/settings', { method: 'PUT', body: { [key]: e.target.checked } }); flash('Saved.'); }) }), ' ' + label), h('small', { class: 'muted' }, hint));
    const show = S.dShow || 'untagged';
    const shown = qs.questions.filter((q) => (show === 'all' ? true : show === 'untagged' ? !q.ruleSet : q.rule === +show)).slice(0, 150);
    const select = (q) => {
      const el = h('select', { 'aria-label': 'District for this question' }, D.map((x) => h('option', { value: String(x.n), selected: x.n === q.rule }, x.n + '. ' + x.name)));
      el.addEventListener('change', () => pending.set(q.id, +el.value));
      return el;
    };
    root.replaceChildren(
      unlocks,
      levelsPanel(st),
      h('section', { class: 'panel' },
        h('h2', null, 'Town settings'),
        sw('clock', 'Show the delivery clock and pay a speed bonus', 'A gentle, route-wide timer. It never ends a route. Turn it off to remove timing completely.'),
        sw('openDistricts', 'Open every district for everyone', 'Ignores levels and class unlocks: every district is open to every pupil, and Rush Hour is open from the start. Use it for testing.'),
      ),
      h('section', { class: 'panel' },
        h('h2', null, 'Parcels in each district'),
        h('p', { class: 'muted small' }, 'Every question belongs to one district. Until you choose, it is suggested from the question itself. Empty districts show as “coming soon” to pupils.'),
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['District', 'Questions', 'Chosen by you'].map((t) => h('th', null, t)))), h('tbody', null, D.map((d) => h('tr', null, h('td', null, d.n + '. ' + d.name), h('td', null, String(tally[d.n].n), tally[d.n].n === 0 ? h('span', { class: 'muted small' }, '  (empty)') : null), h('td', null, String(tally[d.n].tagged)))))))),
      h('section', { class: 'panel' },
        h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:10px' },
          h('h2', { class: 'grow', style: 'margin:0' }, 'Choose districts'),
          h('select', { 'aria-label': 'Which questions to show', onchange: (e) => { S.dShow = e.target.value; render(); } },
            h('option', { value: 'untagged', selected: show === 'untagged' }, 'Only suggested (' + untagged.length + ')'),
            h('option', { value: 'all', selected: show === 'all' }, 'All questions'),
            D.map((d) => h('option', { value: String(d.n), selected: show === String(d.n) }, 'District ' + d.n + ': ' + d.name)))),
        h('div', { class: 'row', style: 'gap:8px;margin:10px 0' },
          h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
            if (!pending.size) return flash('Nothing to save yet.', true);
            await push([...pending].map(([id, rule]) => ({ id, rule })));
            flash('Saved ' + pending.size + ' district choice' + (pending.size === 1 ? '' : 's') + '.');
            render();
          }) }, 'Save my choices'),
          h('button', { class: 'btn alt', type: 'button', disabled: !untagged.length, onclick: guard(async () => {
            if (!confirm('Lock in the suggested district for all ' + untagged.length + ' questions you haven’t chosen for? You can still change any of them.')) return;
            await push(untagged.map((q) => ({ id: q.id, rule: q.auto })));
            flash('Suggestions saved for ' + untagged.length + ' questions.');
            render();
          }) }, 'Accept all suggestions')),
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'Question', 'District'].map((t) => h('th', null, t)))),
          h('tbody', null, shown.map((q) => h('tr', null, h('td', null, 'M' + q.mode), h('td', { style: 'max-width:420px;white-space:pre-wrap' }, qText(q)), h('td', null, select(q), q.ruleSet ? null : h('div', { class: 'muted small' }, 'suggested'))))))),
        shown.length === 150 ? h('p', { class: 'muted small' }, 'Showing the first 150. Use the filter to narrow the list.') : null,
      ),
    );
  }

  async function questionsView(root) {
    const [qs, cls] = await Promise.all([api('/questions' + (S.qMode ? '?mode=' + S.qMode : '')), api('/classes')]);
    S.classes = cls.classes;
    const qText = (q) => {
      const d = q.data;
      if (q.mode === 1) return (d.lines ? '[new line] ' : d.beat ? '[action] ' : '') + d.prompt;
      if (q.mode === 2) return d.faulty;
      if (q.mode === 4) return (d.group ? '[' + d.group + '] ' : '') + d.stem;
      if (q.mode === 5) return d.prompt + '  →  ' + d.instruction;
      if (q.mode === 6) return d.sentence;
      return `“${d.line}” ____ ${d.speaker}`;
    };
    const filter = h('div', { class: 'seg no-print', role: 'group', 'aria-label': 'Filter by mode' },
      [[0, 'All'], [1, 'Mode 1'], [2, 'Mode 2'], [3, 'Mode 3'], [4, 'Mode 4'], [5, 'Mode 5'], [6, 'Mode 6']].map(([m, l]) => h('button', { type: 'button', 'aria-pressed': String(S.qMode === m), onclick: () => { S.qMode = m; render(); } }, l)));
    const rows = qs.questions.map((q) => h('tr', null,
      h('td', null, 'M' + q.mode),
      h('td', { style: 'max-width:420px;white-space:pre-wrap' }, qText(q)),
      h('td', null, h('span', { class: 'small' }, dName(q.rule)), q.ruleSet ? null : h('span', { class: 'muted small' }, ' (auto)')),
      h('td', null, q.class_name ? h('span', { class: 'pill' }, q.class_name) : h('span', { class: 'muted small' }, 'all')),
      h('td', null, q.tries ? Math.round((100 * q.right) / q.tries) + '% of ' + q.tries : '—'),
      h('td', null, !q.editable ? h('span', { class: 'muted small' }, 'shared bank') : [
        h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.editQ = q; render(); } }, 'Edit'),
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          if (!confirm('Remove this question? Past results stay in the analytics.')) return;
          await api('/questions/' + q.id, { method: 'DELETE' });
          render();
        }) }, 'Remove')])));
    root.replaceChildren(
      questionForm(),
      importPanel(),
      h('section', { class: 'panel' },
        h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:10px' }, h('h2', { class: 'grow', style: 'margin:0' }, `Question bank (${qs.questions.length})`), filter),
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'Question', 'District', 'Visible to', 'First-try correct', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))));
  }

  function classSelect(val) {
    return h('select', { 'aria-label': 'Who sees this question' }, S.who.admin ? h('option', { value: '' }, 'Every class and guests') : null,
      S.classes.filter((c) => !c.archived).map((c) => h('option', { value: String(c.id), selected: val === c.id }, 'Only ' + c.name)));
  }

  function questionForm() {
    const edit = S.editQ;
    const mode0 = edit ? edit.mode : 1;
    const modeSel = h('select', { 'aria-label': 'Question type', disabled: !!edit }, [1, 2, 3, 4, 5, 6].map((m) => h('option', { value: m, selected: m === mode0 }, MODE_NAME[m])));
    const holder = h('div', { class: 'grid-form' });
    const out = h('div', { class: 'pv', 'aria-live': 'polite' }, 'The preview appears here.');
    const scope = classSelect(edit ? edit.class_id : null);
    const f = {}; // field elements
    const d = edit ? edit.data : {};
    const mk = (name, label, el, hint) => { f[name] = el; return h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'muted' }, hint) : null); };
    let timer;
    const payload = () => {
      const m = +modeSel.value;
      const com = () => ({ tip: f.tip ? f.tip.value : '', group: f.group ? f.group.value : '', rule: f.rule ? f.rule.value : '' });
      if (m === 1) return { correct: f.correct.value, prompt: f.prompt.value, alts: f.alts.value.split('\n').filter((x) => x.trim()), instruction: f.instruction.value, lines: f.lines.checked, beat: f.beat.checked, ...com() };
      if (m === 2) return { correct: f.correct.value, faulty: f.faulty.value, rule: f.rule ? f.rule.value : '' };
      if (m === 4) {
        const rows = [...holder.querySelectorAll('.optrow')];
        const options = rows.map((r, i) => ({ id: r.dataset.id || String.fromCharCode(97 + i), text: r.querySelector('.ot').value, why: r.querySelector('.ow').value, ok: r.querySelector('.oc').checked })).filter((o) => o.text.trim());
        return { stem: f.stem.value, context: f.context.value, options: options.map(({ id, text, why }) => ({ id, text, why })), correct: options.filter((o) => o.ok).map((o) => o.id), pick: +f.pick.value || 1, explanation: f.explanation.value, code: f.code.value, shuffle: !f.noshuffle.checked, ...com() };
      }
      if (m === 5) return { prompt: f.prompt.value, instruction: f.instruction.value, accepted: f.accepted.value.split('\n').filter((x) => x.trim()), ...com() };
      if (m === 6) return { sentence: f.sentence.value, wrong: f.wrong.value, fixes: f.fixes.value, ...com() };
      return { speaker: f.speaker.value, line: f.line.value, context: f.context.value, target: [...holder.querySelectorAll('.tagpick input:checked')].map((i) => i.value), rule: f.rule ? f.rule.value : '' };
    };
    const lower = () => (f.lower ? f.lower.checked : false);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(guard(async () => {
        const m = +modeSel.value;
        const r = await api('/questions/preview', { method: 'POST', body: { mode: m, data: payload(), lowerFirst: lower() } });
        if (!r.ok) return out.replaceChildren(h('b', { style: 'color:var(--bad)' }, r.problem));
        const p = r.preview;
        const pre = { style: 'white-space:pre-wrap' };
        const show = (...n) => out.replaceChildren(...n.filter(Boolean));
        if (m === 1) show(h('div', pre, h('b', null, 'Pupils see: '), p.prompt), p.instruction ? h('div', null, h('b', null, 'Instruction: '), p.instruction) : null, h('div', pre, h('b', null, 'Model answer: '), '\n' + p.answer), p.lines ? h('div', { class: 'small muted' }, 'Line breaks are marked. Pupils get a multi-line box.') : null, p.beat ? h('div', { class: 'small muted' }, 'Action beat: a comma instead of the full stop gets its own feedback.') : null, p.tip ? h('div', null, h('b', null, 'Tip: '), p.tip) : null);
        else if (m === 4) show(p.context ? h('blockquote', { style: 'white-space:pre-wrap;margin:0 0 8px' }, p.context) : null, h('div', null, h('b', null, p.stem), p.pick > 1 ? ' (choose ' + p.pick + ')' : ''), h('ul', null, p.options.map((o) => h('li', null, (o.correct ? '✓ ' : '✗ ') + o.text, o.why ? h('span', { class: 'muted small' }, ' — ' + o.why) : null))), h('div', null, h('b', null, 'Explanation: '), p.explanation));
        else if (m === 5) show(h('div', null, h('b', null, 'Pupils see: '), p.prompt, ' — ', p.instruction), h('div', null, h('b', null, 'Model answer: '), p.model), h('b', null, `Accepted (${p.variants.length}):`), h('ul', null, p.variants.map((v) => h('li', null, v))), p.tip ? h('div', null, h('b', null, 'Tip: '), p.tip) : null);
        else if (m === 6) show(h('div', null, h('b', null, 'Pupils see: '), p.sentence), h('div', null, h('b', null, 'Tap target: '), p.wrong.join(', '), ' · ', h('b', null, 'Accepted fixes: '), p.fixes.join(', ')), h('div', null, h('b', null, 'Corrected: '), p.corrected), p.tip ? h('div', null, h('b', null, 'Tip: '), p.tip) : null);
        else if (m === 2) out.replaceChildren(h('div', null, h('b', null, 'Pupils see: '), p.faulty), h('div', null, h('b', null, 'Corrected: '), p.correct), h('b', null, `${p.mistakes.length} mistake spot${p.mistakes.length === 1 ? '' : 's'} (worked out automatically):`), h('ul', null, p.mistakes.map((x) => h('li', null, x.summary))));
        else out.replaceChildren(h('div', null, h('b', null, 'Pupils see: '), p.sentence));
      }), 350);
    };
    const common = (withTip = true) => [
      withTip ? mk('tip', 'Tip shown after the question (optional)', h('textarea', { rows: '2', value: d.tip || '' })) : null,
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:end' },
        mk('group', 'Group id (optional)', h('input', { type: 'text', maxlength: '40', value: d.group || '' }), 'Questions sharing a group are served back to back.'),
        districtField()),
    ];
    const districtField = () => mk('rule', 'District', h('select', null,
      h('option', { value: '' }, 'Suggested automatically'),
      ((S.meta && S.meta.districts) || []).map((x) => h('option', { value: String(x.n), selected: d.rule === x.n }, x.n + '. ' + x.name))),
      'Which part of town this parcel is delivered in.');
    const m1 = () => [
      mk('correct', 'Correct sentence', h('textarea', { rows: '2', value: d.correct || '' }), 'Type it correctly with “curly” or "straight" quotes. The prompt is made by stripping the punctuation.'),
      mk('prompt', 'Prompt shown to pupils (optional)', h('textarea', { rows: '2', value: d.prompt || '' }), 'Leave blank to make it automatically.'),
      mk('alts', 'Other acceptable answers (one per line, optional)', h('textarea', { rows: '2', value: (d.alts || []).join('\n') }), 'e.g. the version with the saying words first.'),
      h('label', { class: 'small' }, (f.lower = h('input', { type: 'checkbox' })), ' lowercase the first spoken word in the prompt'),
      mk('instruction', 'Instruction shown above the prompt (optional)', h('input', { type: 'text', maxlength: '150', value: d.instruction || '' }), 'e.g. “Give each speaker their own line.”'),
      h('label', { class: 'small' }, (f.lines = h('input', { type: 'checkbox', checked: !!d.lines })), ' New speaker, new line: line breaks in the correct answer are marked (pupils get a multi-line box; put the whole prompt on one line yourself)'),
      h('label', { class: 'small' }, (f.beat = h('input', { type: 'checkbox', checked: !!d.beat })), ' Action beat before the speech: a comma instead of the full stop gets its own feedback'),
      ...common(),
    ];
    const m2 = () => [
      mk('correct', 'Correct version (use a new line for each line of dialogue)', h('textarea', { rows: '3', value: d.correct || '' })),
      mk('faulty', 'Version with mistakes', h('textarea', { rows: '3', value: d.faulty || '' }), 'Break only punctuation, capitals and speech marks. Keep the words the same.'),
      districtField(),
    ];
    const m3 = () => [
      mk('speaker', 'Speaker', h('input', { type: 'text', maxlength: '40', value: d.speaker || '' })),
      mk('line', 'What they say (ending in , ! or ?)', h('input', { type: 'text', maxlength: '200', value: d.line || '' })),
      mk('context', 'Situation (optional)', h('input', { type: 'text', maxlength: '300', value: d.context || '' })),
      h('fieldset', { class: 'field', style: 'border:0;padding:0;margin:0' }, h('legend', { class: 'small' }, 'The verb must show…'),
        h('div', { class: 'tagpick' }, Object.entries((S.meta && S.meta.tags) || {}).map(([k, l]) => h('label', null, h('input', { type: 'checkbox', value: k, checked: (d.target || []).includes(k) }), l)))),
      districtField(),
    ];
    const m4 = () => {
      const opts = d.options && d.options.length ? d.options : [];
      const rows = [];
      for (let i = 0; i < 6; i++) {
        const o = opts[i] || {};
        const row = h('div', { class: 'optrow row', style: 'gap:6px;align-items:center;flex-wrap:wrap' },
          h('input', { type: 'checkbox', class: 'oc', 'aria-label': 'Option ' + (i + 1) + ' is correct', checked: !!(o.id && (d.correct || []).includes(o.id)) }),
          h('input', { type: 'text', class: 'ot grow', maxlength: '140', placeholder: 'Option ' + (i + 1), value: o.text || '' }),
          h('input', { type: 'text', class: 'ow grow', maxlength: '200', placeholder: 'Why it’s wrong (optional)', value: o.why || '' }));
        if (o.id) row.dataset.id = o.id;
        rows.push(row);
      }
      return [
        mk('stem', 'Question', h('textarea', { rows: '2', value: d.stem || '' })),
        mk('context', 'Passage shown above the question (optional)', h('textarea', { rows: '4', value: d.context || '' })),
        h('div', { class: 'field' }, h('span', null, 'Options. Tick the correct one(s). Empty rows are ignored.'), rows),
        mk('pick', 'Pupils choose', h('select', null, [1, 2, 3, 4].map((n) => h('option', { value: n, selected: (d.pick || 1) === n }, n === 1 ? 'one answer' : n + ' answers (correct if all are valid)')))),
        mk('explanation', 'Explanation shown afterwards', h('textarea', { rows: '2', value: d.explanation || '' })),
        mk('code', 'Analytics label for a wrong answer', h('select', null, [['MC_VERB', 'Verb choice'], ['MC_INFER', 'Reading between the lines'], ['MC_WRONG', 'Other']].map(([v, l]) => h('option', { value: v, selected: (d.code || 'MC_WRONG') === v }, l)))),
        h('label', { class: 'small' }, (f.noshuffle = h('input', { type: 'checkbox', checked: d.shuffle === false })), ' keep my option order (otherwise the order is shuffled for each pupil)'),
        ...common(false),
      ];
    };
    const m5 = () => [
      mk('prompt', 'Sentence pupils change', h('textarea', { rows: '2', value: d.prompt || '' })),
      mk('instruction', 'Instruction', h('input', { type: 'text', maxlength: '150', value: d.instruction || '' }), 'e.g. “Rewrite as reported speech.”'),
      mk('accepted', 'Accepted answers (one per line)', h('textarea', { rows: '4', value: (d.accepted || []).join('\n') }), 'Capitals, spacing, curly/straight quotes and a missing final full stop are forgiven. Use (that) for an optional word and [said|told] for alternatives.'),
      ...common(),
    ];
    const m6 = () => [
      mk('sentence', 'Sentence with the tense mistake', h('textarea', { rows: '2', value: d.sentence || '' })),
      mk('wrong', 'The wrong word(s) pupils may tap (comma-separated)', h('input', { type: 'text', value: (d.wrong || []).join(', ') })),
      mk('fixes', 'Accepted fixes (comma-separated)', h('input', { type: 'text', value: (d.fixes || []).join(', ') })),
      ...common(),
    ];
    const build = () => {
      Object.keys(f).forEach((k) => delete f[k]);
      holder.replaceChildren(...({ 1: m1, 2: m2, 3: m3, 4: m4, 5: m5, 6: m6 }[+modeSel.value])().filter(Boolean));
      holder.addEventListener('input', refresh);
      holder.addEventListener('change', refresh);
      refresh();
    };
    modeSel.addEventListener('change', () => { S.editQ = null; build(); });
    build();
    return h('section', { class: 'panel' },
      h('h2', null, edit ? 'Edit question' : 'Add a question'),
      h('div', { class: 'two' },
        h('div', { class: 'grid-form' }, modeSel, holder, scope,
          h('div', { class: 'row', style: 'gap:8px' },
            h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
              const body = { mode: +modeSel.value, data: payload(), lowerFirst: lower(), class_id: scope.value ? +scope.value : null };
              if (edit) await api('/questions/' + edit.id, { method: 'PUT', body });
              else await api('/questions', { method: 'POST', body });
              S.editQ = null;
              await questionsView(document.getElementById('tab'));
              flash(edit ? 'Question updated.' : 'Question added.');
            }) }, edit ? 'Save changes' : 'Add question'),
            edit ? h('button', { class: 'btn alt', type: 'button', onclick: () => { S.editQ = null; render(); } }, 'Cancel') : null)),
        out));
  }

  function importPanel() {
    const mode = h('select', { 'aria-label': 'Import type' }, [1, 2, 3, 5, 6].map((m) => h('option', { value: m }, MODE_NAME[m])));
    const ta = h('textarea', { class: 'mono', rows: '5', 'aria-label': 'Questions to import' });
    const help = h('p', { class: 'muted small' });
    const sets = {
      1: 'One correct sentence per line.',
      2: 'One question per line: correct version | faulty version. Use \\n for a new line inside either part.',
      3: 'One question per line: speaker | line | tag,tag | situation (optional).',
      5: 'One question per line: sentence | instruction | accepted answer ; another accepted answer. Use (word) for optional words. Multiple choice (Mode 4) is added one at a time with the form above.',
      6: 'One question per line: sentence | wrong word(s) | fix(es), comma-separated.',
    };
    const upd = () => { help.textContent = sets[mode.value]; };
    mode.addEventListener('change', upd);
    upd();
    const res = h('div', { 'aria-live': 'polite' });
    return h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Import many questions'), mode, help, ta,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        const m = +mode.value;
        const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
        const rows = lines.map((l) => {
          if (m === 1) return { correct: l };
          const p = l.split('|').map((s) => s.trim().replace(/\\n/g, '\n'));
          if (m === 2) return { correct: p[0], faulty: p[1] };
          if (m === 5) return { prompt: p[0], instruction: p[1], accepted: (p[2] || '').split(';').map((x) => x.trim()).filter(Boolean) };
          if (m === 6) return { sentence: p[0], wrong: p[1], fixes: p[2] };
          return { speaker: p[0], line: p[1], target: (p[2] || '').split(/[,;\s]+/).filter(Boolean), context: p[3] || '' };
        });
        const r = await api('/questions/import', { method: 'POST', body: { mode: m, rows } });
        res.replaceChildren(h('p', null, `Added ${r.added}.`), r.problems.length ? h('ul', null, r.problems.map((p) => h('li', null, `Line ${p.row}: ${p.problem}`))) : null);
        if (r.added) { ta.value = ''; await questionsView(document.getElementById('tab')); flash(`Added ${r.added} question${r.added === 1 ? '' : 's'}.` + (r.problems.length ? ` ${r.problems.length} line(s) had problems.` : '')); }
      }) }, 'Import')), res);
  }

  // ---------- verb bank ----------
  async function verbsView(root) {
    const admin = S.who.admin;
    const [d, rv] = await Promise.all([admin ? api('/verbs') : { tags: null, verbs: [] }, api('/verbs/review')]);
    const q = h('input', { type: 'search', placeholder: 'Filter verbs…', 'aria-label': 'Filter verbs' });
    const tagKeys = Object.keys(d.tags || S.meta.tags);
    const tagBoxes = (sel) => h('div', { class: 'tagpick' }, tagKeys.map((k) => h('label', null, h('input', { type: 'checkbox', value: k, checked: sel.includes(k) }), (S.meta.tags[k] || k))));
    const picked = (box) => [...box.querySelectorAll('input:checked')].map((i) => i.value);

    // review queue
    const review = h('section', { class: 'panel' }, h('h2', null, `Words the AI has judged (${rv.items.length})`),
      h('p', { class: 'muted small' }, 'When a pupil types a verb that isn’t in your bank, the AI judges it once (≥ 80% confidence to accept). Approve to add it to your bank permanently, or reject to block it. Words the AI rejected are listed below.'),
      rv.items.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Word', 'Confidence', 'Tags', 'AI’s reason', ''].map((t) => h('th', null, t)))), h('tbody', null, rv.items.map((it) => {
        const box = tagBoxes(it.tags || []);
        return h('tr', null, h('td', null, h('b', null, it.word), h('div', { class: 'small muted' }, it.status === 'pending' ? 'waiting' : 'accepted by AI')), h('td', null, it.conf != null ? Math.round(it.conf * 100) + '%' : '—'),
          h('td', null, box), h('td', { style: 'max-width:260px' }, it.reason || ''),
          h('td', null,
            h('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api(`/verbs/review/${encodeURIComponent(it.word)}/approve`, { method: 'POST', body: { tags: picked(box) } }); await verbsView(document.getElementById('tab')); }) }, 'Approve'),
            h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { await api(`/verbs/review/${encodeURIComponent(it.word)}/reject`, { method: 'POST', body: {} }); await verbsView(document.getElementById('tab')); }) }, 'Reject')));
      })))) : h('p', { class: 'muted' }, 'Nothing waiting.'),
      rv.rejected.length ? h('details', null, h('summary', { style: 'cursor:pointer' }, `Recently rejected (${rv.rejected.length})`),
        h('ul', null, rv.rejected.map((r) => h('li', null, h('b', null, r.word), ' — ', r.reason || '', ' ', h('button', { class: 'btn small ghost', type: 'button', onclick: guard(async () => { await api(`/verbs/review/${encodeURIComponent(r.word)}/reset`, { method: 'POST', body: {} }); await verbsView(document.getElementById('tab')); }) }, 'Let the AI re-judge'))))) : null);

    // add one
    const b = h('input', { type: 'text', maxlength: '24', placeholder: 'whisper', 'aria-label': 'Base form' });
    const p = h('input', { type: 'text', maxlength: '24', placeholder: 'whispered (blank = add -ed)', 'aria-label': 'Past tense' });
    const addTags = tagBoxes([]);
    const ban = h('input', { type: 'checkbox' });
    const add = h('section', { class: 'panel' }, h('h2', null, 'Add a verb'),
      h('div', { class: 'two' }, h('div', { class: 'grid-form' }, h('label', { class: 'field' }, h('span', null, 'Base form'), b), h('label', { class: 'field' }, h('span', null, 'Past tense'), p),
        h('label', { class: 'small' }, ban, ' Not allowed (e.g. said, asked)')),
        h('div', null, h('p', { class: 'small', style: 'margin-top:0' }, 'What does it show?'), addTags)),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        await api('/verbs', { method: 'POST', body: { base: b.value, past: p.value, tags: picked(addTags), banned: ban.checked } });
        await verbsView(document.getElementById('tab'));
        flash('Verb saved.');
      }) }, 'Save verb')),
      h('p', { class: 'muted small' }, 'Check the past tense for irregular or doubled-letter verbs (e.g. begged, not beged).'));

    // import
    const ita = h('textarea', { class: 'mono', rows: '4', 'aria-label': 'Verbs to import', placeholder: 'whisper, whispered, soft|calm\nsnap, snapped, angry' });
    const importer = h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Import many verbs'),
      h('p', { class: 'muted small' }, 'One per line: base, past (optional), tags separated by | — tags: ' + tagKeys.join(', ')), ita,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        const rows = ita.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [base, past, tags] = l.split(',').map((s) => s.trim()); return { base, past, tags: tags || '' }; });
        const r = await api('/verbs/import', { method: 'POST', body: { rows } });
        await verbsView(document.getElementById('tab'));
        flash(`Added ${r.added}.` + (r.problems.length ? ' Problems: ' + r.problems.map((x) => `line ${x.row}: ${x.problem}`).join('; ') : ''), !!r.problems.length && !r.added);
      }) }, 'Import')));

    // list
    const tbody = h('tbody');
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      tbody.replaceChildren(...d.verbs.filter((v) => !t || v.base.includes(t) || v.past.includes(t)).map((v) => h('tr', null,
        h('td', null, h('b', null, v.base), v.banned ? h('span', { class: 'pill bad', style: 'margin-left:6px' }, 'not allowed') : null),
        h('td', null, v.past), h('td', null, v.tags.map((x) => S.meta.tags[x] || x).join(', ')), h('td', null, v.source),
        h('td', null,
          h('button', { class: 'btn small alt', type: 'button', onclick: () => editVerb(v) }, 'Edit'),
          h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Delete “${v.base}”?`)) return; await api('/verbs/' + v.id, { method: 'DELETE' }); await verbsView(document.getElementById('tab')); }) }, 'Delete')))));
    };
    const editor = h('div');
    const editVerb = (v) => {
      const eb = h('input', { type: 'text', value: v.base, maxlength: '24', 'aria-label': 'Base' });
      const ep = h('input', { type: 'text', value: v.past, maxlength: '24', 'aria-label': 'Past' });
      const et = tagBoxes(v.tags);
      const en = h('input', { type: 'checkbox', checked: v.banned });
      editor.replaceChildren(h('div', { class: 'panel sel' }, h('h3', { style: 'margin-top:0' }, 'Edit “' + v.base + '”'),
        h('div', { class: 'two' }, h('div', { class: 'grid-form' }, eb, ep, h('label', { class: 'small' }, en, ' Not allowed')), et),
        h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
          h('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api('/verbs/' + v.id, { method: 'PUT', body: { base: eb.value, past: ep.value, tags: picked(et), banned: en.checked } }); await verbsView(document.getElementById('tab')); flash('Saved.'); }) }, 'Save'),
          h('button', { class: 'btn small alt', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancel'))));
      editor.scrollIntoView({ block: 'nearest' });
    };
    q.addEventListener('input', draw);
    draw();
    const list = h('section', { class: 'panel' }, h('h2', null, `Verb bank (${d.verbs.length})`), q, editor,
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Verb', 'Past', 'Shows', 'Source', ''].map((t) => h('th', null, t)))), tbody)));
    root.replaceChildren(...(admin ? [review, add, importer, list] : [review]));
  }

  // ---------- analytics ----------
  async function analyticsView(root) {
    if (!S.classes.length) { const c = await api('/classes'); S.classes = c.classes; S.guests = c.guests; }
    if (!S.ana.cls) S.ana.cls = S.classes[0] ? String(S.classes[0].id) : 'guests';
    const sel = h('select', { 'aria-label': 'Class' }, S.classes.map((c) => h('option', { value: String(c.id), selected: String(c.id) === S.ana.cls }, c.name)), h('option', { value: 'guests', selected: S.ana.cls === 'guests' }, 'Guests'));
    const days = h('select', { 'aria-label': 'Time period' }, [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'This year']].map(([n, l]) => h('option', { value: n, selected: n === S.ana.days }, l)));
    const by = h('div', { class: 'seg', role: 'group', 'aria-label': 'Group columns by' }, [['rule', 'By rule'], ['code', 'By error type']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(S.ana.by === k), onclick: () => { S.ana.by = k; render(); } }, l)));
    sel.addEventListener('change', () => { S.ana.cls = sel.value; render(); });
    days.addEventListener('change', () => { S.ana.days = +days.value; render(); });
    const body = h('div');
    root.replaceChildren(h('section', { class: 'panel no-print' }, h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Analytics'), sel, days, by),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, 'Counts use each pupil’s first try at each question, so retries don’t inflate the numbers.')), body);
    const d = await api(`/analytics?class=${encodeURIComponent(S.ana.cls)}&days=${S.ana.days}`);
    drawAnalytics(body, d);
  }

  const ruleName = (n) => (S.meta.rules[n] ? S.meta.rules[n].short : 'Other');
  function bucket(n, max) { return Math.max(0, Math.min(6, Math.ceil((n / max) * 7) - 1)); }

  function drawAnalytics(root, d) {
    const active = d.pupils.filter((p) => p.attempts > 0);
    if (!d.pupils.length) return root.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'muted', style: 'margin:0' }, 'No pupils here yet.')));
    if (!active.length) return root.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'muted', style: 'margin:0' }, `No answers in the last ${d.days} days.`)));

    // columns
    let cols;
    if (S.ana.by === 'rule') {
      const g = new Map();
      for (const c of d.codes) { const r = c.rule || 0; if (!g.has(r)) g.set(r, { key: 'r' + r, label: r ? `Rule ${r}: ${ruleName(r)}` : 'Other', rule: r, codes: [] }); g.get(r).codes.push(c.code); }
      cols = [...g.values()].sort((a, b) => (a.rule || 99) - (b.rule || 99));
    } else {
      cols = d.codes.slice().sort((a, b) => (a.rule || 99) - (b.rule || 99)).map((c) => ({ key: c.code, label: c.label, rule: c.rule, codes: [c.code] }));
    }
    const val = (p, col) => col.codes.reduce((n, c) => n + (p.counts[c] || 0), 0);
    const colTotal = (col) => active.reduce((n, p) => n + val(p, col), 0);
    cols = cols.filter((c) => colTotal(c) > 0 || S.ana.by === 'rule');
    const pupils = d.pupils.slice().sort((a, b) => a.name.localeCompare(b.name));
    let max = 1;
    for (const p of pupils) for (const c of cols) max = Math.max(max, val(p, c));

    // tooltip
    const tip = h('div', { class: 'tip', hidden: true, role: 'tooltip' });
    document.querySelectorAll('.tip').forEach((t) => t.remove());
    document.body.append(tip);
    const showTip = (td, p, c, n) => {
      tip.replaceChildren(h('b', null, n + (n === 1 ? ' mistake' : ' mistakes')), h('div', null, p.name), h('div', { class: 'small muted' }, c.label), h('div', { class: 'small muted' }, `${p.attempts} first tries`));
      tip.hidden = false;
      const r = td.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 270, Math.max(8, r.left)) + 'px';
      tip.style.top = (r.bottom + 6 > window.innerHeight - 90 ? r.top - 90 : r.bottom + 6) + 'px';
    };
    const hideTip = () => { tip.hidden = true; };

    const head = h('tr', null, h('th', { scope: 'col' }, 'Pupil'), cols.map((c) => h('th', { scope: 'col', class: 'rg', style: `--rc:var(--r${c.rule || 1})`, title: c.label }, c.label)), h('th', { scope: 'col' }, 'First-try correct'));
    const body = pupils.map((p) => h('tr', null, h('th', { scope: 'row' }, p.name),
      cols.map((c) => {
        const n = val(p, c);
        const td = h('td', { class: n ? 'b' + bucket(n, max) : 'z', tabindex: '0', 'data-n': n || false, 'aria-label': `${p.name}, ${c.label}: ${n}` }, n || '·');
        td.addEventListener('mouseenter', () => showTip(td, p, c, n));
        td.addEventListener('focus', () => showTip(td, p, c, n));
        td.addEventListener('mouseleave', hideTip);
        td.addEventListener('blur', hideTip);
        return td;
      }),
      h('td', { style: 'text-align:center' }, p.attempts ? Math.round((100 * p.correct) / p.attempts) + '% (' + p.attempts + ')' : '—')));
    const tot = h('tr', null, h('th', { scope: 'row' }, 'Class total'), cols.map((c) => h('td', { style: 'font-weight:700' }, colTotal(c))), h('td'));

    const steps = [0, 1, 2, 3, 4, 5, 6];
    const scale = h('div', { class: 'scale' }, h('span', null, 'fewer'), h('span', { class: 'ramp', 'aria-hidden': 'true' }, steps.map((i) => h('i', { style: `background:var(--h${i})` }))), h('span', null, 'more (max ' + max + ')'));
    const csv = () => {
      const lines = [['Pupil', ...cols.map((c) => c.label), 'First tries', 'Correct'].map(csvCell).join(',')];
      for (const p of pupils) lines.push([p.name, ...cols.map((c) => val(p, c)), p.attempts, p.correct].map(csvCell).join(','));
      download('dialogue-dash-heatmap.csv', lines.join('\n'));
    };

    // bar chart of totals
    const totals = cols.map((c) => ({ ...c, n: colTotal(c) })).sort((a, b) => b.n - a.n);
    const topN = Math.max(1, ...totals.map((t) => t.n));
    const bars = h('div', { class: 'bars-h' }, totals.filter((t) => t.n > 0).map((t) => h('div', { class: 'line' }, h('span', null, t.label), h('div', { class: 'bar' }, h('i', { style: `width:${(100 * t.n) / topN}%` })), h('b', { style: 'text-align:right' }, t.n))));

    const hard = d.hardest.length ? h('ol', null, d.hardest.map((q) => h('li', null, h('span', { class: 'pill' }, 'M' + q.mode), ' ', q.text, ' — ', h('b', null, Math.round((100 * q.right) / q.tries) + '%'), ` correct first time (${q.tries} tries)`))) : h('p', { class: 'muted' }, 'Needs at least 3 first tries per question.');

    const props = pupils.filter((p) => p.attempts > 0).length;
    root.replaceChildren(
      h('section', { class: 'panel' },
        h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:8px' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Who is making which mistakes'), h('button', { class: 'btn small alt no-print', type: 'button', onclick: csv }, 'Download CSV')),
        h('p', { class: 'muted small' }, `${props} of ${pupils.length} pupils active in the last ${d.days} days. Each cell is a count of mistakes; darker means more.`),
        scale,
        h('div', { class: 'scroll-x', onscroll: hideTip }, h('table', { class: 'heat' }, h('thead', null, head), h('tbody', null, body, tot)))),
      h('div', { class: 'two' },
        h('section', { class: 'panel' }, h('h2', null, 'Most common mistakes'), bars.children.length ? bars : h('p', { class: 'muted' }, 'No mistakes recorded. 🎉')),
        h('section', { class: 'panel' }, h('h2', null, 'Hardest questions'), hard)));
  }

  render();
})();
