export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function readJson(request) {
  try {
    const text = await request.text();
    if (text.length > 400_000) throw new HttpError(413, 'That request is too large.');
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'The request was not valid JSON.');
  }
}

export const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'local';

export async function rateLimited(env, binding, key) {
  const rl = env[binding];
  if (!rl) return false;
  try {
    const { success } = await rl.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

export const clip = (s, n) => String(s ?? '').slice(0, n);
export const int = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// Usernames: lowercase letters, digits, dot, dash, underscore; spaces ignored.
export const cleanUser = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 24);
export const validUser = (u) => /^[a-z0-9][a-z0-9._-]{1,23}$/.test(u);

export function suggestUsername(name, taken) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const ascii = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  let base = ascii(parts[0] || '');
  if (base) base += parts.slice(1).map((p) => ascii(p)[0] || '').join('');
  if (base.length < 2) base = 'pupil';
  base = base.slice(0, 20);
  let u = base;
  let n = 2;
  while (taken.has(u)) u = base + n++;
  return u;
}
