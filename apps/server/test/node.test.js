// The home server's own request handling: odd paths, odd hosts, and who counts as "home".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callerAddress, staticPath } from '../src/node-http.js';
import { announcement } from '../src/announce.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('a request is from home only when its address says so', () => {
  const from = (socket, headers = {}, env = {}) => callerAddress({ socket, headers }, env);
  assert.equal(from('::ffff:192.168.1.20'), '192.168.1.20');
  assert.equal(from('127.0.0.1'), '127.0.0.1');
  // Forwarding headers from a computer on the network are just ignored.
  assert.equal(from('203.0.113.9', { 'x-forwarded-for': '192.168.1.20' }), '203.0.113.9');
  // Through a proxy on this computer, nothing the request says about itself is believed…
  for (const h of ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for', 'forwarded']) {
    assert.equal(from('127.0.0.1', { [h]: '192.168.1.20' }), '', h);
  }
  // …unless the household says which proxy it runs. Then only that proxy's own header counts.
  assert.equal(from('::1', { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '192.168.1.20' }, { NOOR_TRUST_PROXY: 'cloudflare' }), '198.51.100.7');
  assert.equal(from('::1', { 'x-forwarded-for': '192.168.1.20' }, { NOOR_TRUST_PROXY: 'cloudflare' }), '');
  assert.equal(from('127.0.0.1', { 'x-forwarded-for': '192.168.1.20, 198.51.100.7' }, { NOOR_TRUST_PROXY: '1' }), '198.51.100.7');
  assert.equal(from('127.0.0.1', { 'cf-connecting-ip': '192.168.1.20' }, { NOOR_TRUST_PROXY: '1' }), '');
  assert.equal(from('192.168.1.20', {}, { NOOR_AUTO_APPROVE: '0' }), '');
});

test('static paths stay inside the dashboard folder', () => {
  const root = path.resolve('/srv/noor/dist');
  assert.equal(staticPath(root, '/'), root);
  assert.equal(staticPath(root, '/assets/app.js'), path.join(root, 'assets/app.js'));
  assert.equal(staticPath(root, '/companion/%69ndex.html'), path.join(root, 'companion/index.html'));
  assert.equal(staticPath(root, '/../secret.key'), path.join(root, 'secret.key'));
  assert.equal(staticPath(root, '/%2e%2e/%2e%2e/etc/passwd'), path.join(root, 'etc/passwd'));
  assert.equal(staticPath(root, '/%'), null);
  assert.equal(staticPath(root, '/a%00b'), null);
  // A sibling folder whose name starts the same way is still outside.
  assert.equal(staticPath('/srv/noor/dist', '/../dist-old/x'), path.join('/srv/noor/dist', 'dist-old/x'));
});

test('the server announces itself with the system’s own tool', () => {
  const all = () => true, none = () => false;
  assert.deepEqual(announcement({ platform: 'darwin', port: 8787, host: 'Studio.local', has: all }),
    { cmd: 'dns-sd', args: ['-R', 'noor-frame on Studio', '_noor-frame._tcp', 'local', '8787'] });
  assert.deepEqual(announcement({ platform: 'linux', port: 9000, host: 'den', has: all, exists: () => false }),
    { cmd: 'avahi-publish', args: ['-s', 'noor-frame on den', '_noor-frame._tcp', '9000'] });
  // A Pi set up by install.sh already announces it through Avahi's service file.
  assert.equal(announcement({ platform: 'linux', port: 8787, host: 'pi', has: all, exists: () => true }), null);
  assert.equal(announcement({ platform: 'win32', port: 8787, host: 'pc', has: none }), null);
});

// The real server, started on a free port with an empty home folder.
async function startServer() {
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'noor-test-'));
  const dist = path.join(home, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Noor</title>');
  const child = spawn(process.execPath, [path.join(HERE, '../src/node.js')], {
    env: { ...process.env, PORT: String(port), NOOR_HOME: home, STATIC_DIR: dist, FRAME_SECRET: 'x'.repeat(32), NOOR_ANNOUNCE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + output)), 10000);
    child.stdout.on('data', () => { if (output.includes('noor-frame server on')) { clearTimeout(t); resolve(); } });
  });
  // Raw HTTP, so the test can send what a browser never would.
  const raw = (text) => new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.end(text));
    let got = '';
    sock.on('data', (d) => { got += d; });
    sock.on('end', () => resolve(got));
    sock.on('error', reject);
  });
  return { port, raw, child, stop: () => { child.kill(); fs.rmSync(home, { recursive: true, force: true }); } };
}

test('malformed requests get an error and the server keeps running', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  const status = (reply) => Number(reply.split(' ')[1]);
  assert.equal(status(await s.raw('GET /% HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')), 400);
  assert.equal(status(await s.raw('GET /%E0%A4%A HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')), 400);
  assert.equal(status(await s.raw('GET /api/version HTTP/1.1\r\nHost: [bad\r\nConnection: close\r\n\r\n')), 200);
  assert.equal(status(await s.raw('GET /..%2f..%2fdata/secret.key HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')), 404);
  assert.equal(s.child.exitCode, null, 'still running');
  const page = await fetch(`http://127.0.0.1:${s.port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Noor<\/title>/);
});

test('a screen behind a proxy is not approved automatically', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  const register = (headers) => fetch(`http://127.0.0.1:${s.port}/api/devices/register`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ name: 'Hall' }),
  }).then((r) => r.json());
  assert.equal((await register({ 'x-forwarded-for': '192.168.1.20' })).approved, false);
  assert.equal((await register({ 'cf-connecting-ip': '192.168.1.20' })).approved, false);
  assert.equal((await register({ 'x-noor-client-ip': '192.168.1.20', 'x-real-ip': '10.0.0.2' })).approved, false);
  // Straight from this computer (no proxy) it is home.
  assert.equal((await register({})).approved, true);
});
