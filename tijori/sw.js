// Tijori service worker: keeps the app's own files cached so it opens offline.
// It never touches your documents (those live encrypted in IndexedDB) and only fetches this site's own files.
// Strategy: serve from cache instantly, refresh the cache in the background, so updates land on the next launch.
const CACHE = 'tijori-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request, { cache: 'no-cache' }).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
