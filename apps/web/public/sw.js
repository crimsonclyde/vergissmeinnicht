// VergissMeinNicht service worker (Step 8.5, 17.5, 49.2): keeps the app — the HTML page and *every*
// file of the build named in /precache.json (also lazily loaded pages such as Notes, the Recipe editor
// or the map), the same for every user — so every page opens without a connection.
//
// Workspace data is never kept here: saved copies of Lists, Runs, Notes, Reminders, … live in IndexedDB,
// per user, and are deleted on sign-out. The one exception is pictures shown on pages (49.4): an <img>
// from /api answered while online is kept in a separate cache, used only while offline, and deleted by
// the page on sign-out and when another account signs in. Only same-origin GET requests are handled.
const CACHE = 'vmn-shell-v2';
const MEDIA = 'vmn-media-v1';
const SHELL = '/';
const MANIFEST = '/precache.json';
/**
 * With weak signal (17.5: in a shop) a page load could hang for a minute before failing. After this
 * long the saved shell is used; the network answer, if it still comes, updates the saved shell.
 */
const NAVIGATION_TIMEOUT_MS = 4000;
/** Pictures kept for offline use: at most this many, the oldest go first; none larger than this. */
const MEDIA_LIMIT = 400;
const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** How many files are fetched at the same time while the app is being saved on the device. */
const PARALLEL = 6;
const ASSET = /(?:src|href)="(\/assets\/[^"]+)"/g;

const assetsOf = (html) => [...html.matchAll(ASSET)].map((match) => match[1]);
const isKept = (path) => path.startsWith('/assets/') || path === MANIFEST || path.startsWith('/icon') || path === '/apple-touch-icon.png' || path === '/manifest.webmanifest';

async function manifestOf() {
  try {
    const response = await fetch(MANIFEST, { cache: 'no-store' });
    if (!response.ok) return null;
    const manifest = await response.clone().json();
    return Array.isArray(manifest.files) && typeof manifest.version === 'string' ? { manifest, response } : null;
  } catch {
    return null;
  }
}

/** Fetches what is missing, a few at a time. A file that fails now is fetched on the next visit. */
async function fill(cache, paths, refresh) {
  const queue = [...paths];
  const worker = async () => {
    while (queue.length > 0) {
      const path = queue.shift();
      try {
        if (!refresh(path) && (await cache.match(path)) !== undefined) continue;
        const response = await fetch(path, { cache: refresh(path) ? 'no-cache' : 'default' });
        if (response.ok) await cache.put(path, response);
      } catch {
        // offline or the file is gone: the next visit tries again
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

/**
 * Keeps the shell, every file of its build (/precache.json) and nothing of older builds. Public files
 * without a hash in their name (icons, manifest) are fetched again when the build changed.
 */
async function storeShell(response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(SHELL, response);
  const found = await manifestOf();
  const previous = await cache.match(MANIFEST).then((saved) => (saved === undefined ? null : saved.json()), () => null);
  const changed = found !== null && previous?.version !== found.manifest.version;
  const files = [...new Set([...assetsOf(html), ...(found?.manifest.files ?? [])])];
  // The page's own files first: they make the next start work.
  await fill(cache, assetsOf(html), () => false);
  await fill(cache, files, (path) => changed && !path.startsWith('/assets/'));
  if (found !== null) await cache.put(MANIFEST, found.response);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/assets/') && !files.includes(path)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch(SHELL, { cache: 'no-store' });
        if (response.ok) await storeShell(response);
      } catch {
        // installed without a saved shell; the next page load saves it
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE && key !== MEDIA) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** A picture from /api: always asked from the server while online (it decides access); the saved copy only offline. */
async function picture(request) {
  try {
    const response = await fetch(request);
    const size = Number(response.headers.get('content-length') ?? '0');
    if (response.ok && (response.headers.get('content-type') ?? '').startsWith('image/') && size <= MEDIA_MAX_BYTES) {
      const copy = response.clone();
      const cache = await caches.open(MEDIA);
      await cache.put(request, copy);
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - MEDIA_LIMIT))) await cache.delete(old);
    }
    return response;
  } catch (error) {
    const saved = await caches.open(MEDIA).then((cache) => cache.match(request));
    if (saved !== undefined) return saved;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Only pictures shown on a page (<img>); data reads are kept by the page itself, per user.
    // Never pictures of the personal Journal (its entries are not kept offline either).
    if (request.destination === 'image' && !url.pathname.startsWith('/api/account/journal')) event.respondWith(picture(request));
    return;
  }

  if (request.mode === 'navigate') {
    // Network first, but not forever. Every page (also /knot/…) is the same app shell, stored under "/" only.
    let stored = Promise.resolve();
    const network = fetch(request).then((response) => {
      if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html')) stored = storeShell(response.clone());
      return response;
    });
    // Keeps the worker alive until a late answer has been stored as the new shell.
    event.waitUntil(network.then(() => stored).catch(() => undefined));
    event.respondWith(
      (async () => {
        const saved = await caches.match(SHELL);
        if (saved === undefined) return network.catch(() => Response.error());
        const late = new Promise((resolve) => setTimeout(() => resolve(undefined), NAVIGATION_TIMEOUT_MS));
        try {
          return (await Promise.race([network, late])) ?? saved;
        } catch {
          return saved;
        }
      })(),
    );
    return;
  }

  if (isKept(url.pathname) && url.pathname !== MANIFEST) {
    // Hashed file names never change, and public files are refreshed with each build: cache first.
    event.respondWith(
      (async () => {
        const cached = await caches.match(url.pathname, { cacheName: CACHE });
        if (cached !== undefined) return cached;
        return fetch(request);
      })(),
    );
  }
});
