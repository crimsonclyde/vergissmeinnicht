// VergissMeinNicht service worker (Step 8.5, 17.5): keeps the app shell — the HTML page and its hashed
// scripts and styles, the same for every user — so the app opens without a connection. It never
// caches /api (no Workspace data here: Runs saved for offline use live in IndexedDB, per user, and
// are deleted on sign-out), and it only handles same-origin GET requests.
const CACHE = 'vmn-shell-v1';
const SHELL = '/';
/**
 * With weak signal (17.5: in a shop) a page load could hang for a minute before failing. After this
 * long the saved shell is used; the network answer, if it still comes, updates the saved shell.
 */
const NAVIGATION_TIMEOUT_MS = 4000;
const ASSET = /(?:src|href)="(\/assets\/[^"]+)"/g;

const assetsOf = (html) => [...html.matchAll(ASSET)].map((match) => match[1]);

/** Keeps the shell and exactly the assets it references (old deployments' files are removed). */
async function storeShell(response) {
  const cache = await caches.open(CACHE);
  const assets = assetsOf(await response.clone().text());
  await cache.put(SHELL, response);
  await Promise.all(assets.map(async (path) => ((await cache.match(path)) ? undefined : cache.add(path))));
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/assets/') && !assets.includes(path)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(SHELL, { cache: 'no-store' });
      if (response.ok) await storeShell(response);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

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

  if (url.pathname.startsWith('/assets/')) {
    // Hashed file names never change: cache first.
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached !== undefined) return cached;
        return fetch(request);
      })(),
    );
  }
});
