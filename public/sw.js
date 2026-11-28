/* Marblelous — offline shell. Cero dependencias. */
importScripts('./precache-manifest.js');
const VERSION = 'marblelous-v15';
const SHELL = ['./', './index.html', './manifest.webmanifest', './precache-manifest.js'];
const extra = Array.isArray(self.__MARBLELOUS_PRECACHE) ? self.__MARBLELOUS_PRECACHE : [];
const ASSETS = new Set([...SHELL, ...extra].map((path) => new URL(path, self.registration.scope).href));

async function precache(cache) {
  const work = Promise.all([...ASSETS].map((url) => cache.add(url).catch(() => {})));
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('marblelous-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!ASSETS.has(req.url)) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // Los módulos y las hojas son los mismos con y sin cabecera Origin.
      const cached = await cache.match(req, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(req);
      if (response.ok) event.waitUntil(cache.put(req, response.clone()).catch(() => {}));
      return response;
    })
  );
});
