/*
 * PreFlop web service worker: caches the APP SHELL ONLY (index.html, content-hashed built assets,
 * manifest, icons) so the app opens without a network and installs as a PWA.
 * It never stores or answers:
 *   - API traffic: every cross-origin request (the API is on its own origin) and anything /v1/;
 *   - the partner widget: /embed/… pages are always fetched from the network;
 *   - non-GET requests and requests carrying credentials (Authorization).
 * Balances, odds and bets therefore always come live from the API.
 */
const CACHE = 'preflop-web-shell-v1';
const SHELL = ['/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('preflop-web-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/') || url.pathname === '/embed' || url.pathname.startsWith('/embed/')) return;
  if (req.headers.has('authorization')) return;

  if (req.mode === 'navigate') {
    // Network first so a new deployment is picked up at once; the cached shell only when offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || Response.error())),
    );
    return;
  }

  const isShellAsset = url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname);
  if (!isShellAsset) return;
  // Built assets are content-hashed, so cache first is safe.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
