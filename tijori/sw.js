// Tijori service worker: keeps the app's own files cached so it opens offline.
// It never touches your documents (those live encrypted in IndexedDB) and only fetches this site's own files.
// App files: served from cache instantly and refreshed in the background. When the page itself has changed,
// open pages are told a new version is ready, so they can offer a reload.
// Scan-to-fill engine, models and PDF decoders (ocr/**/*.wasm|onnx|ort|txt, ~37 MB): downloaded only when first
// needed, then served from their own cache without re-downloading.
const CACHE = 'tijori-v5';
const OCR_CACHE = 'tijori-ocr-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const tag = r => (r && (r.headers.get('etag') || r.headers.get('last-modified'))) || '';
const isPage = u => /\/(index\.html)?$/.test(u.pathname);
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function tell(type, only) {
  const list = only ? [only] : await self.clients.matchAll({ includeUncontrolled: true });
  list.forEach(c => c.postMessage({ type }));
}
// Fetch a fresh copy, cache it, and report whether it differs from the cached one.
async function refresh(c, req, hit) {
  const res = await fetch(req, { cache: 'no-cache' });
  let changed = false;
  if (res.ok) { changed = !!hit && tag(res) !== tag(hit); await c.put(req, res.clone()); }
  return { res, changed };
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (/\/ocr\/.*\.(wasm|onnx|ort|txt)$/.test(u.pathname)) {
    e.respondWith(caches.open(OCR_CACHE).then(async c => (await c.match(e.request, { ignoreSearch: true })) ||
      fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; })));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = refresh(c, e.request, hit).then(r => { if (r.changed && isPage(u)) tell('tijori-update'); return r.res; }).catch(() => hit);
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
// "Check for updates" in Settings
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'check-update') return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE); let changed = false;
    const mine = e.source && e.source.url ? new URL(e.source.url) : null; if (mine) { mine.hash = ''; mine.search = ''; }
    try {
      // refresh both addresses the app can be opened from, but judge "new version?" by the page that asked
      for (const p of ['./', './index.html']) {
        const req = new Request(new URL(p, self.registration.scope).href);
        const r = await refresh(c, req, await c.match(req, { ignoreSearch: true }));
        if (!mine || req.url === mine.href) changed = changed || r.changed;
      }
    } catch { return tell('tijori-update-error', e.source); }
    tell(changed ? 'tijori-update' : 'tijori-current', e.source);
  })());
});
