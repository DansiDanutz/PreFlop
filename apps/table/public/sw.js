/*
 * PreFlop Table service worker: caches the APP SHELL ONLY (index.html, built assets, manifest,
 * icons) so the tablet starts without a network. It never touches API traffic: cross-origin
 * requests, anything under /v1/, signed requests and every non-GET go straight to the network
 * and are never stored.
 */
const CACHE = 'preflop-table-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/') || req.headers.has('x-preflop-auth')) return;

  if (req.mode === 'navigate') {
    // Network first for the page so a new deployment is picked up; cached shell when offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
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
