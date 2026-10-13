// The per-request context handed to every integration route, hook and tool.
//
//   ctx.settings('prayer')   resolved settings for a section (secrets included — server only)
//   ctx.location()           { name, region, latitude, longitude, timezone }
//   ctx.remember(key, ms, fn) shared in-memory cache
//   ctx.store / ctx.secrets  household storage (may be null on a read-only deployment)
//   ctx.registry             to run hooks or look at other integrations
//   ctx.config               frame.config.json (first-run defaults)

import { resolveLocation } from './location.js';

export function makeContext({ request = null, registry, config = {}, store = null, secrets = null, remember, overrides = {}, extras = {} }) {
  const memo = new Map();
  const ctx = {
    request,
    url: request ? new URL(request.url) : null,
    registry, config, store, secrets, remember, overrides,
    settings(section) {
      if (!memo.has(section)) memo.set(section, registry.settingsFor(section, { overrides, withSecrets: true }));
      return memo.get(section);
    },
    async location() { return resolveLocation(await ctx.settings('location'), remember); },
    runHook(name, payload) { return registry.runHook(name, payload, ctx); },
    ...extras,
  };
  return ctx;
}
