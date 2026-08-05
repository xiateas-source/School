const CACHE_NAME = 'cat-trainer-raster-v2';
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './app-core.js',
  './app-ui.js',
  './manifest.webmanifest',
  './icon.svg',
  './sprite-1.js',
  './sprite-2.js',
  './sprite-3.js',
  './sprite-4.js',
  './sprite-5.js',
  './family-1.js',
  './family-2.js',
  './family-3.js',
  './family-4.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
