// Prayer times from AlAdhan (https://aladhan.com/prayer-times-api), free and keyless.
// The frame downloads a whole month at a time and keeps it, so the athan still plays if the
// Wi-Fi drops.

import { defineIntegration, json, getJson } from '@noor-frame/core';

const NAMES = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
// AlAdhan's `tune` parameter takes minute offsets in this order.
const TUNE_ORDER = ['Imsak', 'Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Sunset', 'Isha', 'Midnight'];

export const METHODS = [
  [2, 'Islamic Society of North America (ISNA)'], [3, 'Muslim World League'], [4, 'Umm al-Qura, Makkah'],
  [5, 'Egyptian General Authority of Survey'], [1, 'University of Islamic Sciences, Karachi'], [15, 'Moonsighting Committee Worldwide'],
  [8, 'Gulf Region'], [9, 'Kuwait'], [10, 'Qatar'], [16, 'Dubai'], [13, 'Diyanet, Turkey'], [17, 'JAKIM, Malaysia'],
  [11, 'MUIS, Singapore'], [20, 'Kemenag, Indonesia'], [12, 'UOIF, France'], [21, 'Morocco'], [19, 'Algeria'], [18, 'Tunisia'],
  [23, 'Jordan'], [14, 'Spiritual Administration of Muslims of Russia'], [22, 'Comunidade Islâmica de Lisboa'],
  [7, 'Institute of Geophysics, Tehran'], [0, 'Shia Ithna-Ashari, Qum'],
];
// A sensible method for each country (ISO code), used when someone picks a city.
export const METHOD_FOR_COUNTRY = {
  US: 2, CA: 2, GB: 15, IE: 3, SA: 4, AE: 16, QA: 10, KW: 9, BH: 8, OM: 8, EG: 5, SD: 5, LY: 5, TR: 13, PK: 1, IN: 1, BD: 1, AF: 1,
  MY: 17, SG: 11, ID: 20, FR: 12, MA: 21, DZ: 19, TN: 18, JO: 23, PS: 23, LB: 3, IQ: 3, IR: 7, AU: 3, NZ: 3, ZA: 3,
};

export async function prayerMonth(ctx, year, month) {
  const loc = await ctx.location();
  const p = await ctx.settings('prayer');
  const tune = TUNE_ORDER.map((k) => Number(p.tune?.[k]) || 0).join(',');
  return ctx.remember(`prayer-${loc.latitude},${loc.longitude}-${p.method}-${p.school}-${tune}-${year}-${month}`, 12 * 3600e3, async () => {
    const q = new URLSearchParams({
      latitude: loc.latitude, longitude: loc.longitude, method: p.method, school: p.school, tune, iso8601: 'true',
    });
    const res = await getJson(`https://api.aladhan.com/v1/calendar/${year}/${month}?${q}`);
    if (res.code !== 200 || !Array.isArray(res.data)) throw new Error('AlAdhan returned no data');
    const days = {};
    for (const d of res.data) {
      const [dd, mm, yyyy] = d.date.gregorian.date.split('-');
      const times = {};
      for (const n of NAMES) times[n] = new Date(d.timings[n]).toISOString();
      const h = d.date.hijri;
      days[`${yyyy}-${mm}-${dd}`] = {
        times,
        hijri: { day: Number(h.day), month: h.month.en, monthAr: h.month.ar, year: Number(h.year), holidays: h.holidays || [] },
      };
    }
    return { year, month, days, method: res.data[0]?.meta?.method?.name, timezone: loc.timezone };
  });
}

export default defineIntegration({
  id: 'prayer-aladhan',
  name: 'Prayer times',
  description: 'Daily prayer times and the Hijri date from AlAdhan.',
  section: 'prayer',
  settings: [
    { key: 'method', type: 'select', label: 'Calculation method', default: 2, options: METHODS.map(([value, label]) => ({ value, label })) },
    { key: 'school', type: 'select', label: 'Asr time', default: 0, options: [{ value: 0, label: 'Standard (Shafi, Maliki, Hanbali)' }, { value: 1, label: 'Hanafi' }] },
    { key: 'tune', type: 'json', label: 'Adjust times (minutes)', default: {}, keys: ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'], valueType: 'number', min: -30, max: 30, help: 'Nudge a prayer time to match your local masjid.' },
  ],
  routes: {
    'GET /api/prayer': async (request, ctx) => {
      const url = new URL(request.url), now = new Date();
      const y = Number(url.searchParams.get('year')) || now.getUTCFullYear();
      const m = Number(url.searchParams.get('month')) || now.getUTCMonth() + 1;
      if (y < 2000 || y > 2100 || m < 1 || m > 12) return json({ error: 'year/month out of range' }, 400);
      return json(await prayerMonth(ctx, y, m), 200, 3600);
    },
  },
  publicConfig: async (ctx) => {
    const p = await ctx.settings('prayer');
    return { prayer: { method: p.method, school: p.school } };
  },
  features: ['prayer'],
  tools: [{
    name: 'get_prayer_times',
    description: 'Prayer times (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) and the Hijri date for one day at the household location.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    run: async ({ date }, ctx) => {
      const [y, m] = String(date).split('-').map(Number);
      const month = await prayerMonth(ctx, y, m);
      return month.days[date] ? { date, timezone: month.timezone, ...month.days[date] } : { error: 'No times for that date' };
    },
  }],
});
