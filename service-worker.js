/* ==========================================================================
   THE CURRENT INVESTMENT — service-worker.js
   App shell precache, offline navigation and runtime caching for CDN files.
   Increase VERSION whenever files change so installed apps update.
   ========================================================================== */
const VERSION = 'v1.0.0';
const SHELL_CACHE = `tci-shell-${VERSION}`;
const RUNTIME_CACHE = `tci-runtime-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/img/logo.png',
  './assets/css/style.css',
  './assets/js/utils.js',
  './assets/js/database.js',
  './assets/js/ui.js',
  './assets/js/auth.js',
  './assets/js/invoices.js',
  './assets/js/settings.js',
  './assets/js/pwa.js',
  './assets/js/app.js',
  './assets/fonts/ibm-plex-sans-latin-400-normal.woff2',
  './assets/fonts/ibm-plex-sans-latin-500-normal.woff2',
  './assets/fonts/ibm-plex-sans-latin-600-normal.woff2',
  './assets/fonts/ibm-plex-sans-latin-700-normal.woff2',
  './assets/vendor/fontawesome/css/fontawesome.min.css',
  './assets/vendor/fontawesome/css/solid.min.css',
  './assets/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// Libraries loaded from CDNs: cached so PDF export works offline later.
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(CDN.map(async (url) => {
      const opaque = false;
      const res = await fetch(url, { mode: opaque ? 'no-cors' : 'cors', credentials: 'omit' });
      if (res.ok || res.type === 'opaque') await runtime.put(url, res);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tci-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page loads: network first, fall back to the cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch (e) {
        return (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./'));
      }
    })());
    return;
  }

  // Same-origin files: serve from cache immediately and refresh in the background.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || new Response('', { status: 504, statusText: 'Offline' });
    })());
    return;
  }

  // CDN libraries: cache first, then network.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
  }
});
