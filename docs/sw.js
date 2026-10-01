// Minimal app-shell service worker so Auoris can be installed to a phone's home screen and reopen instantly
// (even briefly offline) while it boots. It never caches Supabase API calls - those always go to the network,
// same as if there were no service worker at all. Bump CACHE_NAME to force clients onto a fresh shell.
const CACHE_NAME = 'auoris-shell-v6';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/emoji.js', '/vendor/supabase.js', '/logo.png', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;  // never touch POSTs (Supabase writes, functions, etc.)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // leave Supabase/GitHub API calls alone - network only

  if (req.mode === 'navigate') {
    // Network-first for page loads, so the GitHub Pages 404->redirect SPA routing trick keeps working online.
    // Falling back to the cached shell only kicks in when the phone has no signal at all.
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }
  // Static assets: cache-first, refreshing the cache in the background.
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
