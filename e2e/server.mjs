// The server the browser tests talk to: the real API handler and the built dashboard and
// companion, with every outside service faked (apps/server/test/fake-world.js) and storage in
// memory. Run `npm run build` first.
//
// Test-only additions, never in the real server:
//   POST /__test/reset     forget everything (each test starts from a fresh household)
//   x-test-ip: <address>   pretend a request comes from that address (e.g. outside the home)

import { createServer } from 'node:http';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMemoryStore } from '@noor-frame/core';
import { createHandler } from '../apps/server/src/handler.js';
import { fakeWorld } from '../apps/server/test/fake-world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = path.join(ROOT, 'apps/frame/dist');
const PORT = Number(process.env.E2E_PORT) || 8790;
const ORIGIN = `http://localhost:${PORT}`;

export const CONFIG = {
  location: { city: 'Toronto', country: 'Canada' },
  travel: { waitMs: 3000 },
  calendars: [
    { id: 'family', name: 'Family', color: '#111111', family: true, url: 'demo:family' },
  ],
};

let world, handle;
function reset() {
  world = fakeWorld();
  globalThis.fetch = world.fetch;
  handle = createHandler({
    config: CONFIG, store: makeMemoryStore(), secretMaterial: 'e2e-'.repeat(8), log: {},
    clientIp: (request) => request.headers.get('x-noor-client-ip'),
    lanIp: () => 'localhost', lanUrl: () => ORIGIN,
  });
}
reset();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };

function serveStatic(pathname, res) {
  let file = path.normalize(path.join(STATIC, decodeURIComponent(pathname)));
  if (!file.startsWith(STATIC)) { res.writeHead(403).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    if (path.extname(file)) { res.writeHead(404).end('Not found'); return; }
    file = path.join(STATIC, pathname.startsWith('/companion') ? 'companion/index.html' : 'index.html');
  }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('Run npm run build first'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname === '/__test/reset' && req.method === 'POST') { reset(); res.writeHead(204).end(); return; }
  if (url.pathname === '/__test/world') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ calls: world.calls, google: world.google.requests.length }));
    return;
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers(req.headers);
  headers.set('x-noor-client-ip', req.headers['x-test-ip'] || '127.0.0.1');
  const body = req.method === 'POST' ? Buffer.concat(chunks) : undefined;
  const r = await handle(new Request(url, { method: req.method, headers, body }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`e2e server on ${ORIGIN}`));
