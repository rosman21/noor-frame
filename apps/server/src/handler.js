// The whole API as one fetch-style function (Request -> Response), shared by the home-server
// entry (node.js) and the Cloudflare entry (worker.js). Most routes come from the enabled
// integrations; this file adds the household routes (settings, devices, version) and access rules.
//
// Reading the dashboard is open. Changing anything needs an approved device key, sent as
// "Authorization: Bearer <key>". Screens get one from POST /api/devices/register; on a home
// network they're approved straight away.

import { makeRegistry, makeContext, makeCache, makeSecrets, makeDevices, makeLock, isPrivateAddress, json, randomToken } from '@noor-frame/core';
import { defaultIntegrations } from './integrations.js';

// Screens with their own settings may still send them as query parameters; they apply to that
// request only. Household settings saved on the server are the normal way.
export function overridesFrom(url) {
  const q = url.searchParams, num = (k) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : NaN);
  const o = {};
  if (Number.isFinite(num('lat')) && Number.isFinite(num('lon'))) {
    o.location = { latitude: num('lat'), longitude: num('lon'), city: q.get('place') || '', region: q.get('region') || '', timezone: q.get('tz') || '' };
  }
  if (Number.isFinite(num('method'))) (o.prayer ||= {}).method = num('method');
  if (Number.isFinite(num('school'))) (o.prayer ||= {}).school = num('school');
  if (q.get('units') === 'celsius' || q.get('units') === 'fahrenheit') o.weather = { units: q.get('units') };
  if (/^[a-z]{2}\.[a-z]+$/.test(q.get('translation') || '')) (o.quran ||= {}).translation = q.get('translation');
  if (/^[a-z]{2}\.[a-z]+$/.test(q.get('reciter') || '')) (o.quran ||= {}).reciter = q.get('reciter');
  return o;
}

// Household data that screens show. Writing any of it bumps a version number, which screens
// poll (GET /api/version) so a change on one screen appears on the others within seconds.
const SHARED = /^(settings:|integrations$|calendars$|calendarOverrides$|secret:)/;
function versioned(store) {
  if (!store) return null;
  const bump = async (key) => {
    if (SHARED.test(key)) await store.put('meta:version', ((await store.get('meta:version')) || 0) + 1);
  };
  return {
    ...store,
    async put(key, value, ttl) { await store.put(key, value, ttl); await bump(key); },
    async del(key) { await store.del(key); await bump(key); },
  };
}

// A pairing code is what a screen shows as a QR code. Scanning it proves you're standing at an
// approved screen, so a phone that presents it is signed in (POST /api/companion/claim), and the
// simple calendar page accepts it too. Codes last 15 minutes and can be scanned by several phones.
const PAIR_TTL = 15 * 60;

const bearer = (request) => (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
const readBody = (request) => request.json().catch(() => ({}));

// The first screen on a server that approves nothing automatically (Cloudflare, or a home server
// with NOOR_AUTO_APPROVE=0) is approved with a setup code the operator chose: open the dashboard
// once with ?setup=<code>. Codes shorter than 12 characters are ignored.
function setupCodeMatches(expected, given) {
  if (!expected || expected.length < 12 || typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// config: frame.config.json · store: makeFileStore/makeKvStore (null = read-only) ·
// secretMaterial: FRAME_SECRET · clientIp(request): the caller's address (home server only) ·
// setupCode: approves a screen that registers with it (NOOR_SETUP_CODE / FRAME_SETUP_CODE).
export function createHandler({
  config = {}, store: rawStore = null, secretMaterial = null, integrations = defaultIntegrations,
  lanIp = () => null, lanUrl = () => null, clientIp = () => null, setupCode = null, log = console,
} = {}) {
  const store = versioned(rawStore);
  const secrets = store && secretMaterial ? makeSecrets(store, secretMaterial) : null;
  const devices = store ? makeDevices(store) : null;
  const registry = makeRegistry({ integrations, config, store, secrets });
  const remember = makeCache();
  // New devices per caller address (and in all) per 10 minutes. A screen registers once, so this
  // only slows down something flooding the list, which would push out screens waiting for approval.
  const registrations = makeLimiter({ each: 10, total: 60, windowMs: 10 * 60e3 });
  // Changes are read-modify-write (settings, calendars, devices), so they run one at a time.
  const oneAtATime = makeLock();

  // Who is calling: an approved device, a pending one, or nobody.
  async function caller(request) {
    return devices ? devices.verify(bearer(request)) : null;
  }
  function deny(device) {
    if (!devices) return json({ error: 'Changing settings needs storage. On Cloudflare, add a KV namespace named FRAME_KV.' }, 501);
    if (!device) return json({ error: 'This screen isn’t registered with the server yet. Reload it to register.' }, 401);
    return json({ error: 'This screen is waiting for approval. Approve it from the companion app on your phone.', pending: true }, 403);
  }

  // ------------------------------------------------------------ household routes
  const household = {
    'GET /api/version': async () => json({ version: store ? (await store.get('meta:version')) || 0 : 0 }),

    'POST /api/devices/register': async (request) => {
      if (!devices) return deny(null);
      if (!registrations.take(clientIp(request) || '')) return json({ error: 'Too many new screens at once. Try again in a few minutes.' }, 429);
      const body = await readBody(request);
      const approved = isPrivateAddress(clientIp(request)) || setupCodeMatches(setupCode, body.setupCode);
      const d = await devices.register({ name: body.name, kind: body.kind === 'phone' ? 'phone' : 'screen', approved });
      return json(d, 201);
    },
    'POST /api/pair': { auth: true, run: async (request, me) => {
      const token = randomToken();
      await store.put('pair:' + token, { expires: Date.now() + PAIR_TTL * 1000, by: me.id, added: [], phones: [] }, PAIR_TTL);
      return json({ token, expiresIn: PAIR_TTL });
    } },
    // The screen showing the QR code polls this to say what happened on the phone.
    'GET /api/pair/status': async (request) => {
      const pair = store && (await store.get('pair:' + new URL(request.url).searchParams.get('token')));
      return json(pair ? { status: 'waiting', added: pair.added || [], phones: pair.phones || [] } : { status: 'expired', added: [], phones: [] });
    },
    // A phone that scanned the QR code: give it its own approved key.
    'POST /api/companion/claim': async (request) => {
      if (!devices) return deny(null);
      const body = await readBody(request);
      const key = 'pair:' + String(body.token || '');
      const pair = /^[0-9a-f]{32}$/.test(body.token || '') ? await store.get(key) : null;
      if (!pair) return json({ error: 'This QR code has expired. Show a new one on the frame (Settings → Open on phone).' }, 403);
      const d = await devices.register({ name: body.name, kind: 'phone', approved: true });
      pair.phones = (pair.phones || []).concat(d.name);
      await store.put(key, pair, Math.max(60, Math.round((pair.expires - Date.now()) / 1000)));
      return json(d, 201);
    },
    'GET /api/devices/me': async (request) => {
      const d = await caller(request);
      return d ? json(d) : json({ error: 'Unknown device' }, 401);
    },
    'GET /api/devices': { auth: true, run: async () => json({ devices: await devices.list() }) },
    'POST /api/devices/update': { auth: true, run: async (request) => {
      const b = await readBody(request);
      return json(await devices.update(b.id, { approved: b.approved, name: b.name }));
    } },
    'POST /api/devices/remove': { auth: true, run: async (request, me) => {
      const b = await readBody(request);
      if (b.id === me.id) return json({ error: 'A device can’t remove itself.' }, 400);
      await devices.remove(b.id);
      return json({ ok: true });
    } },

    // Every integration, whether it's on, and its settings (keys only as "set, ends in 1234").
    'GET /api/settings': { auth: true, run: async () => json({ integrations: await registry.describe(), saved: await registry.savedKeys() }) },

    // { section: 'prayer', values: { method: 3 } }  or  { integration: 'travel', values: {…} }.
    // A null value goes back to the default.
    'POST /api/settings': { auth: true, run: async (request) => {
      const b = await readBody(request);
      const integ = b.integration ? registry.get(b.integration) : registry.forSection(b.section);
      if (!integ?.section) return json({ error: 'Unknown settings section' }, 400);
      try { await registry.saveSettings(integ.id, b.values || {}); }
      catch (err) { return json({ error: err.message }, 400); }
      return json({ ok: true, section: integ.section, values: await registry.settingsFor(integ.section) });
    } },

    'POST /api/integrations': { auth: true, run: async (request) => {
      const b = await readBody(request);
      try { await registry.setEnabled(b.id, !!b.enabled); }
      catch (err) { return json({ error: err.message }, 400); }
      return json({ ok: true, features: await registry.features() });
    } },
  };

  function handle(request) {
    return request.method === 'GET' || request.method === 'HEAD' ? respond(request) : oneAtATime(() => respond(request));
  }

  async function respond(request) {
    const url = new URL(request.url);
    const ctx = makeContext({
      request, registry, config, store, secrets, remember, overrides: overridesFrom(url),
      extras: { lanIp: lanIp(), devices },
    });
    try {
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return json({
          ...(await registry.publicConfig(ctx)),
          lanIp: ctx.lanIp,
          lanUrl: lanUrl(),
          features: await registry.features(),
          saved: await registry.savedKeys(),
          canSave: !!store,
        });
      }

      const own = household[`${request.method} ${url.pathname}`];
      if (own) {
        if (typeof own === 'function') return await own(request);
        const me = await caller(request);
        if (!me?.approved) return deny(me);
        return await own.run(request, me);
      }

      const hit = await registry.route(request);
      if (hit) {
        if (hit.auth === 'device') {
          const me = await caller(request);
          if (!me?.approved) return deny(me);
          ctx.device = me;
        }
        return await hit.handler(request, ctx);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      log.error?.(`[${request.method} ${url.pathname}]`, err.message);
      return json({ error: err.message }, 502);
    }
  }

  handle.registry = registry;
  handle.devices = devices;
  return handle;
}

// Fixed-window counters: take(key) is false once `each` uses by one key, or `total` by all, have
// happened in the current window.
function makeLimiter({ each, total, windowMs, now = () => Date.now() }) {
  let start = 0, all = 0, counts = new Map();
  return {
    take(key) {
      if (now() - start >= windowMs) { start = now(); all = 0; counts = new Map(); }
      const n = counts.get(key) || 0;
      if (n >= each || all >= total) return false;
      counts.set(key, n + 1);
      all += 1;
      return true;
    },
  };
}
