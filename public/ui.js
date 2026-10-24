/* Dash Express shared UI toolkit, used by the pupil app and the teacher console.
   Dialogs, toasts, screen-reader announcements, loading skeletons and error panels.
   Plain JS. Text from the server is only ever inserted with textContent. */
(() => {
  'use strict';

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  // ---------- screen-reader announcements ----------
  let live = null;
  function announce(message) {
    if (!live || !live.isConnected) {
      live = el('div', { id: 'dd-live', class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
      document.body.append(live);
    }
    live.textContent = '';
    // a short delay makes screen readers announce repeated messages too
    setTimeout(() => {
      if (live) live.textContent = String(message || '');
    }, 30);
  }

  // ---------- toasts ----------
  let tray = null;
  // kind: 'ok' | 'error' | 'info'. action: { label, onClick } (for example "Undo").
  function toast(message, { kind = 'info', ms, action } = {}) {
    if (!tray || !tray.isConnected) {
      tray = el('div', { class: 'toasts', 'aria-label': 'Notifications' });
      document.body.append(tray);
    }
    const bad = kind === 'error';
    const wait = ms == null ? (bad ? 9000 : action ? 8000 : 4500) : ms;
    let timer = null;
    const t = el('div', { class: 'toast ' + kind, role: bad ? 'alert' : 'status' },
      el('span', { class: 'toast-msg' }, message),
      action ? el('button', { class: 'btn small alt', type: 'button', onclick: () => { close(); action.onClick(); } }, action.label) : null,
      el('button', { class: 'toast-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => close() }, '×'),
    );
    function close() {
      clearTimeout(timer);
      t.remove();
    }
    tray.append(t);
    while (tray.children.length > 4) tray.firstChild.remove();
    if (wait > 0) timer = setTimeout(close, wait);
    return { close };
  }

  // ---------- dialogs ----------
  // ask({ title, body, confirmLabel, cancelLabel, danger, fields, typeToConfirm })
  //   body            text (new lines make paragraphs)
  //   fields          [{ key, label, value, placeholder, maxlength }] text boxes
  //   typeToConfirm   a string the person must type before the button works (for deleting things)
  // resolves { ok: boolean, values: { key: text } }
  function ask(opts) {
    const o = typeof opts === 'string' ? { body: opts } : opts || {};
    return new Promise((resolve) => {
      const opener = document.activeElement;
      const uid = 'ddlg' + Math.random().toString(36).slice(2, 8);
      const inputs = [];
      const fields = (o.fields || []).map((f) => {
        const input = el('input', { type: 'text', value: f.value == null ? '' : String(f.value), placeholder: f.placeholder || '', maxlength: f.maxlength ? String(f.maxlength) : null, autocomplete: 'off', autocapitalize: 'none', 'aria-label': f.label });
        inputs.push([f.key, input]);
        return el('label', { class: 'field' }, el('span', null, f.label), input);
      });
      let typed = null;
      if (o.typeToConfirm) {
        typed = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', 'aria-label': 'Type ' + o.typeToConfirm + ' to confirm' });
        fields.push(el('label', { class: 'field' }, el('span', null, 'Type ', el('b', null, o.typeToConfirm), ' to confirm'), typed));
      }
      const go = el('button', { class: 'btn' + (o.danger ? ' danger' : ''), type: 'submit' }, o.confirmLabel || 'OK');
      const no = o.cancelLabel === null ? null : el('button', { class: 'btn alt', type: 'button', onclick: () => finish(false) }, o.cancelLabel || 'Cancel');
      const sync = () => {
        go.disabled = !!(typed && typed.value.trim().toLowerCase() !== String(o.typeToConfirm).trim().toLowerCase());
      };
      if (typed) typed.addEventListener('input', sync);
      const form = el('form', { class: 'ddlg-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); if (!go.disabled) finish(true); } },
        o.title ? el('h2', { id: uid + 't', class: 'ddlg-title' }, o.title) : null,
        o.body ? el('div', { class: 'ddlg-body', id: uid + 'b' }, String(o.body).split('\n').map((line) => el('p', null, line))) : null,
        fields,
        el('div', { class: 'ddlg-actions' }, no, go),
      );
      const dlg = el('dialog', { class: 'ddlg' + (o.danger ? ' danger' : ''), 'aria-labelledby': o.title ? uid + 't' : null, 'aria-describedby': o.body ? uid + 'b' : null, 'aria-label': o.title ? null : 'Confirm' }, form);
      let done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        const values = {};
        for (const [k, i] of inputs) values[k] = i.value;
        try {
          dlg.close();
        } catch {}
        dlg.remove();
        if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
        resolve({ ok, values });
      }
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        finish(false);
      });
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) finish(false); // a click on the backdrop
      });
      document.body.append(dlg);
      sync();
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute('open', '');
      }
      // Safe default: for a risky action the cursor starts on Cancel, otherwise on the first box or the button.
      const first = inputs[0] ? inputs[0][1] : typed || (o.danger && no ? no : go);
      first.focus({ preventScroll: true });
      if (first.select && first.tagName === 'INPUT') first.select();
    });
  }
  const confirm = async (opts) => (await ask(opts)).ok;
  // One text box. Resolves the text, or null if cancelled.
  async function prompt(opts) {
    const o = typeof opts === 'string' ? { title: opts } : opts;
    const r = await ask({ ...o, fields: [{ key: 'v', label: o.label || o.title || 'Value', value: o.value, placeholder: o.placeholder, maxlength: o.maxlength }] });
    return r.ok ? r.values.v : null;
  }

  // ---------- loading and error states ----------
  function skeleton(blocks = 3, label = 'Loading') {
    const wrap = el('div', { class: 'skel-wrap', role: 'status', 'aria-label': label });
    for (let i = 0; i < blocks; i++) wrap.append(el('div', { class: 'panel skel', 'aria-hidden': 'true' }, el('i', { class: 'skel-line w60' }), el('i', { class: 'skel-line' }), el('i', { class: 'skel-line w80' })));
    wrap.append(el('span', { class: 'sr-only' }, label + '…'));
    return wrap;
  }
  function errorPanel({ title = 'That didn’t work', message = '', onRetry, retryLabel = 'Try again' } = {}) {
    return el('section', { class: 'panel errpanel', role: 'alert' },
      el('h2', { style: 'margin-top:0' }, title),
      el('p', null, message),
      onRetry ? el('button', { class: 'btn', type: 'button', onclick: onRetry }, retryLabel) : null,
    );
  }

  // Move keyboard and screen-reader focus to the top of new content (without scrolling the page).
  function focusMain(root) {
    const t = root && (root.querySelector('[data-focus]') || root.querySelector('h1, h2') || root);
    if (!t) return;
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  }

  // "You're offline" banner, shown while the browser says there is no connection.
  function watchOnline(message) {
    let bar = null;
    const show = () => {
      if (bar && bar.isConnected) return;
      bar = el('div', { class: 'offline-banner', role: 'status' }, message || 'You’re offline. Reconnect to keep your progress.');
      document.body.prepend(bar);
    };
    const hide = () => {
      if (bar) bar.remove();
      bar = null;
    };
    window.addEventListener('offline', show);
    window.addEventListener('online', hide);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) show();
  }

  window.DashUI = { ask, confirm, prompt, toast, announce, skeleton, errorPanel, focusMain, watchOnline };
})();
