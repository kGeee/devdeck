/* DevDeck service worker.
 *
 * Scope is deliberately narrow. DevDeck is a live control panel: it streams
 * logs over SSE, polls process state, and drives git and agent runs. Caching
 * any of that would show stale state that looks real, which is worse than no
 * service worker at all. So:
 *
 *   - /api/* and event streams are NEVER cached, under any strategy.
 *   - Only content-hashed build assets and icons are cache-first.
 *   - Navigations go to the network, and fall back to an offline page that
 *     says the server is not running, which is the only real failure mode.
 */

const VERSION = "devdeck-v1";
const STATIC_CACHE = VERSION + "-static";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isCacheableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET is ever cacheable; a POST that starts an agent run must not be
  // replayed from a cache under any circumstances.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live surfaces: always the network, never stored.
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.get("accept") === "text/event-stream") return;

  if (isCacheableAsset(url)) {
    // Build assets are content-hashed, so a hit is always correct.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit || Response.error())
      )
    );
  }
});
