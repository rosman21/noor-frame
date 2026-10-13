// Household settings that belong to the dashboard itself rather than an outside service.
// They use the same contract as every other integration, so the companion edits them the same way.

import { defineIntegration } from './integration.js';
import { searchPlaces } from './location.js';
import { json } from './http.js';

export const location = defineIntegration({
  id: 'location',
  name: 'Location',
  description: 'Where you live. Prayer times, the athan and the weather all use it.',
  section: 'location',
  settings: [
    { key: 'city', type: 'string', label: 'City', maxLength: 80 },
    { key: 'region', type: 'string', label: 'Region', maxLength: 80 },
    { key: 'country', type: 'string', label: 'Country', maxLength: 80 },
    { key: 'latitude', type: 'number', label: 'Latitude', min: -90, max: 90 },
    { key: 'longitude', type: 'number', label: 'Longitude', min: -180, max: 180 },
    { key: 'timezone', type: 'string', label: 'Time zone', pattern: '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' },
    { key: 'code', type: 'string', label: 'Country code', pattern: '^[A-Z]{2}$' },
    { key: 'source', type: 'select', label: 'Chosen by', options: [{ value: 'list', label: 'City list' }, { value: 'search', label: 'Search' }, { value: 'auto', label: 'Detected' }, { value: 'config', label: 'Config file' }] },
  ],
  publicConfig: async (ctx) => ({ location: await ctx.location() }),
  routes: {
    // Town or postal code → places to choose from. Searched here rather than on the screen, so
    // old frames whose certificates can't reach the geocoder still can.
    'POST /api/location/search': { auth: 'device', handler: async (request, ctx) => {
      const b = await request.json().catch(() => ({}));
      const near = await ctx.location().then((l) => l.code, () => '');
      return json({ places: await searchPlaces(b.q, { near, language: b.lang, remember: ctx.remember }) });
    } },
  },
});

const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

export const athan = defineIntegration({
  id: 'athan',
  name: 'Athan',
  description: 'The call to prayer played by the frame at each prayer time.',
  section: 'athan',
  settings: [
    { key: 'enabled', type: 'boolean', label: 'Play the athan', default: true },
    { key: 'volume', type: 'number', label: 'Volume (0 to 1)', min: 0, max: 1, default: 0.8, advanced: true },
    { key: 'prayers', type: 'json', label: 'Play the athan for', default: Object.fromEntries(PRAYERS.map((p) => [p, true])), keys: PRAYERS, valueType: 'boolean' },
    { key: 'file', type: 'string', label: 'Athan recording', default: '/audio/athan.mp3', advanced: true },
    { key: 'fajrFile', type: 'string', label: 'Fajr athan recording', default: '/audio/athan-fajr.mp3', advanced: true },
    { key: 'reminderMinutes', type: 'number', label: 'Reminder before prayer (minutes)', min: 0, max: 60, default: 10 },
  ],
  publicConfig: async (ctx) => ({ athan: await ctx.settings('athan') }),
});

export const display = defineIntegration({
  id: 'display',
  name: 'Display',
  description: 'Household defaults for every screen. Each screen can still change its own.',
  section: 'display',
  settings: [
    { key: 'clock24h', type: 'boolean', label: '24-hour clock', default: false },
    { key: 'theme', type: 'select', label: 'Theme', default: 'auto', options: [{ value: 'auto', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
    { key: 'idleMinutes', type: 'number', label: 'Idle screen after (minutes, 0 = never)', min: 0, max: 600, default: 2 },
    { key: 'nav', type: 'select', label: 'Menu', default: 'top', options: [{ value: 'top', label: 'Slide down from the top' }, { value: 'bottom', label: 'Slide up from the bottom' }, { value: 'left', label: 'Dock on the left' }, { value: 'right', label: 'Dock on the right' }] },
  ],
  publicConfig: async (ctx) => ({ display: await ctx.settings('display') }),
});

export const builtins = [location, athan, display];
