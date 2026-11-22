// RIFT ARENA — service worker: offline shell, versioned cache, network-first API
const VERSION = 'rift-arena-v1';
const SHELL = [
  '/', '/index.html', '/manifest.json',
  '/styles/main.css', '/styles/components.css', '/styles/lobby.css', '/styles/screens.css',
  '/styles/auth.css', '/styles/game.css', '/styles/admin.css', '/styles/mobile.css',
  '/src/app.js',
  '/assets/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API & WS: network only (multiplayer needs a live server)
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  // shared defs + assets: cache-first (immutable content)
  if (url.pathname.startsWith('/shared/') || url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit ?? fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('/index.html'))),
    );
    return;
  }
  // app files: network-first, cache fallback (offline shell)
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit ?? caches.match('/index.html'))),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
