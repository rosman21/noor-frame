// Where the household is. Frames have no GPS, so this comes from settings: coordinates (with
// or without a time zone), or a city name looked up with Open-Meteo's free geocoder.

import { getJson } from './http.js';

export async function resolveLocation(loc, remember) {
  loc = loc || {};
  // Passed through untouched, so screens can show how the place was chosen.
  const extra = { country: loc.country || '', code: loc.code || '', source: loc.source || '' };
  const found = await remember(`location-${JSON.stringify(loc)}`, 24 * 3600e3, async () => {
    const lat = loc.latitude, lon = loc.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const name = loc.city || loc.name || 'Home';
      if (loc.timezone) return { name, region: loc.region || '', latitude: lat, longitude: lon, timezone: loc.timezone };
      const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1`);
      return { name, region: loc.region || '', latitude: lat, longitude: lon, timezone: w.timezone };
    }
    if (!loc.city) throw new Error('No location set. Choose a city in Settings (or set location.city in frame.config.json).');
    const q = new URLSearchParams({ name: loc.city, count: '10', language: 'en' });
    const res = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
    const want = String(loc.country || '').toLowerCase();
    const hit = (res.results || []).find((p) => !want || p.country?.toLowerCase() === want || p.country_code?.toLowerCase() === want);
    if (!hit) throw new Error(`Could not find "${loc.city}". Pick it from the city list, or use latitude/longitude.`);
    return { name: hit.name, region: hit.admin1 || '', latitude: hit.latitude, longitude: hit.longitude, timezone: hit.timezone, code: hit.country_code || '' };
  });
  return { ...extra, ...found, code: extra.code || found.code || '' };
}

// Search by town name or postal code (Open-Meteo matches both), for choosing the household's
// place. Places in `near` (the current country code) come first, so a ZIP code that also exists
// abroad still shows the local town at the top.
export async function searchPlaces(query, { near = '', language = 'en', remember } = {}) {
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 80) return [];
  const lang = /^[a-z]{2}$/.test(language) ? language : 'en';
  const run = async () => {
    const res = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '20', language: lang })}`);
    return (res.results || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  };
  const hits = remember ? await remember(`places-${lang}-${q.toLowerCase()}`, 7 * 24 * 3600e3, run) : await run();
  const code = String(near || '').toUpperCase();
  const digits = q.replace(/\s/g, '').toLowerCase();
  const postcodeOf = (p) => (p.postcodes || []).find((c) => c.replace(/\s/g, '').toLowerCase() === digits) || '';
  return hits
    .map((p, i) => ({ p, i, rank: (code && p.country_code === code ? 0 : 2) + (postcodeOf(p) ? 0 : 1) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, 12)
    .map(({ p }) => ({
      name: p.name, region: p.admin1 || '', area: p.admin2 || '', country: p.country || '', code: p.country_code || '',
      latitude: p.latitude, longitude: p.longitude, timezone: p.timezone || '', postcode: postcodeOf(p),
    }));
}
