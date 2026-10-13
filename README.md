# noor-frame

An Islamic family dashboard for the wall. It shows:

- prayer times, with the athan;
- the ayah of the day, with recitation;
- the family's calendars, with travel times;
- the weather.

It runs on a cheap Android photo frame, a Raspberry Pi screen, or any TV or
browser. AI features are optional, so households that don't want them never see
them.

> **Status:** early, but in daily use. Most parts work:
>
> - the server and integrations;
> - the dashboard and the phone companion;
> - the optional AI;
> - the Raspberry Pi setup;
> - the Android frame app.
>
> Android frames still need hands-on setup; see
> [Noor on an Android photo frame](docs/android-frame.md).

## How it fits together

```
 wall frame / Pi screen / TV          phone (scan a QR code)
        │  apps/frame                       │  apps/companion
        └──────────────┬────────────────────┘
                       ▼
              apps/server  (your home computer or Pi, or Cloudflare)
                       │  only enabled integrations are loaded
   ┌───────────┬───────┴───────┬────────────┬──────────┬────────────┐
 prayer     weather          quran       calendars   travel     AI (optional)
 AlAdhan    Open-Meteo    AlQuran Cloud   iCal/ICS   OSRM/Google   Claude
```

- **Everything runs in your house by default.** The server runs on any
  always-on computer on your Wi-Fi; a Raspberry Pi is ideal. Calendar links and
  API keys stay on it. Keys are encrypted, and screens never receive them.
- **Integrations are plug-ins.** Each one is a folder in `packages/integrations/`
  that declares its settings, routes and features. Turn an optional one off and
  its routes, settings and screen features all disappear.
- **Settings belong to the household.** These are saved on the server and apply
  to every screen; a change on one shows on the others within seconds:
  - location and prayer calculation;
  - units;
  - the Quran translation.

  Language, fonts, the clock, and each screen's theme, idle time and menu stay
  per screen.
- **Only approved screens can change things.** Each screen gets its own key the
  first time it connects. Screens on your home network are approved
  automatically; anything else waits for approval in the companion app. To
  approve every screen by hand, set `NOOR_AUTO_APPROVE=0` with a
  [setup code](docs/configuration.md#screens-and-phones) for the first one.
- **No keyboard on the frame.** Anything that needs real typing happens on your
  phone, after scanning a QR code on the screen: calendar links and keys. Wi-Fi
  is chosen on the frame itself, with Noor's own on-screen keyboard.

## Try it

Requires Node 22 or newer.

```sh
git clone https://github.com/rosman21/noor-frame
cd noor-frame
npm install
npm run dev       # open http://localhost:5174 (the dashboard, with hot reload)
```

To run it the way a Pi or home computer would:

```sh
npm run build     # builds the dashboard into apps/frame/dist
npm start         # serves the dashboard and API on http://localhost:8787
npm test          # runs fully offline, with every outside service faked
```

**First steps:**

1. Open **Settings** on the dashboard. Tap **Town or ZIP** and type your town
   or postal code. **Detect** guesses from your internet connection, which often
   lands on the nearest big city. Prayer times are worked out for the exact place.
2. Tap **Add calendar** and scan the code with your phone. Paste a calendar's
   share link (Apple, Google or Outlook) there.

To try it without real calendars, use `demo:family`, `demo:me`, `demo:spouse`
or `demo:kid` as links. Settings can also be preset in a `frame.config.json`
file; see [configuration](docs/configuration.md).

**On your phone:** on any screen, open **Settings → Open on phone** and scan the
code. The phone gets its own key and opens the companion. There you can:

- change household settings;
- search for your town or ZIP code;
- add calendars;
- switch optional features on or off, and add API keys;
- approve, rename or remove screens.

Each integration's settings page is built from the settings it declares, so a
new integration gets a working page without extra code.

**Optional AI:** in the companion, switch on **AI assistant** and paste an
Anthropic API key (console.anthropic.com → API keys).

- **Daily brief:** after Fajr each day, the screens show a short brief written
  from your calendar, prayer times and weather.
- **Ask the frame:** on your phone, it answers questions like "Who has something
  on tomorrow morning?" from the same data.
- **Model and cost:** it uses Claude Opus 5.5 by default; Sonnet 5.5 and Haiku
  5.5 cost less. It stops for the day at a spending limit you set (50¢ by
  default).
- **Limits:** it never writes Quran text itself (it quotes the ayah API) and
  doesn't give religious rulings.
- **Privacy:** the key is encrypted on your server and never reaches a screen.
  With AI off, none of this code reaches the screens.

**Travel times:** events with a real place show how long the trip takes and when
to leave. These are free estimates from OpenStreetMap. Add a Google Maps API key
(Routes API) in the companion for live traffic, transit and cycling.

The dashboard is designed for a 1280×800 frame and scales to fit any other
screen. On a 16:9 TV it widens instead of showing black bars. On a keyboard,
press **D** for test controls (pretend time, idle and night screens, play the
athan) and **M** for the menu.

## Where it runs

| Screen | Guide |
| --- | --- |
| Raspberry Pi (server, screen, or both) | [docs/pi-server.md](docs/pi-server.md): `sudo /opt/noor-frame/apps/kiosk-pi/install.sh both`. A screen Pi with no Wi-Fi starts a **Noor Frame Setup** network and shows a QR code; join it from your phone and pick your home Wi-Fi. |
| Android photo frame | [docs/android-frame.md](docs/android-frame.md): the full route for the tested AEEZO PF1007L, from a verified backup to Noor as the Home app. |
| TV or any browser | Open the server's address, for example `http://noor.local:8787`. See below. |
| Cloudflare (server only) | [docs/configuration.md](docs/configuration.md#hosting-on-cloudflare-optional). |
| Fire TV, Google TV, Apple TV | Planned. [docs/platforms.md](docs/platforms.md) compares every platform and sets out how to add one. |

**On a TV or browser:**

- **TV mode:** with no touch screen (or `?tv` in the address), it switches to TV
  mode. The menu becomes a side dock, and the remote's arrows, OK and Back move
  around with a large focus ring.
- **Sound:** browsers keep pages silent until they're touched, so the screen
  asks once to allow the athan sound.
- **Offline:** over https, or on the computer running the server, it keeps
  working offline with the last saved day.

**Athan recordings** aren't included, because most are copyrighted. Add your
own; see [apps/frame/public/audio](apps/frame/public/audio/README.md). Without
them, the frame plays a short built-in chime.

## Repository layout

| Path | What it is |
|---|---|
| `apps/server` | The API. `src/node.js` runs it at home, `src/worker.js` runs it on Cloudflare. |
| `apps/frame` | The wall dashboard: Today, Calendar, Prayer and Settings screens, idle and night screens, light and dark themes. |
| `apps/companion` | The phone app: household settings, calendars, optional features and keys, approving screens. Served by the server at `/companion/`. |
| `apps/kiosk-pi` | Raspberry Pi: one install script for a server, a wall screen or both, with Wi-Fi setup from a phone. |
| `apps/kiosk-android` | The Android Home app for photo frames, with Noor's own Wi-Fi setup and volume control. |
| `scripts/a33-frame` | Backup and root-ADB tooling for the Allwinner A33 PF1007L frame. |
| `packages/core` | The integration contract, settings, storage, encrypted secrets. |
| `packages/integrations/*` | Prayer times, weather, ayah, calendars, travel and AI. |
| `apps/kiosk-shared` | Noor's on-screen Wi-Fi page, shared by the Android and Raspberry Pi kiosks. |
| `docs/` | Guides: [Android frame](docs/android-frame.md), [Raspberry Pi](docs/pi-server.md), [platforms](docs/platforms.md), [configuration](docs/configuration.md), [writing an integration](docs/writing-an-integration.md). |

## Contributing

Contributions are welcome, from bug reports and translations to new
integrations and support for more frames. Start with
[CONTRIBUTING.md](CONTRIBUTING.md). Please follow the
[code of conduct](CODE_OF_CONDUCT.md). To report a security problem, see
[SECURITY.md](SECURITY.md); please don't open a public issue for it.

## Roadmap

1. ✅ Monorepo, integration contract, server, ported integrations, tests
2. ✅ Dashboard UI rebuilt on the new core (light/dark, menu modes)
3. ✅ Household settings saved on the server, shared by every screen
4. ✅ Phone companion app (QR sign-in, settings, calendars, integrations, devices)
5. ✅ Optional AI (Claude): a daily brief on the screens and questions from your phone
6. ✅ Raspberry Pi install script and Wi-Fi setup hotspot, web/TV mode
7. ✅ Android frame app: Home app, built-in Wi-Fi setup, volume, offline recovery
8. ✅ Guides: Android frame, Pi server, configuration, integrations
9. More frames, more integrations, a local AI option and screen-setting sync

## Credits and inspiration

This project was inspired by **Wes Bos's
[photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard)**. His
write-up on turning a cheap Android photo frame into a family dashboard, and the
dashboard he built for it, made us want to build one for our own home, centred
on prayer times, the athan and the Quran. His PF1007L hardware notes made the
Android frame work possible. Thank you, Wes. noor-frame is a separate project
written from scratch, but it wouldn't exist without his.

Data comes from these services:

- prayer times from [AlAdhan](https://aladhan.com);
- the Quran text, translations and recitations from [AlQuran Cloud](https://alquran.cloud);
- weather from [Open-Meteo](https://open-meteo.com);
- free travel estimates from [OpenStreetMap](https://www.openstreetmap.org)
  (Nominatim) and [OSRM](https://project-osrm.org).

Please respect each service's usage policy. Self-hosting households make few
requests, and results are cached.

## License

[MIT](LICENSE). Athan recordings, fonts and the data from the services above
keep their own licenses and terms.
