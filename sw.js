/* Fredagsfett · Service Worker — TOMBSTONE.
 *
 * The previous v1/v2 SW had a subtle bug: when its install handler tried to
 * pre-cache `/fredagsfett/{hem,kalender,sp1wise,karta,casino}`, the redirect
 * to the gateway (302 → login) caused fetch + cache.put to interact poorly.
 * The end result was a Service Worker stuck in a redundant state that
 * intercepted navigations and returned ERR_FAILED to the browser.
 *
 * This tombstone version exists only to clean up. On activate it:
 *   1. Deletes every cache the previous SW created
 *   2. Unregisters itself
 *   3. Reloads every open client tab so the cleaned-up state takes effect
 *
 * After every visitor's browser has hit this once, the SW is gone and the
 * site behaves as if there were never an SW. We can reintroduce caching
 * later from a proper baseline if/when needed.
 */

const TOMBSTONE_VERSION = 'ff-sw-tombstone-v1';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        // Force a hard reload so the now-unregistered SW stops intercepting.
        try { c.navigate(c.url); } catch {}
      }
    } catch {}
  })());
});

// While the tombstone is briefly active before unregistering, pass every
// request straight through to the network with no caching, no transforms.
// (Returning nothing here is equivalent to "let the browser handle it".)
self.addEventListener('fetch', () => {});
