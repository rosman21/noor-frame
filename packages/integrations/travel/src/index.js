// Travel time to calendar events that have a real place, so the frame can say "leave in 10 min".
//  - With a Google Maps key: Google Routes API, with live traffic.
//  - Without one: a free estimate (OpenStreetMap geocoding + OSRM routing), no live traffic.
// Only upcoming events get a time, and results are cached, to keep API use small.
// It hooks into the calendar integration's "events" hook, so it works with any calendar source.

import { defineIntegration, getJson, json } from '@noor-frame/core';

// Locations that aren't somewhere you travel to.
const VIRTUAL = /(zoom|meet\.google|teams|webex|skype|facetime|https?:\/\/|\bonline\b|\bvirtual\b|\bphone\b|\bcall\b|^home$)/i;

// Nominatim's usage policy allows 1 request per second, so lookups share one queue.
let queue = Promise.resolve();
function throttled(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

function lookup(query, near) {
  return throttled(async () => {
    const q = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' });
    // Prefer results near home, but still allow anything.
    if (near) q.set('viewbox', [near.longitude - 1, near.latitude + 1, near.longitude + 1, near.latitude - 1].join(','));
    const res = await getJson(`https://nominatim.openstreetmap.org/search?${q}`);
    return res[0] ? { latitude: Number(res[0].lat), longitude: Number(res[0].lon) } : null;
  });
}

// Calendar locations are messy ("Place, street, city"), so try a few shapes of the address.
// Misses are cached too, so a bad address isn't looked up on every refresh.
async function geocode(ctx, query, near) {
  const hit = await ctx.remember(`geo-${query}`, 30 * 864e5, async () => {
    const parts = query.split(',').map((s) => s.trim()).filter(Boolean);
    const tries = [query];
    if (parts.length > 2) tries.push(parts.slice(1).join(', '), [parts[0]].concat(parts.slice(-2)).join(', '));
    for (const t of tries) {
      const r = await lookup(t, near);
      if (r) return r;
    }
    return null;
  });
  if (!hit) throw new Error('Address not found');
  return hit;
}

// Google bills every lookup, so the household sets a daily cap (Travel times → Google lookups per
// day). Lookups are counted in storage, one at a time so parallel trips can't overshoot it.
let counting = Promise.resolve();
function localDate(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function takeGoogleLookup(ctx, tz, limit) {
  const run = counting.then(async () => {
    if (!ctx.store) return true; // read-only server: nothing to count in, and no key saved from a phone
    const key = 'travel:google:' + localDate(tz);
    const used = (await ctx.store.get(key)) || 0;
    if (used >= limit) return false;
    await ctx.store.put(key, used + 1, 3 * 86400);
    return true;
  });
  counting = run.catch(() => {});
  return run;
}

export function mapsUrl(home, dest, mode) {
  const q = new URLSearchParams({ api: '1', destination: dest, travelmode: mode });
  if (home.address) q.set('origin', home.address);
  return `https://www.google.com/maps/dir/?${q}`;
}

// ------------------------------------------------------------ Google
const LIMIT_MSG = (n) => `Google Maps: today’s lookup limit (${n}) is used up, so travel times are free estimates until midnight. Raise it in the companion app (Travel times).`;

// One Google Maps Platform request, with the key in a header (never the URL). Account problems
// (wrong key, API not turned on, billing) become errors marked .service, worded for people.
async function google(t, url, body, fieldMask, api) {
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': t.googleMapsApiKey };
  if (fieldMask) headers['x-goog-fieldmask'] = fieldMask;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    const disabled = /has not been used|is disabled|SERVICE_DISABLED/.test(msg + JSON.stringify(data.error?.details || ''));
    const err = new Error(disabled
      ? `Google Maps: the ${api} isn’t turned on for this key’s Google Cloud project. Turn it on in Google Cloud (APIs & Services → Library → ${api}), then wait a few minutes.${api === 'Routes API' ? ' Travel times are free estimates until then.' : ''}`
      : `Google Maps: ${msg}${api === 'Routes API' ? ' Travel times are free estimates until this is fixed.' : ''}`);
    err.service = true;
    throw err;
  }
  return data;
}

// Where trips start, for Google: the checked spot when there is one, otherwise the address.
function origin(home) {
  return home.checked || !home.address
    ? { location: { latLng: { latitude: home.latitude, longitude: home.longitude } } }
    : { address: home.address };
}

async function googleRoute(t, home, dest, departAt) {
  const mode = { driving: 'DRIVE', walking: 'WALK', bicycling: 'BICYCLE', transit: 'TRANSIT' }[t.mode] || 'DRIVE';
  const body = { origin: origin(home), destination: typeof dest === 'string' ? { address: dest } : dest, travelMode: mode };
  if (mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
    body.departureTime = new Date(Math.max(departAt, Date.now() + 60e3)).toISOString();
  }
  const data = await google(t, 'https://routes.googleapis.com/directions/v2:computeRoutes', body, 'routes.duration,routes.distanceMeters', 'Routes API');
  const r = data.routes?.[0];
  if (!r) throw new Error('No route');
  return { minutes: Math.max(1, Math.round(parseInt(r.duration, 10) / 60)), km: Math.round(r.distanceMeters / 100) / 10, source: 'google' };
}

async function viaGoogle(ctx, t, home, dest, departAt, ttl, tz) {
  const slot = Math.floor(departAt / (15 * 60e3)); // one lookup per 15-minute departure slot
  return ctx.remember(`gmaps-${dest}-${t.mode}-${slot}`, ttl, async () => {
    if (!(await takeGoogleLookup(ctx, tz, t.googleDailyLimit))) {
      const err = new Error(LIMIT_MSG(t.googleDailyLimit));
      err.limit = true;
      throw err;
    }
    return googleRoute(t, home, dest, departAt);
  });
}

// The home address through Google's Address Validation API. Its exact spot is saved, so trips
// start from where Google placed the house rather than a guess.
const GOOD = new Set(['PREMISE', 'SUB_PREMISE', 'PREMISE_PROXIMITY']);
const PARTS = { postal_code: 'ZIP or postal code', street_number: 'house number', route: 'street', locality: 'town or city', administrative_area_level_1: 'state or province', country: 'country', subpremise: 'apartment or unit' };
async function validateHome(t, loc) {
  const address = { addressLines: [t.home] };
  if (loc.code) address.regionCode = loc.code;
  const data = await google(t, 'https://addressvalidation.googleapis.com/v1:validateAddress', { address }, null, 'Address Validation API');
  const r = data.result || {};
  const v = r.verdict || {};
  const unconfirmed = (r.address?.unconfirmedComponentTypes || []).concat(r.address?.missingComponentTypes || []);
  return {
    formatted: r.address?.formattedAddress || '',
    latitude: r.geocode?.location?.latitude, longitude: r.geocode?.location?.longitude,
    good: !!v.addressComplete && GOOD.has(v.validationGranularity) && !v.hasUnconfirmedComponents,
    problems: [...new Set(unconfirmed.map((c) => PARTS[c] || c.replace(/_/g, ' ')))],
  };
}
const sameAddress = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]/g, '') === String(b).toLowerCase().replace(/[^a-z0-9]/g, '');

async function viaOsm(ctx, t, home, dest) {
  const mode = t.mode === 'walking' ? 'foot' : 'driving';
  return ctx.remember(`osrm-${dest}-${mode}`, 864e5, async () => {
    const to = await geocode(ctx, dest, home);
    const res = await getJson(`https://router.project-osrm.org/route/v1/${mode}/${home.longitude},${home.latitude};${to.longitude},${to.latitude}?overview=false`);
    const r = res.routes?.[0];
    if (!r) throw new Error('No route');
    // OSRM assumes empty roads; add 25% so town estimates aren't optimistic.
    const factor = mode === 'driving' ? 1.25 : 1;
    return { minutes: Math.max(1, Math.round((r.duration * factor) / 60)), km: Math.round(r.distance / 100) / 10, source: 'estimate' };
  });
}

// Adds e.travel = { minutes, km, source, mode, mapsUrl } to upcoming events with a real place.
// Resolves to true when some lookups are still running (they finish in the background).
// Google Maps account problems are added to `problems` (once each), so screens can show them;
// an address that can't be found just leaves that event without a time.
export async function addTravel(events, ctx, problems = []) {
  const t = await ctx.settings('travel');
  if (t.enabled === false) return false;
  const loc = await ctx.location();
  let home;
  const checked = t.home && ctx.store ? await ctx.store.get('travel:home') : null;
  if (checked && checked.for === t.home && checked.latitude != null) {
    home = { address: t.home, latitude: checked.latitude, longitude: checked.longitude, checked: true };
  } else {
    try {
      home = t.home ? { address: t.home, ...(await geocode(ctx, t.home)) } : { latitude: loc.latitude, longitude: loc.longitude };
    } catch {
      home = { address: t.home, latitude: loc.latitude, longitude: loc.longitude };
    }
  }
  const now = Date.now(), horizon = now + t.lookaheadHours * 3600e3;

  const jobs = events.filter((e) => !e.allDay && e.loc && !VIRTUAL.test(e.loc.trim())).map(async (e) => {
    const start = Date.parse(e.start), end = Date.parse(e.end);
    if (end < now || start > horizon) return;
    const dest = e.loc.replace(/\s*\n\s*/g, ', ').trim();
    try {
      // Live traffic is refreshed often only for trips in the next 3 hours.
      const ttl = start - now < 3 * 3600e3 ? 15 * 60e3 : 6 * 3600e3;
      let r;
      if (t.googleMapsApiKey) {
        try {
          r = await viaGoogle(ctx, t, home, dest, start - 30 * 60e3, ttl, loc.timezone);
        } catch (err) {
          // Over the daily limit, or Google refused (key, API, billing): use the free estimate.
          if (!err.limit && !err.service) throw err;
          if (!problems.includes(err.message)) problems.push(err.message);
          r = await viaOsm(ctx, t, home, dest);
        }
      } else {
        r = await viaOsm(ctx, t, home, dest);
      }
      e.travel = { ...r, mode: t.mode, mapsUrl: mapsUrl(home, dest, t.mode) };
    } catch (err) {
      if (err.service && !problems.includes(err.message)) problems.push(err.message);
      e.travel = { minutes: null, mode: t.mode, mapsUrl: mapsUrl(home, dest, t.mode) };
    }
  });
  // Don't hold up the calendar for slow first-time lookups.
  let timer;
  const done = await Promise.race([
    Promise.all(jobs).then(() => true),
    new Promise((r) => { timer = setTimeout(() => r(false), t.waitMs); }),
  ]);
  clearTimeout(timer);
  return !done;
}

// Address suggestions while typing the home address in the companion (Google Places API (New),
// Autocomplete). Each request counts towards the daily limit. → { suggestions: [text], note? }
export async function suggestPlaces(ctx, input, session) {
  const t = await ctx.settings('travel');
  if (!t.googleMapsApiKey) return { suggestions: [], note: 'Add a Google Maps key for address suggestions.' };
  const loc = await ctx.location();
  if (!(await takeGoogleLookup(ctx, loc.timezone, t.googleDailyLimit))) return { suggestions: [], note: 'Today’s Google lookup limit is used up.' };
  const body = {
    input,
    locationBias: { circle: { center: { latitude: loc.latitude, longitude: loc.longitude }, radius: 50000 } },
  };
  if (loc.code) body.includedRegionCodes = [loc.code.toLowerCase()];
  if (/^[\w-]{8,64}$/.test(session || '')) body.sessionToken = session;
  try {
    const data = await google(t, 'https://places.googleapis.com/v1/places:autocomplete', body, 'suggestions.placePrediction.text.text', 'Places API (New)');
    return { suggestions: (data.suggestions || []).map((s) => s.placePrediction?.text?.text).filter(Boolean).slice(0, 5) };
  } catch (err) {
    if (err.service) return { suggestions: [], note: err.message };
    throw err;
  }
}

// Settings → Travel times → "Check address and routes" in the companion. Each item is
// { ok: true | false | null (a warning), title, detail, fix?: { key, value, label } }.
export async function checkTravel(ctx) {
  const t = await ctx.settings('travel');
  const loc = await ctx.location();
  const items = [];
  if (!t.googleMapsApiKey) {
    items.push({ ok: null, title: 'No Google Maps key', detail: 'Travel times are free estimates from OpenStreetMap. Add a key for live traffic and address checks.' });
    if (t.home) {
      try { await geocode(ctx, t.home); items.push({ ok: true, title: 'Home address found', detail: t.home }); }
      catch { items.push({ ok: false, title: 'Home address not found', detail: `OpenStreetMap couldn’t find “${t.home}”. Check the spelling, or leave it empty to start trips from ${loc.name}.` }); }
    }
    return { items };
  }
  const take = () => takeGoogleLookup(ctx, loc.timezone, t.googleDailyLimit);

  let home = { latitude: loc.latitude, longitude: loc.longitude };
  if (!t.home) {
    items.push({ ok: null, title: 'No home address', detail: `Trips start from the middle of ${loc.name}. Add your address above for exact times.` });
  } else if (!(await take())) {
    return { items: [{ ok: false, title: 'Daily limit reached', detail: LIMIT_MSG(t.googleDailyLimit) }] };
  } else {
    try {
      const v = await validateHome(t, loc);
      if (v.latitude != null) {
        home = { address: t.home, latitude: v.latitude, longitude: v.longitude, checked: true };
        if (ctx.store) await ctx.store.put('travel:home', { for: t.home, formatted: v.formatted, latitude: v.latitude, longitude: v.longitude, at: Date.now() });
      }
      const fix = v.formatted && !sameAddress(v.formatted, t.home) ? { key: 'home', value: v.formatted, label: 'Use this address' } : undefined;
      if (v.good && !fix) items.push({ ok: true, title: 'Home address confirmed', detail: v.formatted || t.home });
      else if (v.good) items.push({ ok: null, title: 'Google suggests a correction', detail: v.formatted, fix });
      else items.push({
        ok: false, title: 'Google couldn’t confirm this address',
        detail: (v.problems.length ? `Check the ${v.problems.join(', ')}. ` : '') + (v.formatted ? `Closest match: ${v.formatted}` : 'No match found.'),
        fix,
      });
    } catch (err) {
      items.push({ ok: false, title: 'Address check failed', detail: err.message });
    }
  }

  if (!(await take())) {
    items.push({ ok: false, title: 'Daily limit reached', detail: LIMIT_MSG(t.googleDailyLimit) });
    return { items };
  }
  try {
    // Home → the middle of town; without a home address, a short hop north of the middle of town.
    const to = t.home ? { latitude: loc.latitude, longitude: loc.longitude } : { latitude: loc.latitude + 0.045, longitude: loc.longitude };
    const r = await googleRoute(t, home, { location: { latLng: to } }, Date.now());
    items.push({ ok: true, title: 'Routes work', detail: t.home
      ? `A test trip from home to the middle of ${loc.name}: ${r.minutes} min, ${r.km} km${t.mode === 'driving' ? ' with today’s traffic' : ''}.`
      : `A test trip in ${loc.name}: ${r.minutes} min, ${r.km} km.` });
  } catch (err) {
    items.push({ ok: false, title: 'Route check failed', detail: err.message });
  }
  return { items };
}

export default defineIntegration({
  id: 'travel',
  name: 'Travel times',
  description: 'How long it takes to get to calendar events, and when to leave. Free estimates, or live traffic with a Google Maps key.',
  section: 'travel',
  optional: true,
  enabledByDefault: true,
  settings: [
    { key: 'home', type: 'string', label: 'Home address', maxLength: 200, help: 'Where trips start. Leave empty to use your city.', autocomplete: '/api/travel/places' },
    { key: 'mode', type: 'select', label: 'Usually travel by', default: 'driving', options: [{ value: 'driving', label: 'Car' }, { value: 'walking', label: 'Walking' }, { value: 'transit', label: 'Transit (needs Google key)' }, { value: 'bicycling', label: 'Bike (needs Google key)' }] },
    { key: 'googleMapsApiKey', type: 'secret', label: 'Google Maps API key (optional)', help: 'Adds live traffic. Needs the Routes API enabled in Google Cloud. Google bills each lookup to your account.' },
    { key: 'googleDailyLimit', type: 'number', label: 'Google lookups per day', default: 100, min: 0, max: 5000, help: 'Live-traffic lookups stop for the day at this number, and free estimates are used until midnight. Each upcoming trip is checked about every 15 minutes in the 3 hours before it.' },
    { key: 'lookaheadHours', type: 'number', label: 'Look ahead (hours)', default: 36, min: 1, max: 168, advanced: true },
    { key: 'waitMs', type: 'number', label: 'Wait for lookups (ms)', default: 4000, min: 0, max: 20000, advanced: true },
  ],
  routes: {
    'POST /api/travel/check': { auth: 'device', handler: async (request, ctx) => json(await checkTravel(ctx)) },
    'POST /api/travel/places': { auth: 'device', handler: async (request, ctx) => {
      const b = await request.json().catch(() => ({}));
      const input = String(b.input || '').trim();
      if (input.length < 3 || input.length > 200) return json({ suggestions: [] });
      return json(await suggestPlaces(ctx, input, b.session));
    } },
  },
  check: { label: 'Check address and routes', path: '/api/travel/check' },
  hooks: {
    events: async ({ events }, ctx) => {
      const problems = [];
      const travelPending = await addTravel(events, ctx, problems);
      return { travelPending, errors: problems };
    },
  },
  features: ['travel'],
});
