/* =========================================================
   SERVICE WORKER - Museo Virtual del Sistema Solar
   =========================================================
   Estrategias:
   - Precaché: archivos esenciales de la app (index, manifest,
     iconos, librerías A-Frame y MindAR, modelo del Sol y target).
   - Navegación: network-first con respaldo a index.html offline.
   - Modelos (.glb) y targets (.mind): cache-first; se guardan
     la primera vez que se usan.
   - CDN y demás recursos: stale-while-revalidate.

   Para publicar una nueva versión, cambia CACHE_VERSION.
   ========================================================= */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `museo-solar-${CACHE_VERSION}`;

// Archivos propios (rutas relativas al scope del service worker).
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './img/logo-planetario.png',
  './modelos/sun1.glb',
  './targets/TG_SOL3.mind'
];

// Librerías externas que usa index.html (mismas versiones).
const CDN_ASSETS = [
  'https://aframe.io/releases/1.5.0/aframe.min.js',
  'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Los archivos propios son obligatorios: si fallan, no se instala.
    await cache.addAll(LOCAL_ASSETS);

    // Los de CDN se intentan uno por uno; un fallo no bloquea la instalación.
    await Promise.allSettled(
      CDN_ASSETS.map((url) => cache.add(new Request(url, { mode: 'cors' })))
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('museo-solar-') && n !== CACHE_NAME)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // Navegación: red primero, y si no hay conexión, index.html en caché.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  const isLocal = url.origin === self.location.origin;
  const isHeavyAsset = isLocal && /\.(glb|gltf|mind|bin)$/i.test(url.pathname);

  // Modelos 3D y targets: cache-first.
  if (isHeavyAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // Todo lo demás: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    const network = fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      })
      .catch(() => null);

    return cached || (await network) || Response.error();
  })());
});
