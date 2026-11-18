/* Marblelous — offline shell. Cero dependencias. */
importScripts('./precache-manifest.js');
const VERSION = 'marblelous-v5';
const SHELL = ['./', './index.html', './manifest.webmanifest', './precache-manifest.js'];

async function precache(cache) {
  const extra = Array.isArray(self.__MARBLELOUS_PRECACHE) ? self.__MARBLELOUS_PRECACHE : [];
  const urls = [...new Set([...SHELL, ...extra])];
  const work = Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
  // Nunca bloquear la instalación por un recurso lento o ausente.
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 6000))]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => precache(cache))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
