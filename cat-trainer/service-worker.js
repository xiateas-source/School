const CACHE='cat-trainer-v4.3-final-art-pack';
const FILES=['./','index.html','styles.css','manifest.webmanifest','icon.svg','app.js','sprite-1.js','sprite-2.js','sprite-3.js','sprite-4.js','sprite-5.js','family-1.js','family-2.js','family-3.js','family-4.js','v4-loader.js','v4-pack-01.js','v4-pack-02.js','v4-pack-03.js','v4-pack-04.js','v4-pack-05.js','v4-pack-06.js','v4-pack-07.js','v4-pack-08.js','v4-pack-09.js','v4-pack-10.js','v4-pack-11.js','v4-pack-12.js','v4-pack-13.js','v4-pack-14.js','v4-pack-15.js','v4-pack-16.js','v4-pack-17.js','v4-pack-18.js','v4-pack-19.js','v4-pack-20.js','v4-pack-21.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  const freshAsset=/\/(?:app|v4-loader|v4-pack-\d+)\.js$/.test(url.pathname);
  if(freshAsset){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      return response;
    }).catch(()=>caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>caches.match('index.html'))));
});
