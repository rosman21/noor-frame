# Contributing to noor-frame

Thank you for helping. Bug reports, translations, docs, new integrations and
support for more frames are all welcome.

## Ground rules

- **Be kind.** This project follows the [code of conduct](CODE_OF_CONDUCT.md).
- **Security problems go to [SECURITY.md](SECURITY.md)**, not a public issue.
- **Religious content needs care.** Quran text always comes from the ayah API,
  never from code, translations we write ourselves, or an AI model. Prayer
  calculations come from AlAdhan's published methods. If you change anything
  that decides a prayer time or shows Quran text, explain the source in your
  pull request.
- **The household's data stays at home.** Calendar links and keys live on the
  server. Screens never receive keys. New features keep it that way.
- **AI stays optional.** With the AI integration off, no AI code or UI should
  reach the screens.

## Set up

You need Node 22 or newer and Python 3 (for the Pi and frame tooling tests).

```sh
git clone https://github.com/rosman21/noor-frame
cd noor-frame
npm install
npm run dev            # dashboard with hot reload on http://localhost:5174
```

To see a full dashboard without real calendars, create `frame.config.json` in
the repo root with the built-in demo calendars:

```json
{
  "location": { "city": "Toronto", "country": "Canada" },
  "calendars": [
    { "id": "family", "name": "Family", "color": "#111111", "family": true, "url": "demo:family" },
    { "id": "me", "name": "Me", "color": "#2D5BFF", "url": "demo:me" }
  ]
}
```

The file is ignored by Git. See [configuration](docs/configuration.md) for every
option.

## Tests

Everything runs offline; outside services are faked.

```sh
npm test               # server, core and integrations (node:test)
npm run test:kiosk-pi  # Raspberry Pi helper, against a pretend NetworkManager
npm run test:a33       # A33 frame backup and boot-patch tooling, on fake disks
npm run build          # the dashboard and companion must build
npm run test:e2e       # the phone companion in real browsers (after npm run build)
```

The browser tests drive the phone companion the way a person would, as an iPhone
(WebKit) and an Android phone (Chromium). They cover scanning a screen's code,
every settings page, keys, calendars and approving devices, and they check that
changes reach the screens. They run against `e2e/server.mjs`: the real API with
the same fake outside services as the API tests. Install the browsers once with
`npx playwright install chromium webkit`.

A new route or integration needs tests. The pattern is in
`apps/server/test/handler.test.js`: a fake `fetch` answers each outside host,
and requests go through the real handler. The
[integration guide](docs/writing-an-integration.md) has a worked example.

## Where things live

| Change | Look in |
| --- | --- |
| A data source (prayer, weather, calendars, travel, AI) | `packages/integrations/<name>/` and [writing an integration](docs/writing-an-integration.md) |
| Settings, storage, secrets, devices | `packages/core/src/` |
| The API and its routes | `apps/server/src/handler.js` |
| The wall dashboard | `apps/frame/src/` and `apps/frame/styles/` |
| The phone companion | `apps/companion/src/` |
| Raspberry Pi | `apps/kiosk-pi/` and [the Pi guide](docs/pi-server.md) |
| Android frame app | `apps/kiosk-android/` |
| On-screen Wi-Fi page (Android and Pi) | `apps/kiosk-shared/setup.html` |
| A new kind of screen (Fire TV, Apple TV…) | [docs/platforms.md](docs/platforms.md) |
| Frame hardware tooling | `scripts/a33-frame/` |

## Style

- **Match the code around you.** Plain JavaScript (ES modules on the server,
  and the dashboard's existing style in `apps/frame`). There are no frameworks
  and no build step on the server. Comments explain *why*, briefly.
- **No new dependencies without a reason.** Say why in the pull request.
- **The dashboard runs on old hardware.** It targets Chrome 106, on a 1 GB
  Android 6 frame. Keep work per minute small, and test on a slow device if you
  can.
- **Touch and remote first.** Tap targets are large. Everything must also work
  with arrow keys, Enter and Back (TV mode: add `?tv` to the address).
- **Words matter.** Short, plain sentences in the UI and docs.

## Translations

UI strings are written in English in the code and looked up with
`App.t('…')`. Translations live in `apps/frame/src/lang.js`, one block per
language. To add a language:

1. Add it to `LANGS` in `apps/frame/src/i18n.js`.
2. Add a block to `lang.js`.

Missing strings fall back to English, so partial translations are fine. Please
have a native speaker check religious terms.

## Hardware support

Reports from other frames and boards are very useful, even if nothing works yet.
Open a **Hardware report** issue with:

- the board and Android version;
- what you tried;
- what each check printed.

**Never post** backups, device serial numbers or Wi-Fi details.

The A33 tooling refuses to run on a disk it hasn't identified. Keep it that way:
a pull request that weakens a safety check needs a very good reason.

## Pull requests

1. Open an issue first for anything large, so we can agree on the approach.
2. Keep each pull request to one change, with tests and doc updates.
3. Run `npm test` and `npm run build` before pushing. CI runs them too.
4. Describe what changed and how you checked it. For UI changes, add a
   screenshot.

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
