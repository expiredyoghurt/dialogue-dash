// Dialogue Dash: Cloudflare Worker entry. Static pages come from /public; everything under /api runs here.

import { HttpError, json } from './util.js';
import { verifyToken, teacherConfigured } from './auth.js';
import * as pupil from './pupil.js';
import { teacherLogin, teacherRoute } from './teacher.js';

const bearer = (request) => {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};

async function route(request, env, url) {
  const path = url.pathname;
  const m = request.method;

  if (!env.DB) throw new HttpError(500, 'The database is not connected. Check the D1 binding.');

  if (path === '/api/meta' && m === 'GET') return pupil.meta();
  if (path === '/api/login' && m === 'POST') return pupil.login(request, env);
  if (path === '/api/guest' && m === 'POST') return pupil.guest(request, env);
  if (path === '/api/teacher/login' && m === 'POST') return teacherLogin(request, env);

  if (path.startsWith('/api/t/') || path === '/api/t') {
    if (!teacherConfigured(env)) throw new HttpError(503, 'Teacher sign-in is not set up yet.');
    const payload = await verifyToken(env, bearer(request));
    if (!payload || payload.r !== 't') throw new HttpError(401, 'Please sign in again.');
    const res = await teacherRoute(request, env, url);
    if (res) return res;
    throw new HttpError(404, 'Not found.');
  }

  // everything else needs a pupil (or guest)
  if (!teacherConfigured(env)) throw new HttpError(503, 'This app is not set up yet. Ask your teacher.');
  const payload = await verifyToken(env, bearer(request));
  const p = await pupil.authPupil(env, payload);
  if (!p) throw new HttpError(401, 'Please sign in again.');

  if (path === '/api/me' && m === 'GET') return pupil.me(env, p);
  if (path === '/api/questions' && m === 'GET') return pupil.listQuestions(env, p, url);
  if (path === '/api/answer' && m === 'POST') return pupil.answer(request, env, p);
  throw new HttpError(404, 'Not found.');
}

async function purgeGuests(env) {
  const days = parseInt(env.GUEST_RETENTION_DAYS || '30', 10);
  const cutoff = Date.now() - days * 86_400_000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE pupil_id IN (SELECT id FROM pupils WHERE is_guest = 1 AND created_at < ?1)').bind(cutoff),
    env.DB.prepare('DELETE FROM pupils WHERE is_guest = 1 AND created_at < ?1').bind(cutoff),
  ]);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('API error', e?.stack || e);
      return json({ error: 'Something went wrong on the server. Please try again.' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(purgeGuests(env));
  },
};
