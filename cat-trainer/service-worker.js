'use strict';

const CACHE_NAME = 'cat-trainer-png-v46';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './image-fix.css',
  './assets.css',
  './app.js',
  './app-core.js',
  './asset-overrides.js',
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
  './family-4.js',
  './assets/sirus.png',
  './assets/mom.png',
  './assets/abba.png',
  './assets/arlo.png',
  './assets/wesley.png',
  './assets/nova.png',
  './assets/nova-hero.png',
  './assets/ember.png',
  './assets/ember-hero.png',
  './assets/moss.png',
  './assets/moss-hero.png',
  './assets/cafe-room.png',
  './assets/bed-blue-stars.png',
  './assets/bed-pink-hearts.png',
  './assets/food-bowl-purple.png',
  './assets/water-bowl-teal.png',
  './assets/yarn-blue.png',
  './assets/yarn-pink.png',
  './assets/cat-tree.png',
  './assets/bookshelf.png',
  './assets/toy-basket.png',
  './assets/plant.png',
  './assets/collar-moon.png',
  './assets/morning-icon.png',
  './assets/brain-icon.png',
  './assets/move-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('cat-trainer') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
