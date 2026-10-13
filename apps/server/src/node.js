// Home server: runs on any always-on computer on your Wi-Fi (a Raspberry Pi is ideal).
// Serves the dashboard and the /api routes.
//
//   npm start                      (from the repo root)
//
// Environment (all optional):
//   PORT           default 8787
//   NOOR_HOME      folder holding frame.config.json and data/ (default: the repo root)
//   FRAME_SECRET   key for encrypting saved API keys (default: generated into data/secret.key)
//   STATIC_DIR     built dashboard to serve (default: apps/frame/dist)
//   NOOR_PUBLIC_URL  the address phones should use, if not http://<this computer's IP>:PORT
//   NOOR_AUTO_APPROVE  0 = never approve new screens automatically (see NOOR_SETUP_CODE)
//   NOOR_TRUST_PROXY   behind a tunnel or reverse proxy on this computer: 'cloudflare' or 1
//                      (see node-http.js); otherwise proxied requests are never approved automatically
//   NOOR_SETUP_CODE  at least 12 characters; opening the dashboard once with ?setup=<code>
//                    approves that screen (the way in when nothing is approved automatically)

import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { makeFileStore } from '@noor-frame/core';
import { createHandler } from './handler.js';
import { callerAddress, staticPath } from './node-http.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const HOME = path.resolve(process.env.NOOR_HOME || ROOT);
const STATIC = path.resolve(process.env.STATIC_DIR || path.join(ROOT, 'apps/frame/dist'));
const PORT = Number(process.env.PORT) || 8787;

function loadConfig() {
  const file = path.join(HOME, 'frame.config.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { throw new Error(`frame.config.json isn't valid JSON: ${err.message}`); }
}

// The key that encrypts saved API keys. Generated once and kept next to the data, readable only
// by this user. Back it up together with data/ — without it, saved keys can't be read.
function secretMaterial() {
  if (process.env.FRAME_SECRET) return process.env.FRAME_SECRET;
  const file = path.join(HOME, 'data', 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf8').trim();
}

// This computer's address on the home network, for QR codes a phone can open.
function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
  }
  return null;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function serveStatic(pathname, res) {
  let file = staticPath(STATIC, pathname);
  if (!file) { res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad path'); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    // A missing file with an extension (e.g. /audio/athan.mp3) is a real 404; other paths get
    // the app they belong to (the phone companion lives under /companion/).
    if (path.extname(file)) { res.writeHead(404).end('Not found'); return; }
    file = path.join(STATIC, pathname.startsWith('/companion') ? 'companion/index.html' : 'index.html');
  }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('The dashboard is not built yet. Run: npm run build'); return; }
    // index.html and the offline worker are never cached, so a rebuilt dashboard shows up on the
    // next reload.
    const cache = file.endsWith('index.html') || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
    res.end(body);
  });
}

// The address phones use for this server (QR codes on a Raspberry Pi kiosk, which shows the
// dashboard through its own local helper). NOOR_PUBLIC_URL overrides it, e.g. http://noor.local:8787
function lanUrl() {
  if (process.env.NOOR_PUBLIC_URL) return process.env.NOOR_PUBLIC_URL.replace(/\/$/, '');
  const ip = lanIp();
  return ip ? `http://${ip}:${PORT}` : null;
}

const store = makeFileStore(path.join(HOME, 'data', 'frame.json'), fs);
const handle = createHandler({
  config: loadConfig(), store, secretMaterial: secretMaterial(), lanIp, lanUrl,
  clientIp: (request) => request.headers.get('x-noor-client-ip'),
  setupCode: process.env.NOOR_SETUP_CODE || null,
});

createServer(async (req, res) => {
  // A request that can't be read gets an error, never takes the server down.
  try { await respond(req, res); }
  catch (err) {
    console.error(`${req.method} ${req.url}: ${err.stack || err}`);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end();
  }
}).listen(PORT, '0.0.0.0', () => {
  const ip = lanIp();
  console.log(`noor-frame server on http://localhost:${PORT}/` + (ip ? `  ·  on your Wi-Fi: http://${ip}:${PORT}/` : ''));
});

async function respond(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request'); return; }
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
  let body;
  if (req.method === 'POST' || req.method === 'PUT') {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(c);
    }
    body = Buffer.concat(chunks);
  }
  // The caller's address decides whether a new screen is approved automatically (home network).
  // Set here from the socket, never trusted from the request itself.
  const headers = new Headers(req.headers);
  headers.set('x-noor-client-ip', callerAddress({ socket: req.socket.remoteAddress, headers: req.headers }));
  const r = await handle(new Request(url, { method: req.method, headers, body }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}
