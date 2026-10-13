// Lets the dashboard open without a connection, showing the last saved day (live.js keeps the
// data itself in localStorage). Browsers only run this on https:// or http://localhost, so it
// covers installed web apps, Cloudflare deployments and Raspberry Pi kiosks (which load the
// dashboard through localhost). A frame that loads it over plain http on the LAN simply skips it.
//
//  - The page: network first, the saved copy when offline, so updates show up on the next load.
//  - Built files (/assets/…, hashed names) and the icons: saved on first use.
//  - Google Fonts: the saved copy straight away, refreshed in the background.
//  - The API, the phone companion, athan audio and the kiosk helper: never touched.

const CACHE = 'noor-frame-v1';
const MAX_ASSETS = 80;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const SKIP = /^\/(api|companion|audio|kiosk)\//;

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (url.origin === location.origin) {
    if (SKIP.test(url.pathname)) return;
    if (req.mode === 'navigate') return e.respondWith(page(req));
    return e.respondWith(saved(req, true));
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(saved(req, false));
});

async function page(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchWithin(req, 5000);
    if (res.ok) { await cache.put('/', res.clone()); return res; }
    // The server is down (a Pi kiosk's helper answers 503): the saved dashboard beats an error.
    return (await cache.match('/')) || res;
  } catch {
    return (await cache.match('/')) || new Response('Offline, and this screen has not saved the dashboard yet.', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

// Cache first. `keep`: never refetch (hashed files); otherwise refresh in the background.
async function saved(req, keep) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req).then(async (res) => {
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  });
  if (hit) {
    if (!keep) refresh.catch(() => {});
    return hit;
  }
  return refresh;
}

async function trim(cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith('/assets/'));
  for (const r of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(r);
}

function fetchWithin(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}
