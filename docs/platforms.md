# Screens and platforms

Noor's dashboard (`apps/frame`) is one web app. It runs anywhere with a modern browser engine
(Chrome 106 or newer). A *platform* is what wraps it on a particular kind of screen. The
wrapper's jobs:
- **Keep it full screen** and starting by itself.
- **Recover when the server is away.**
- **Provide the device controls a browser can't reach:** Wi-Fi, the display, volume.

## The bridge: `window.Frame`

A platform tells the dashboard what it can do by defining `window.Frame` before the dashboard
loads. The dashboard checks which functions exist (`App.can` in `apps/frame/src/device.js`)
and only shows the controls a screen supports. A plain browser defines nothing and gets none
of them.

| Function | What the dashboard does with it |
| --- | --- |
| `platform` | `'android'`, `'pi'`, … (`App.platform`). |
| `openWifiSettings()` | Shows **Settings → Wi-Fi**. The platform opens its Wi-Fi screen. |
| `screen(on)` | **Settings → At night → Screen off.** Turns the display off at night and on for the athan or a tap. |
| `volume()` | The device's volume as JSON `{"level", "max"}`, or `null`. Shows **Settings → Sound**. |
| `setVolume(level)` | Sets it. The dashboard plays a short tone at the new level. |

Calls must return straight away. A platform that has to ask something slower, like the Pi's
helper over HTTP, keeps the last answer and refreshes it, as `device.js` does for the Pi.

The **Wi-Fi setup page** (`apps/kiosk-shared/setup.html`) is shared too. It works with no
server and no network, because each platform keeps its own copy, and it talks to the device
through a small promise-based bridge:

| Call | Answers |
| --- | --- |
| `status()` | `{ wifiOn, connected, ssid, connecting, authFailed, ip }` |
| `networks()` | `[{ ssid, security: 'wpa' \| 'open' \| 'other', bars: 0–3, saved }]` |
| `scan()`, `connect(ssid, password, security)` | Starts a scan; joins a network. |
| `serverUrl()`, `setServerUrl(url)` | The Noor server's address, kept on the device. |
| `openDashboard()` | Back to the dashboard. |
| `phoneSetup()` | Optional: set up Wi-Fi from a phone instead (the Pi's setup network). |

See `androidBridge` and `piBridge` at the top of the page's script for the two versions.

## What each platform does today

Noor supports three kinds of screen: the **Android photo frame**, the **Raspberry Pi** and
**any modern browser** (including a TV's own browser). The Pi setup is covered by automated
tests and a Debian container, but hasn't been tried on real Pi hardware yet; reports are
welcome.

| | Android frame | Raspberry Pi | Browser / TV |
| --- | --- | --- | --- |
| Where | `apps/kiosk-android` | `apps/kiosk-pi` | any browser |
| Starts by itself | Home app | systemd + cage | — |
| Full screen | ✅ | ✅ | browser full screen |
| Finds the server by itself | ✅ (`_noor-frame._tcp`) | ✅ (`_noor-frame._tcp`) | — (type the address) |
| Recovers when the server is away | ✅ Wi-Fi page, retries | ✅ connecting screen | offline copy (https or localhost) |
| Wi-Fi on the screen | ✅ Noor's keyboard | ✅ touch screens | — |
| Wi-Fi from a phone | — | ✅ setup network | — |
| Change the server address | ✅ | ✅ | type it |
| Volume (Settings → Sound) | ✅ | ✅ (ALSA / PipeWire) | — |
| Screen off at night | — (night clock) | ✅ | — |
| Remote control (arrows, OK, Back) | — | ✅ with `?tv` | ✅ TV mode |
| Boot animation | ✅ `bootanimation.zip` | ✅ `--splash` (wall frames) | — |

**Finding the server.** Every Noor server announces itself on the home network as
`_noor-frame._tcp` (`apps/server/src/announce.js`: `dns-sd` on macOS and on Windows with
Bonjour, `avahi-publish` on Linux, Avahi's service file on a Pi set up by the installer).
Android frames and Pi screens look for it when they have no server yet, or when theirs stops
answering, so a server that moves to a new address is found again. With several servers on one
network, the Android frame lists them to choose from. `NOOR_ANNOUNCE=0` stops a server
announcing itself; `npm run dev` doesn't announce.

## Ideas for later

These aren't supported and aren't scheduled. They're written down so anyone who wants to add
one knows where to start. Until then, a TV's own browser with `?tv` works, and a Mac or iPhone
can AirPlay a browser showing the dashboard.

### Fire TV and Google TV

Fire TV runs Fire OS, which is built on Android, with a modern WebView. The Android app is
most of the way there:

- **Launcher entry.** Add a TV launcher entry (`android.intent.category.LEANBACK_LAUNCHER`)
  and a 320 × 180 banner. Mark touch and the `HOME` category as not required.
- **Detect the TV.** Use `UiModeManager` to spot a TV, and then:
  - open the dashboard with `?tv`, so the remote moves a focus ring;
  - leave out `openWifiSettings` and `setVolume`, because the TV and its remote handle those.
- **Same server.** Nothing changes on the server: screens register like any other.
- **Starting it.** Fire TV can't make Noor its home screen. Families start Noor from the apps
  row, and it keeps the screen awake while it's open.

### Apple TV

tvOS has no web view, so the dashboard can't run inside an Apple TV app. An Apple TV version
would be a **native app** (SwiftUI) that draws its own screens from the same server API:

- **What it reads:** `/api/config`, `/api/prayer`, `/api/calendar`, `/api/weather` and
  `/api/ayah`.
- **Signing in:** it registers with `/api/devices/register` like any screen.
- **What it reuses:** the server, the integrations, the companion app and household settings.
- **What it re-creates:** the screens themselves, in Swift.

It's the largest of the platforms to add.

## Adding a platform

1. **Wrap the dashboard** at the server's address, full screen. Allow sound without a tap, and
   keep the screen awake.
2. **Define `window.Frame`** with whatever the device can do. Leave out the rest.
3. **Handle "server away"** by showing `apps/kiosk-shared/setup.html` from the device's own
   storage, with a bridge for its calls.
4. **Add a row** to the table above, and browser or unit tests like `e2e/pi.spec.js` and
   `apps/kiosk-pi/helper/test_noor_kiosk.py`.
