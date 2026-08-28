/* Control Mant · service worker
   Guarda la app en el teléfono para que abra sin conexión.
   Los datos de la planilla NUNCA se cachean: siempre van a la red. */

const CACHE = 'control-mant-v2.1.0';
const ARCHIVOS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())
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
  if (req.method !== 'GET') return;                          // los envíos van directo a la red
  if (!req.url.startsWith(self.location.origin)) return;     // Apps Script nunca se cachea

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        // Devuelve lo guardado al instante y refresca por detrás.
        fetch(req).then(r => {
          if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then(r => {
        if (r && r.ok) { const cl = r.clone(); caches.open(CACHE).then(c => c.put(req, cl)); }
        return r;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
