// Cat Trainer service worker — offline resilience + installable PWA.
//
// It is designed to PAIR with the cache-bust stamp (tools/stamp.mjs), not fight
// it, so we don't reintroduce the stale-module pain the SW was deferred to avoid:
//
//   • Version-stamped requests (those carrying a "v" query) are immutable per
//     URL — a new deploy mints a new URL — so they're served CACHE-FIRST. Old
//     entries are purged on activate under a fresh cache name.
//   • The HTML document (a navigation, un-versioned) is NETWORK-FIRST: online
//     users always get the latest index.html; offline users fall back to the
//     last cached copy.
//   • Other same-origin assets (PNGs, icon, manifest) are STALE-WHILE-
//     REVALIDATE: instant from cache, refreshed in the background.
//   • Cross-origin requests (Firebase CDN, Firestore) are NOT intercepted, so
//     realtime sync and Firebase's own offline persistence are untouched.
//
// CACHE_VERSION is rewritten by tools/stamp.mjs to the same content hash used
// for the module version stamps, so every deploy gets a fresh cache and purges
// the old one.

const CACHE_VERSION = '9bf62112'; // stamped by tools/stamp.mjs
const CACHE_PREFIX = 'cat-trainer-v2-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// The app's scope path, derived from where this SW lives
// (e.g. "/School/cat-trainer-v2/"). Used to ignore anything outside the app —
// notably the legacy app at /School/cat-trainer/.
const SCOPE_PATH = new URL('./', self.location).pathname;

self.addEventListener('install', () => {
  // Take over as soon as installed; activate purges old caches.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch Firestore writes etc.

  const url = new URL(req.url);

  // Only our own origin + our own app subpath. Everything else (Firebase CDN,
  // Firestore API, the legacy app) passes straight through to the network.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;

  // The HTML shell: prefer fresh, fall back to cache when offline.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Content-hash-versioned modules/CSS: immutable per URL → cache-first.
  if (url.searchParams.has('v')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Un-versioned assets (images, icon, manifest): serve fast, refresh quietly.
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last resort: any cached copy of the app shell so a cold offline
    // navigation to a fresh URL still boots.
    const shell = await cache.match(SCOPE_PATH) || await cache.match(SCOPE_PATH + 'index.html');
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || fetch(req);
}
