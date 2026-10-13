// The integration contract. Everything the dashboard talks to — prayer times, weather,
// calendars, travel, Quran, AI — is an integration: a plain object that declares its settings
// and what it adds to the server. The registry decides which are on, resolves their settings,
// and wires up only the enabled ones. A disabled integration has no routes, adds nothing to
// /api/config, sends no feature flags to the frame and offers no tools to the AI.
//
//   export default defineIntegration({
//     id: 'weather-open-meteo',          // unique, kebab-case
//     name: 'Weather', description: '…',
//     section: 'weather',                // its block in frame.config.json and in saved settings
//     optional: false,                   // true = the household can switch it off
//     enabledByDefault: true,
//     settings: [                        // drives the companion's form and validation
//       { key: 'units', type: 'select', label: 'Temperature', default: 'celsius',
//         options: [{ value: 'celsius', label: 'Celsius' }, { value: 'fahrenheit', label: 'Fahrenheit' }] },
//       { key: 'apiKey', type: 'secret', label: 'API key' },   // encrypted, never sent out
//       { key: 'tune', type: 'json', keys: ['Fajr', 'Isha'], valueType: 'number' },  // one row per key
//       { key: 'waitMs', type: 'number', advanced: true },     // tucked under "Advanced" in the companion
//       { key: 'home', type: 'string', autocomplete: '/api/x/places' }, // suggestions while typing:
//                                                  // POST { input, session } → { suggestions: [text], note? }
//     ],
//     routes: { 'GET /api/weather': async (request, ctx) => Response,
//               'POST /api/weather/x': { auth: 'device', handler } },   // needs an approved device
//     hooks: { events: async ({ events, from, to }, ctx) => {} }, // called by other integrations
//     publicConfig: async (ctx) => ({ weather: { units } }),  // merged into /api/config
//     features: ['weather'],                                  // flags for the frame's UI
//     tools: [{ name, description, input_schema, run: async (input, ctx) => result }],  // for AI
//     check: { label: 'Check address and routes', path: '/api/travel/check' },  // a companion button:
//            POST path → { items: [{ ok: true|false|null, title, detail, fix?: { key, value, label } }] }
//   });

const TYPES = new Set(['string', 'number', 'boolean', 'select', 'secret', 'json']);
const ROUTE = /^(GET|POST|PUT|DELETE|ANY) \/\S*$/;

export function defineIntegration(def) {
  const where = `Integration "${def?.id}"`;
  if (!/^[a-z][a-z0-9-]*$/.test(def?.id || '')) throw new Error(`${where}: id must be kebab-case`);
  if (!def.name) throw new Error(`${where}: name is required`);
  if (def.section != null && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(def.section)) throw new Error(`${where}: section must be a plain word`);
  for (const s of def.settings || []) {
    if (!s.key || !TYPES.has(s.type)) throw new Error(`${where}: setting "${s.key}" needs a key and a type (${[...TYPES].join(', ')})`);
    if (s.type === 'select' && s.options && !s.options.every((o) => o && 'value' in o)) throw new Error(`${where}: select "${s.key}" options need { value, label }`);
  }
  for (const [r, v] of Object.entries(def.routes || {})) {
    if (!ROUTE.test(r)) throw new Error(`${where}: route "${r}" must look like "GET /api/thing" (a trailing * matches a prefix)`);
    const handler = typeof v === 'function' ? v : v?.handler;
    if (typeof handler !== 'function') throw new Error(`${where}: route "${r}" needs a handler function`);
    if (typeof v === 'object' && v.auth != null && v.auth !== 'device') throw new Error(`${where}: route "${r}" auth must be 'device'`);
  }
  if (def.check && !(def.check.label && def.routes?.['POST ' + def.check.path])) throw new Error(`${where}: check needs a label and a "POST ${def.check?.path}" route`);
  return Object.freeze({
    optional: false,
    enabledByDefault: true,
    settings: [],
    routes: {},
    hooks: {},
    features: [],
    tools: [],
    ...def,
  });
}

// Coerce and check one value against its schema entry. Throws a message meant for people.
function coerce(s, value) {
  if (value === null || value === undefined || value === '') return undefined;
  switch (s.type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${s.label || s.key} must be a number`);
      if (s.min != null && n < s.min) throw new Error(`${s.label || s.key} must be at least ${s.min}`);
      if (s.max != null && n > s.max) throw new Error(`${s.label || s.key} must be at most ${s.max}`);
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      throw new Error(`${s.label || s.key} must be on or off`);
    case 'select':
      if (s.options && !s.options.some((o) => String(o.value) === String(value))) throw new Error(`${s.label || s.key}: "${value}" isn't one of the choices`);
      return s.options ? s.options.find((o) => String(o.value) === String(value)).value : value;
    case 'json':
      return typeof value === 'string' ? JSON.parse(value) : value;
    default: {
      const v = String(value);
      if (s.maxLength && v.length > s.maxLength) throw new Error(`${s.label || s.key} is too long`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) throw new Error(`${s.label || s.key} doesn't look right`);
      return v;
    }
  }
}

// config: frame.config.json (optional first-run defaults). store/secrets: see store.js, secrets.js.
export function makeRegistry({ integrations, config = {}, store = null, secrets = null }) {
  const byId = new Map();
  for (const i of integrations) {
    if (byId.has(i.id)) throw new Error(`Two integrations use the id "${i.id}"`);
    byId.set(i.id, i);
  }
  const bySection = new Map(integrations.filter((i) => i.section).map((i) => [i.section, i]));

  async function enabledMap() {
    const saved = (store && (await store.get('integrations'))) || {};
    const fromFile = config.integrations || {};
    const out = {};
    for (const i of integrations) {
      out[i.id] = !i.optional ? true : saved[i.id] ?? fromFile[i.id] ?? i.enabledByDefault;
    }
    return out;
  }

  // Settings for a section: schema defaults < frame.config.json < saved settings < per-request
  // overrides. Secrets come from the encrypted store (or, as a fallback, the config file) and
  // are only included when `withSecrets` is set — i.e. for server-side use.
  async function settingsFor(section, { overrides, withSecrets = false } = {}) {
    const integ = bySection.get(section);
    const defaults = {};
    for (const s of integ?.settings || []) if (s.default !== undefined && s.type !== 'secret') defaults[s.key] = s.default;
    const saved = (store && (await store.get('settings:' + section))) || {};
    const out = { ...defaults, ...(config[section] || {}), ...saved, ...(overrides?.[section] || {}) };
    for (const s of integ?.settings || []) {
      if (s.type !== 'secret') continue;
      const fileValue = config[section]?.[s.key];
      delete out[s.key];
      if (withSecrets) out[s.key] = (secrets && (await secrets.get(integ.id, s.key))) || fileValue || '';
    }
    return out;
  }

  return {
    integrations,
    get: (id) => byId.get(id),
    enabledMap,
    async isEnabled(id) { return !!(await enabledMap())[id]; },
    async enabled() { const m = await enabledMap(); return integrations.filter((i) => m[i.id]); },

    async setEnabled(id, on) {
      const i = byId.get(id);
      if (!i) throw new Error(`Unknown integration "${id}"`);
      if (!i.optional) throw new Error(`${i.name} can't be switched off`);
      if (!store) throw new Error('Saving settings needs storage');
      const saved = (await store.get('integrations')) || {};
      saved[id] = !!on;
      await store.put('integrations', saved);
    },

    settingsFor,

    // Save a partial update for an integration's section. Secret fields go to the encrypted
    // store; an empty string clears a secret. Unknown keys are rejected.
    async saveSettings(id, patch) {
      const i = byId.get(id);
      if (!i || !i.section) throw new Error(`Unknown integration "${id}"`);
      if (!store) throw new Error('Saving settings needs storage');
      const schema = new Map(i.settings.map((s) => [s.key, s]));
      const saved = (await store.get('settings:' + i.section)) || {};
      for (const [k, v] of Object.entries(patch || {})) {
        const s = schema.get(k);
        if (!s) throw new Error(`${i.name} has no setting "${k}"`);
        if (s.type === 'secret') {
          if (!secrets) throw new Error('Saving keys needs FRAME_SECRET to be set');
          await secrets.set(i.id, k, v);
          continue;
        }
        const value = coerce(s, v);
        if (value === undefined) delete saved[k]; else saved[k] = value;
      }
      await store.put('settings:' + i.section, saved);
    },

    // What the companion shows: every integration, whether it's on, and its settings with
    // current values. Secrets appear only as { set, last4 }.
    async describe() {
      const on = await enabledMap();
      return Promise.all(integrations.map(async (i) => {
        const values = i.section ? await settingsFor(i.section) : {};
        const settings = await Promise.all(i.settings.map(async (s) => {
          const { default: def, ...rest } = s;
          if (s.type === 'secret') {
            const info = secrets ? await secrets.info(i.id, s.key) : { set: false };
            if (!info.set && config[i.section]?.[s.key]) return { ...rest, value: { set: true, last4: String(config[i.section][s.key]).slice(-4), fromConfigFile: true } };
            return { ...rest, value: info };
          }
          return { ...rest, default: def, value: values[s.key] ?? null };
        }));
        return { id: i.id, name: i.name, description: i.description || '', optional: i.optional, enabled: on[i.id], section: i.section || null, settings, check: (on[i.id] && i.check) || null };
      }));
    },

    // Find the handler for a request among enabled integrations. Exact paths win over prefixes.
    // → { integration, handler, auth } where auth is 'device' when an approved device is required.
    async route(request) {
      const url = new URL(request.url);
      const on = await enabledMap();
      let prefixHit = null;
      for (const i of integrations) {
        if (!on[i.id]) continue;
        for (const [key, value] of Object.entries(i.routes)) {
          const [method, path] = key.split(' ');
          if (method !== 'ANY' && method !== request.method) continue;
          const hit = { integration: i, handler: value.handler || value, auth: value.auth || null };
          if (path === url.pathname) return hit;
          if (path.endsWith('*') && url.pathname.startsWith(path.slice(0, -1)) && !prefixHit) prefixHit = hit;
        }
      }
      return prefixHit;
    },

    // Which settings the household has actually chosen (as opposed to defaults), per section.
    async savedKeys() {
      const out = {};
      if (!store) return out;
      for (const i of integrations) {
        if (!i.section) continue;
        const saved = await store.get('settings:' + i.section);
        if (saved && Object.keys(saved).length) out[i.section] = Object.keys(saved);
      }
      return out;
    },

    // Integration that owns a section (e.g. 'prayer' → prayer-aladhan).
    forSection: (section) => bySection.get(section) || null,

    async features() {
      return [...new Set((await this.enabled()).flatMap((i) => i.features))];
    },

    // Let every enabled integration that implements `name` work on a payload, in order.
    async runHook(name, payload, ctx) {
      const results = [];
      for (const i of await this.enabled()) {
        if (typeof i.hooks[name] === 'function') results.push(await i.hooks[name](payload, ctx));
      }
      return results;
    },

    async publicConfig(ctx) {
      const out = {};
      for (const i of await this.enabled()) {
        if (typeof i.publicConfig === 'function') Object.assign(out, await i.publicConfig(ctx));
      }
      return out;
    },

    async tools() {
      return (await this.enabled()).flatMap((i) => i.tools.map((t) => ({ ...t, integration: i.id })));
    },
  };
}
