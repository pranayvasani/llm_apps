// Tijori service worker: keeps the app's own files cached so it opens offline.
// It never touches your documents (those live encrypted in IndexedDB) and only fetches this site's own files.
// App files: served from cache instantly and refreshed in the background, so updates land on the next launch.
// Scan-to-fill engine and models (ocr/*.wasm|onnx|ort|txt, ~36 MB): downloaded only on first scan, then served
// from their own cache without re-downloading.
const CACHE = 'tijori-v3';
const OCR_CACHE = 'tijori-ocr-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (/\/ocr\/[^/]+\.(wasm|onnx|ort|txt)$/.test(u.pathname)) {
    e.respondWith(caches.open(OCR_CACHE).then(async c => (await c.match(e.request, { ignoreSearch: true })) ||
      fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; })));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request, { cache: 'no-cache' }).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
