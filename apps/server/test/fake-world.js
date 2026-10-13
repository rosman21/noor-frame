// The outside world, faked: every service the integrations call (prayer times, weather, Quran,
// maps, calendars) answers from here, so tests run offline and give the same answers every time.
// Used by the API tests (apps/server/test) and the browser tests (e2e/).
//
//   const world = fakeWorld();
//   globalThis.fetch = world.fetch;
//   world.calls      hosts + paths that were requested
//   world.google     { requests, reply }: Google Routes requests, and what the fake answers;
//                    { validations, validation }: the same for Address Validation;
//                    { places, placesReply }: and for Places Autocomplete

const ICS = (name) => ['BEGIN:VCALENDAR', 'VERSION:2.0', `X-WR-CALNAME:${name}`,
  'BEGIN:VEVENT', 'UID:a@x', 'SUMMARY:Dentist', `DTSTART:${stamp(Date.now() + 3 * 3600e3)}`, `DTEND:${stamp(Date.now() + 4 * 3600e3)}`, 'LOCATION:1 Main St, Toronto, ON', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
function stamp(t) { return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

function aladhanMonth(url) {
  const [, y, m] = url.pathname.match(/calendar\/(\d+)\/(\d+)/);
  const days = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
  return {
    code: 200,
    data: Array.from({ length: days }, (_, i) => {
      const dd = String(i + 1).padStart(2, '0'), mm = String(m).padStart(2, '0');
      const t = (h) => `${y}-${mm}-${dd}T${h}:00-04:00`;
      return {
        timings: { Fajr: t('06:10'), Sunrise: t('07:28'), Dhuhr: t('13:04'), Asr: t('16:08'), Maghrib: t('18:39'), Isha: t('19:58') },
        date: { gregorian: { date: `${dd}-${mm}-${y}` }, hijri: { day: '1', month: { en: 'Jumādá al-ūlá', ar: 'جُمادى الأولى' }, year: '1448', holidays: [] } },
        meta: { method: { name: 'Islamic Society of North America (ISNA)' } },
      };
    }),
  };
}

// What the geocoder knows, by search term. Anything else finds Toronto.
const PLACES = {
  Toronto: [{ name: 'Toronto', admin1: 'Ontario', country: 'Canada', country_code: 'CA', latitude: 43.7, longitude: -79.4, timezone: 'America/Toronto' }],
  Birmingham: [
    { name: 'Birmingham', admin1: 'England', admin2: 'West Midlands', country: 'United Kingdom', country_code: 'GB', latitude: 52.48, longitude: -1.9, timezone: 'Europe/London' },
    { name: 'Birmingham', admin1: 'Alabama', admin2: 'Jefferson', country: 'United States', country_code: 'US', latitude: 33.52, longitude: -86.81, timezone: 'America/Chicago' },
  ],
  'Kuala Lumpur': [{ name: 'Kuala Lumpur', admin1: 'Kuala Lumpur', country: 'Malaysia', country_code: 'MY', latitude: 3.14, longitude: 101.69, timezone: 'Asia/Kuala_Lumpur' }],
  Nowhereville: undefined,
  // A postal code that exists in two countries, listed abroad first.
  12345: [
    { name: 'Musterstadt', admin1: 'Hessen', country: 'Germany', country_code: 'DE', postcodes: ['12345'], latitude: 50.1, longitude: 8.7, timezone: 'Europe/Berlin' },
    { name: 'Springfield', admin1: 'Illinois', admin2: 'Sangamon', country: 'United States', country_code: 'US', postcodes: ['12340', '12345'], latitude: 39.8, longitude: -89.6, timezone: 'America/Chicago' },
  ],
};

export function fakeWorld() {
  const calls = [];
  const google = {
    requests: [], reply: { status: 200, body: { routes: [{ duration: '1260s', distanceMeters: 15400 }] } },
    validations: [], validation: { status: 200, body: { result: {
      verdict: { validationGranularity: 'PREMISE', addressComplete: true },
      address: { formattedAddress: '100 Queen St W, Toronto, ON M5H 2N2, Canada' },
      geocode: { location: { latitude: 43.6534, longitude: -79.3839 } },
    } } },
    places: [], placesReply: { status: 200, body: { suggestions: [
      { placePrediction: { text: { text: '100 Queen St W, Toronto, ON, Canada' } } },
      { placePrediction: { text: { text: '100 Queen St E, Toronto, ON, Canada' } } },
    ] } },
  };
  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.host + url.pathname);
    const ok = (body, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': type } });
    switch (url.host) {
      case 'geocoding-api.open-meteo.com': {
        const name = url.searchParams.get('name');
        return ok({ results: name in PLACES ? PLACES[name] : PLACES.Toronto });
      }
      case 'api.open-meteo.com': {
        const hours = 168;
        return ok({
          timezone: 'America/Toronto',
          current: { temperature_2m: 16.4, apparent_temperature: 15, weather_code: 3, is_day: 1, relative_humidity_2m: 70, wind_speed_10m: 12.2 },
          hourly: { time: Array.from({ length: hours }, (_, i) => `2026-10-12T${String(i % 24).padStart(2, '0')}:00`), temperature_2m: Array(hours).fill(15.6), weather_code: Array(hours).fill(3), precipitation_probability: Array(hours).fill(10), is_day: Array(hours).fill(1) },
          daily: { time: ['2026-10-12', '2026-10-13'], weather_code: [3, 61], temperature_2m_max: [21.2, 24], temperature_2m_min: [13.8, 16], precipitation_probability_max: [5, 80] },
        });
      }
      case 'api.aladhan.com': return ok(aladhanMonth(url));
      case 'api.alquran.cloud': {
        const n = +url.pathname.match(/ayah\/(\d+)/)[1];
        const surah = { number: 17, englishName: 'Al-Israa', englishNameTranslation: 'The Night Journey', name: 'سورة الإسراء' };
        return ok({ data: [
          { text: n % 2 ? 'عَسَىٰ رَبُّكُمْ أَن يَرْحَمَكُمْ' : 'ا'.repeat(400), numberInSurah: 8, surah },
          { text: 'It is expected that your Lord will have mercy upon you.', edition: { englishName: 'Saheeh International' } },
          { audio: 'https://cdn.example/ayah.mp3', audioSecondary: [], edition: { englishName: 'Alafasy' } },
        ] });
      }
      case 'cdn.example': return ok('ID3-recitation', 'audio/mpeg');
      case 'routes.googleapis.com':
        google.requests.push({ path: url.pathname, headers: new Headers(init.headers), body: JSON.parse(init.body) });
        return new Response(JSON.stringify(google.reply.body), { status: google.reply.status, headers: { 'content-type': 'application/json' } });
      case 'addressvalidation.googleapis.com':
        google.validations.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) });
        return new Response(JSON.stringify(google.validation.body), { status: google.validation.status, headers: { 'content-type': 'application/json' } });
      case 'places.googleapis.com':
        google.places.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) });
        return new Response(JSON.stringify(google.placesReply.body), { status: google.placesReply.status, headers: { 'content-type': 'application/json' } });
      case 'nominatim.openstreetmap.org': return ok([{ lat: '43.65', lon: '-79.38' }]);
      case 'router.project-osrm.org': return ok({ routes: [{ duration: 1200, distance: 8300 }] });
      case 'cal.example': return ok(url.pathname.includes('notcal') ? '<html>nope</html>' : ICS(url.pathname.includes('work') ? 'Work' : 'School'), 'text/calendar');
      default: throw new Error('unexpected fetch ' + url);
    }
  };
  return { fetch, calls, google };
}
