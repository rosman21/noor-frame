// API keys and other secrets, encrypted at rest with AES-GCM (WebCrypto, so it works on Node
// and Cloudflare). Secrets are write-only from the outside: callers can store one, use it on the
// server, or ask whether it is set (with its last 4 characters) — never read it back over the API.
//
// The encryption key comes from FRAME_SECRET (env) or, on a home server, a generated
// data/secret.key file (see apps/server/src/node.js).

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function fromB64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

async function deriveKey(secretMaterial) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode('noor-frame:secrets:v1:' + secretMaterial));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function makeSecrets(store, secretMaterial) {
  // Checked here, not inside the async key derivation, so a bad secret stops the server at startup.
  if (!secretMaterial || String(secretMaterial).length < 16) throw new Error('FRAME_SECRET must be at least 16 characters');
  const keyPromise = deriveKey(secretMaterial);
  const storeKey = (owner, name) => `secret:${owner}:${name}`;

  return {
    async set(owner, name, value) {
      const v = String(value ?? '').trim();
      if (!v) return this.remove(owner, name);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(storeKey(owner, name)) }, await keyPromise, enc.encode(v)));
      await store.put(storeKey(owner, name), { v: 1, iv: toB64(iv), ct: toB64(ct), last4: v.slice(-4), at: Date.now() });
    },
    // Server-side use only (e.g. calling an API with the key).
    async get(owner, name) {
      const rec = await store.get(storeKey(owner, name));
      if (!rec) return null;
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(rec.iv), additionalData: enc.encode(storeKey(owner, name)) },
        await keyPromise, fromB64(rec.ct),
      );
      return dec.decode(pt);
    },
    // Safe to send anywhere: whether it's set, and enough to recognise which key it is.
    async info(owner, name) {
      const rec = await store.get(storeKey(owner, name));
      return rec ? { set: true, last4: rec.last4, at: rec.at } : { set: false };
    },
    async remove(owner, name) { await store.del(storeKey(owner, name)); },
  };
}
