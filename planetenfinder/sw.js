/**
 * Service worker — so the app works where it is actually used.
 *
 * A field at night is exactly where there is no signal, and this app needs
 * none: every position is computed on the device. The only thing standing
 * between it and full offline use was the download itself, which this fixes.
 *
 * Policy is network-first with a cache fallback, not the other way round. The
 * app is under active development, and a cache-first worker would happily
 * serve last week's build to someone who is online and expecting a fix.
 */

const CACHE = 'planetenfinder-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './src/main.js',
  './src/astro.js',
  './src/events.js',
  './src/sensors.js',
  './src/skyview.js',
  './src/mapview.js',
  './src/realistic.js',
  './src/stars.js',
  './src/deepsky.js',
  './src/bodies.js',
  './src/geo.js',
  './src/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing file must not fail the whole install, so they go in
      // individually and any straggler is simply skipped.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
