# Writing an integration

Everything the dashboard shows comes from an integration: prayer times, weather, the ayah,
calendars, travel times and the AI. An integration is a small package that declares its
settings and what it adds to the server. The server loads only the integrations that are
switched on. A disabled integration has no routes, adds nothing to `/api/config`, sends no
feature flags to screens and offers no tools to the AI.

This guide covers the contract in `packages/core/src/integration.js`, with a complete example
at the end.

## Where an integration lives

```
packages/integrations/<name>/
  package.json        name "@noor-frame/<name>", "type": "module", exports ./src/index.js
  src/index.js        export default defineIntegration({ … })
```

The root `package.json` already treats every folder in `packages/integrations/` as an npm
workspace. To turn yours on:

1. Add it to `dependencies` in `apps/server/package.json`, for example
   `"@noor-frame/prayer-times-example": "*"`.
2. Import it in `apps/server/src/integrations.js` and add it to `defaultIntegrations`.
3. Run `npm install` from the repo root so the workspace link is created.

Copy `package.json` from `packages/integrations/weather-open-meteo/` as a starting point. Its
only dependency is `@noor-frame/core`.

Integrations run on both Node (the home server) and Cloudflare Workers. Use web-standard APIs
only (`fetch`, `Request`, `Response`, `crypto.subtle`), never Node built-ins like `fs`.

## defineIntegration

`defineIntegration(def)` checks the definition when the server starts and fills in defaults.

| Field | What it does |
| --- | --- |
| `id` | Unique, kebab-case, such as `weather-open-meteo`. |
| `name`, `description` | Shown in the companion app. `name` is required. |
| `section` | One plain word, such as `weather`. It names the block in `frame.config.json` and in saved settings. Leave it out if the integration has no settings. |
| `optional` | `true` lets the household switch it off. Default `false`: always on. |
| `enabledByDefault` | For optional integrations: on until someone switches it off. Default `true`. The AI uses `false`. |
| `settings` | The setting schema. It drives the companion's form and the server's validation. |
| `routes` | API routes it adds. |
| `hooks` | Functions other integrations call, such as `events`. |
| `publicConfig` | Extra data merged into `GET /api/config`, which every screen reads. |
| `features` | Flags sent to screens in `/api/config` while the integration is on. |
| `tools` | Tools the AI can call when answering questions. |

### Settings

Each entry has a `key`, a `type` and usually a `label`, `default` and `help`.

| Type | Value | Extra fields |
| --- | --- | --- |
| `string` | Text | `maxLength`, `pattern` (a regular expression as a string) |
| `number` | A number | `min`, `max` |
| `boolean` | On or off | |
| `select` | One of `options: [{ value, label, group? }]` | The value keeps its type, so numbers stay numbers. |
| `secret` | An API key or password | Encrypted on the server. It's never sent back, not even to the companion. |
| `json` | Any JSON value | `keys` plus `valueType: 'number' \| 'boolean'` shows one row per key, as in the athan's prayers or the prayer `tune`. |

Add `advanced: true` to tuck a setting under **Advanced** in the companion.

Saving checks every value against the schema: unknown keys, numbers out of range and choices
not in the list are rejected with a message meant for people. Sending `null` puts a setting
back to its default.

### Routes

```js
routes: {
  'GET /api/weather': async (request, ctx) => json(await forecast(ctx)),
  'POST /api/calendars/add': { auth: 'device', handler: async (request, ctx) => … },
  'GET /api/files/*': async (request, ctx) => …,   // a trailing * matches a prefix
},
```

- Keys look like `METHOD /path`. The method is `GET`, `POST`, `PUT`, `DELETE` or `ANY`.
- A handler receives a web `Request` and the context, and returns a `Response`. The `json()`
  helper builds one: `json(data, status = 200, maxAgeSeconds = 0)`.
- Reading is open to anyone who can reach the server. Anything that changes household data
  should use `{ auth: 'device', handler }`. Only approved screens and phones get through, and
  the device is available as `ctx.device`.
- An error thrown from a handler becomes a `502` with `{ error: message }`, so write messages
  people can understand.
- Exact paths win over prefix matches.

`check: { label, path }` adds a **Check** button to the integration's companion settings page
while that integration is enabled. The path must be one of the integration's declared routes,
and the route must accept `POST`. Return `{ items: [...] }`; each item has `ok` (`true` for
success, `false` for a problem, `null` for a warning), `title`, and optional `detail` and
`fix: { key, value, label }`. The companion displays the results and applies a suggested fix
to that setting when the user taps it.

### Hooks

A hook lets one integration work on another's data without either importing the other. The
calendar integration runs the `events` hook after loading events:

```js
const extra = await ctx.runHook('events', { events, from, to });
```

`runHook` calls the hook on every enabled integration that has one, in order, and returns
their results as an array. Travel uses it to add `e.travel` to events, and returns
`{ travelPending, errors }`. The calendar merges those into its own response.

### publicConfig and features

`publicConfig(ctx)` returns an object merged into `GET /api/config`. Every screen reads it.
For example, weather sends `{ weather: { units } }`. **Never put secrets here.**

`features` are short names such as `['weather']` that appear in `/api/config` as
`features` while the integration is on. Screens use them to show or skip features. The frame
also uses them to load optional code: the AI's code (`apps/frame/src/brief.js`) is downloaded
only when the `ai` feature is on. To gate a large new piece of screen code the same way, map
your feature to a dynamic import in `apps/frame/src/main.js`.

### Tools for the AI

When the AI assistant is on, it can call the tools of every enabled integration:

```js
tools: [{
  name: 'get_weather',
  description: 'Weather for the household location …',
  input_schema: { type: 'object', properties: {} },
  run: async (input, ctx) => ({ … }),   // return plain data
}],
```

Return only what the screens could already show. Quran text must always come from the
Quran integration's tool, never from the model.

## The context (ctx)

Every route, hook and tool gets the same per-request context (`packages/core/src/context.js`):

| Helper | What it gives you |
| --- | --- |
| `ctx.settings(section)` | That section's resolved settings, **secrets included**. Server-side only, never send them on. |
| `ctx.location()` | `{ name, region, latitude, longitude, timezone, … }` for the household. |
| `ctx.remember(key, ms, fn)` | A shared in-memory cache. Callers asking for the same key at once share one request. A thrown error isn't cached. |
| `ctx.runHook(name, payload)` | Runs a hook on every enabled integration. |
| `ctx.store` | Household key-value storage: `get`, `put(key, value, ttlSeconds?)`, `del`, `keys(prefix)`. `null` on a read-only deployment, so check before writing. |
| `ctx.secrets` | Encrypted key storage. Prefer `secret` settings, which use it for you. |
| `ctx.registry` | The registry, to look at other integrations. |
| `ctx.config` | `frame.config.json`, the first-run defaults. |
| `ctx.request`, `ctx.url` | The request, and its parsed URL. |
| `ctx.device` | The approved device, on `auth: 'device'` routes. |

`@noor-frame/core` also exports small helpers: `json`, `html`, `getJson(url, { timeoutMs,
headers })`, `getText(url)`, `escapeHtml` and `randomToken`. `getJson` and `getText` send a
`noor-frame` user agent and throw on HTTP errors.

Cache anything that calls an outside service. Free APIs have usage limits, and one household
can have several screens polling. Weather caches for 10 minutes; the ayah caches for a day.

## Settings pages come for free

The companion app (`apps/companion/src/views/section.js`) builds each integration's page from
`GET /api/settings`, which lists every integration with its schema and current values. You
don't write any companion code:

- `boolean` becomes a switch, `select` a list, `number` a number field and `string` a text
  field.
- `json` with `keys` shows one row per key.
- `secret` shows "Saved · ends in 1234", with a field to paste a replacement. The key itself is
  never shown.
- `advanced` settings go under **Advanced**.
- A string setting with `autocomplete: '/api/path'` asks that POST route for suggestions as the
  user types. After a 350 ms pause and once at least four characters are entered, the companion
  sends `{ input, session }`; return `{ suggestions: [text], note? }`. A `note` is shown instead of
  suggestions and disables further requests for that field visit. Use the session value to group
  related requests if the outside service supports it.
- Optional integrations get an on/off switch at the top.

Saving posts to `POST /api/settings` with `{ integration: '<id>', values: { … } }`.

## Keys never reach screens

- A `secret` setting is encrypted with AES-GCM in the server's storage.
- `GET /api/settings` reports a secret only as `{ set, last4 }`.
- `ctx.settings()` includes secrets for your server code. Don't return them from a route,
  `publicConfig`, a hook result or a tool.
- Send keys to outside services in a header where the service allows it, not in the URL, so
  they don't end up in logs. Travel sends the Google key as `x-goog-api-key`.

A test should check this; see below.

## Testing

`npm test` runs every `packages/**/test/*.test.js` and `apps/server/test/*.test.js` file with
Node's built-in test runner, fully offline. The end-to-end tests in
`apps/server/test/handler.test.js` build the real server handler with a memory store and
replace `globalThis.fetch` with a fake that answers by host:

```js
beforeEach(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    switch (url.host) {
      case 'api.open-meteo.com': return ok({ /* a small, realistic reply */ });
      // …one case per outside service…
      default: throw new Error('unexpected fetch ' + url);
    }
  };
});
```

The `default` case makes any unexpected network call fail the test. Add a case for your
service there, then test through the API the way a screen would:

```js
test('with a Google Maps key, driving times come from the Routes API with live traffic', async () => {
  const { call } = await withGoogle();            // signs in and saves the key via /api/settings
  const { body } = await call('GET', '/api/calendar');
  const costco = body.events.find((e) => e.title === 'Costco run');
  assert.deepEqual([costco.travel.minutes, costco.travel.km, costco.travel.source], [21, 15.4, 'google']);
  assert.equal(JSON.stringify(body).includes('AIza'), false, 'screens never see the key');
});
```

`server()` returns `call(method, path, body, { from, key })`, which uses a home-network
address by default, and `signIn()`, which registers a test screen so `auth: 'device'` routes
work. Good tests for a new integration cover:

- what it sends to the outside service, and how it reads the answer;
- a failure from that service;
- that switching it off removes its routes and feature (for optional integrations);
- that its keys never appear in responses.

## A complete example

A keyless integration that shows a daily hadith from a made-up API. Call the folder
`packages/integrations/hadith-example/`.

`package.json`:

```json
{
  "name": "@noor-frame/hadith-example",
  "version": "0.1.0",
  "description": "A daily hadith.",
  "license": "MIT",
  "type": "module",
  "exports": { ".": "./src/index.js" },
  "dependencies": { "@noor-frame/core": "*" }
}
```

`src/index.js`:

```js
// A daily hadith from hadith.example (made up for this guide). One per day, the same on every
// screen, cached for the day.

import { defineIntegration, json, getJson } from '@noor-frame/core';

async function hadithOfDay(ctx, date) {
  const { collection } = await ctx.settings('hadith');
  return ctx.remember(`hadith-${date}-${collection}`, 24 * 3600e3, async () => {
    const h = await getJson(`https://api.hadith.example/v1/daily?date=${date}&collection=${collection}`);
    return { date, text: h.text, source: h.reference };
  });
}

export default defineIntegration({
  id: 'hadith-example',
  name: 'Hadith of the day',
  description: 'A short hadith each day.',
  section: 'hadith',
  optional: true,
  enabledByDefault: false,
  settings: [
    { key: 'collection', type: 'select', label: 'Collection', default: 'bukhari',
      options: [{ value: 'bukhari', label: 'Sahih al-Bukhari' }, { value: 'muslim', label: 'Sahih Muslim' }] },
  ],
  routes: {
    'GET /api/hadith': async (request, ctx) => {
      const date = new URL(request.url).searchParams.get('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return json({ error: 'date=YYYY-MM-DD required' }, 400);
      return json(await hadithOfDay(ctx, date), 200, 3600);
    },
  },
  features: ['hadith'],
  tools: [{
    name: 'get_hadith_of_the_day',
    description: "Today's hadith as shown on the frame, with its reference. Quote it exactly.",
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    run: async ({ date }, ctx) => hadithOfDay(ctx, date),
  }],
});
```

Then add it to `apps/server/package.json` and `apps/server/src/integrations.js`, run
`npm install`, and switch it on in the companion. Its settings page already works. Showing it
on the dashboard is a separate change in `apps/frame`.

Before opening a pull request:

- add tests with a fake reply for `api.hadith.example`;
- run `npm test`;
- say in the PR which outside service it uses, its terms, and whether it needs a key.
