const CACHE_NAME = 'sthstart-notebook-shell-v1';
const OFFLINE_SHELL = '/apps/notebook/offline';

async function cacheOfflineShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(OFFLINE_SHELL, { cache: 'reload' });
  if (!response.ok) return;
  await cache.put(OFFLINE_SHELL, response.clone());
  const html = await response.text();
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'<>\s]+/g) ?? [])];
  await Promise.allSettled(assets.map((asset) => cache.add(asset)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheOfflineShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('sthstart-notebook-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
      return response;
    }));
    return;
  }

  if (url.pathname.startsWith('/api/admin/notebook/assets/')) {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
      return response;
    }).catch(() => caches.match(request).then((cached) => cached ?? Response.error())));
    return;
  }

  if (url.pathname.startsWith('/apps/notebook')) {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
      return response;
    }).catch(async () => {
      const exact = await caches.match(request);
      if (exact) return exact;
      if (request.mode === 'navigate') return (await caches.match(OFFLINE_SHELL)) ?? Response.error();
      return Response.error();
    }));
  }
});
