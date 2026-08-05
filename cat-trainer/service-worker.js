const CACHE='cat-trainer-v4.4-stable-core';
const FILES=['./','index.html','styles.css','manifest.webmanifest','icon.svg','app.js','app-core.js','app-ui.js','sprite-1.js','sprite-2.js','sprite-3.js','sprite-4.js','sprite-5.js','family-1.js','family-2.js','family-3.js','family-4.js'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  const networkFirst=/\/(?:app|app-core|app-ui)\.js$/.test(url.pathname);
  if(networkFirst){
    event.respondWith(
      fetch(event.request).then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      }).catch(()=>caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      return response;
    }))
  );
});
