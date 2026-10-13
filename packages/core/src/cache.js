// A small in-memory cache, so a busy screen (or several screens) doesn't hammer the free
// upstream APIs. Concurrent callers for the same key share one in-flight request.

export function makeCache({ now = () => Date.now(), maxEntries = 2000 } = {}) {
  const hits = new Map();
  const pending = new Map();

  async function remember(key, ttlMs, fn) {
    const hit = hits.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    if (pending.has(key)) return pending.get(key);
    const run = (async () => {
      try {
        const value = await fn();
        hits.set(key, { at: now(), value });
        if (hits.size > maxEntries) hits.delete(hits.keys().next().value); // oldest first
        return value;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, run);
    return run;
  }

  remember.clear = () => { hits.clear(); pending.clear(); };
  return remember;
}
