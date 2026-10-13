// Weather from Open-Meteo (https://open-meteo.com), free and keyless: now, 7 days of hourly
// values (for today's strip and each day's 3-hourly view) and 7 daily summaries.

import { defineIntegration, json, getJson } from '@noor-frame/core';

export async function forecast(ctx) {
  const loc = await ctx.location();
  const f = (await ctx.settings('weather')).units === 'fahrenheit';
  return ctx.remember(`weather-${loc.latitude},${loc.longitude}-${f}`, 10 * 60e3, async () => {
    const q = new URLSearchParams({
      latitude: loc.latitude, longitude: loc.longitude, timezone: loc.timezone,
      temperature_unit: f ? 'fahrenheit' : 'celsius', wind_speed_unit: f ? 'mph' : 'kmh',
      current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      forecast_days: '7',
    });
    const w = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);
    const H = w.hourly;
    return {
      unit: f ? 'F' : 'C',
      windUnit: f ? 'mph' : 'km/h',
      current: {
        temp: Math.round(w.current.temperature_2m), feels: Math.round(w.current.apparent_temperature),
        code: w.current.weather_code, isDay: !!w.current.is_day,
        humidity: w.current.relative_humidity_2m, wind: Math.round(w.current.wind_speed_10m),
      },
      // From midnight today, one entry per hour for 7 days.
      hourly: { start: H.time[0], t: H.temperature_2m.map(Math.round), code: H.weather_code, p: H.precipitation_probability, day: H.is_day },
      daily: w.daily.time.map((d, i) => ({
        date: d, code: w.daily.weather_code[i],
        hi: Math.round(w.daily.temperature_2m_max[i]), lo: Math.round(w.daily.temperature_2m_min[i]),
        p: w.daily.precipitation_probability_max[i],
      })),
    };
  });
}

export default defineIntegration({
  id: 'weather-open-meteo',
  name: 'Weather',
  description: 'Current conditions and a 7-day forecast from Open-Meteo.',
  section: 'weather',
  settings: [
    { key: 'units', type: 'select', label: 'Temperature', default: 'celsius', options: [{ value: 'celsius', label: 'Celsius (°C)' }, { value: 'fahrenheit', label: 'Fahrenheit (°F)' }] },
  ],
  routes: {
    'GET /api/weather': async (request, ctx) => json(await forecast(ctx)),
  },
  publicConfig: async (ctx) => ({ weather: { units: (await ctx.settings('weather')).units } }),
  features: ['weather'],
  tools: [{
    name: 'get_weather',
    description: 'Weather for the household location: current conditions, and the high/low and chance of rain for each of the next 7 days.',
    input_schema: { type: 'object', properties: {} },
    run: async (input, ctx) => {
      const w = await forecast(ctx);
      return { unit: w.unit, now: w.current, days: w.daily };
    },
  }],
});
