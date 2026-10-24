/* Dash Express service worker: lets the pupil app be installed and open without a connection.
   It never touches /api/ (answers, sign-in and progress always go to the server), never caches the
   teacher console, and prefers the network so a new version shows up straight away when online. */
const VERSION = '1.7.0';
const CACHE = 'dash-express-' + VERSION;
const SHELL = ['/', '/app.css', '/app.js', '/ui.js', '/sfx.js', '/art.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon.svg'];
const NETWORK_WAIT_MS = 4000; // on slow school wifi, fall back to the saved copy after this long

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('dash-express-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function shouldHandle(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p.startsWith('/api/') || p === '/sw.js') return false;
  if (p.startsWith('/teacher')) return false; // the teacher console always loads fresh
  return true;
}

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('slow network')), NETWORK_WAIT_MS);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function respond(request) {
  try {
    const res = await fromNetwork(request);
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
    }
    return res;
  } catch {
    const hit = await caches.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const home = await caches.match('/');
      if (home) return home;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (!shouldHandle(event.request)) return;
  event.respondWith(respond(event.request));
});
