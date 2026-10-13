// End-to-end tests of the API through the shared handler, with every outside service faked.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeMemoryStore } from '@noor-frame/core';
import { createHandler } from '../src/handler.js';
import { fakeWorld } from './fake-world.js';

// ------------------------------------------------------------------ fake outside world
const realFetch = globalThis.fetch;
let calls, google;

beforeEach(() => {
  const world = fakeWorld();
  ({ calls, google } = world);
  globalThis.fetch = world.fetch;
});
after(() => { globalThis.fetch = realFetch; });

const CONFIG = {
  location: { city: 'Toronto', country: 'Canada' },
  travel: { waitMs: 3000 },
  calendars: [
    { id: 'family', name: 'Family', color: '#111111', family: true, url: 'demo:family' },
    { id: 'me', name: 'Me', color: '#2D5BFF', url: 'demo:me' },
  ],
};
// `from` is the caller's address as the home server would see it.
function server({ config = CONFIG, store = makeMemoryStore() } = {}) {
  const handle = createHandler({
    config, store, secretMaterial: 'x'.repeat(32), lanIp: () => '192.168.1.5', log: {},
    clientIp: (request) => request.headers.get('x-test-ip'),
  });
  let token = null;
  const call = async (method, path, body, { from = '192.168.1.20', key = token } = {}) => {
    const headers = { 'x-test-ip': from };
    if (body) headers['content-type'] = 'application/json';
    if (key) headers.authorization = 'Bearer ' + key;
    const r = await handle(new Request('http://frame.local' + path, { method, body: body && JSON.stringify(body), headers }));
    return { status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
  };
  // Register this test as a screen on the home network (approved automatically).
  const signIn = async () => { token = (await call('POST', '/api/devices/register', { name: 'Kitchen' })).body.token; return token; };
  return { handle, call, store, signIn };
}

// ------------------------------------------------------------------ tests
test('/api/config has what the frame expects, plus feature flags', async () => {
  const { call } = server();
  const { status, body } = await call('GET', '/api/config');
  assert.equal(status, 200);
  assert.equal(body.location.name, 'Toronto');
  assert.equal(body.location.timezone, 'America/Toronto');
  assert.deepEqual(body.prayer, { method: 2, school: 0 });
  assert.deepEqual(body.weather, { units: 'celsius' });
  assert.deepEqual(body.quran, { translation: 'en.sahih', reciter: 'ar.alafasy' });
  assert.equal(body.athan.reminderMinutes, 10);
  assert.equal(body.display.nav, 'top');
  assert.equal(body.lanIp, '192.168.1.5');
  assert.equal(body.canAddCalendars, true);
  assert.deepEqual(body.calendars.map((c) => c.id), ['family', 'me']);
  assert.deepEqual(body.features.sort(), ['ayah', 'calendar', 'prayer', 'travel', 'weather']);
  assert.equal(JSON.stringify(body).includes('demo:'), false, 'calendar links must not be sent to screens');
});

test('/api/prayer returns a month of times and the Hijri date', async () => {
  const { call } = server();
  const { body } = await call('GET', '/api/prayer?year=2026&month=10');
  assert.equal(Object.keys(body.days).length, 31);
  assert.equal(body.days['2026-10-12'].times.Maghrib, '2026-10-12T22:39:00.000Z');
  assert.equal(body.days['2026-10-12'].hijri.year, 1448);
  assert.equal(body.method, 'Islamic Society of North America (ISNA)');
  assert.equal((await call('GET', '/api/prayer?year=1900&month=1')).status, 400);
});

test('/api/weather returns current, 7 days of hourly values and daily summaries', async () => {
  const { body } = await server().call('GET', '/api/weather');
  assert.equal(body.unit, 'C');
  assert.equal(body.current.temp, 16);
  assert.equal(body.hourly.t.length, 168);
  assert.deepEqual(body.daily[1], { date: '2026-10-13', code: 61, hi: 24, lo: 16, p: 80 });
});

test('/api/ayah checks the date and skips ayat too long for the tile', async () => {
  const { call } = server();
  assert.equal((await call('GET', '/api/ayah')).status, 400);
  const { body } = await call('GET', '/api/ayah?date=2026-10-12');
  assert.ok(body.arabic.length <= 220);
  assert.equal(body.surahName, 'Al-Israa');
  assert.equal(body.audio, '/api/ayah/audio?date=2026-10-12');
  assert.equal(body.audioAlt, null);
});

test('/api/ayah/audio plays only the day\'s recitation, fetched by the server', async () => {
  const { call } = server();
  assert.equal((await call('GET', '/api/ayah/audio')).status, 400);
  assert.equal((await call('GET', '/api/ayah/audio?date=2026-10-12&alt=1')).status, 404);
  const r = await call('GET', '/api/ayah/audio?date=2026-10-12');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'audio/mpeg');
  assert.equal(r.body, 'ID3-recitation');
});

test('/api/calendar expands demo calendars and the travel hook adds trip times', async () => {
  const { body } = await server().call('GET', '/api/calendar');
  assert.ok(body.events.length > 10);
  assert.deepEqual(body.errors, []);
  const costco = body.events.find((e) => e.title === 'Costco run');
  assert.equal(costco.travel.minutes, 25); // 1200 s × 1.25
  assert.equal(costco.travel.source, 'estimate');
  assert.match(costco.travel.mapsUrl, /google\.com\/maps\/dir/);
  assert.equal(body.events.find((e) => e.title === 'Team standup').travel, undefined, 'Zoom meetings get no travel time');
});

// A screen saves the household's Google Maps key (and any other travel settings) like the phone
// companion does.
async function withGoogle(values = {}) {
  const s = server();
  await s.signIn();
  const r = await s.call('POST', '/api/settings', { integration: 'travel', values: { googleMapsApiKey: 'AIzaSyEXAMPLEKEY9876', ...values } });
  assert.equal(r.status, 200);
  return s;
}

test('with a Google Maps key, driving times come from the Routes API with live traffic', async () => {
  const { call } = await withGoogle();
  const { body } = await call('GET', '/api/calendar');
  const costco = body.events.find((e) => e.title === 'Costco run');
  assert.deepEqual([costco.travel.minutes, costco.travel.km, costco.travel.source], [21, 15.4, 'google']);
  assert.deepEqual(body.errors, []);

  const req = google.requests.find((r) => r.body.destination.address.startsWith('Costco'));
  assert.equal(req.path, '/directions/v2:computeRoutes');
  assert.equal(req.headers.get('x-goog-api-key'), 'AIzaSyEXAMPLEKEY9876', 'the key goes in a header, not the URL');
  assert.equal(req.headers.get('x-goog-fieldmask'), 'routes.duration,routes.distanceMeters');
  assert.equal(req.body.travelMode, 'DRIVE');
  assert.equal(req.body.routingPreference, 'TRAFFIC_AWARE');
  assert.ok(Date.parse(req.body.departureTime) > Date.now(), 'departure time is in the future');
  assert.equal(calls.some((c) => c.startsWith('router.project-osrm.org')), false, 'no free estimate when Google answers');
  assert.equal(JSON.stringify(body).includes('AIza'), false, 'screens never see the key');
});

test('Google transit trips send the transit mode without traffic options', async () => {
  const { call } = await withGoogle({ mode: 'transit' });
  const { body } = await call('GET', '/api/calendar');
  const req = google.requests.find((r) => r.body.destination.address.startsWith('Costco'));
  assert.equal(req.body.travelMode, 'TRANSIT');
  assert.equal(req.body.routingPreference, undefined);
  assert.equal(req.body.departureTime, undefined);
  const costco = body.events.find((e) => e.title === 'Costco run');
  assert.equal(costco.travel.mode, 'transit');
  assert.match(costco.travel.mapsUrl, /travelmode=transit/);
});

test('when Google refuses, the problem is explained once and trips use free estimates', async () => {
  google.reply = { status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Routes API has not been used in project 123 before or it is disabled.' } } };
  const { call } = await withGoogle();
  const { body } = await call('GET', '/api/calendar');
  assert.equal(body.errors.length, 1);
  assert.match(body.errors[0], /Routes API isn’t turned on/);
  assert.ok(calls.some((c) => c.startsWith('nominatim.openstreetmap.org')), 'free estimates instead');
  const costco = body.events.find((e) => e.title === 'Costco run');
  assert.match(costco.travel.mapsUrl, /google\.com\/maps\/dir/);

  google.reply = { status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } } };
  const again = await withGoogle();
  const r = await again.call('GET', '/api/calendar');
  assert.match(r.body.errors[0], /^Google Maps: API key not valid\. .*free estimates/);
});

test('without a Google key, the travel check says trips are free estimates', async () => {
  const { call, signIn } = server();
  await signIn();
  await call('POST', '/api/settings', { integration: 'travel', values: { home: '100 Queen St W, Toronto' } });
  const { body } = await call('POST', '/api/travel/check');
  assert.equal(body.items[0].title, 'No Google Maps key');
  assert.equal(body.items[1].title, 'Home address found');
  assert.equal(google.validations.length, 0);
});

test('the travel check confirms the home address and that routes work, and trips start there', async () => {
  const { call } = await withGoogle({ home: '100 Queen Street West, Toronto ON M5H 2N2, Canada' });
  const { body } = await call('POST', '/api/travel/check');
  // Same address, written differently: still a correction worth offering.
  assert.equal(body.items[0].title, 'Google suggests a correction');
  assert.deepEqual(body.items[0].fix, { key: 'home', value: '100 Queen St W, Toronto, ON M5H 2N2, Canada', label: 'Use this address' });
  assert.equal(body.items[1].title, 'Routes work');
  assert.match(body.items[1].detail, /21 min, 15\.4 km/);
  assert.equal(google.validations[0].headers.get('x-goog-api-key'), 'AIzaSyEXAMPLEKEY9876');
  assert.deepEqual(google.validations[0].body.address.addressLines, ['100 Queen Street West, Toronto ON M5H 2N2, Canada']);

  // Taking the fix, the address is confirmed as is.
  await call('POST', '/api/settings', { integration: 'travel', values: { home: body.items[0].fix.value } });
  const again = (await call('POST', '/api/travel/check')).body;
  assert.equal(again.items[0].title, 'Home address confirmed');

  // Trips now start from the spot Google confirmed.
  google.requests.length = 0;
  await call('GET', '/api/calendar');
  const trip = google.requests.find((r) => r.body.destination.address?.startsWith('Costco'));
  assert.deepEqual(trip.body.origin, { location: { latLng: { latitude: 43.6534, longitude: -79.3839 } } });
});

test('an address Google can’t confirm says which part to check', async () => {
  google.validation = { status: 200, body: { result: {
    verdict: { validationGranularity: 'ROUTE', addressComplete: false, hasUnconfirmedComponents: true },
    address: { formattedAddress: '742 Evergreen Terrace, Springfield, ON, Canada', unconfirmedComponentTypes: ['postal_code'] },
    geocode: { location: { latitude: 43.7, longitude: -79.4 } },
  } } };
  const { call } = await withGoogle({ home: '742 Evergreen Terrace, Springfield 123456' });
  const { items } = (await call('POST', '/api/travel/check')).body;
  assert.equal(items[0].ok, false);
  assert.match(items[0].detail, /Check the ZIP or postal code/);
  assert.equal(items[0].fix.value, '742 Evergreen Terrace, Springfield, ON, Canada');
});

test('the travel check explains a turned-off Address Validation API and still tests routes', async () => {
  google.validation = { status: 403, body: { error: { code: 403, message: 'Address Validation API has not been used in project 1 before or it is disabled.' } } };
  const { call } = await withGoogle({ home: '100 Queen St W, Toronto' });
  const { items } = (await call('POST', '/api/travel/check')).body;
  assert.equal(items[0].title, 'Address check failed');
  assert.match(items[0].detail, /Address Validation API isn’t turned on/);
  assert.equal(items[1].title, 'Routes work');
});

test('travel checks count towards the daily Google limit', async () => {
  const { call } = await withGoogle({ home: '100 Queen St W, Toronto', googleDailyLimit: 1 });
  const { items } = (await call('POST', '/api/travel/check')).body;
  assert.equal(google.validations.length, 1);
  assert.equal(google.requests.length, 0);
  assert.equal(items.at(-1).title, 'Daily limit reached');
});

test('address suggestions come from Google Places through the server, near home', async () => {
  const { call } = await withGoogle();
  const { body } = await call('POST', '/api/travel/places', { input: '100 Queen', session: 'session-abc-123' });
  assert.deepEqual(body.suggestions, ['100 Queen St W, Toronto, ON, Canada', '100 Queen St E, Toronto, ON, Canada']);
  const req = google.places[0];
  assert.equal(req.headers.get('x-goog-api-key'), 'AIzaSyEXAMPLEKEY9876');
  assert.equal(req.headers.get('x-goog-fieldmask'), 'suggestions.placePrediction.text.text');
  assert.equal(req.body.sessionToken, 'session-abc-123');
  assert.deepEqual(req.body.includedRegionCodes, ['ca']);
  assert.equal(req.body.locationBias.circle.radius, 50000);
  // Too short to be worth a lookup.
  assert.deepEqual((await call('POST', '/api/travel/places', { input: '10' })).body.suggestions, []);
  assert.equal(google.places.length, 1);
});

test('address suggestions need a key, the Places API, and room under the daily limit', async () => {
  const s = server();
  await s.signIn();
  assert.match((await s.call('POST', '/api/travel/places', { input: '100 Queen' })).body.note, /Add a Google Maps key/);

  google.placesReply = { status: 403, body: { error: { code: 403, message: 'Places API (New) has not been used in project 1 before or it is disabled.' } } };
  const { call } = await withGoogle();
  assert.match((await call('POST', '/api/travel/places', { input: '100 Queen' })).body.note, /Places API \(New\) isn’t turned on/);

  const limited = await withGoogle({ googleDailyLimit: 0 });
  assert.match((await limited.call('POST', '/api/travel/places', { input: '100 Queen' })).body.note, /limit is used up/);
});

test('integrations with a check offer it to the companion, only while switched on', async () => {
  const { call, signIn, handle } = server();
  await signIn();
  const travel = () => call('GET', '/api/settings').then((r) => r.body.integrations.find((i) => i.id === 'travel'));
  assert.deepEqual((await travel()).check, { label: 'Check address and routes', path: '/api/travel/check' });
  await handle.registry.setEnabled('travel', false);
  assert.equal((await travel()).check, null);
  assert.equal((await call('POST', '/api/travel/check')).status, 404);
});

test('the daily Google limit stops lookups and falls back to free estimates', async () => {
  const { call } = await withGoogle({ googleDailyLimit: 0 });
  const { body } = await call('GET', '/api/calendar');
  assert.equal(google.requests.length, 0, 'no billed lookups once the limit is reached');
  assert.ok(calls.some((c) => c.startsWith('nominatim.openstreetmap.org')), 'free estimates instead');
  assert.equal(body.errors.length, 1);
  assert.match(body.errors[0], /today’s lookup limit \(0\) is used up/);
});

test('the daily Google limit counts every lookup, even in parallel', async () => {
  const { call } = await withGoogle({ googleDailyLimit: 1 });
  const { body } = await call('GET', '/api/calendar');
  // The demo has several upcoming trips; all of them ask Google at once.
  assert.equal(google.requests.length, 1);
  assert.match(body.errors[0], /today’s lookup limit \(1\) is used up/);
});

test('Google lookups are cached per 15-minute departure slot', async () => {
  const { call } = await withGoogle();
  await call('GET', '/api/calendar');
  const first = google.requests.length;
  assert.ok(first > 0);
  await call('GET', '/api/calendar');
  assert.equal(google.requests.length, first, 'a refresh reuses the cached times');
});

test('switching travel off removes travel times and its feature flag', async () => {
  const { call, handle } = server();
  await handle.registry.setEnabled('travel', false);
  const cal = await call('GET', '/api/calendar');
  assert.equal(cal.body.events.some((e) => e.travel), false);
  assert.equal(calls.some((c) => c.startsWith('router.project-osrm.org')), false);
  assert.equal((await call('GET', '/api/config')).body.features.includes('travel'), false);
});

test('query overrides from a screen apply to that request only', async () => {
  const { call } = server();
  const r = await call('GET', '/api/config?lat=29.65&lon=-82.32&tz=America/New_York&place=Gainesville&units=fahrenheit&method=3');
  assert.equal(r.body.location.name, 'Gainesville');
  assert.equal(r.body.weather.units, 'fahrenheit');
  assert.equal(r.body.prayer.method, 3);
  assert.equal((await call('GET', '/api/config')).body.location.name, 'Toronto');
});

test('adding calendars from a phone: pair, paste two links, manage them', async () => {
  const { call, signIn } = server();
  await signIn();
  const { body: pair } = await call('POST', '/api/pair');
  assert.match(pair.token, /^[0-9a-f]{32}$/);

  const page = await call('GET', '/api/setup?token=' + pair.token);
  assert.match(page.type, /text\/html/);
  assert.match(page.body, /Add a calendar/);
  // Anything but a real code gets the expired page, and never reaches the page's script.
  for (const token of ['</script><script>alert(1)</script>', pair.token + '"', 'f'.repeat(32)]) {
    const bad = await call('GET', '/api/setup?token=' + encodeURIComponent(token));
    assert.match(bad.body, /This code has expired/);
    assert.ok(!bad.body.includes('alert(1)') && !bad.body.includes(pair.token), token);
    assert.match(bad.body, /token: ""/);
  }

  const add = await call('POST', '/api/setup/calendar', { token: pair.token, url: 'webcal://cal.example/school.ics\nhttps://cal.example/work.ics' });
  assert.deepEqual(add.body.results.map((r) => r.name), ['School', 'Work']);
  assert.notEqual(add.body.results[0].color, add.body.results[1].color);

  const status = await call('GET', '/api/pair/status?token=' + pair.token);
  assert.deepEqual(status.body.added, ['School', 'Work']);

  const list = (await call('GET', '/api/calendars')).body.calendars;
  assert.deepEqual(list.map((c) => c.name), ['Family', 'Me', 'School', 'Work']);
  assert.equal((await call('GET', '/api/config')).body.calendars.length, 4);

  const bad = await call('POST', '/api/setup/calendar', { token: pair.token, url: 'https://cal.example/notcal.ics' });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/setup/calendar', { token: 'nope', url: 'https://cal.example/x.ics' })).status, 403);

  const school = list.find((c) => c.name === 'School');
  await call('POST', '/api/calendars/update', { id: school.id, family: true });
  await call('POST', '/api/calendars/update', { id: 'me', hidden: true });
  const after = (await call('GET', '/api/config')).body.calendars;
  assert.deepEqual(after.map((c) => c.name), ['Family', 'School', 'Work']);
  assert.equal(after.find((c) => c.name === 'School').family, true);

  assert.equal((await call('POST', '/api/calendars/remove', { id: 'family' })).status, 400, 'config calendars can only be hidden');
  await call('POST', '/api/calendars/remove', { id: school.id });
  assert.deepEqual((await call('GET', '/api/config')).body.calendars.map((c) => c.name), ['Family', 'Work']);
});

test('without storage, calendar management explains what is missing', async () => {
  const handle = createHandler({ config: CONFIG, store: null, log: {} });
  assert.equal((await handle(new Request('http://frame.local/api/devices/register', { method: 'POST' }))).status, 501);
  const r = await handle(new Request('http://frame.local/api/pair', { method: 'POST' }));
  assert.equal(r.status, 501);
  assert.match((await r.json()).error, /needs storage/);
});

test('unknown routes are JSON 404s', async () => {
  const r = await server().call('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'Not found');
});

// ------------------------------------------------------------ Phase 3: household settings
test('screens on the home network are approved; others wait', async () => {
  const { call } = server();
  const home = await call('POST', '/api/devices/register', { name: 'Kitchen' }, { from: '::ffff:192.168.1.30' });
  assert.equal(home.status, 201);
  assert.equal(home.body.approved, true);
  assert.match(home.body.token, /^[0-9a-f]{64}$/);
  const away = await call('POST', '/api/devices/register', {}, { from: '203.0.113.9' });
  assert.equal(away.body.approved, false);
  const unknownCaller = await call('POST', '/api/devices/register', {}, { from: null });
  assert.equal(unknownCaller.body.approved, false, 'no address (e.g. Cloudflare) is never approved automatically');

  assert.deepEqual((await call('GET', '/api/devices/me', null, { key: home.body.token })).body, { id: home.body.id, name: 'Kitchen', kind: 'screen', approved: true });
  const pending = await call('POST', '/api/settings', { section: 'weather', values: { units: 'fahrenheit' } }, { key: away.body.token });
  assert.equal(pending.status, 403);
  assert.equal(pending.body.pending, true);
});

test('changing anything needs an approved device key', async () => {
  const { call } = server();
  for (const [method, path, body] of [
    ['POST', '/api/settings', { section: 'weather', values: { units: 'fahrenheit' } }],
    ['POST', '/api/integrations', { id: 'travel', enabled: false }],
    ['POST', '/api/pair'],
    ['POST', '/api/calendars/update', { id: 'me', hidden: true }],
    ['POST', '/api/calendars/remove', { id: 'x' }],
    ['GET', '/api/settings'],
    ['GET', '/api/devices'],
  ]) {
    assert.equal((await call(method, path, body)).status, 401, `${method} ${path} without a key`);
    assert.equal((await call(method, path, body, { key: 'f'.repeat(64) })).status, 401, `${method} ${path} with a made-up key`);
  }
  // Reading the dashboard stays open.
  for (const path of ['/api/config', '/api/version', '/api/calendars', '/api/weather']) assert.equal((await call('GET', path)).status, 200, path);
});

test('a setting saved by one screen applies to every screen, and bumps the version', async () => {
  const { call, signIn } = server();
  await signIn();
  const v0 = (await call('GET', '/api/version')).body.version;
  const saved = await call('POST', '/api/settings', { section: 'location', values: {
    city: 'Gainesville', region: 'Florida', country: 'United States', code: 'US', latitude: 29.65, longitude: -82.32, timezone: 'America/New_York', source: 'list',
  } });
  assert.equal(saved.status, 200);
  await call('POST', '/api/settings', { section: 'prayer', values: { method: 3, school: 1 } });
  await call('POST', '/api/settings', { section: 'weather', values: { units: 'fahrenheit' } });
  assert.ok((await call('GET', '/api/version')).body.version >= v0 + 3);

  // Another screen (no key needed to read) sees the household values.
  const cfg = (await call('GET', '/api/config', null, { key: null })).body;
  assert.equal(cfg.location.name, 'Gainesville');
  assert.equal(cfg.location.code, 'US');
  assert.equal(cfg.location.source, 'list');
  assert.deepEqual(cfg.prayer, { method: 3, school: 1 });
  assert.equal(cfg.weather.units, 'fahrenheit');
  assert.deepEqual(cfg.saved.prayer.sort(), ['method', 'school']);
  assert.equal((await call('GET', '/api/weather')).body.unit, 'F');

  // null goes back to the default.
  await call('POST', '/api/settings', { section: 'weather', values: { units: null } });
  assert.equal((await call('GET', '/api/config')).body.weather.units, 'celsius');
});

test('places can be searched by postal code, nearest country first', async () => {
  const { call, signIn } = server();
  assert.equal((await call('POST', '/api/location/search', { q: '12345' })).status, 401);
  await signIn();
  // Toronto (Canada) to start: neither place is nearer, so the geocoder's order stands.
  assert.deepEqual((await call('POST', '/api/location/search', { q: '12345' })).body.places.map((p) => p.code), ['DE', 'US']);
  await call('POST', '/api/settings', { section: 'location', values: { city: 'Chicago', code: 'US', latitude: 41.9, longitude: -87.6, timezone: 'America/Chicago' } });
  const { body } = await call('POST', '/api/location/search', { q: ' 12345 ' });
  assert.deepEqual(body.places.map((p) => p.code), ['US', 'DE']);
  assert.deepEqual(body.places[0], {
    name: 'Springfield', region: 'Illinois', area: 'Sangamon', country: 'United States', code: 'US',
    latitude: 39.8, longitude: -89.6, timezone: 'America/Chicago', postcode: '12345',
  });
  assert.equal(body.places[1].postcode, '12345');
  // Searches are remembered, and nonsense lengths never leave the server.
  const asked = calls.filter((c) => c.startsWith('geocoding-api')).length;
  await call('POST', '/api/location/search', { q: '12345' });
  assert.equal(calls.filter((c) => c.startsWith('geocoding-api')).length, asked);
  assert.deepEqual((await call('POST', '/api/location/search', { q: 'x' })).body.places, []);
  assert.deepEqual((await call('POST', '/api/location/search', { q: 'y'.repeat(81) })).body.places, []);
});

test('a flood of new screens is slowed down', async () => {
  const { call } = server();
  const register = (from) => call('POST', '/api/devices/register', { name: 'Hall' }, { from, key: null });
  for (let i = 0; i < 10; i++) assert.equal((await register('203.0.113.9')).status, 201);
  const r = await register('203.0.113.9');
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Too many new screens/);
  // Someone else (a screen at home) can still register.
  assert.equal((await register('192.168.1.20')).status, 201);
});

test('bad settings are refused with a readable reason', async () => {
  const { call, signIn } = server();
  await signIn();
  const r = await call('POST', '/api/settings', { section: 'prayer', values: { method: 99 } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /isn't one of the choices/);
  assert.equal((await call('POST', '/api/settings', { section: 'nope', values: {} })).status, 400);
  assert.equal((await call('POST', '/api/settings', { section: 'location', values: { latitude: 200 } })).body.error, 'Latitude must be at most 90');
});

test('keys saved through settings are never sent back', async () => {
  const { call, signIn, store } = server();
  await signIn();
  await call('POST', '/api/settings', { integration: 'travel', values: { googleMapsApiKey: 'AIzaSyEXAMPLEKEY9876' } });
  const all = JSON.stringify((await call('GET', '/api/settings')).body);
  assert.equal(all.includes('AIzaSyEXAMPLE'), false);
  assert.match(all, /"last4":"9876"/);
  assert.equal(JSON.stringify(await store.get('secret:travel:googleMapsApiKey')).includes('AIza'), false);
  assert.equal(JSON.stringify((await call('GET', '/api/config')).body).includes('9876'), false, 'screens never see keys');
});

test('switching an integration from a screen changes the features screens see', async () => {
  const { call, signIn } = server();
  await signIn();
  const r = await call('POST', '/api/integrations', { id: 'travel', enabled: false });
  assert.equal(r.body.features.includes('travel'), false);
  assert.equal((await call('POST', '/api/integrations', { id: 'prayer-aladhan', enabled: false })).status, 400, 'core integrations stay on');
});

test('a setup code approves the first screen when nothing is approved automatically', async () => {
  const handle = createHandler({ config: CONFIG, store: makeMemoryStore(), secretMaterial: 'x'.repeat(32), log: {}, setupCode: 'correct-horse-battery' });
  const register = async (body) => (await handle(new Request('http://frame.local/api/devices/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))).json();
  assert.equal((await register({ kind: 'screen' })).approved, false);
  assert.equal((await register({ kind: 'screen', setupCode: 'wrong-horse-battery' })).approved, false);
  assert.equal((await register({ kind: 'screen', setupCode: 'correct-horse-battery' })).approved, true);

  const short = createHandler({ config: CONFIG, store: makeMemoryStore(), secretMaterial: 'x'.repeat(32), log: {}, setupCode: 'too-short' });
  const r = await short(new Request('http://frame.local/api/devices/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupCode: 'too-short' }),
  }));
  assert.equal((await r.json()).approved, false, 'codes under 12 characters are ignored');
});

test('approved devices can list, rename and approve others, but not remove themselves', async () => {
  const { call, signIn } = server();
  const me = await signIn();
  const other = (await call('POST', '/api/devices/register', { kind: 'phone' }, { from: '8.8.8.8', key: null })).body;
  const list = (await call('GET', '/api/devices')).body.devices;
  assert.deepEqual(list.map((d) => [d.name, d.approved]), [['Kitchen', true], ['Phone 1', false]]);
  assert.equal(JSON.stringify(list).includes('hash'), false);
  await call('POST', '/api/devices/update', { id: other.id, approved: true, name: 'Sam’s phone' });
  assert.equal((await call('GET', '/api/devices/me', null, { key: other.token })).body.approved, true);
  const self = (await call('GET', '/api/devices/me')).body;
  assert.equal((await call('POST', '/api/devices/remove', { id: self.id })).status, 400);
  assert.ok(me);
});

test('screens registering at the same moment each get their own key and name', async () => {
  const { call } = server();
  const regs = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/devices/register', {}, { key: null })));
  assert.equal(new Set(regs.map((r) => r.body.name)).size, 8);
  for (const r of regs) assert.equal((await call('GET', '/api/devices/me', null, { key: r.body.token })).status, 200, r.body.name + ' kept its key');
});

test('settings saved at the same moment are all kept', async () => {
  const { call, signIn } = server();
  await signIn();
  await Promise.all([
    call('POST', '/api/settings', { section: 'prayer', values: { method: 3 } }),
    call('POST', '/api/settings', { section: 'prayer', values: { school: 1 } }),
    call('POST', '/api/settings', { section: 'quran', values: { reciter: 'ar.husary' } }),
  ]);
  const cfg = (await call('GET', '/api/config')).body;
  assert.deepEqual(cfg.prayer, { method: 3, school: 1 });
  assert.equal(cfg.quran.reciter, 'ar.husary');
});

// ------------------------------------------------------------ Phase 4: phones (companion)
test('a phone that scans a screen’s QR code is signed in', async () => {
  const { call, signIn } = server();
  await signIn();
  const { body: pair } = await call('POST', '/api/pair');
  // The phone is on mobile data (not the home network) — the QR code is what counts.
  const phone = await call('POST', '/api/companion/claim', { token: pair.token, name: 'Aisha’s phone' }, { from: '100.64.1.1', key: null });
  assert.equal(phone.status, 201);
  assert.equal(phone.body.approved, true);
  assert.equal((await call('GET', '/api/pair/status?token=' + pair.token)).body.phones[0], 'Aisha’s phone');
  const me = await call('GET', '/api/devices/me', null, { key: phone.body.token });
  assert.deepEqual([me.body.kind, me.body.approved], ['phone', true]);
  // …and can change household settings and add calendars without a code.
  assert.equal((await call('POST', '/api/settings', { section: 'weather', values: { units: 'fahrenheit' } }, { key: phone.body.token })).status, 200);
  const add = await call('POST', '/api/calendars/add', { url: 'https://cal.example/work.ics' }, { key: phone.body.token });
  assert.deepEqual(add.body.results.map((r) => r.name), ['Work']);
});

test('claiming needs a live code from an approved screen', async () => {
  const { call } = server();
  assert.equal((await call('POST', '/api/companion/claim', { token: 'a'.repeat(32) }, { key: null })).status, 403);
  assert.equal((await call('POST', '/api/companion/claim', { token: '../x' }, { key: null })).status, 403);
  assert.equal((await call('POST', '/api/pair', null, { key: null })).status, 401, 'only approved screens make codes');
  assert.equal((await call('POST', '/api/calendars/add', { url: 'https://cal.example/a.ics' }, { key: null })).status, 401);
});
