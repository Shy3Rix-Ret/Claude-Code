// Offline-Speicher.
//
// Die Zusammenfassung nennt als Schwäche der Web-Version, dass sie eine
// Verbindung braucht und "für dauerhafte Offline-Nutzung nicht vorgesehen"
// ist. Das ist kein Naturgesetz, sondern eine Datei — diese hier.

const VERSION = 'pmt-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './styles/app.css',
  './src/main.js',
  './src/config.js',
  './src/theory.js',
  './src/state.js',
  './src/strokes.js',
  './src/paper.js',
  './src/pointer.js',
  './src/keyboard.js',
  './src/sequencer.js',
  './src/ui.js',
  './src/gallery.js',
  './src/storage.js',
  './src/midiin.js',
  './src/audio/engine.js',
  './src/audio/voices.js',
  './src/audio/render.js',
  './src/export/wav.js',
  './src/export/midi.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll bricht komplett ab, wenn eine einzige Datei fehlt. Lieber
      // einzeln: ein fehlendes Icon soll nicht die ganze App offline-untauglich
      // machen.
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Netz zuerst, Cache als Rückfall: so bekommt man beim nächsten Besuch die
  // neue Version, ohne dass ein Ausfall die App unbenutzbar macht.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      }),
  );
});
