/*
 * Service worker: makes the game work offline once it has been opened.
 * Code and pages are fetched network-first (so updates arrive when online);
 * large static files (engine, images) are served cache-first.
 * Bump CACHE_VERSION when the list of files changes.
 */
const CACHE_VERSION = 'chess-for-two-v2';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/chess.js',
  'js/sound.js',
  'js/engine.js',
  'js/app.js',
  'engine/stockfish-19-lite-single.js',
  'engine/stockfish-19-lite-single.wasm',
  'data/openings.json',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  ...['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((t) => `assets/pieces/${c}${t}.svg`)),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CACHE_FIRST = /\.(wasm|svg|png)$/;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (CACHE_FIRST.test(new URL(request.url).pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => store(request, res)))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => store(request, res))
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});

function store(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
  }
  return response;
}
