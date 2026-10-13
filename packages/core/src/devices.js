// Screens and phones that may change household settings. Each device gets a random key once;
// only a hash of it is stored. Reading the dashboard needs no key; changing anything does.
//
// Approval: a screen registering from the home network is approved automatically (it's in
// your house). Anything else stays pending until an approved device approves it — for example
// a phone that scanned the QR code on a screen (see the companion app).

import { makeLock } from './lock.js';

const enc = new TextEncoder();

async function sha256(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const MAX_DEVICES = 50;
const KINDS = new Set(['screen', 'phone']);

export function makeDevices(store, { now = () => Date.now() } = {}) {
  const all = async () => (await store.get('devices')) || [];
  const saveAll = (list) => store.put('devices', list);
  const locked = makeLock(); // every change to the list goes through here, one at a time

  return {
    // → { id, token, approved }. The token is shown once; keep it on the device.
    register: (opts) => locked(() => register(opts)),
    verify: (token) => locked(() => verify(token)),
    async list() { return (await all()).map(({ hash, ...d }) => d); },
    update: (id, patch) => locked(() => update(id, patch)),
    remove: (id) => locked(async () => saveAll((await all()).filter((d) => d.id !== id))),
  };

  async function register({ name, kind = 'screen', approved = false }) {
    if (!KINDS.has(kind)) throw new Error('kind must be screen or phone');
    const list = await all();
    if (list.length >= MAX_DEVICES) {
      // Drop the oldest never-approved device rather than refusing forever.
      const i = list.findIndex((d) => !d.approved);
      if (i === -1) throw new Error('Too many devices. Remove some in the companion app.');
      list.splice(i, 1);
    }
    const id = 'dev-' + randomHex(6), token = randomHex(32);
    const label = String(name || '').trim().slice(0, 40) || (kind === 'phone' ? 'Phone' : 'Screen') + ' ' + (list.filter((d) => d.kind === kind).length + 1);
    list.push({ id, name: label, kind, approved: !!approved, hash: await sha256(token), created: now(), seen: now() });
    await saveAll(list);
    return { id, token, approved: !!approved, name: label };
  }

  // The device for a key, or null. Updates "last seen" at most once a minute.
  async function verify(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const hash = await sha256(token);
    const list = await all();
    const d = list.find((x) => x.hash === hash);
    if (!d) return null;
    if (now() - d.seen > 60e3) { d.seen = now(); await saveAll(list); }
    return { id: d.id, name: d.name, kind: d.kind, approved: d.approved };
  }

  async function update(id, patch) {
    const list = await all();
    const d = list.find((x) => x.id === id);
    if (!d) throw new Error('Unknown device');
    if (typeof patch.approved === 'boolean') d.approved = patch.approved;
    if (typeof patch.name === 'string' && patch.name.trim()) d.name = patch.name.trim().slice(0, 40);
    await saveAll(list);
    return { id: d.id, name: d.name, kind: d.kind, approved: d.approved };
  }
}

// Is this address on a home network (private ranges, loopback)? Used to approve screens
// automatically on a home server. Cloudflare deployments never pass an address.
export function isPrivateAddress(ip) {
  if (!ip) return false;
  ip = String(ip).replace(/^::ffff:/i, '');
  if (ip === '::1' || /^127\./.test(ip)) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^169\.254\./.test(ip)) return true;
  return /^(fc|fd|fe80)/i.test(ip); // IPv6 unique-local and link-local
}
