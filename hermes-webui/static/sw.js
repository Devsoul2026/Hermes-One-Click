/**
 * Hermes WebUI Service Worker
 *
 * The desktop window launcher and the active development workflow rely on
 * the latest static assets being served on every reload.  An older cache-
 * first service worker shipped earlier kept stale `sessions.js` / `boot.js`
 * files in browser caches even after the server received an update, which
 * made fixes look like they "did not deploy".
 *
 * To guarantee freshness in the packaged EXE flow we now:
 *   1. unregister this service worker on activation, and
 *   2. delete every cache it ever created.
 *
 * The script remains in place so previously registered installs can still
 * load it and self-terminate.  Once unregistered the browser falls back to
 * the network for every static asset, which is exactly what we want for a
 * desktop shell that always runs against a local HTTP server.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_err) {
      // Cache deletion is best-effort; carry on.
    }
    try {
      await self.registration.unregister();
    } catch (_err) {
      // If unregister fails, a future reload will retry.
    }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    } catch (_err) {
      // Reloading open windows is best-effort.
    }
  })());
});

self.addEventListener('fetch', () => {
  // Always defer to the network. Once unregister completes this listener
  // is no longer invoked, but until then we must never serve from a stale
  // shell cache.
});
