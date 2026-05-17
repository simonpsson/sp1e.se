/* Fredagsfett · Service Worker — QoL #35.
 *
 * Offline read-only access to the calendar + locked events. Strategy:
 *   - Static shell (HTML + CSS + JS) cached on install via cache-first.
 *   - GET API calls to /api/fredagsfett/{availability,events,sp1wise,activity,chat}
 *     are served stale-while-revalidate: cached copy returned instantly, fresh
 *     copy fetched in the background and stored for next time.
 *   - Everything else falls through to network with a cache-fallback.
 *
 * Mutation requests (POST/PATCH/DELETE) always go straight to the network and
 * are NOT cached or replayed — we don't want to silently re-send an expense
 * delete when the user reconnects after closing their laptop for a week.
 */

const VERSION = 'ff-sw-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE   = `${VERSION}-api`;

const SHELL_PATHS = [
  '/fredagsfett/hem',
  '/fredagsfett/kalender',
  '/fredagsfett/sp1wise',
  '/fredagsfett/karta',
  '/fredagsfett/style.css',
  '/fredagsfett/light-ui.css',
  '/fredagsfett/theme.js',
  '/favicon.svg',
  '/apple-touch-icon.svg',
  '/site.webmanifest',
];

// Whitelist of API GET endpoints worth caching (read-only views).
const API_PATTERNS = [
  /^\/api\/fredagsfett\/availability(\?|$)/,
  /^\/api\/fredagsfett\/events(\?|$)/,
  /^\/api\/fredagsfett\/sp1wise(\?|$)/,
  /^\/api\/fredagsfett\/activity(\?|$)/,
  /^\/api\/fredagsfett\/chat(\?|$)/,
  /^\/api\/fredagsfett\/routes(\?|$)/,
  /^\/api\/fredagsfett\/news(\?|$)/,
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // Use fetch + put so a single 404 doesn't kill the whole install
      Promise.all(SHELL_PATHS.map(p =>
        fetch(p, { credentials: 'same-origin' })
          .then(r => r.ok ? cache.put(p, r) : null)
          .catch(() => null)
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => !n.startsWith(VERSION)).map(n => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

function isCacheableApi(url) {
  return API_PATTERNS.some(re => re.test(url.pathname + url.search));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache POST/PATCH/DELETE
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignore CDN font requests etc.

  // Shell: cache-first
  if (SHELL_PATHS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) caches.open(SHELL_CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req)))
    );
    return;
  }

  // API: stale-while-revalidate
  if (isCacheableApi(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req, { credentials: 'same-origin' }).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || network || new Response('{"error":"offline"}', {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    })());
    return;
  }
});

// Manual cache purge hook from the client (e.g. on logout).
self.addEventListener('message', event => {
  if (event.data === 'ff-sw-clear') {
    caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
  }
});
