// Small key-value storage for household data: settings, calendars added from a phone,
// pairing codes, encrypted keys. Values are JSON. `ttlSeconds` expires short-lived entries.
//  - Home server / Pi: a JSON file (makeFileStore).
//  - Cloudflare: a Workers KV namespace (makeKvStore).
//  - Tests: makeMemoryStore.

export function makeMemoryStore({ now = () => Date.now() } = {}) {
  const data = new Map();
  return {
    async get(key) {
      const e = data.get(key);
      if (!e) return null;
      if (e.exp && e.exp < now()) { data.delete(key); return null; }
      return structuredClone(e.v);
    },
    async put(key, value, ttlSeconds) {
      data.set(key, { v: structuredClone(value), exp: ttlSeconds ? now() + ttlSeconds * 1000 : 0 });
    },
    async del(key) { data.delete(key); },
    async keys(prefix = '') { return [...data.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

// `fs` is node:fs, passed in so this module never imports Node built-ins (it is also bundled
// for Cloudflare). Writes go to a temp file and are renamed, so a power cut can't leave half a file.
export function makeFileStore(file, fs) {
  let cache = null;
  function load() {
    if (!cache) {
      try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
    }
    return cache;
  }
  function persist() {
    fs.mkdirSync(file.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(cache, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  return {
    async get(key) {
      const e = load()[key];
      if (!e) return null;
      if (e.exp && e.exp < Date.now()) { delete cache[key]; persist(); return null; }
      return structuredClone(e.v);
    },
    async put(key, value, ttlSeconds) {
      load()[key] = { v: value, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 };
      persist();
    },
    async del(key) { delete load()[key]; persist(); },
    async keys(prefix = '') { return Object.keys(load()).filter((k) => k.startsWith(prefix)); },
  };
}

export function makeKvStore(kv) {
  return {
    async get(key) { return kv.get(key, 'json'); },
    async put(key, value, ttlSeconds) {
      // KV's shortest expiry is 60 seconds.
      await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: Math.max(60, ttlSeconds) } : undefined);
    },
    async del(key) { await kv.delete(key); },
    async keys(prefix = '') { return (await kv.list({ prefix })).keys.map((k) => k.name); },
  };
}
