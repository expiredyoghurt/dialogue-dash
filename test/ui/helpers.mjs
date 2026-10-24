// Runs the real pupil app and teacher console in jsdom, talking to the real Worker code over an in-memory D1.
// No browser needed. These check behaviour (what is on screen, what gets saved), not pixels.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../helpers/d1.mjs';
import worker from '../../src/index.js';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
export const SEEDS = ['questions-450.sql', 'seed-new-types.sql', 'seed-new-types-extra.sql'];
export const SECRETS = { teacher_user: 'admin', teacher_password: 'adminpw-123' };
export const sleep = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const pages = new Set();
// Closing the simulated windows stops the app's own timers (the delivery clock), so the test run can end.
export function closeAll() {
  for (const d of pages) {
    try {
      d.window.close();
    } catch {}
  }
  pages.clear();
}

export function makeWorld() {
  const { db, d1 } = makeDb({ seeds: SEEDS });
  const env = { DB: d1, ...SECRETS, ASSETS: { fetch: () => new Response('no', { status: 404 }) } };
  return { db, env };
}

// page: 'index.html' | 'teacher.html'
export function mount(world, page, { pre } = {}) {
  const scripts = page === 'index.html' ? ['ui.js', 'sfx.js', 'art.js', 'app.js'] : ['ui.js', 'teacher.js'];
  const html = readFileSync(PUBLIC + page, 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
  const dom = new JSDOM(html, { url: 'http://x/', runScripts: 'outside-only', pretendToBeVisual: true });
  pages.add(dom);
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new w.Event('close'));
  };
  w.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  const log = [];
  w.fetch = async (url, opts = {}) => {
    log.push({ url: String(url), method: opts.method || 'GET' });
    if (world.offline) throw new TypeError('Failed to fetch');
    return worker.fetch(new Request(new URL(url, 'http://x/'), { method: opts.method || 'GET', headers: opts.headers, body: opts.body }), world.env, { waitUntil() {} });
  };
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  if (pre) pre(w);
  for (const s of scripts) w.eval(readFileSync(PUBLIC + s, 'utf8'));
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => [...w.document.querySelectorAll(s)];
  const text = () => w.document.body.textContent.replace(/\s+/g, ' ');
  const btn = (label) => $$('button').find((b) => b.textContent.trim().startsWith(label));
  const exact = (label) => $$('button').find((b) => b.textContent.trim() === label);
  const until = async (f, label) => {
    for (let i = 0; i < 160; i++) {
      if (f()) return;
      await sleep(30);
    }
    throw new Error('timed out waiting for: ' + label + '\n' + text().slice(0, 600));
  };
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  // Answer a custom dialog: click its confirm button (or cancel).
  const dialog = async (label) => {
    await until(() => $('dialog.ddlg[open]'), 'a dialog');
    const d = $('dialog.ddlg[open]');
    if (label === false) {
      [...d.querySelectorAll('button')].find((b) => /cancel/i.test(b.textContent)).click();
    } else {
      [...d.querySelectorAll('button')].find((b) => (label ? b.textContent.trim() === label : b.type === 'submit')).click();
    }
    await sleep(20);
  };
  return { w, $, $$, text, btn, exact, until, type, dialog, errors, log, dom };
}

export async function adminToken(world) {
  const r = await worker.fetch(new Request('http://x/api/teacher/login', { method: 'POST', body: JSON.stringify({ username: SECRETS.teacher_user, password: SECRETS.teacher_password }) }), world.env, {});
  return (await r.json()).token;
}

// A small accessibility check for whatever is on screen: every control has a name, labels exist, ids are unique.
export function a11yProblems(page) {
  const out = [];
  const doc = page.w.document;
  const name = (el) => (el.getAttribute('aria-label') || '').trim() || (el.getAttribute('aria-labelledby') ? (doc.getElementById(el.getAttribute('aria-labelledby')) || {}).textContent : '') || (el.textContent || '').trim() || (el.getAttribute('title') || '').trim();
  const describe = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' "' + (el.textContent || el.value || '').trim().slice(0, 30) + '"';
  for (const el of doc.querySelectorAll('button, a[href], summary, [role=button]')) if (!name(el)) out.push('no name: ' + describe(el));
  for (const el of doc.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden') continue;
    const wrapped = el.closest('label');
    const forLabel = el.id ? doc.querySelector('label[for="' + el.id + '"]') : null;
    const ok = (el.getAttribute('aria-label') || '').trim() || el.getAttribute('aria-labelledby') || (wrapped && wrapped.textContent.trim()) || (forLabel && forLabel.textContent.trim());
    if (!ok) out.push('unlabelled field: ' + el.tagName.toLowerCase() + (el.name ? '[' + el.name + ']' : '') + (el.type ? ' type=' + el.type : ''));
  }
  const seen = new Set();
  for (const el of doc.querySelectorAll('[id]')) {
    if (seen.has(el.id)) out.push('duplicate id: ' + el.id);
    seen.add(el.id);
  }
  for (const el of doc.querySelectorAll('svg')) {
    if (!el.closest('[aria-hidden="true"]') && el.getAttribute('aria-hidden') !== 'true' && el.getAttribute('role') !== 'img' && !el.closest('button, a')) out.push('svg neither hidden nor labelled');
  }
  for (const el of doc.querySelectorAll('dialog[open]')) if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) out.push('dialog with no name');
  if (!doc.querySelector('main, [role=main], #main')) out.push('no main landmark');
  return out;
}
