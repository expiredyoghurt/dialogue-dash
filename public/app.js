/* Dialogue Dash — pupil app. Plain JS, no build step.
   Everything that comes from the server is inserted with textContent (never innerHTML). */
(() => {
  'use strict';

  // ---------- tiny helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
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
  const mem = {};
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return mem[k] ?? null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        mem[k] = v;
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        delete mem[k];
      }
    },
  };
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // ---------- state ----------
  const S = { token: store.get('dd_token'), pupil: null, me: null, meta: null, view: 'home', authTab: 'signin', flash: '', R: null, practiceCount: null };
  const root = $('#app');

  async function api(path, { method = 'GET', body } = {}) {
    if (path === '/answer' && body) S.lastTry = body.fixTry || body.tryNo || 1;
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Can’t reach the server. Check the internet connection and try again.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (res.status === 401 && S.token) {
      signOut('Your session ended. Please sign in again.');
      throw new Error('Please sign in again.');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
    return data;
  }

  // ---------- small components ----------
  const RULE_NAMES = () => (S.meta ? S.meta.rules : {});
  function ruleChip(n) {
    const r = RULE_NAMES()[n] || { short: 'Other' };
    return h('span', { class: 'rule r' + n }, h('b', null, n ? n : '•'), r.short);
  }
  // Show punctuation and speech marks in colour so pupils see what matters.
  function mark(text) {
    const frag = document.createDocumentFragment();
    let buf = '';
    const flush = () => {
      if (buf) frag.append(document.createTextNode(buf));
      buf = '';
    };
    for (const c of String(text)) {
      if (/[“”"]/.test(c)) {
        flush();
        frag.append(h('span', { class: 'pm-q' }, c));
      } else if (/[.,!?;:…—]/.test(c)) {
        flush();
        frag.append(h('span', { class: 'pm-p' }, c));
      } else buf += c;
    }
    flush();
    return frag;
  }
  const errorBox = (m) => h('div', { class: 'error-msg', role: 'alert' }, m);
  function errorList(errors) {
    return h(
      'ul',
      { class: 'fb' },
      errors.map((e) =>
        h(
          'li',
          null,
          ruleChip(e.rule),
          h('p', { class: 'what' }, e.what),
          e.fix ? h('p', { class: 'fix' }, h('b', null, 'Fix: '), e.fix) : null,
        ),
      ),
    );
  }
  const tipLine = (t) => (t ? h('p', { class: 'tip-line' }, h('b', null, 'Tip: '), t) : null);
  const NOTES = {
    case: 'Check your capital letters: names and the first word of a sentence need one.',
    end: 'Remember the full stop (or question mark) at the end.',
    single: 'Single speech marks are fine in many books, but in this game use double ones: “ ”.',
  };
  const noteList = (notes) => (notes && notes.length ? h('ul', { class: 'notes' }, notes.map((n) => (NOTES[n] ? h('li', null, NOTES[n]) : null))) : null);
  const xpPop = (n) => (n > 0 ? h('span', { class: 'xp-pop' }, '+' + n + ' XP') : null);

  // ---------- auth ----------
  function signOut(msg) {
    store.del('dd_token');
    S.token = null;
    S.me = null;
    S.pupil = null;
    S.R = null;
    S.view = 'home';
    S.flash = msg || '';
    render();
  }

  async function afterSignIn(res) {
    S.token = res.token;
    store.set('dd_token', res.token);
    S.pupil = res.pupil;
    S.flash = '';
    S.view = 'home';
    await loadMe();
    render();
  }

  function authView() {
    const guest = S.authTab === 'guest';
    const err = h('div', { 'aria-live': 'polite' });
    const form = guest
      ? h(
          'div',
          null,
          h('p', null, 'No username? Play as a guest. You’ll get a temporary name like ', h('b', null, 'guest_0001'), '.'),
          h('p', { class: 'muted small' }, 'Guest progress isn’t part of a class. Ask your teacher for a username and class code to save your work with your class.'),
          h('button', { class: 'btn', type: 'button', onclick: async (e) => {
            e.target.disabled = true;
            try {
              await afterSignIn(await api('/guest', { method: 'POST' }));
            } catch (x) {
              err.replaceChildren(errorBox(x.message));
              e.target.disabled = false;
            }
          } }, 'Play as a guest'),
        )
      : (() => {
          const u = h('input', { type: 'text', id: 'u', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', value: store.get('dd_user') || '', required: true });
          const c = h('input', { type: 'text', id: 'c', class: 'code-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '8', required: true });
          const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
          const f = h(
            'form',
            { onsubmit: async (e) => {
              e.preventDefault();
              btn.disabled = true;
              err.replaceChildren();
              try {
                store.set('dd_user', u.value.trim());
                await afterSignIn(await api('/login', { method: 'POST', body: { username: u.value, code: c.value } }));
              } catch (x) {
                err.replaceChildren(errorBox(x.message));
                btn.disabled = false;
              }
            } },
            h('label', { class: 'field' }, h('span', null, 'Your username'), u),
            h('label', { class: 'field' }, h('span', null, 'Class code'), c),
            err,
            btn,
          );
          return f;
        })();
    return h(
      'div',
      { class: 'wrap' },
      h('div', { class: 'auth' },
        h('div', { class: 'brand', style: 'margin:0 0 18px' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Dash Express'),
        h('div', { class: 'panel' },
          S.flash ? h('div', { class: 'notice', role: 'status' }, S.flash) : null,
          h('div', { class: 'seg', role: 'group', 'aria-label': 'How do you want to sign in?' },
            h('button', { type: 'button', 'aria-pressed': String(!guest), onclick: () => { S.authTab = 'signin'; render(); } }, 'Sign in'),
            h('button', { type: 'button', 'aria-pressed': String(guest), onclick: () => { S.authTab = 'guest'; render(); } }, 'Guest'),
          ),
          guest ? null : err,
          form,
        ),
        h('p', { class: 'muted small' }, 'Teacher? ', h('a', { href: '/teacher' }, 'Go to the teacher console')),
      ),
    );
  }

  // ---------- install to the home screen ----------
  let deferredInstall = null;
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it until the pupil taps our own button
    deferredInstall = e;
    if (S.me && S.view === 'progress') render();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    UI.toast('Installed! Find Dash Express on your home screen.', { kind: 'ok' });
    if (S.me && S.view === 'progress') render();
  });
  function installPanel() {
    if (isStandalone()) return null;
    if (deferredInstall) {
      return h('section', { class: 'panel row install' },
        h('div', { class: 'grow' }, h('h2', { style: 'margin:0 0 4px' }, 'Put Dash Express on your home screen'), h('p', { class: 'small muted', style: 'margin:0' }, 'It opens full screen, like an app, and starts quickly.')),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const ev = deferredInstall;
          deferredInstall = null;
          try {
            await ev.prompt();
          } catch {}
          render();
        } }, 'Install'));
    }
    if (isIOS()) {
      return h('section', { class: 'panel install' }, h('h2', { style: 'margin:0 0 4px' }, 'Put Dash Express on your home screen'), h('p', { class: 'small', style: 'margin:0' }, 'In Safari, tap the Share button, then “Add to Home Screen”.'));
    }
    return null;
  }

  // ---------- chrome ----------
  const Sfx = window.DashSfx || { enabled: () => false, setEnabled() {}, play() {} };
  const UI = window.DashUI;
  const icon = (paths) => Art.sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, paths.map((d) => Art.sv('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })));
  const ICONS = {
    home: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
    depot: ['M4 8l8-4 8 4v9l-8 4-8-4z', 'M4 8l8 4 8-4', 'M12 12v9'],
    garage: ['M3 17h18', 'M5 17l1.5-6h11L19 17', 'M7 17v2M17 17v2', 'M9 13h6'],
    me: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.5-6 8-6s8 2 8 6'],
  };
  function soundButton() {
    const on = Sfx.enabled();
    return h('button', { class: 'iconbtn', type: 'button', id: 'soundbtn', 'aria-pressed': String(on), 'aria-label': 'Sound effects', title: on ? 'Sound on' : 'Sound off', onclick: () => {
      Sfx.setEnabled(!Sfx.enabled());
      savePrefs({ sound: Sfx.enabled() });
      const nb = soundButton();
      $('#soundbtn').replaceWith(nb);
      UI.announce(Sfx.enabled() ? 'Sound on' : 'Sound off');
    } }, icon(on ? ['M4 9v6h4l5 4V5L8 9z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a8 8 0 0 1 0 11'] : ['M4 9v6h4l5 4V5L8 9z', 'M17 9l4 6M21 9l-4 6']));
  }
  function header() {
    const me = S.me;
    return [
      h('header', { class: 'topbar' },
        h('div', { class: 'brand' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Dash Express'),
        me ? h('span', { class: 'chip', id: 'rankchip' }, me.rank.name) : null,
        me ? h('span', { class: 'chip xp', id: 'xpchip', 'aria-label': me.xp + ' experience points' }, me.xp + ' XP') : null,
        soundButton(),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => signOut('') }, 'Sign out'),
      ),
      h('nav', { class: 'tabs desk', 'aria-label': 'Sections' },
        tab('home', 'Town'),
        tab('depot', 'Depot'),
        tab('garage', 'Garage'),
        tab('practice', 'Redeliveries', me && me.wrong ? me.wrong : 0),
        tab('rules', 'Handbook'),
        tab('progress', 'My progress'),
      ),
    ];
  }
  // Four big buttons along the bottom on phones. Redeliveries and the Handbook live under "Me".
  function bottomNav() {
    const me = S.me;
    const cur = (v) => (v === 'home' ? S.view === 'home' || S.view === 'play' : v === 'progress' ? ['progress', 'practice', 'rules'].includes(S.view) : S.view === v);
    const item = (v, label, badge) => h('button', { class: 'bn', type: 'button', 'aria-current': cur(v) ? 'page' : false, onclick: () => { S.view = v; S.R = null; render(); } }, icon(ICONS[v === 'progress' ? 'me' : v]), label, badge ? h('span', { class: 'badge', 'aria-label': badge + ' to redeliver' }, badge) : null);
    return h('nav', { class: 'bottomnav', 'aria-label': 'Main' }, item('home', 'Town'), item('depot', 'Depot'), item('garage', 'Garage'), item('progress', 'Me', me && me.wrong ? me.wrong : 0));
  }
  function tab(view, label, badge) {
    const cur = S.view === view || (view === 'home' && S.view === 'play');
    return h('button', { class: 'tab', type: 'button', 'aria-current': cur ? 'page' : false, onclick: () => { S.view = view; S.R = null; render(); } }, label, badge ? h('span', { class: 'badge', 'aria-label': badge + ' to retry' }, badge) : null);
  }
  function updateChips() {
    const x = $('#xpchip');
    const r = $('#rankchip');
    if (x && S.me) {
      x.textContent = S.me.xp + ' XP';
      x.setAttribute('aria-label', S.me.xp + ' experience points');
    }
    if (r && S.me) r.textContent = S.me.rank.name;
  }
  function applyTotals(res) {
    if (res && res.xpTotal != null && S.me) {
      S.me.xp = res.xpTotal;
      S.me.rank = res.rank;
      if (res.vehicle) S.me.vehicle = res.vehicle;
      if (res.level && S.me.level) S.me.level.level = res.level;
      updateChips();
    }
  }

  // ---------- data ----------
  async function loadMe() {
    S.me = await api('/me');
    S.pupil = S.me.pupil;
    // Choices saved on the account win over this device's, so a pupil's ride and settings follow them around.
    const pr = S.me.prefs || {};
    if (typeof pr.sound === 'boolean') Sfx.setEnabled(pr.sound, { quiet: true });
    if (typeof pr.keys === 'boolean') store.set(KEYS_PREF, pr.keys ? '1' : '0');
  }
  // Saved a moment after the last change, so flicking a switch a few times is one request. A failure never
  // breaks the game: the choice still works on this device.
  let prefTimer = null;
  let prefPending = {};
  function savePrefs(patch) {
    Object.assign(prefPending, patch);
    clearTimeout(prefTimer);
    prefTimer = setTimeout(async () => {
      const body = prefPending;
      prefPending = {};
      try {
        const r = await api('/prefs', { method: 'PUT', body });
        if (S.me) S.me.prefs = { ...(S.me.prefs || {}), ...r.prefs };
      } catch (e) {
        UI.toast('Couldn’t save that to your account. It still works on this device.', { kind: 'error' });
      }
    }, 350);
  }

  // ---------- home ----------
  const MODES = {
    1: {
      title: 'Repack the parcel',
      orig: 'Rewrite it',
      text: 'Add speech marks, capital letters and punctuation to the sentence.',
      demo: [h('div', { class: 'muted' }, 'Raj said I want to be a doctor'), h('div', null, mark('Raj said, “I want to be a doctor.”'))],
    },
    2: {
      title: 'Inspect the parcel',
      orig: 'Spot the error',
      text: 'Tap every smudge in the dialogue, then type the fix.',
      demo: [h('div', { class: 'muted' }, '“lets go to the library said Chen.'), h('div', null, mark('“Let’s go to the library,” said Chen.'))],
    },
    3: {
      title: 'Build your ride',
      orig: 'Upgrade the tag',
      text: 'Swap said for a verb that shows how the speaker feels. “Said” is walking; a stronger verb is a faster ride.',
      demo: [h('div', { class: 'muted' }, '“I can’t find my homework,” said Mei.'), h('div', null, mark('“I can’t find my homework,” '), h('span', { class: 'verb' }, 'stammered'), ' Mei.')],
    },
    4: {
      title: 'The garage',
      orig: 'Choose the best answer',
      text: 'Pick the best saying verb for the job, or read the customer between the lines.',
      demo: [h('div', { class: 'muted' }, '“Quiet, please,” said the librarian.'), h('div', null, mark('“Quiet, please,” '), h('span', { class: 'verb' }, 'whispered'), ' the librarian.')],
    },
    5: {
      title: 'Relay the message',
      orig: 'Change the speech',
      text: 'Pass the message on: direct speech to reported speech, or the other way round.',
      demo: [h('div', { class: 'muted' }, mark('“I am going,” said Mei.')), h('div', null, 'Mei said she was going.')],
    },
    6: {
      title: 'Fix the dispatch diary',
      orig: 'Fix the tense',
      text: 'Tap the verb in the wrong time, then type the fix.',
      demo: [h('div', { class: 'muted' }, 'The courier ran in and sees a parcel.'), h('div', null, 'The courier ran in and ', h('span', { class: 'verb' }, 'saw'), ' a parcel.')],
    },
  };

  function modeCard(m, st) {
    const info = MODES[m];
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    const allDone = st.total && st.done >= st.total;
    return h('section', { class: 'panel mode-card' },
      h('span', { class: 'tag' }, 'Mode ' + m + ' · ' + info.orig),
      h('h2', null, info.title),
      h('p', { style: 'margin:0' }, info.text),
      h('div', { class: 'demo', 'aria-hidden': 'true' }, info.demo),
      h('div', { class: 'bar thin', role: 'img', 'aria-label': st.done + ' of ' + st.total + ' done' }, h('i', { style: 'width:' + pct + '%' })),
      h('span', { class: 'small muted' }, st.total ? st.done + ' of ' + st.total + ' done' : 'Nothing to deliver yet. This job opens as you level up.'),
      h('button', { class: 'btn', type: 'button', disabled: !st.total, onclick: () => startRoute({ kind: 'mode', mode: m }) }, allDone ? 'Run it again' : st.done ? 'Keep going' : 'Start'),
    );
  }

  // ---------- rounds ----------
  // Takes the first n questions, but whenever a question belongs to a group (e.g. three questions about
  // one passage) its whole group comes with it, in id order, so siblings are served back to back.
  function takeRound(list, n) {
    const out = [];
    const used = new Set();
    for (const q of list) {
      if (out.length >= n) break;
      if (used.has(q.id)) continue;
      const g = q.p && q.p.group;
      const batch = g ? list.filter((x) => x.p && x.p.group === g && !used.has(x.id)).sort((a, b) => a.id - b.id) : [q];
      for (const b of batch) {
        used.add(b.id);
        out.push(b);
      }
    }
    return out;
  }

  async function startRound(mode, practice) {
    const back = S.view === 'play' ? 'home' : S.view;
    S.busy = 'Packing your parcels';
    render();
    try {
      const data = await api('/questions?' + (practice ? 'practice=1' : 'mode=' + mode));
      const qs = data.questions;
      let pool;
      if (practice) pool = shuffle([...qs]);
      else pool = [...shuffle(qs.filter((q) => q.status === 'new')), ...shuffle(qs.filter((q) => q.status === 'wrong')), ...shuffle(qs.filter((q) => q.status === 'done'))];
      pool = takeRound(pool, practice ? 8 : 5);
      if (!pool.length) {
        S.busy = '';
        S.view = back;
        S.flash = 'There are no questions here yet.';
        render();
        return;
      }
      S.busy = '';
      S.R = { kind: 'practice', list: pool, i: 0, practice: true, mode, xp: 0, right: 0, results: [], combo: 0, bestCombo: 0, slips: 0, over: false, startedAt: Date.now(), t0: Date.now() };
      S.view = 'play';
      render();
    } catch (e) {
      S.busy = '';
      S.view = back;
      S.flash = e.message;
      render();
    }
  }

  function finishQuestion(correct, xp) {
    const R = S.R;
    R.results[R.i] = correct ? 'done' : 'bad';
    if (correct) R.right++;
    R.xp += xp || 0;
    const slipped = !(correct && S.lastTry === 1);
    if (!slipped) {
      R.combo++;
      R.bestCombo = Math.max(R.bestCombo, R.combo);
    } else {
      R.combo = 0;
      R.slips++;
    }
    Sfx.play(!correct ? (R.kind === 'big' ? 'slip' : 'wrong') : R.combo >= 2 ? 'combo' : 'right');
    UI.announce(!correct ? 'Not this time.' : R.combo >= 2 ? 'Correct! Combo times ' + Math.min(R.combo, 4) + '.' : 'Correct!');
    const patience = (S.meta.route || {}).patience || 3;
    if (R.kind === 'big' && R.slips >= patience) R.over = true;
    refreshStrip();
  }
  function nextBtn() {
    const R = S.R;
    const last = R.i >= R.list.length - 1 || R.over;
    return h('button', { class: 'btn', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      if (last) return endRoute();
      R.i++;
      render();
    } }, last ? 'Finish route' : 'Next stop');
  }

  function playView() {
    const R = S.R;
    if (R.i >= R.list.length) return R.practice ? summaryView() : receiptView();
    const q = R.list[R.i];
    const rulesDlg = rulesDialog();
    const stage = { 1: qMode1, 2: qMode2, 3: qMode3, 4: qMode4, 5: qMode5, 6: qMode6 }[q.mode](q);
    // On phones the main button (Check, Fix it, Continue) stays in reach while you scroll a long question.
    const act = stage.querySelector('.actions');
    if (act && !act.closest('.dock')) act.classList.add('sticky-actions');
    return h('div', { class: 'wrap' },
      h('div', { class: 'stagebar' },
        h('div', { class: 'grow' }, routeStrip()),
        h('button', { class: 'btn small alt', type: 'button', onclick: () => rulesDlg.showModal() }, 'Handbook'),
        h('button', { class: 'btn small alt', type: 'button', onclick: async () => { clearInterval(S.clockTimer); S.view = S.R && S.R.practice ? 'practice' : 'home'; S.R = null; try { await loadMe(); } catch {} render(); } }, 'Quit'),
      ),
      rulesDlg,
      stage,
    );
  }

  function summaryView() {
    const R = S.R;
    const missed = R.results.filter((r) => r === 'bad').length;
    return h('div', { class: 'wrap' },
      h('section', { class: 'panel' },
        h('h1', null, R.right === R.list.length ? 'Perfect round!' : 'Round complete'),
        h('p', { class: 'summary-big' }, R.right + ' / ' + R.list.length),
        h('p', null, 'answered correctly', R.xp ? [' · ', h('span', { class: 'xp-pop' }, '+' + R.xp + ' XP')] : null),
        missed ? h('p', null, 'The ' + (missed === 1 ? 'one' : missed) + ' you missed ' + (missed === 1 ? 'is' : 'are') + ' saved in ', h('b', null, 'Redeliveries'), '.') : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => startRound(R.mode, R.practice) }, R.practice ? 'Practise more' : 'Play again'),
          missed ? h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'practice'; S.R = null; render(); } }, 'Try the missed ones') : null,
          h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'home'; S.R = null; render(); } }, 'Home'),
        ),
      ),
    );
  }

  // ---------- typing aids: punctuation keys, and a bar that stays above the on-screen keyboard ----------
  const KEYS_PREF = 'dd_keys';
  // Shown by default on touch screens (hard to type “ ” there). Anyone can switch them on or off; it is remembered.
  function keysWanted() {
    const v = store.get(KEYS_PREF);
    if (v === '1') return true;
    if (v === '0') return false;
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }
  const PUNCT = [['“', 'open speech marks'], ['”', 'close speech marks'], ['‘', 'open single quote'], ['’', 'apostrophe or close single quote'], [',', 'comma'], ['.', 'full stop'], ['?', 'question mark'], ['!', 'exclamation mark'], [':', 'colon'], [';', 'semicolon'], ['—', 'dash'], ['…', 'ellipsis']];
  // getTarget() returns the box to type into. Pressing a key must not steal focus (that would close the keyboard on a phone).
  function punctKeys(getTarget, { newline = false } = {}) {
    const insert = (c) => {
      const t = getTarget();
      if (!t || t.disabled) return;
      const a = t.selectionStart == null ? t.value.length : t.selectionStart;
      const b = t.selectionEnd == null ? t.value.length : t.selectionEnd;
      t.setRangeText(c, a, b, 'end');
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.focus();
      Sfx.play('tap');
    };
    const keys = h('div', { class: 'keys', role: 'group', 'aria-label': 'Punctuation keys' },
      [...PUNCT, ...(newline ? [['\n', 'new line']] : [])].map(([c, name]) =>
        h('button', { type: 'button', 'aria-label': name, onpointerdown: (e) => e.preventDefault(), onmousedown: (e) => e.preventDefault(), onclick: () => insert(c) }, c === '\n' ? '↵ new line' : c)));
    const toggle = h('button', { class: 'keys-toggle', type: 'button', onclick: () => {
      const nowOn = keys.hidden;
      store.set(KEYS_PREF, nowOn ? '1' : '0');
      savePrefs({ keys: nowOn });
      sync();
    } });
    const sync = () => {
      const on = keysWanted();
      keys.hidden = !on;
      toggle.textContent = on ? 'Hide punctuation keys' : 'Show punctuation keys';
      toggle.setAttribute('aria-pressed', String(on));
    };
    sync();
    const el = h('div', { class: 'keyswrap' }, keys, toggle);
    return { el, keys, hide: () => { el.hidden = true; } };
  }
  // The answer bar. On phones it sits at the bottom of the screen, above the keyboard, so the keys and the
  // Check button are always in reach. On bigger screens it is simply part of the page.
  function answerDock(...kids) {
    return h('div', { class: 'dock' }, kids);
  }
  function trackKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => document.documentElement.style.setProperty('--kb', Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + 'px');
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }

  // ---------- Mode 1: rewrite ----------
  function qMode1(q) {
    let tryNo = 1;
    const lines = !!q.p.lines;
    const bubble = h('div', { class: 'bubble pre' }, q.p.prompt);
    const ta = h('textarea', { class: 'answer', rows: lines ? '4' : '2', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Your answer', placeholder: lines ? 'Type it here. Press Enter to start a new line.' : 'Type the sentence with speech marks and punctuation' });
    const fb = h('div', { 'aria-live': 'polite' });
    const check = h('button', { class: 'btn', type: 'button' }, 'Check');
    const show = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Show me the answer');
    const pk = punctKeys(() => ta, { newline: lines });
    const keys = pk.el;
    const dock = answerDock(keys, h('div', { class: 'actions' }, check, show));
    const lock = () => {
      ta.disabled = true;
      check.hidden = true;
      show.hidden = true;
      dock.hidden = true;
    };
    function showAnswer(text, good) {
      bubble.className = 'bubble pre' + (good ? ' good' : '');
      bubble.replaceChildren(mark(text));
    }
    async function send(payload) {
      check.disabled = true;
      show.disabled = true;
      try {
        const r = await api('/answer', { method: 'POST', body: { qid: q.id, tryNo, practice: S.R.practice, ...payload } });
        applyTotals(r);
        if (r.correct) {
          finishQuestion(true, r.xp);
          lock();
          showAnswer(r.reveal, true);
          fb.replaceChildren(h('div', { class: 'result good' }, h('h3', null, tryNo === 1 ? 'Correct! First try.' : 'Correct!'), xpPop(r.xp), r.note === 'single' ? h('p', { class: 'small', style: 'margin:8px 0 0' }, 'Tip: single speech marks are fine in many books, but in this game use double ones: “ ”.') : null, tipLine(r.tip)), h('div', { class: 'actions' }, nextBtn()));
        } else if (r.final) {
          finishQuestion(false, 0);
          lock();
          showAnswer(r.reveal, false);
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Here’s the answer'), h('p', { style: 'margin:0' }, 'Compare it with yours. This one is saved in Redeliveries so you can try it again.'), r.errors && r.errors.length ? errorList(r.errors) : null, tipLine(r.tip)), h('div', { class: 'actions' }, nextBtn()));
        } else {
          const n = r.errors.length;
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Not quite — ' + n + (n === 1 ? ' thing to fix' : ' things to fix')), errorList(r.errors), h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'Fix your sentence above and check again. Try ' + (tryNo + 1) + ' of 3.')));
          tryNo++;
          check.textContent = 'Check again';
          show.hidden = false;
          ta.focus();
        }
      } catch (e) {
        fb.replaceChildren(errorBox(e.message));
      } finally {
        check.disabled = false;
        show.disabled = false;
      }
    }
    check.addEventListener('click', () => {
      if (!ta.value.trim()) return ta.focus();
      send({ answer: ta.value });
    });
    show.addEventListener('click', () => send({ giveUp: true }));
    ta.addEventListener('keydown', (e) => {
      // one-line questions: Enter checks. Line-break questions: Enter makes a new line, Ctrl/Cmd+Enter checks.
      if (e.key === 'Enter' && (lines ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
        e.preventDefault();
        check.click();
      }
    });
    setTimeout(() => ta.focus(), 30);
    return h('div', null,
      h('p', { class: 'instruction' }, q.p.instruction || 'Rewrite the sentence with the correct speech marks and punctuation.'),
      bubble,
      ta,
      fb,
      dock,
    );
  }

  // ---------- Mode 2: spot the error, then fix ----------
  function qMode2(q) {
    const p = q.p;
    const sel = new Set();
    let phase = 1;
    const flow = h('div', { class: 'flow', role: 'group', 'aria-label': 'Dialogue. Tap the words or gaps that have mistakes.' });
    const counter = h('p', { class: 'muted', id: 'pick-count' });
    const fb = h('div', { 'aria-live': 'polite' });
    const actions = h('div', { class: 'actions' });
    const toks = []; // {key, kind, index, el}

    const gapText = (k) => p.gaps[k].raw.replace(/[ \t]+/g, ' ');
    const gapLabel = (k) => (k === 0 ? 'Gap before ' + p.words[0] : k === p.words.length ? 'Gap after ' + p.words[k - 1] : 'Gap between ' + p.words[k - 1] + ' and ' + p.words[k]);

    function toggle(t) {
      if (phase !== 1) return;
      if (sel.has(t.key)) sel.delete(t.key);
      else sel.add(t.key);
      t.el.classList.toggle('sel', sel.has(t.key));
      t.el.setAttribute('aria-pressed', String(sel.has(t.key)));
      counter.textContent = 'Selected: ' + sel.size + ' of ' + p.places + ' places to fix.';
    }
    function makeTok(kind, index) {
      const key = (kind === 'g' ? 'g' : 'w') + index;
      const isGap = kind === 'g';
      const el = h('span', {
        class: 'tok ' + (isGap ? 'gap' : 'word'),
        role: 'button',
        tabindex: '0',
        'aria-pressed': 'false',
        'aria-label': isGap ? gapLabel(index) + (p.gaps[index].raw.trim() ? ': ' + p.gaps[index].raw.trim() : '') : p.words[index],
      }, isGap ? gapText(index) : p.words[index]);
      const t = { key, kind, index, el };
      el.addEventListener('click', () => toggle(t));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(t);
        }
      });
      return t;
    }
    for (let k = 0; k <= p.words.length; k++) {
      toks.push(makeTok('g', k));
      if (k < p.words.length) toks.push(makeTok('w', k));
    }
    flow.append(...toks.map((t) => t.el));
    counter.textContent = 'Selected: 0 of ' + p.places + ' places to fix.';

    const spotBtn = h('button', { class: 'btn', type: 'button' }, 'Check my spots');
    spotBtn.addEventListener('click', async () => {
      spotBtn.disabled = true;
      try {
        const r = await api('/answer', { method: 'POST', body: { qid: q.id, phase: 1, clicked: [...sel], practice: S.R.practice } });
        phase = 2;
        const slotKeys = new Set(r.slots.map((s) => s.key));
        for (const t of toks) {
          t.el.removeAttribute('role');
          t.el.removeAttribute('tabindex');
          t.el.removeAttribute('aria-pressed');
          t.el.classList.remove('sel');
          t.el.classList.add('locked');
        }
        const slotMap = new Map(r.slots.map((s) => [s.key, s]));
        for (const t of toks) {
          const s = slotMap.get(t.key);
          if (s) t.el.classList.add(s.spotted ? 'hit' : 'miss');
          else if (sel.has(t.key)) t.el.classList.add('falsepos');
        }
        const missed = r.total - r.hits;
        fb.replaceChildren(
          h('div', { class: 'result ' + (missed === 0 && !r.falseKeys.length ? 'good' : 'bad') },
            h('h3', null, 'You found ' + r.hits + ' of ' + r.total + ' mistakes'),
            h('p', { style: 'margin:0' }, missed ? 'The dashed red spots are mistakes you missed. ' : '', r.falseKeys.length ? 'Crossed-out spots were already correct. ' : '', 'Now fix every highlighted spot.'),
          ),
          h('div', { class: 'legend', style: 'margin-top:12px' }, h('span', { class: 'l-hit' }, 'You found it'), h('span', { class: 'l-miss' }, 'You missed it'), h('span', { class: 'l-false' }, 'Already correct')),
        );
        counter.hidden = true;
        // swap highlighted spots for typing boxes
        const inputs = new Map();
        for (const t of toks) {
          const s = slotMap.get(t.key);
          if (!s) continue;
          const cur = t.kind === 'g' ? p.gaps[t.index].raw.replace(/\s+/g, '') : p.words[t.index];
          const inp = h('input', {
            type: 'text',
            class: 'fixbox',
            value: cur,
            size: String(Math.max(3, cur.length + 1)),
            spellcheck: 'false',
            autocomplete: 'off',
            autocapitalize: 'off',
            'aria-label': t.kind === 'g' ? 'Fix for the ' + gapLabel(t.index).toLowerCase() : 'Fix for the word ' + p.words[t.index],
            placeholder: t.kind === 'g' ? '…' : '',
          });
          inp.addEventListener('input', () => inp.setAttribute('size', String(Math.max(3, inp.value.length + 1))));
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              fixBtn.click();
            }
          });
          inputs.set(t.key, inp);
          t.el.replaceWith(inp);
          t.input = inp;
        }
        const first = [...inputs.values()][0];
        let lastFix = first;
        for (const inp of inputs.values()) inp.addEventListener('focus', () => { lastFix = inp; });
        const pk2 = punctKeys(() => lastFix);
        actions.before(pk2.el);
        if (first) first.focus();
        actions.replaceChildren(fixBtn);
        fixBtn.addEventListener('click', async () => {
          fixBtn.disabled = true;
          try {
            const fixes = {};
            for (const [k, inp] of inputs) fixes[k] = inp.value;
            const r2 = await api('/answer', { method: 'POST', body: { qid: q.id, phase: 2, clicked: [...sel], fixes, practice: S.R.practice } });
            applyTotals(r2);
            finishQuestion(r2.correct, r2.xp);
            for (const s of r2.slots) {
              const inp = inputs.get(s.key);
              inp.disabled = true;
              inp.classList.add(s.fixed ? 'ok' : 'no');
            }
            const list = h('ul', { class: 'fb' }, r2.slots.map((s) =>
              h('li', null,
                h('p', { style: 'margin:0 0 4px' }, h('b', null, s.fixed ? '✓ ' : '✗ '), s.summary),
                s.fixed ? null : h('p', { class: 'fix', style: 'margin:0 0 6px' }, s.message || (s.typed ? 'You typed ‘' + s.typed + '’.' : 'You didn’t type a fix.'), s.residual && s.residual.length ? ' ' + s.residual.map((e) => e.what).join(' ') : ''),
                s.errors.map((e) => h('div', { style: 'margin-top:6px' }, ruleChip(e.rule), h('span', { style: 'margin-left:8px' }, e.what))),
              )));
            fb.replaceChildren(
              h('div', { class: 'result ' + (r2.correct ? 'good' : 'bad') },
                h('h3', null, r2.perfect ? 'Perfect! Every mistake found and fixed.' : r2.correct ? 'All fixed!' : 'Fixed ' + r2.fixed + ' of ' + r2.total),
                xpPop(r2.xp),
                h('p', { style: 'margin:10px 0 4px' }, h('b', null, 'The mistakes')),
                list,
                h('p', { style: 'margin:14px 0 4px' }, h('b', null, 'The correct version')),
                h('div', { class: 'bubble good', style: 'margin-bottom:6px;font-size:1.25rem;white-space:pre-wrap' }, mark(r2.correctText)),
              ),
            );
            actions.replaceChildren(nextBtn());
          } catch (e) {
            fb.replaceChildren(errorBox(e.message));
            fixBtn.disabled = false;
          }
        });
      } catch (e) {
        fb.replaceChildren(errorBox(e.message));
        spotBtn.disabled = false;
      }
    });
    const fixBtn = h('button', { class: 'btn', type: 'button' }, 'Check my fixes');
    actions.append(spotBtn);
    return h('div', null,
      h('p', { class: 'instruction' }, 'Tap every mistake. A mistake can be a word, or a gap where punctuation or speech marks are missing or wrong (gaps have a dotted underline).'),
      flow,
      counter,
      actions,
      fb,
    );
  }

  // ---------- Mode 3: upgrade the tag ----------
  function qMode3(q) {
    const p = q.p;
    let tryNo = 1;
    const input = h('input', { type: 'text', class: 'blank', maxlength: '24', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Your saying verb', placeholder: 'your verb' });
    const bubble = h('div', { class: 'bubble' },
      p.context ? h('span', { class: 'scene' }, p.context) : null,
      mark('“' + p.line + '” '),
      input,
      ' ' + p.speaker + '.',
    );
    const fb = h('div', { 'aria-live': 'polite' });
    const check = h('button', { class: 'btn', type: 'button' }, 'Check');
    const hintBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Give me a hint');
    const hintBox = h('p', { class: 'notice', hidden: true }, 'Think about how ' + p.speaker + ' sounds: ', h('b', null, p.hint.join(' or ')), '.');
    hintBtn.addEventListener('click', () => {
      hintBox.hidden = false;
      hintBtn.hidden = true;
    });
    function ideas(list) {
      return list && list.length ? h('div', null, h('p', { class: 'small', style: 'margin:10px 0 0' }, 'Other good choices:'), h('div', { class: 'ideas' }, list.map((w) => h('span', { class: 'idea' }, w)))) : null;
    }
    async function send(giveUp) {
      const word = input.value.trim();
      if (!giveUp && !word) return input.focus();
      check.disabled = true;
      try {
        const r = await api('/answer', { method: 'POST', body: { qid: q.id, answer: word || '-', tryNo, practice: S.R.practice, giveUp } });
        applyTotals(r);
        if (r.correct) {
          finishQuestion(true, r.xp);
          input.disabled = true;
          check.hidden = true;
          hintBtn.hidden = true;
          bubble.className = 'bubble good';
          bubble.replaceChildren(p.context ? h('span', { class: 'scene' }, p.context) : null, mark('“' + p.line + '” '), h('span', { class: 'verb' }, word.toLowerCase()), ' ' + p.speaker + '.');
          fb.replaceChildren(h('div', { class: 'result good' }, h('h3', null, tryNo === 1 ? 'Great verb!' : 'That works!'), xpPop(r.xp), h('p', { style: 'margin:8px 0 0' }, r.message), ideas(r.more)), h('div', { class: 'actions' }, nextBtn()));
        } else if (r.final) {
          finishQuestion(false, 0);
          input.disabled = true;
          check.hidden = true;
          hintBtn.hidden = true;
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Some verbs that would work'), h('p', { style: 'margin:0' }, 'This one is saved in Redeliveries so you can try it again.'), ideas(r.more)), h('div', { class: 'actions' }, nextBtn()));
        } else {
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, r.status === 'pending' ? 'Waiting for your teacher' : 'Try another verb'), ruleChip(7), h('p', { style: 'margin:8px 0 0' }, r.message), h('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'Try ' + (tryNo + 1) + ' of 3.')));
          tryNo++;
          hintBox.hidden = false;
          hintBtn.hidden = true;
          input.select();
          input.focus();
        }
      } catch (e) {
        fb.replaceChildren(errorBox(e.message));
      } finally {
        check.disabled = false;
      }
    }
    check.addEventListener('click', () => send(false));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send(false);
      }
    });
    setTimeout(() => input.focus(), 30);
    return h('div', null,
      h('p', { class: 'instruction' }, 'Replace “said” with a saying verb that shows how ' + p.speaker + ' feels.'),
      bubble,
      hintBox,
      h('div', { class: 'actions' }, check, hintBtn),
      fb,
    );
  }

  // ---------- Mode 4: multiple choice ----------
  function qMode4(q) {
    const p = q.p;
    let tryNo = 1;
    const sel = new Set();
    const els = new Map();
    const fb = h('div', { 'aria-live': 'polite' });
    const count = h('p', { class: 'muted small', style: 'margin:6px 0 0' });
    const check = h('button', { class: 'btn', type: 'button', disabled: true }, 'Check');
    const single = p.pick === 1;
    const refresh = () => {
      for (const [id, el] of els) el.setAttribute('aria-checked', String(sel.has(id)));
      check.disabled = sel.size !== p.pick;
      count.textContent = single ? '' : 'Choose ' + p.pick + '. Chosen so far: ' + sel.size + '.';
    };
    const list = h('div', { class: 'opts', role: single ? 'radiogroup' : 'group', 'aria-label': p.stem },
      p.options.map((o) => {
        const el = h('button', { type: 'button', class: 'opt', role: single ? 'radio' : 'checkbox', 'aria-checked': 'false' }, h('span', { class: 'box', 'aria-hidden': 'true' }), h('span', null, o.text));
        el.addEventListener('click', () => {
          if (el.disabled) return;
          if (single) sel.clear();
          if (sel.has(o.id) && !single) sel.delete(o.id);
          else sel.add(o.id);
          refresh();
        });
        els.set(o.id, el);
        return el;
      }),
    );
    refresh();
    const lockAll = () => els.forEach((el) => (el.disabled = true));
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        const r = await api('/answer', { method: 'POST', body: { qid: q.id, choice: [...sel], tryNo, practice: S.R.practice } });
        applyTotals(r);
        if (r.correct) {
          finishQuestion(true, r.xp);
          lockAll();
          for (const id of sel) els.get(id).classList.add('right');
          check.hidden = true;
          fb.replaceChildren(h('div', { class: 'result good' }, h('h3', null, tryNo === 1 ? 'Correct! First try.' : 'Correct!'), xpPop(r.xp), h('p', { style: 'margin:8px 0 0' }, r.explanation)), h('div', { class: 'actions' }, nextBtn()));
          return;
        }
        for (const id of r.wrongIds) {
          const el = els.get(id);
          el.classList.add('wrong');
          el.disabled = true;
          sel.delete(id);
        }
        if (r.final) {
          finishQuestion(false, 0);
          lockAll();
          for (const id of r.reveal.correct) els.get(id).classList.add('right');
          check.hidden = true;
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Here’s the answer'), h('p', { style: 'margin:0' }, r.explanation), h('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'This one is saved in Redeliveries so you can try it again.')), h('div', { class: 'actions' }, nextBtn()));
          return;
        }
        const whys = Object.entries(r.whys || {});
        fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Not quite'), r.rule != null ? ruleChip(r.rule) : null,
          whys.length ? h('ul', { class: 'fb' }, whys.map(([id, w]) => h('li', null, h('p', { class: 'what' }, h('b', null, '“' + els.get(id).textContent + '”: '), w)))) : null,
          h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'The wrong choice is crossed out. Try ' + (tryNo + 1) + ' of 2.')));
        tryNo++;
        refresh();
      } catch (e) {
        fb.replaceChildren(errorBox(e.message));
        refresh();
      }
    });
    return h('div', null,
      p.context ? h('blockquote', { class: 'passage' }, mark(p.context)) : null,
      h('p', { class: 'instruction' }, mark(p.stem)),
      list,
      count,
      h('div', { class: 'actions' }, check),
      fb,
    );
  }

  // ---------- Mode 5: change the speech ----------
  function qMode5(q) {
    const p = q.p;
    let tryNo = 1;
    const bubble = h('div', { class: 'bubble pre' }, mark(p.prompt));
    const ta = h('textarea', { class: 'answer', rows: '2', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Your answer', placeholder: 'Type your answer here' });
    const fb = h('div', { 'aria-live': 'polite' });
    const check = h('button', { class: 'btn', type: 'button' }, 'Check');
    const show = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Show me the answer');
    const pk = punctKeys(() => ta);
    const keys = pk.el;
    const dock = answerDock(keys, h('div', { class: 'actions' }, check, show));
    const lock = () => {
      ta.disabled = true;
      check.hidden = true;
      show.hidden = true;
      dock.hidden = true;
    };
    async function send(payload) {
      check.disabled = true;
      show.disabled = true;
      try {
        const r = await api('/answer', { method: 'POST', body: { qid: q.id, tryNo, practice: S.R.practice, ...payload } });
        applyTotals(r);
        if (r.correct) {
          finishQuestion(true, r.xp);
          lock();
          fb.replaceChildren(h('div', { class: 'result good' }, h('h3', null, tryNo === 1 ? 'Correct! First try.' : 'Correct!'), xpPop(r.xp), noteList(r.notes), tipLine(r.tip)), h('div', { class: 'actions' }, nextBtn()));
        } else if (r.final) {
          finishQuestion(false, 0);
          lock();
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Here’s one way to write it'), h('div', { class: 'bubble good pre', style: 'margin:10px 0 8px;font-size:1.2rem' }, mark(r.reveal)), r.reveal.includes('(') ? h('p', { class: 'small muted', style: 'margin:0' }, 'Words in brackets are optional.') : null,
            r.errors && r.errors.length ? errorList(r.errors) : null, tipLine(r.tip), h('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'This one is saved in Redeliveries so you can try it again.')), h('div', { class: 'actions' }, nextBtn()));
        } else {
          const n = r.errors.length;
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Not quite' + (n > 1 ? ' — ' + n + ' things to fix' : '')), errorList(r.errors), noteList(r.notes), h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'Fix your answer above and check again. Try ' + (tryNo + 1) + ' of 3.')));
          tryNo++;
          check.textContent = 'Check again';
          show.hidden = false;
          ta.focus();
        }
      } catch (e) {
        fb.replaceChildren(errorBox(e.message));
      } finally {
        check.disabled = false;
        show.disabled = false;
      }
    }
    check.addEventListener('click', () => (ta.value.trim() ? send({ answer: ta.value }) : ta.focus()));
    show.addEventListener('click', () => send({ giveUp: true }));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        check.click();
      }
    });
    setTimeout(() => ta.focus(), 30);
    return h('div', null, h('p', { class: 'instruction' }, p.instruction), bubble, ta, fb, dock);
  }

  // ---------- Mode 6: tap the wrong word, then type the fix ----------
  function qMode6(q) {
    const p = q.p;
    let phase = 1;
    let tapTry = 1;
    let fixTry = 1;
    let chosen = -1;
    const fb = h('div', { 'aria-live': 'polite' });
    const actions = h('div', { class: 'actions' });
    const flow = h('div', { class: 'flow', role: 'group', 'aria-label': 'Sentence. Tap the verb that is in the wrong time.' });
    const wordEls = [];
    for (let k = 0; k <= p.words.length; k++) {
      const g = p.gaps[k].raw;
      if (g) flow.append(h('span', { class: 'gaptxt' }, g));
      if (k < p.words.length) {
        const i = k;
        const el = h('span', { class: 'tok word', role: 'button', tabindex: '0', 'aria-pressed': 'false' }, p.words[k]);
        const pick = () => {
          if (phase !== 1) return;
          chosen = i;
          wordEls.forEach((w, j) => {
            w.classList.toggle('sel', j === i);
            w.setAttribute('aria-pressed', String(j === i));
          });
          tapBtn.disabled = false;
        };
        el.addEventListener('click', pick);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
        wordEls.push(el);
        flow.append(el);
      }
    }
    const tapBtn = h('button', { class: 'btn', type: 'button', disabled: true }, 'Check my word');
    const fixBtn = h('button', { class: 'btn', type: 'button' }, 'Check my fix');
    const input = h('input', { type: 'text', class: 'fixbox', size: '8', maxlength: '30', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Your correction for the wrong word' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        fixBtn.click();
      }
    });
    function toFixPhase() {
      phase = 2;
      const el = wordEls[chosen];
      el.classList.remove('sel');
      el.classList.add('hit');
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      wordEls.forEach((w) => w.classList.add('locked'));
      el.replaceWith(input);
      input.focus();
      actions.replaceChildren(fixBtn);
    }
    tapBtn.addEventListener('click', async () => {
      tapBtn.disabled = true;
      try {
        const r = await api('/answer', { method: 'POST', body: { qid: q.id, phase: 1, tap: chosen, tapTry, practice: S.R.practice } });
        if (r.hit) {
          fb.replaceChildren(h('div', { class: 'result good' }, h('h3', null, 'Yes, that verb is in the wrong time.'), h('p', { style: 'margin:0' }, 'Type the corrected word in the box.')));
          toFixPhase();
          return;
        }
        wordEls[chosen].classList.add('falsepos');
        wordEls[chosen].classList.remove('sel');
        if (r.reveal != null) {
          chosen = r.reveal;
          tapTry = 3;
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Here’s the word to fix'), h('p', { style: 'margin:0' }, 'It’s ‘' + p.words[chosen] + '’. Now type the corrected word.')));
          toFixPhase();
          return;
        }
        tapTry++;
        chosen = -1;
        fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Not that one'), h('p', { style: 'margin:0' }, 'That word is fine. Find the verb that isn’t in the same time as the others. Try 2 of 2.')));
      } catch (e) {
        fb.replaceChildren(errorBox(e.message));
        tapBtn.disabled = chosen < 0;
      }
    });
    fixBtn.addEventListener('click', async () => {
      if (!input.value.trim()) return input.focus();
      fixBtn.disabled = true;
      try {
        const r = await api('/answer', { method: 'POST', body: { qid: q.id, phase: 2, tap: chosen, tapTry, fix: input.value, fixTry, practice: S.R.practice } });
        applyTotals(r);
        const done = (good) => {
          finishQuestion(good, r.xp);
          input.disabled = true;
          actions.replaceChildren(nextBtn());
        };
        if (r.correct) {
          done(true);
          fb.replaceChildren(h('div', { class: 'result good' }, h('h3', null, fixTry === 1 && tapTry === 1 ? 'Perfect! Found and fixed first time.' : 'Fixed!'), xpPop(r.xp), h('div', { class: 'bubble good', style: 'margin:10px 0 6px;font-size:1.2rem' }, r.sentence), tipLine(r.tip)));
        } else if (r.final) {
          done(false);
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Here’s the fix'), h('div', { class: 'bubble good', style: 'margin:10px 0 6px;font-size:1.2rem' }, r.sentence), tipLine(r.tip), h('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'This one is saved in Redeliveries so you can try it again.')));
        } else {
          fixTry++;
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Not quite'), ruleChip(11), h('p', { style: 'margin:8px 0 0' }, r.message), h('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'Try ' + fixTry + ' of 3.')));
          input.select();
          input.focus();
          fixBtn.disabled = false;
        }
      } catch (e) {
        fb.replaceChildren(errorBox(e.message));
        fixBtn.disabled = false;
      }
    });
    actions.append(tapBtn);
    return h('div', null,
      h('p', { class: 'instruction' }, 'One verb is in the wrong time. Tap it, then type the fix.'),
      flow,
      actions,
      fb,
    );
  }

  // ---------- rules ----------
  function ruleCards(compact) {
    const rules = RULE_NAMES();
    return Object.keys(rules).map(Number).filter((n) => n > 0).sort((a, b) => a - b).map((n) => {
      const r = rules[n];
      if (!r) return null;
      return h('section', { class: 'panel rule-card r' + n, style: compact ? 'box-shadow:none;margin-bottom:12px;padding:12px' : '' },
        h('div', { class: 'num', 'aria-hidden': 'true' }, n),
        h('h3', null, 'Rule ' + n + ': ' + r.title),
        h('p', { class: 'small', style: 'margin:0 0 4px' }, h('b', null, 'District: '), distInfo(n).name),
        h('p', { class: 'muted small', style: 'margin:0' }, r.tip),
        r.good ? h('div', { class: 'good pre' }, mark(r.good)) : null,
      );
    });
  }
  function rulesDialog() {
    const dlg = h('dialog', { 'aria-label': 'The handbook' },
      h('div', { class: 'row', style: 'margin-bottom:10px' }, h('h2', { class: 'grow', style: 'margin:0' }, 'The handbook'), h('button', { class: 'btn small', type: 'button', onclick: () => dlg.close() }, 'Close')),
      ruleCards(true),
    );
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    return dlg;
  }
  function rulesView() {
    return h('div', { class: 'wrap' }, h('h1', null, 'The Dash Express handbook'), h('p', { class: 'muted' }, 'One rule for every district. Coloured marks show the speech marks and punctuation.'), ruleCards(false));
  }

  // ---------- practice ----------
  function practiceView() {
    const wrap = h('div', { class: 'wrap' }, h('h1', null, 'Redeliveries'), h('p', { class: 'muted' }, 'Parcels that came back undelivered. Get one right and it leaves this list.'));
    const body = h('div', null, h('p', null, 'Loading…'));
    wrap.append(body);
    api('/questions?practice=1')
      .then((d) => {
        S.practiceCount = d.questions.length;
        if (!d.questions.length) {
          body.replaceChildren(h('section', { class: 'panel' }, h('h2', null, 'Nothing to redeliver'), h('p', { style: 'margin:0' }, 'You haven’t got any questions to retry. Play a round and any you miss will appear here.'), h('div', { class: 'actions', style: 'margin-top:14px' }, h('button', { class: 'btn', type: 'button', onclick: () => { S.view = 'home'; render(); } }, 'Go and play'))));
          return;
        }
        const by = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
        for (const q of d.questions) by[q.mode].push(q);
        body.replaceChildren(
          h('section', { class: 'panel' },
            h('h2', null, d.questions.length + (d.questions.length === 1 ? ' question to retry' : ' questions to retry')),
            h('ul', { style: 'padding-left:20px;margin:0 0 14px' }, [1, 2, 3, 4, 5, 6].filter((m) => by[m].length).map((m) => h('li', null, MODES[m].title + ': ' + by[m].length))),
            h('button', { class: 'btn', type: 'button', onclick: () => startRound(null, true) }, 'Start redeliveries'),
          ),
          h('section', { class: 'panel flat' }, h('h3', null, 'Coming up'), h('ul', { style: 'padding-left:20px;margin:0' }, d.questions.slice(0, 8).map((q) => h('li', null, q.mode === 1 || q.mode === 5 ? q.p.prompt : q.mode === 2 || q.mode === 6 ? q.p.words.slice(0, 8).join(' ') + '…' : q.mode === 4 ? q.p.stem : '“' + q.p.line + '” ___ ' + q.p.speaker)))),
        );
      })
      .catch((e) => body.replaceChildren(errorBox(e.message)));
    return wrap;
  }

  // ---------- progress ----------
  function progressView() {
    const me = S.me;
    const rk = me.rank;
    const pct = rk.next ? Math.round(((me.xp - rk.from) / (rk.next - rk.from)) * 100) : 100;
    const errs = Object.entries(me.ruleErrors || {}).map(([r, n]) => [+r, n]).sort((a, b) => b[1] - a[1]);
    const max = errs.length ? errs[0][1] : 1;
    return h('div', { class: 'wrap' },
      h('h1', null, 'My progress'),
      installPanel(),
      h('section', { class: 'panel' },
        h('div', { class: 'mehub' },
          h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'practice'; render(); } }, 'Redeliveries' + (me.wrong ? ' (' + me.wrong + ')' : '')),
          h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'rules'; render(); } }, 'Handbook'),
          h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'garage'; render(); } }, 'Garage')),
        h('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:10px;margin-top:12px' },
          h('input', { type: 'checkbox', checked: Sfx.enabled(), onchange: (e) => { Sfx.setEnabled(e.target.checked); savePrefs({ sound: e.target.checked }); const nb = soundButton(); const old = $('#soundbtn'); if (old) old.replaceWith(nb); } }),
          h('span', null, 'Sound effects'))),
      h('div', { class: 'statgrid' },
        h('div', { class: 'stat' }, h('b', null, me.xp), 'XP'),
        h('div', { class: 'stat' }, h('b', null, me.streak), me.streak === 1 ? 'day on the job' : 'days on the job'),
        h('div', { class: 'stat' }, h('b', null, me.level.level), 'level'),
        h('div', { class: 'stat' }, h('b', null, me.tips), 'tips earned'),
        h('div', { class: 'stat' }, h('b', null, me.routes), me.routes === 1 ? 'route finished' : 'routes finished'),
        h('div', { class: 'stat' }, h('b', null, Object.values(me.modes).reduce((n, m) => n + m.done, 0)), 'questions mastered'),
        h('div', { class: 'stat' }, h('b', null, me.verbs), 'saying verbs used'),
      ),
      h('section', { class: 'panel' },
        h('h2', null, rk.name),
        rk.next ? [h('div', { class: 'bar', role: 'img', 'aria-label': pct + '% of the way to ' + rk.nextName }, h('i', { style: 'width:' + pct + '%' })), h('p', { class: 'muted small', style: 'margin:8px 0 0' }, rk.next - me.xp + ' XP to ' + rk.nextName)] : h('p', { style: 'margin:0' }, 'Top rank reached!'),
      ),
      h('section', { class: 'panel' },
        h('h2', null, 'Districts'),
        h('div', { class: 'distlist' }, me.districts.filter((d) => !d.empty).map((d) => h('div', { class: 'drow' }, h('span', { class: 'grow' }, h('b', null, distInfo(d.n).name), h('span', { class: 'muted small' }, ' · ' + d.done + ' of ' + d.total)), d.cleared ? h('b', { class: 'okmark' }, 'Cleared') : !d.unlocked ? h('span', { class: 'muted small' }, 'Locked') : null, Art.starsRow(d.stars, 16)))),
      ),
      h('section', { class: 'panel' },
        h('h2', null, 'Rules to practise'),
        errs.length
          ? [h('p', { class: 'muted small' }, 'From your last 80 first tries. Longer bar = more slips.'), h('div', { class: 'rule-bars' }, errs.map(([r, n]) => h('div', { class: 'line r' + r }, h('div', null, ruleChip(r), h('div', { class: 'bar thin', style: 'margin-top:6px' }, h('i', { style: 'width:' + Math.max(6, Math.round((n / max) * 100)) + '%' }))), h('b', null, n))))]
          : h('p', { style: 'margin:0' }, 'No slips recorded yet. Play a round to find out which rules need practice.'),
      ),
    );
  }

  // ---------- Dash Express: town, depot, garage, routes ----------
  const Art = window.DashArt;
  const distInfo = (n) => (S.meta.districts || []).find((d) => d.n === n) || { n, name: 'District ' + n, blurb: '' };
  const ruleShort = (n) => (RULE_NAMES()[n] || { short: 'this rule' }).short;
  // The ride has its own XP amounts (set by the admin), separate from the rank.
  const vehicleOf = () => (S.me && S.me.vehicle) || { index: 0, id: 'foot', name: 'On foot', next: null };
  const fmtTime = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // The pupil's garage choices live in their own browser; what is unlocked comes from their XP and tips.
  const garageKey = () => 'dd_garage_' + (S.pupil ? S.pupil.id : 0);
  function garage() {
    let g = {};
    try {
      g = JSON.parse(store.get(garageKey()) || '{}');
    } catch {}
    if (S.me && S.me.prefs && S.me.prefs.garage) g = S.me.prefs.garage;
    const C = S.meta.cosmetics || { paints: [], helmets: [], stickers: [] };
    const xp = S.me ? S.me.xp : 0;
    const pick = (list, id) => (list.find((x) => x.id === id && x.at <= xp) || list[0] || { id: '', at: 0 });
    const paint = pick(C.paints, g.paint);
    const helmet = pick(C.helmets, g.helmet);
    const sticker = pick(C.stickers, g.sticker);
    return { paint: paint.color, paintId: paint.id, helmet: helmet.id, sticker: sticker.id };
  }
  const saveGarage = (patch) => {
    const cur = garage();
    const next = { paint: cur.paintId, helmet: cur.helmet, sticker: cur.sticker, ...patch };
    store.set(garageKey(), JSON.stringify(next));
    if (S.me) S.me.prefs = { ...(S.me.prefs || {}), garage: next };
    savePrefs({ garage: next });
  };
  const myRide = (size) => Art.vehicleSvg(vehicleOf().id, garage(), size);

  function dotSays(...kids) {
    return h('div', { class: 'dot' }, h('div', { class: 'dot-face' }, Art.dotSvg(54)), h('div', { class: 'dot-bubble' }, h('b', { class: 'dot-name' }, 'Dot'), kids));
  }

  // First visit: Dot explains the town in three short steps.
  function introDialog() {
    const key = 'dd_intro_' + S.pupil.id;
    if (store.get(key)) return null;
    const steps = [
      ['Welcome to Dash Express!', 'I’m Dot, the boss of the depot. In Chatterbury, everything people say travels as a word parcel, and you’re our newest courier.'],
      ['The Smudge strikes again', 'A rival firm called the Smudge keeps spilling ink on our parcels. Speech marks vanish, capitals shrink, and everybody just “said” things. Fix the message and the parcel is delivered.'],
      ['How a route works', 'Each route has five stops. Get a stop right first time to build a combo and earn bigger tips. Finish a district, beat its Big Delivery, and the next part of town opens.'],
    ];
    let i = 0;
    const dlg = h('dialog', { 'aria-label': 'Welcome', class: 'intro' });
    const draw = () => {
      const last = i === steps.length - 1;
      dlg.replaceChildren(
        dotSays(h('h2', { style: 'margin:4px 0 6px' }, steps[i][0]), h('p', { style: 'margin:0' }, steps[i][1])),
        h('div', { class: 'row', style: 'margin-top:14px' },
          h('span', { class: 'muted small grow' }, 'Step ' + (i + 1) + ' of ' + steps.length),
          h('button', { class: 'btn', type: 'button', onclick: () => { if (last) { store.set(key, '1'); dlg.close(); } else { i++; draw(); } } }, last ? 'Let’s go!' : 'Next'),
        ),
      );
    };
    draw();
    dlg.addEventListener('cancel', () => store.set(key, '1'));
    setTimeout(() => {
      try {
        dlg.showModal();
      } catch {}
    }, 60);
    return dlg;
  }

  // ----- town -----
  function townView() {
    const me = S.me;
    const rk = me.rank;
    const veh = vehicleOf();
    const lv = me.level;
    const pct = Math.max(0, Math.min(100, Math.round(((me.xp - lv.from) / (lv.next - lv.from)) * 100)));
    const nt = lv.nextTier;
    const firstOpen = (me.districts.find((d) => !d.cleared && !d.empty) || {}).n;
    const tipD = me.tip ? distInfo(me.tip.district) : null;
    return h('div', { class: 'wrap' },
      introDialog(),
      h('section', { class: 'panel hero townhero' },
        h('div', { class: 'ride' }, myRide(150)),
        h('div', { class: 'grow' },
          h('h1', null, 'Hi ' + (me.pupil.name.split(' ')[0] || 'there') + '!'),
          h('div', { class: 'row' },
            h('span', { class: 'chip lvl' }, 'Level ' + lv.level),
            h('span', { class: 'chip' }, rk.name),
            h('span', { class: 'chip' }, veh.name),
            h('span', { class: 'chip' }, me.streak ? plural(me.streak, 'day', 'days') + ' on the job' : 'Deliver today to start a streak'),
            me.tips ? h('span', { class: 'chip xp' }, me.tips + ' tips earned') : null,
          ),
          h('div', { class: 'bar', role: 'img', 'aria-label': pct + '% of the way to level ' + (lv.level + 1) }, h('i', { style: 'width:' + pct + '%' })),
          h('p', { class: 'muted small', style: 'margin:0' }, lv.next - me.xp + ' XP to level ' + (lv.level + 1) + (rk.next ? ' · ' + (rk.next - me.xp) + ' XP to ' + rk.nextName : '') + (veh.next ? ' · ' + (veh.next - me.xp) + ' XP to a new ride: the ' + veh.nextName.toLowerCase() : '') + (!rk.next && !veh.next ? ' · top rank, and the fastest ride in Chatterbury!' : '')),
          nt ? h('p', { class: 'small', style: 'margin:6px 0 0' }, h('b', null, 'Level ' + nt.level + ' opens '), nt.districts.map((n) => distInfo(n).name).join(', ') + '.') : null,
        ),
      ),
      me.pupil.guest ? h('div', { class: 'notice' }, 'You’re playing as a guest (' + me.pupil.name + '). Your teacher can give you a username and class code to save your progress with your class.') : null,
      tipD
        ? h('div', { class: 'panel dottip' }, dotSays(h('p', { style: 'margin:0 0 8px' }, 'You’ve slipped on ', h('b', null, ruleShort(me.tip.rule)), ' a few times lately. ', tipD.name, ' is the place to fix that.'), h('button', { class: 'btn small', type: 'button', onclick: () => startRoute({ kind: 'route', district: tipD.n }) }, 'Deliver in ' + tipD.name)))
        : !me.routes ? h('div', { class: 'panel dottip' }, dotSays(h('p', { style: 'margin:0' }, 'Start in ', h('b', null, distInfo(firstOpen || 1).name), '. Five stops, and you’re a courier!'))) : null,
      me.wrong ? h('div', { class: 'panel row', style: 'padding:12px 18px' }, h('span', { class: 'grow' }, h('b', null, plural(me.wrong, 'parcel', 'parcels')), ' came back undelivered.'), h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.view = 'practice'; render(); } }, 'Redeliveries')) : null,
      h('h2', { class: 'sect' }, 'Chatterbury'),
      h('div', { class: 'town' }, me.districts.map((d) => districtCard(d, firstOpen))),
      rushCard(),
    );
  }

  function districtCard(d, firstOpen) {
    const info = distInfo(d.n);
    const state = d.empty ? 'empty' : !d.unlocked ? 'locked' : d.cleared ? 'cleared' : 'open';
    const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
    return h('section', { class: 'panel dcard ' + state },
      h('div', { class: 'dtop' }, Art.buildingSvg(d.n, state === 'locked' ? 'locked' : 'open'), h('div', null, h('span', { class: 'tag' }, 'Rule ' + d.n), h('h3', null, info.name))),
      h('p', { class: 'small', style: 'margin:0' }, info.blurb),
      d.empty ? h('p', { class: 'muted small', style: 'margin:0' }, 'Coming soon. No parcels here yet.') : [
        h('div', { class: 'bar thin', role: 'img', 'aria-label': d.done + ' of ' + d.total + ' delivered' }, h('i', { style: 'width:' + pct + '%' })),
        h('div', { class: 'row small' }, h('span', { class: 'muted grow' }, d.done + ' of ' + d.total + ' delivered'), state === 'cleared' ? h('b', { class: 'okmark' }, 'Cleared') : null, Art.starsRow(d.stars, 16)),
      ],
      d.empty ? null : state === 'locked'
        ? h('button', { class: 'btn', type: 'button', disabled: true }, 'Locked')
        : h('div', { class: 'actions', style: 'margin-top:auto' },
            h('button', { class: 'btn', type: 'button', onclick: () => startRoute({ kind: 'route', district: d.n }) }, d.done ? 'Deliver' : 'Start'),
            d.bigReady ? h('button', { class: 'btn alt big', type: 'button', onclick: () => startRoute({ kind: 'big', district: d.n }) }, d.bigDone ? 'Big Delivery again' : 'Big Delivery') : null),
      state === 'locked' ? h('p', { class: 'small', style: 'margin:0' }, h('b', null, 'Reach level ' + d.needLevel + ' to open this district.')) : null,
      !d.empty && state === 'open' && !d.bigReady && d.total >= 4 ? h('p', { class: 'muted small', style: 'margin:0' }, 'Deliver ' + Math.max(0, Math.min(d.total, (S.meta.route || {}).bigAt || 8) - d.done) + ' more to unlock the Big Delivery.') : null,
    );
  }

  function rushCard() {
    const me = S.me;
    const open = me.rush && me.rush.open;
    return h('section', { class: 'panel rush' + (open ? '' : ' locked') },
      h('div', { class: 'grow' }, h('h3', { style: 'margin:0 0 4px' }, 'Rush Hour'), h('p', { class: 'small', style: 'margin:0' }, open ? 'A mixed route from every district you’ve opened. Keep your combo going!' : 'Clear ' + plural(Math.max(0, me.rush.at - me.cleared), 'more district', 'more districts') + ' to open Rush Hour.')),
      h('button', { class: 'btn', type: 'button', disabled: !open, onclick: () => startRoute({ kind: 'rush' }) }, open ? 'Start Rush Hour' : 'Locked'),
    );
  }

  // ----- depot: the six jobs, by kind of question -----
  function depotView() {
    const me = S.me;
    return h('div', { class: 'wrap' },
      h('h1', null, 'The depot'),
      h('p', { class: 'muted' }, 'Fancy one kind of job? Pick it here. Routes through the districts are on the Town map.'),
      h('div', { class: 'modes' }, [1, 2, 3, 4, 5, 6].map((m) => modeCard(m, me.modes[m] || { total: 0, done: 0 }))),
    );
  }

  // ----- garage -----
  function garageView() {
    const me = S.me;
    const C = S.meta.cosmetics;
    const g = garage();
    const rk = me.rank;
    const cur = vehicleOf();
    const swatch = (kind, item, selected) => {
      const open = item.at <= me.xp;
      const rainbow = item.color === 'rainbow';
      return h('button', {
        type: 'button', class: 'swatch' + (selected ? ' sel' : '') + (open ? '' : ' lock'), disabled: !open, 'aria-pressed': String(selected),
        'aria-label': item.name + (open ? '' : ', unlocks at ' + item.at + ' XP'),
        title: item.name + (open ? '' : ' (unlocks at ' + item.at + ' XP)'),
        onclick: () => { saveGarage({ [kind]: item.id }); render(); },
        style: kind === 'paint' ? 'background:' + (rainbow ? 'linear-gradient(90deg,#ff6b6b,#ff9f1c,#ffd23f,#3ecf8e,#4aa8ff,#8b5cf6)' : item.color) : '',
      }, kind === 'paint' ? null : h('span', null, item.name), open ? null : h('small', null, item.at + ' XP'));
    };
    return h('div', { class: 'wrap' },
      h('h1', null, 'The garage'),
      h('section', { class: 'panel garage-show' }, h('div', { class: 'ride big' }, myRide(260)), h('p', { class: 'muted small', style: 'margin:0' }, cur.name + ' · ' + rk.name)),
      h('section', { class: 'panel' },
        h('h2', null, 'Your rides'),
        h('p', { class: 'muted small' }, 'Earn XP and tips to move up to a faster ride.'),
        h('div', { class: 'ladder' }, me.rides.map((v, i) => {
          const got = i <= cur.index;
          return h('div', { class: 'rung' + (i === cur.index ? ' now' : '') + (got ? '' : ' lock') }, Art.vehicleSvg(v.id, got ? g : { paint: '#9aa1bd', helmet: 'none', sticker: 'none' }, 110), h('b', null, v.name), h('span', { class: 'small muted' }, i === cur.index ? 'Your ride' : got ? 'Unlocked' : v.xp + ' XP'));
        })),
      ),
      h('section', { class: 'panel' }, h('h2', null, 'Paint'), h('div', { class: 'swatches' }, C.paints.map((p) => swatch('paint', p, p.id === g.paintId)))),
      h('section', { class: 'panel' }, h('h2', null, 'Helmet'), h('div', { class: 'swatches' }, C.helmets.map((p) => swatch('helmet', p, p.id === g.helmet)))),
      h('section', { class: 'panel' }, h('h2', null, 'Sticker'), h('div', { class: 'swatches' }, C.stickers.map((p) => swatch('sticker', p, p.id === g.sticker)))),
    );
  }

  // ----- starting a route -----
  const orderPool = (x) => [...shuffle(x.filter((q) => q.status === 'new')), ...shuffle(x.filter((q) => q.status === 'wrong')), ...shuffle(x.filter((q) => q.status === 'done'))];

  async function startRoute({ kind, district = 0, mode = 0 }) {
    const back = S.view === 'play' ? 'home' : S.view;
    S.busy = 'Packing your parcels';
    render();
    try {
      const cfg = S.meta.route || { len: 5, big: 6, rush: 6 };
      let qs;
      if (kind === 'route' || kind === 'big') qs = (await api('/questions?district=' + district)).questions;
      else if (kind === 'mode') qs = (await api('/questions?mode=' + mode)).questions;
      else {
        const open = new Set(S.me.districts.filter((d) => d.unlocked && !d.empty).map((d) => d.n));
        qs = (await api('/questions')).questions.filter((q) => open.has(q.rule));
      }
      const len = kind === 'big' ? cfg.big : kind === 'rush' ? cfg.rush : cfg.len;
      let pool;
      if (kind === 'rush') {
        // one stop from each district in turn, so the route really is mixed
        const by = {};
        for (const q of orderPool(qs)) (by[q.rule] = by[q.rule] || []).push(q);
        const keys = shuffle(Object.keys(by));
        pool = [];
        for (let i = 0; keys.some((k) => by[k][i]); i++) for (const k of keys) if (by[k][i]) pool.push(by[k][i]);
      } else pool = kind === 'big' ? shuffle([...qs]) : orderPool(qs);
      pool = takeRound(pool, len);
      if (!pool.length) {
        S.busy = '';
        S.view = back;
        S.flash = 'There are no parcels here yet.';
        render();
        return;
      }
      S.busy = '';
      S.R = { kind, district, mode, list: pool, i: 0, practice: false, xp: 0, right: 0, results: [], combo: 0, bestCombo: 0, slips: 0, over: false, startedAt: Date.now(), t0: Date.now(), receipt: null, rankBefore: S.me.rank.index, vehicleBefore: S.me.vehicle.index, levelBefore: S.me.level.level, before: S.me.districts };
      S.view = 'play';
      render();
    } catch (e) {
      S.busy = '';
      S.view = back;
      S.flash = e.message;
      render();
    }
  }

  // ----- on the road -----
  function routeStrip() {
    const R = S.R;
    const cfg = S.meta.route || { patience: 3, parMs: 90000 };
    const n = R.list.length;
    const at = Math.min(R.i + (R.results[R.i] ? 1 : 0), n);
    const left = n > 1 ? (at / n) * 100 : 0;
    const big = R.kind === 'big';
    const clockOn = !!(S.me.settings && S.me.settings.clock) && !R.practice;
    const strip = h('div', { class: 'strip', id: 'strip' },
      h('div', { class: 'road', role: 'img', 'aria-label': 'Stop ' + Math.min(R.i + 1, n) + ' of ' + n },
        h('div', { class: 'rider', style: 'left:calc(' + left + '% * 0.86)' }, myRide(54)),
        R.list.map((_, i) => h('span', { class: 'stop ' + (R.results[i] || (i === R.i ? 'now' : '')) })),
      ),
      h('div', { class: 'row stripinfo' },
        R.combo >= 2 ? h('span', { class: 'combo' }, 'Combo ×' + Math.min(R.combo, 4)) : h('span', { class: 'muted small' }, big ? 'Big Delivery' : R.practice ? 'Redelivery' : 'Stop ' + Math.min(R.i + 1, n) + ' of ' + n),
        big ? h('span', { class: 'patience', role: 'img', 'aria-label': 'Customer patience: ' + Math.max(0, cfg.patience - R.slips) + ' of ' + cfg.patience }, Array.from({ length: cfg.patience }, (_, k) => Art.envelope(k < cfg.patience - R.slips))) : null,
        clockOn ? h('span', { class: 'clock grow', 'aria-hidden': 'true' }, h('span', { class: 'clockbar' }, h('i', { id: 'clockfill' })), h('small', { id: 'clocklabel' }, '')) : h('span', { class: 'grow' }),
      ),
    );
    return strip;
  }
  function tickClock() {
    clearInterval(S.clockTimer);
    const R = S.R;
    if (!R || R.practice || !$('#clockfill')) return;
    const par = ((S.meta.route || {}).parMs || 90000) * R.list.length;
    const tick = () => {
      const f = $('#clockfill');
      if (!f || !S.R) return clearInterval(S.clockTimer);
      const used = Date.now() - R.t0;
      f.style.width = Math.max(0, 100 - (used / par) * 100) + '%';
      const l = $('#clocklabel');
      if (l) l.textContent = used <= par ? 'Speed bonus ' + fmtTime(par - used) : 'No rush. Take your time.';
    };
    tick();
    S.clockTimer = setInterval(tick, 1000);
  }
  function refreshStrip() {
    const old = $('#strip');
    if (old) {
      old.replaceWith(routeStrip());
      tickClock();
    }
  }

  async function endRoute() {
    const R = S.R;
    if (R.practice) {
      R.i = R.list.length;
      try {
        await loadMe();
      } catch {}
      return render();
    }
    R.i = R.list.length;
    R.busy = true;
    render();
    try {
      const res = await api('/route', { method: 'POST', body: { kind: R.kind, district: R.district, mode: R.mode, qids: R.list.map((q) => q.id), startedAt: R.startedAt, ms: Date.now() - R.t0 } });
      R.receipt = res;
      applyTotals(res);
    } catch (e) {
      R.receiptError = e.message;
    }
    try {
      await loadMe();
    } catch {}
    R.busy = false;
    const up = S.me.level.level > (R.levelBefore || 0) || S.me.rank.index > (R.rankBefore || 0) || S.me.vehicle.index > (R.vehicleBefore || 0);
    const good = R.receipt && R.receipt.run && (R.receipt.run.passed || R.receipt.run.stars > 0);
    Sfx.play(up ? 'levelup' : good ? 'done' : 'slip');
    render();
  }

  // ----- the receipt -----
  function receiptView() {
    const R = S.R;
    if (R.busy) return h('div', { class: 'wrap' }, h('section', { class: 'panel' }, h('h1', null, 'Stamping your receipt…')));
    const run = R.receipt && R.receipt.run;
    const big = R.kind === 'big';
    const me = S.me;
    if (!run) {
      return h('div', { class: 'wrap' },
        h('section', { class: 'panel' },
          h('h1', null, 'Route finished'),
          h('p', { class: 'summary-big' }, R.right + ' / ' + R.list.length),
          h('div', { class: 'notice' }, 'Your answers are saved, but the receipt could not be stamped' + (R.receiptError ? ' (' + R.receiptError + ')' : '') + '. Tips for this route may be missing.'),
          h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => { S.view = 'home'; S.R = null; render(); } }, 'Back to town')),
        ),
      );
    }
    const title = big ? (run.passed ? 'Customer delighted!' : 'Customer not happy yet') : run.stars === 3 ? 'Perfect route!' : run.stars ? 'Route complete!' : 'Route finished';
    const line = big
      ? run.passed ? 'The Big Delivery is done. The Smudge didn’t stand a chance.' : 'That customer ran out of patience. Have another go when you’re ready.'
      : run.stars === 3 ? 'Every parcel delivered. Not a smudge in sight.' : run.stars ? 'Nice work, courier. A few parcels fought back, but you got them there.' : 'Rough road today. Try the same district again, one stop at a time.';
    const nowIds = new Set(me.districts.filter((d) => d.cleared && !d.empty).map((d) => d.n));
    const wasIds = new Set((R.before || []).filter((d) => d.cleared && !d.empty).map((d) => d.n));
    const newlyCleared = [...nowIds].filter((n) => !wasIds.has(n));
    const wasOpen = new Set((R.before || []).filter((d) => d.unlocked).map((d) => d.n));
    const newlyOpen = me.districts.filter((d) => d.unlocked && !d.empty && !wasOpen.has(d.n));
    const rankUp = me.rank.index > (R.rankBefore || 0);
    const rideUp = me.vehicle.index > (R.vehicleBefore || 0);
    const levelUp = me.level.level > (R.levelBefore || me.level.level);
    const costly = run.costlyRule;
    const home = (d) => me.districts.find((x) => x.n === d);
    const again = !big || run.passed ? 'Another route' : 'Try again';
    const dist = R.district ? home(R.district) : null;
    const canAgain = R.kind === 'mode' || R.kind === 'rush' || (dist && dist.unlocked);
    return h('div', { class: 'wrap' },
      h('section', { class: 'panel receipt' },
        h('div', { class: 'rhead' }, h('span', { class: 'tag' }, big ? distInfo(R.district).name + ' · Big Delivery' : R.kind === 'rush' ? 'Rush Hour' : R.kind === 'mode' ? 'Depot job' : distInfo(R.district).name), h('h1', null, title), big ? null : Art.starsRow(run.stars, 38)),
        dotSays(h('p', { style: 'margin:0' }, line)),
        h('div', { class: 'statgrid' },
          h('div', { class: 'stat' }, h('b', null, run.right + ' / ' + run.total), 'delivered'),
          h('div', { class: 'stat' }, h('b', null, run.first), 'first time'),
          h('div', { class: 'stat' }, h('b', null, run.bestCombo >= 2 ? '×' + Math.min(run.bestCombo, 4) : '—'), 'best combo'),
          h('div', { class: 'stat' }, h('b', null, fmtTime(run.ms)), run.fast ? 'speed bonus!' : 'on the road'),
        ),
        h('p', { class: 'tipsline' }, h('span', { class: 'xp-pop' }, '+' + run.bonus + ' tips'), R.xp ? h('span', { class: 'muted' }, ' on top of +' + R.xp + ' XP from your answers') : null),
        newlyCleared.length ? h('div', { class: 'banner good' }, h('b', null, 'District cleared! '), newlyCleared.map((n) => distInfo(n).name).join(', ') + '.') : null,
        newlyOpen.length ? h('div', { class: 'banner' }, h('b', null, 'New in town: '), newlyOpen.map((d) => distInfo(d.n).name).join(', ') + ' is now open.') : null,
        levelUp ? h('div', { class: 'banner good' }, h('b', null, 'Level up! '), 'You’re level ' + me.level.level + ' now.') : null,
        rankUp ? h('div', { class: 'banner good' }, h('b', null, 'New rank: ' + me.rank.name + '!')) : null,
        rideUp ? h('div', { class: 'banner good' }, h('b', null, 'New ride! '), 'You’ve got a ' + me.vehicle.name.toLowerCase() + ' now.', h('span', { class: 'ride' }, myRide(90))) : null,
        costly && run.right < run.total + 1 && (R.slips || run.first < run.total) ? h('p', { class: 'small' }, 'Costliest rule this route: ', ruleChip(costly), ' ', home(costly) && home(costly).unlocked && !home(costly).empty ? h('button', { class: 'btn small alt', type: 'button', onclick: () => startRoute({ kind: 'route', district: costly }) }, 'Practise in ' + distInfo(costly).name) : null) : null,
        h('div', { class: 'actions' },
          canAgain ? h('button', { class: 'btn', type: 'button', onclick: () => startRoute({ kind: R.kind, district: R.district, mode: R.mode }) }, again) : null,
          big && run.passed ? null : null,
          h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'home'; S.R = null; render(); } }, 'Back to town'),
          me.wrong ? h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'practice'; S.R = null; render(); } }, 'Redeliveries') : null,
        ),
      ),
    );
  }

  // ---------- render ----------
  function render() {
    clearInterval(S.clockTimer);
    const scrollY = window.scrollY || 0;
    root.replaceChildren();
    document.body.classList.toggle('has-bottomnav', !!(S.token && S.me));
    const playingNow = S.view === 'play' && !!S.R && S.R.i < S.R.list.length;
    document.body.classList.toggle('playing', playingNow);
    if (!S.token) {
      const av = authView();
      av.id = 'main';
      root.append(av);
      return;
    }
    if (!S.me) {
      // signed in but the pupil's details have not loaded: show a loading screen, or a retry if it failed
      root.append(h('div', { class: 'wrap', id: 'main', tabindex: '-1' }, S.bootError
        ? UI.errorPanel({ title: 'Can’t reach Dash Express', message: S.bootError, onRetry: boot, retryLabel: 'Try again' })
        : UI.skeleton(3, 'Loading your town')));
      if (S.bootError) root.firstChild.append(h('p', null, h('button', { class: 'btn ghost small', type: 'button', onclick: () => signOut('') }, 'Sign out')));
      return;
    }
    const flash = S.flash;
    S.flash = '';
    root.append(...header());
    let view;
    if (S.busy) view = h('div', { class: 'wrap' }, h('h1', { class: 'sr-only', 'data-focus': '' }, S.busy), UI.skeleton(2, S.busy));
    else if (S.view === 'play' && S.R) view = playView();
    else if (S.view === 'practice') view = practiceView();
    else if (S.view === 'depot') view = depotView();
    else if (S.view === 'garage') view = garageView();
    else if (S.view === 'rules') view = rulesView();
    else if (S.view === 'progress') view = progressView();
    else view = townView();
    view.id = 'main';
    view.setAttribute('tabindex', '-1');
    if (flash) {
      view.prepend(h('div', { class: 'notice', role: 'status' }, flash));
      UI.announce(flash);
    }
    root.append(view);
    if (!playingNow) root.append(bottomNav());
    if (S.view === 'play' && S.R && S.R.i < S.R.list.length && !S.busy) tickClock();
    // New screen or new question: back to the top and into the content. Same screen again (a swatch, a toggle): stay put.
    const key = S.view + ':' + (S.busy ? 'busy' : S.R ? S.R.i : '');
    if (key !== S.renderKey) {
      S.renderKey = key;
      window.scrollTo(0, 0);
      if (!S.busy) UI.focusMain(view);
    } else window.scrollTo(0, scrollY);
  }

  // ---------- boot ----------
  async function boot() {
    S.bootError = '';
    render();
    try {
      S.meta = await (await fetch('/api/meta')).json();
    } catch {
      S.meta = S.meta || { rules: {} };
    }
    if (S.token) {
      try {
        await loadMe();
      } catch (e) {
        // A real "please sign in again" has already signed the pupil out. Anything else (no signal, server hiccup)
        // keeps them signed in and offers a retry instead.
        if (S.token) S.bootError = e.message || 'Something went wrong.';
      }
    }
    render();
  }
  UI.watchOnline('You’re offline. Your answers can’t be saved until you’re back online.');
  trackKeyboard();
  boot();
  // Lets the app be installed and open offline. It never touches /api/ (see sw.js).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
