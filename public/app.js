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
        h('div', { class: 'brand', style: 'margin:0 0 18px' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Dialogue Dash'),
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

  // ---------- chrome ----------
  function header() {
    const me = S.me;
    return [
      h('header', { class: 'topbar' },
        h('div', { class: 'brand' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Dialogue Dash'),
        me ? h('span', { class: 'chip', id: 'rankchip' }, me.rank.name) : null,
        me ? h('span', { class: 'chip xp', id: 'xpchip', 'aria-label': me.xp + ' experience points' }, me.xp + ' XP') : null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => signOut('') }, 'Sign out'),
      ),
      h('nav', { class: 'tabs', 'aria-label': 'Sections' },
        tab('home', 'Play'),
        tab('practice', 'More practice', me && me.wrong ? me.wrong : 0),
        tab('rules', 'Rules'),
        tab('progress', 'My progress'),
      ),
    ];
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
      updateChips();
    }
  }

  // ---------- data ----------
  async function loadMe() {
    S.me = await api('/me');
    S.pupil = S.me.pupil;
  }

  // ---------- home ----------
  const MODES = {
    1: {
      title: 'Rewrite it',
      text: 'Add speech marks, capital letters and punctuation to the sentence.',
      demo: [h('div', { class: 'muted' }, 'Raj said I want to be a doctor'), h('div', null, mark('Raj said, “I want to be a doctor.”'))],
    },
    2: {
      title: 'Spot the error',
      text: 'Tap every mistake in the dialogue, then type the fix.',
      demo: [h('div', { class: 'muted' }, '“lets go to the library said Chen.'), h('div', null, mark('“Let’s go to the library,” said Chen.'))],
    },
    3: {
      title: 'Upgrade the tag',
      text: 'Swap said for a verb that shows how the speaker feels.',
      demo: [h('div', { class: 'muted' }, '“I can’t find my homework,” said Mei.'), h('div', null, mark('“I can’t find my homework,” '), h('span', { class: 'verb' }, 'stammered'), ' Mei.')],
    },
  };

  function homeView() {
    const me = S.me;
    const rk = me.rank;
    const pct = rk.next ? Math.round(((me.xp - rk.from) / (rk.next - rk.from)) * 100) : 100;
    return h('div', { class: 'wrap' },
      h('section', { class: 'panel hero' },
        h('h1', null, 'Hi ' + (me.pupil.name.split(' ')[0] || 'there') + '!'),
        h('div', { class: 'row' },
          h('span', { class: 'chip' }, rk.name),
          h('span', { class: 'chip' }, me.streak ? me.streak + (me.streak === 1 ? ' day' : ' days') + ' in a row' : 'Play today to start a streak'),
          me.todayXp ? h('span', { class: 'chip xp' }, '+' + me.todayXp + ' XP today') : null,
        ),
        rk.next
          ? [h('div', { class: 'bar', role: 'img', 'aria-label': pct + '% of the way to ' + rk.nextName }, h('i', { style: 'width:' + pct + '%' })), h('p', { class: 'muted small', style: 'margin:0' }, rk.next - me.xp + ' XP to ' + rk.nextName)]
          : h('p', { style: 'margin:0' }, 'You’ve reached the top rank!'),
      ),
      me.pupil.guest ? h('div', { class: 'notice' }, 'You’re playing as a guest (' + me.pupil.name + '). Your teacher can give you a username and class code to save your progress with your class.') : null,
      me.wrong ? h('div', { class: 'panel row', style: 'padding:12px 18px' }, h('span', { class: 'grow' }, h('b', null, me.wrong + (me.wrong === 1 ? ' question' : ' questions')), ' to try again.'), h('button', { class: 'btn small', type: 'button', onclick: () => { S.view = 'practice'; render(); } }, 'More practice')) : null,
      h('div', { class: 'modes' }, [1, 2, 3].map((m) => modeCard(m, me.modes[m]))),
    );
  }
  function modeCard(m, st) {
    const info = MODES[m];
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    const allDone = st.total && st.done >= st.total;
    return h('section', { class: 'panel mode-card' },
      h('span', { class: 'tag' }, 'Mode ' + m),
      h('h2', null, info.title),
      h('p', { style: 'margin:0' }, info.text),
      h('div', { class: 'demo', 'aria-hidden': 'true' }, info.demo),
      h('div', { class: 'bar thin', role: 'img', 'aria-label': st.done + ' of ' + st.total + ' done' }, h('i', { style: 'width:' + pct + '%' })),
      h('span', { class: 'small muted' }, st.total ? st.done + ' of ' + st.total + ' done' : 'No questions yet'),
      h('button', { class: 'btn', type: 'button', disabled: !st.total, onclick: () => startRound(m, false) }, allDone ? 'Play again' : st.done ? 'Keep going' : 'Start'),
    );
  }

  // ---------- rounds ----------
  async function startRound(mode, practice) {
    try {
      const data = await api('/questions?' + (practice ? 'practice=1' : 'mode=' + mode));
      const qs = data.questions;
      let pool;
      if (practice) pool = shuffle([...qs]);
      else pool = [...shuffle(qs.filter((q) => q.status === 'new')), ...shuffle(qs.filter((q) => q.status === 'wrong')), ...shuffle(qs.filter((q) => q.status === 'done'))];
      pool = pool.slice(0, practice ? 8 : 5);
      if (!pool.length) {
        S.flash = 'There are no questions here yet.';
        render();
        return;
      }
      S.R = { list: pool, i: 0, practice, mode, xp: 0, right: 0, results: [] };
      S.view = 'play';
      render();
    } catch (e) {
      S.flash = e.message;
      render();
    }
  }

  function finishQuestion(correct, xp) {
    const R = S.R;
    R.results[R.i] = correct ? 'done' : 'bad';
    if (correct) R.right++;
    R.xp += xp || 0;
  }
  function nextBtn() {
    const R = S.R;
    const last = R.i >= R.list.length - 1;
    return h('button', { class: 'btn', type: 'button', onclick: async () => {
      R.i++;
      if (last) {
        try {
          await loadMe();
        } catch {}
      }
      render();
    } }, last ? 'Finish round' : 'Next question');
  }

  function playView() {
    const R = S.R;
    if (R.i >= R.list.length) return summaryView();
    const q = R.list[R.i];
    const rulesDlg = rulesDialog();
    const stage = q.mode === 1 ? qMode1(q) : q.mode === 2 ? qMode2(q) : qMode3(q);
    return h('div', { class: 'wrap' },
      h('div', { class: 'stagebar' },
        h('div', { class: 'pips', role: 'img', 'aria-label': 'Question ' + (R.i + 1) + ' of ' + R.list.length }, R.list.map((_, i) => h('i', { class: i < R.i ? R.results[i] || 'done' : i === R.i ? 'now' : '' }))),
        h('button', { class: 'btn small alt', type: 'button', onclick: () => rulesDlg.showModal() }, 'Rules'),
        h('button', { class: 'btn small alt', type: 'button', onclick: async () => { S.view = 'home'; S.R = null; try { await loadMe(); } catch {} render(); } }, 'Quit'),
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
        missed ? h('p', null, 'The ' + (missed === 1 ? 'one' : missed) + ' you missed ' + (missed === 1 ? 'is' : 'are') + ' saved in ', h('b', null, 'More practice'), '.') : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => startRound(R.mode, R.practice) }, R.practice ? 'Practise more' : 'Play again'),
          missed ? h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'practice'; S.R = null; render(); } }, 'Try the missed ones') : null,
          h('button', { class: 'btn alt', type: 'button', onclick: () => { S.view = 'home'; S.R = null; render(); } }, 'Home'),
        ),
      ),
    );
  }

  // ---------- Mode 1: rewrite ----------
  function qMode1(q) {
    let tryNo = 1;
    const bubble = h('div', { class: 'bubble' }, q.p.prompt);
    const ta = h('textarea', { class: 'answer', rows: '2', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Your answer', placeholder: 'Type the sentence with speech marks and punctuation' });
    const fb = h('div', { 'aria-live': 'polite' });
    const check = h('button', { class: 'btn', type: 'button' }, 'Check');
    const show = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Show me the answer');
    const keys = h('div', { class: 'keys', role: 'group', 'aria-label': 'Punctuation keys' },
      [['“', 'open speech marks'], ['”', 'close speech marks'], [',', 'comma'], ['.', 'full stop'], ['?', 'question mark'], ['!', 'exclamation mark'], ['’', 'apostrophe']].map(([c, name]) =>
        h('button', { type: 'button', 'aria-label': name, onclick: () => { ta.setRangeText(c, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); } }, c)),
    );

    const lock = () => {
      ta.disabled = true;
      check.hidden = true;
      show.hidden = true;
      keys.hidden = true;
    };
    function showAnswer(text, good) {
      bubble.className = 'bubble' + (good ? ' good' : '');
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
          fb.replaceChildren(h('div', { class: 'result good' }, h('h3', null, tryNo === 1 ? 'Correct! First try.' : 'Correct!'), xpPop(r.xp), r.note === 'single' ? h('p', { class: 'small', style: 'margin:8px 0 0' }, 'Tip: single speech marks are fine in many books, but in this game use double ones: “ ”.') : null), h('div', { class: 'actions' }, nextBtn()));
        } else if (r.final) {
          finishQuestion(false, 0);
          lock();
          showAnswer(r.reveal, false);
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Here’s the answer'), h('p', { style: 'margin:0' }, 'Compare it with yours. This one is saved in More practice so you can try it again.'), r.errors && r.errors.length ? errorList(r.errors) : null), h('div', { class: 'actions' }, nextBtn()));
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
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        check.click();
      }
    });
    setTimeout(() => ta.focus(), 30);
    return h('div', null,
      h('p', { class: 'instruction' }, 'Rewrite the sentence with the correct speech marks and punctuation.'),
      bubble,
      ta,
      keys,
      h('div', { class: 'actions' }, check, show),
      fb,
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
          fb.replaceChildren(h('div', { class: 'result bad' }, h('h3', null, 'Some verbs that would work'), h('p', { style: 'margin:0' }, 'This one is saved in More practice so you can try it again.'), ideas(r.more)), h('div', { class: 'actions' }, nextBtn()));
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

  // ---------- rules ----------
  function ruleCards(compact) {
    const rules = RULE_NAMES();
    return [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const r = rules[n];
      if (!r) return null;
      return h('section', { class: 'panel rule-card r' + n, style: compact ? 'box-shadow:none;margin-bottom:12px;padding:12px' : '' },
        h('div', { class: 'num', 'aria-hidden': 'true' }, n),
        h('h3', null, 'Rule ' + n + ': ' + r.title),
        h('p', { class: 'muted small', style: 'margin:0' }, r.tip),
        r.good ? h('div', { class: 'good' }, mark(r.good)) : null,
      );
    });
  }
  function rulesDialog() {
    const dlg = h('dialog', { 'aria-label': 'The rules' },
      h('div', { class: 'row', style: 'margin-bottom:10px' }, h('h2', { class: 'grow', style: 'margin:0' }, 'The rules'), h('button', { class: 'btn small', type: 'button', onclick: () => dlg.close() }, 'Close')),
      ruleCards(true),
    );
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    return dlg;
  }
  function rulesView() {
    return h('div', { class: 'wrap' }, h('h1', null, 'The rules'), h('p', { class: 'muted' }, 'Coloured marks show the speech marks and punctuation.'), ruleCards(false));
  }

  // ---------- practice ----------
  function practiceView() {
    const wrap = h('div', { class: 'wrap' }, h('h1', null, 'More practice'), h('p', { class: 'muted' }, 'Questions you got wrong, ready to try again. Get one right and it leaves this list.'));
    const body = h('div', null, h('p', null, 'Loading…'));
    wrap.append(body);
    api('/questions?practice=1')
      .then((d) => {
        S.practiceCount = d.questions.length;
        if (!d.questions.length) {
          body.replaceChildren(h('section', { class: 'panel' }, h('h2', null, 'Nothing to practise'), h('p', { style: 'margin:0' }, 'You haven’t got any questions to retry. Play a round and any you miss will appear here.'), h('div', { class: 'actions', style: 'margin-top:14px' }, h('button', { class: 'btn', type: 'button', onclick: () => { S.view = 'home'; render(); } }, 'Go and play'))));
          return;
        }
        const by = { 1: [], 2: [], 3: [] };
        for (const q of d.questions) by[q.mode].push(q);
        body.replaceChildren(
          h('section', { class: 'panel' },
            h('h2', null, d.questions.length + (d.questions.length === 1 ? ' question to retry' : ' questions to retry')),
            h('ul', { style: 'padding-left:20px;margin:0 0 14px' }, [1, 2, 3].filter((m) => by[m].length).map((m) => h('li', null, MODES[m].title + ': ' + by[m].length))),
            h('button', { class: 'btn', type: 'button', onclick: () => startRound(null, true) }, 'Start practice'),
          ),
          h('section', { class: 'panel flat' }, h('h3', null, 'Coming up'), h('ul', { style: 'padding-left:20px;margin:0' }, d.questions.slice(0, 8).map((q) => h('li', null, q.mode === 1 ? q.p.prompt : q.mode === 2 ? q.p.words.slice(0, 8).join(' ') + '…' : '“' + q.p.line + '” ___ ' + q.p.speaker)))),
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
      h('div', { class: 'statgrid' },
        h('div', { class: 'stat' }, h('b', null, me.xp), 'XP'),
        h('div', { class: 'stat' }, h('b', null, me.streak), me.streak === 1 ? 'day in a row' : 'days in a row'),
        h('div', { class: 'stat' }, h('b', null, me.modes[1].done + me.modes[2].done + me.modes[3].done), 'questions mastered'),
        h('div', { class: 'stat' }, h('b', null, me.verbs), 'saying verbs used'),
      ),
      h('section', { class: 'panel' },
        h('h2', null, rk.name),
        rk.next ? [h('div', { class: 'bar', role: 'img', 'aria-label': pct + '% of the way to ' + rk.nextName }, h('i', { style: 'width:' + pct + '%' })), h('p', { class: 'muted small', style: 'margin:8px 0 0' }, rk.next - me.xp + ' XP to ' + rk.nextName)] : h('p', { style: 'margin:0' }, 'Top rank reached!'),
      ),
      h('section', { class: 'panel' },
        h('h2', null, 'Rules to practise'),
        errs.length
          ? [h('p', { class: 'muted small' }, 'From your last 80 first tries. Longer bar = more slips.'), h('div', { class: 'rule-bars' }, errs.map(([r, n]) => h('div', { class: 'line r' + r }, h('div', null, ruleChip(r), h('div', { class: 'bar thin', style: 'margin-top:6px' }, h('i', { style: 'width:' + Math.max(6, Math.round((n / max) * 100)) + '%' }))), h('b', null, n))))]
          : h('p', { style: 'margin:0' }, 'No slips recorded yet. Play a round to find out which rules need practice.'),
      ),
    );
  }

  // ---------- render ----------
  function render() {
    root.replaceChildren();
    if (!S.token || !S.me) {
      root.append(authView());
      return;
    }
    const flash = S.flash;
    S.flash = '';
    root.append(...header());
    let view;
    if (S.view === 'play' && S.R) view = playView();
    else if (S.view === 'practice') view = practiceView();
    else if (S.view === 'rules') view = rulesView();
    else if (S.view === 'progress') view = progressView();
    else view = homeView();
    if (flash) view.prepend(h('div', { class: 'notice', role: 'status' }, flash));
    root.append(view);
    window.scrollTo(0, 0);
  }

  // ---------- boot ----------
  (async () => {
    try {
      S.meta = await (await fetch('/api/meta')).json();
    } catch {
      S.meta = { rules: {} };
    }
    if (S.token) {
      try {
        await loadMe();
      } catch {
        S.token = null;
      }
    }
    render();
  })();
})();
