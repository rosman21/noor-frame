// Cloudflare Workers entry (optional hosting instead of a computer at home).
// Static files come from apps/frame/dist; only /api/* reaches this code.
//
// Settings that would live in frame.config.json go in the FRAME_CONFIG variable (JSON text).
// Saving settings, calendars and keys needs a KV namespace bound as FRAME_KV and a
// FRAME_SECRET secret (`npx wrangler secret put FRAME_SECRET`). See wrangler.jsonc.
//
// Nothing is approved automatically here. Set a FRAME_SETUP_CODE secret (12+ characters) and open
// the dashboard once with ?setup=<code> to approve your first screen; approve the rest from it.
//
// Cloudflare URLs are public: put Cloudflare Access in front before adding real calendars.

import { makeKvStore } from '@noor-frame/core';
import { createHandler } from './handler.js';

let cached = null;
function handlerFor(env) {
  if (!cached) {
    let config = {};
    if (env.FRAME_CONFIG) config = typeof env.FRAME_CONFIG === 'string' ? JSON.parse(env.FRAME_CONFIG) : env.FRAME_CONFIG;
    const store = env.FRAME_KV ? makeKvStore(env.FRAME_KV) : null;
    // No clientIp here: on the public internet nothing is approved automatically; approve screens
    // from the companion app.
    cached = createHandler({ config, store, secretMaterial: env.FRAME_SECRET || null, setupCode: env.FRAME_SETUP_CODE || null });
  }
  return cached;
}

export default {
  fetch(request, env) {
    return handlerFor(env)(request);
  },
};
