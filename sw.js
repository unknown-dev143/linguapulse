/* LinguaPulse service worker — offline app shell.
   Cross-origin requests (MyMemory / LibreTranslate / OpenAI) are left to the
   network; only our own static assets are cached so translations always stay fresh. */
const CACHE = 'linguapulse-v3';
const ASSETS = [
  './', './index.html', './app.js', './styles.css',
  './manifest.webmanifest', './favicon.svg',
  './icon-192.png', './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let translation APIs hit the network

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  // stale-while-revalidate for static assets
  e.respondWith(
    caches.match(req).then(async cached => {
      if(cached) return cached;
      try {
        const resp = await fetch(req);
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return resp;
      } catch(e) {
        // offline + not cached: fall back to the app shell so respondWith
        // never resolves with undefined (which throws a runtime error)
        return (await caches.match('./index.html')) || Response.error();
      }
    })
  );
});
