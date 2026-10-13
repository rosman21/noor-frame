# Configuration

How to set up and run the noor-frame server: the optional `frame.config.json`, what it stores
in `data/`, environment variables, and Cloudflare hosting.

Most households never edit a file. Settings are changed in the phone companion app and saved
on the server. `frame.config.json` is for first-run defaults, or for setting things up before
any screen is connected.

## Where settings come from

For each section, such as `prayer` or `weather`, the server combines four layers. Later layers
win:

1. **Defaults** declared by the integration (listed below).
2. **`frame.config.json`**, the first-run defaults.
3. **Saved settings**, changed from the companion app or a screen. These apply to the whole
   household.
4. **Per-request overrides** a screen adds to one request, such as `?units=fahrenheit`. They
   apply to that request only.

So once a setting has been saved from the companion, changing the same setting in
`frame.config.json` has no effect. Put a setting back to its default in the companion (or send
`null`) and the file's value applies again.

### Household and per-screen settings

- **Household** settings are saved on the server and shared by every screen: location, prayer
  calculation, the athan, temperature units, the Quran translation and reciter, calendars,
  travel, and the AI. A change on one screen shows on the others within seconds.
- **Per-screen** settings stay on each screen, in its browser storage: language, text style and
  Arabic font, the clock, theme, idle time, menu position and what the screen does at night.
  The `display` section sets the household defaults for some of these, and each screen can
  still change its own.

## frame.config.json

Put it in the repo root (or in `NOOR_HOME`, see below). It's ignored by Git because it can
hold calendar links. Every section is optional. A full example:

```json
{
  "location": { "city": "Springfield", "country": "United States" },

  "prayer": { "method": 2, "school": 0, "tune": { "Fajr": 0, "Isha": 0 } },

  "athan": {
    "enabled": true,
    "prayers": { "Fajr": true, "Dhuhr": true, "Asr": true, "Maghrib": true, "Isha": true },
    "reminderMinutes": 10
  },

  "weather": { "units": "fahrenheit" },

  "quran": { "translation": "en.sahih", "reciter": "ar.alafasy" },

  "travel": { "home": "123 Main St, Springfield", "mode": "driving" },

  "display": { "clock24h": false, "theme": "auto" },

  "integrations": { "travel": true, "ai-claude": false },

  "calendars": [
    { "id": "family", "name": "Family", "color": "#111111", "family": true, "url": "demo:family" },
    { "id": "me", "name": "Me", "color": "#2D5BFF", "url": "demo:me" }
  ]
}
```

If the file isn't valid JSON, the server refuses to start and says why.

### location

Where the household is. Prayer times, the athan and the weather all use it.

| Key | Type | Notes |
| --- | --- | --- |
| `city` | text | Looked up with Open-Meteo's free geocoder. |
| `country` | text | Picks the right city when several share a name. |
| `region` | text | Shown under the city name. |
| `latitude`, `longitude` | number | Use these instead of `city` for an exact place. |
| `timezone` | text | For example `America/New_York`. Found automatically if left out. |
| `code` | text | Two-letter country code, such as `US`. |

With no location at all, screens ask you to choose a city.

Screens and the companion search by town name or postal code through the server
(`POST /api/location/search`, Open-Meteo's geocoder, no key). They save the chosen
place's `latitude`, `longitude` and `timezone`, so prayer times are worked out for
that exact spot. Moving 40 km usually changes them by a minute or two. A bigger
difference from your masjid comes from the calculation method, the Asr setting or
the masjid's own adjustments; match those under `prayer`.

### prayer

From the `prayer-aladhan` integration.

| Key | Default | Notes |
| --- | --- | --- |
| `method` | `2` (ISNA) | The calculation method. The companion lists all of them. |
| `school` | `0` | Asr time: `0` Standard (Shafi, Maliki, Hanbali), `1` Hanafi. |
| `tune` | `{}` | Minutes to add to each time, −30 to 30, for `Fajr`, `Sunrise`, `Dhuhr`, `Asr`, `Maghrib` and `Isha`. Use it to match your local masjid. |

### athan

| Key | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | Play the athan at prayer times. |
| `volume` | `0.8` | 0 to 1, a share of the device's own volume. |
| `prayers` | all `true` | Which of the five prayers get the athan. |
| `file` | `/audio/athan.mp3` | The recording for Dhuhr, Asr, Maghrib and Isha. |
| `fajrFile` | `/audio/athan-fajr.mp3` | The Fajr recording. See `apps/frame/public/audio/README.md`. |
| `reminderMinutes` | `10` | A reminder this many minutes before each prayer, 0 to 60. |

### weather

| Key | Default | Notes |
| --- | --- | --- |
| `units` | `celsius` | `celsius` or `fahrenheit`. |

### quran

| Key | Default | Notes |
| --- | --- | --- |
| `translation` | `en.sahih` | An AlQuran Cloud edition, such as `en.pickthall`, `ur.jalandhry` or `fr.hamidullah`. |
| `reciter` | `ar.alafasy` | An AlQuran Cloud audio edition, such as `ar.husary`. |
| `maxArabicLength` | `220` | Longest ayah to show, in characters (60 to 2000). Longer ayat are skipped so the text fits the home tile. |

### travel

Optional. On by default.

| Key | Default | Notes |
| --- | --- | --- |
| `home` | (your city) | Where trips start. |
| `mode` | `driving` | `driving`, `walking`, `transit` or `bicycling`. Transit and bike need a Google key. |
| `googleMapsApiKey` | (none) | Adds live traffic, address validation and address suggestions. Enable Routes API, Address Validation API and Places API (New) in Google Cloud. Better saved from the companion, where it's encrypted. See the [Google Maps setup and cost guide](google-maps.md). |
| `googleDailyLimit` | `100` | Maximum outgoing Google Maps requests counted per household day (0 to 5000), shared by routes, home-address validation and Places autocomplete. After that, trips use free estimates until midnight, and screens say why. |
| `lookaheadHours` | `36` | How far ahead to look up trips (1 to 168). |
| `waitMs` | `4000` | How long the calendar waits for slow lookups before answering (0 to 20000). The rest finish in the background. |

Without a Google key, travel times are free estimates from OpenStreetMap, with no live
traffic.

### ai

The `ai-claude` integration. Optional and **off** by default.

| Key | Default | Notes |
| --- | --- | --- |
| `apiKey` | (none) | An Anthropic API key. Save it from the companion. |
| `model` | `claude-opus-5-5` | The companion lists the choices. |
| `dailyLimitCents` | `50` | AI stops for the day at this spend, in US cents (0 to 5000). |
| `brief` | `true` | A daily brief on the screens. |
| `briefLanguage` | `en` | `en`, `ar`, `ur`, `fr`, `tr`, `id` or `ms`. |
| `chat` | `true` | Questions from the companion app. |
| `effort` | `low` | `low`, `medium` or `high` thinking effort. |

### display

Household defaults for every screen. Each screen can still change its own.

| Key | Default | Notes |
| --- | --- | --- |
| `clock24h` | `false` | 24-hour clock. |
| `theme` | `auto` | `auto`, `light` or `dark`. |
| `idleMinutes` | `2` | Idle screen after this many minutes; `0` means never. |
| `nav` | `top` | Menu: `top`, `bottom`, `left` or `right`. |

### integrations

Switches optional integrations on or off, by id: `travel` and `ai-claude` today. A switch
saved from the companion wins over the file. Required integrations (prayer, weather, Quran,
calendars) are always on.

### calendars

Calendars listed here appear on every screen, alongside any added from a phone.

| Key | Notes |
| --- | --- |
| `id` | Unique, such as `family`. |
| `name` | Shown on the lanes. |
| `color` | A hex colour. |
| `family` | `true` for the shared family calendar. |
| `url` | An iCal/ICS link (Apple, Google or Outlook share links work), or a built-in demo. |

ICS feeds are limited to 10 MB per download. The server expands at most 50,000 recurrence
iterations and keeps at most 5,000 events per feed, so an unusually large calendar cannot use
unbounded memory or processing time.

The demos `demo:family`, `demo:me`, `demo:spouse` and `demo:kid` generate sample events
around today, so you can try everything without real calendars. Calendar links are private:
anyone with one can read the calendar. They stay on the server.

Screens can hide calendars from this file or change their colour. Adding calendars from a phone
is the usual way.

### Secrets in the file

A `secret` setting, such as `travel.googleMapsApiKey` or `ai.apiKey`, can be set in
`frame.config.json` as a fallback. It's stored in plain text there, so prefer the companion,
which encrypts it. A key saved from the companion wins over the file.

## The data folder

The home server keeps everything it saves in `data/`, next to `frame.config.json`:

| File | What it holds |
| --- | --- |
| `data/frame.json` | Saved settings, which integrations are on, calendars added from phones, screens and phones with their approval, encrypted keys, and short-lived pairing codes. Only a hash of each device key is stored. |
| `data/secret.key` | The key that encrypts saved API keys. Created on first start, readable only by the server's user. |

**Back up both files together.** Without `secret.key`, saved API keys can't be decrypted, and
you'll need to paste them again. Both are ignored by Git; never commit them. Writes go to a
temporary file that's renamed into place, so a power cut can't leave half a file.

## Environment variables (home server)

All optional. Set them before `npm start`, or on a Raspberry Pi in `/etc/noor-frame/server.env`.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | The port to listen on. |
| `NOOR_HOME` | the repo root | The folder holding `frame.config.json` and `data/`. The Pi installer uses `/var/lib/noor-frame`. |
| `FRAME_SECRET` | `data/secret.key` | The key for encrypting saved API keys. If set, `secret.key` isn't used or created. Keep it the same, or saved keys stop working. |
| `STATIC_DIR` | `apps/frame/dist` | The built dashboard to serve. |
| `NOOR_PUBLIC_URL` | `http://<this computer's IP>:PORT` | Node.js home server only (including the Pi install): the address phones should use in QR codes. Set it if the automatic one is wrong, for example `http://noor.local:8787`. Cloudflare Workers do not read this variable. |
| `NOOR_ANNOUNCE` | on | Set to `0` to stop the server announcing itself on the network (`_noor-frame._tcp`), which lets frames and Pi screens find it. `npm run dev` doesn't announce. |
| `NOOR_AUTO_APPROVE` | on | Set to `0` to stop approving new screens automatically. |
| `NOOR_TRUST_PROXY` | none | Node.js only. Behind your own trusted proxy on the same computer: `cloudflare` or `1`. See below. |
| `NOOR_SETUP_CODE` | none | A secret of 12 or more characters. Opening the dashboard once with `?setup=<code>` approves that screen. Use it with `NOOR_AUTO_APPROVE=0`. |

## Screens and phones

Reading the dashboard needs no key. Changing anything needs an **approved device**:

- Each screen gets its own key the first time it connects (`POST /api/devices/register`).
- On the Node.js home server, a screen connecting from a private address (your home network:
  `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, or this computer) is approved automatically.
  Cloudflare Workers do not auto-approve screens; use `FRAME_SETUP_CODE` for first registration.
- Anything else waits for approval. Approve it in the companion app, under screens.
- A phone that scans a screen's QR code (Settings → Open on phone) gets its own approved key.
  The code lasts 15 minutes.
- Behind a tunnel or reverse proxy on the same computer (cloudflared, nginx…), every request
  arrives from localhost, and its forwarding headers say whatever the sender wrote. So such
  requests are never approved automatically; use `NOOR_SETUP_CODE`. If you run the proxy
  yourself, tell the server which one with `NOOR_TRUST_PROXY`: `cloudflare` believes only
  Cloudflare's `CF-Connecting-IP`, and `1` believes only the last `X-Forwarded-For` entry (the
  one your proxy added).
- At most 10 new screens can register from one address in 10 minutes (60 in all).

With `NOOR_AUTO_APPROVE=0`, new screens are approved only from an approved device. To approve
the first one, set `NOOR_SETUP_CODE` and open the dashboard once with the code in the address:

```
http://<server>:8787/?setup=<your code>
```

The screen sends the code when it registers and removes it from the address straight away.
From that screen, use **Settings → Open on phone** to approve your phone, and approve other
screens from there. A code shorter than 12 characters is ignored.

### If you are locked out

If no approved screen or phone can open household settings, use the server's setup code to
approve a screen again. On a Node.js home server, set `NOOR_SETUP_CODE` to a private value at
least 12 characters long in the server environment (on the Pi, edit
`/etc/noor-frame/server.env`), then restart the server. Open the dashboard on the screen with
`/?setup=<your code>` appended to its address. For Cloudflare Workers, set the `FRAME_SETUP_CODE`
secret and open `https://<your-worker>/?setup=<your code>`. Keep the code private and remove it
from any saved links after registration. Once a screen is approved, use **Settings → Open on
phone** to pair a phone. Registration is limited to 10 attempts per address and 60 attempts
total in each 10-minute window; if you hit that limit, wait a few minutes before retrying.

## Hosting on Cloudflare (optional)

The same server runs as a Cloudflare Worker (`apps/server/src/worker.js`), serving the built
dashboard as static assets. From the repo root:

```sh
npm install
npm run build                       # builds apps/frame/dist, which the Worker serves
cd apps/server
npx wrangler kv namespace create FRAME_KV
npx wrangler secret put FRAME_SECRET       # any long random text; keep it the same
npx wrangler secret put FRAME_SETUP_CODE   # 12+ characters; approves your first screen
```

Then edit `apps/server/wrangler.jsonc`:

- Add the storage binding the first command printed:
  `"kv_namespaces": [{ "binding": "FRAME_KV", "id": "<id>" }]`.
- Put your household defaults, what `frame.config.json` does at home, in a variable:
  `"vars": { "FRAME_CONFIG": { "location": { "city": "Springfield", "country": "United States" } } }`.

Deploy with `npx wrangler deploy` (or `npm run deploy -w @noor-frame/server` from the root).

| Binding | What it does |
| --- | --- |
| `FRAME_CONFIG` | First-run defaults, as JSON. The same shape as `frame.config.json`. |
| `FRAME_KV` | Storage for settings, calendars, devices and keys. Without it the server is read-only: screens work, but nothing can be saved. |
| `FRAME_SECRET` | Encrypts saved API keys. Without it, keys can't be saved. |
| `FRAME_SETUP_CODE` | Approves a screen opened with `?setup=<code>`. Without it, no device can be approved on Cloudflare. |

Things to know before choosing Cloudflare:

- **The address is public.** Anyone who finds it can read your dashboard, including calendar
  events. Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  in front of it before adding real calendars.
- **Nothing is approved automatically**, because there's no home network to recognise. Open
  the dashboard once as `https://<your worker>/?setup=<FRAME_SETUP_CODE>` to approve your
  first screen, then approve your phone and other screens from it.
- **No athan recordings** unless the MP3s were in `apps/frame/public/audio/` when you built.
  They're excluded from Git, so a fresh clone plays the built-in chime.
- Settings saved on the home server and on Cloudflare are separate; nothing syncs between them.
