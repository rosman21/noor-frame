# kiosk-pi

noor-frame on a Raspberry Pi: as the home server, as a wall screen, or both on one Pi.

```sh
sudo git clone https://github.com/rosman21/noor-frame /opt/noor-frame
sudo /opt/noor-frame/apps/kiosk-pi/install.sh both     # or: server, frame
```

The step-by-step guide is [docs/pi-server.md](../../docs/pi-server.md).

## What's here

| Path | What it does |
| --- | --- |
| `install.sh` | Installs and updates everything for the chosen role. Safe to run again. |
| `helper/noor_kiosk.py` | Runs on a screen Pi. It serves the dashboard to Chromium on `localhost:8788`, shows a "connecting" screen when the server can't be reached, and turns the display off at night when the dashboard asks. When there's no Wi-Fi, it starts the **Noor Frame Setup** network so a phone can choose the home Wi-Fi. |
| `helper/pages/` | The connecting/Wi-Fi screen, and the phone's setup page. Both work with no internet. |
| `../kiosk-shared/setup.html` | Noor's on-screen Wi-Fi page, with its own keyboard. It's the same page the Android frames use; the helper serves it at `/kiosk/setup`. |
| `splash/` | The optional boot splash (`--splash`): a Plymouth theme and its picture, rendered from the Android boot animation with `render.mjs --still`. |
| `bin/noor-browser` | Starts Chromium full screen inside [cage](https://github.com/cage-kiosk/cage), with sound allowed and an optional screen rotation. |
| `bin/noor-frame-update` | `sudo noor-frame-update`: pulls the latest version and restarts. |
| `systemd/` | `noor-server`, `noor-kiosk-helper`, `noor-kiosk` (the screen), and the optional nightly update timer. |
| `system/` | Small system files: the screen's login session (PAM), Wi-Fi permission for the `noor` account (polkit), backlight access (udev), the setup network's sign-in page redirect (dnsmasq), and the server's network announcement (avahi). |

## How the screen talks to the dashboard

The dashboard's `window.Frame` bridge is the same on every device (see `apps/frame/src/device.js`).
On a Pi, Chromium opens `http://localhost:8788/?kiosk=pi`, and the dashboard calls the helper:

| Dashboard | Helper |
| --- | --- |
| Settings → Wi-Fi | touch screens: `/kiosk/setup` (choose on the screen); TVs: `/kiosk/wifi` (use a phone) |
| Wi-Fi page | `GET /kiosk/wifi/status`, `GET /kiosk/wifi/networks`, `POST /kiosk/wifi/scan`, `POST /kiosk/wifi/join {ssid, password}`, `POST /kiosk/server {url}` |
| Settings → Sound | `GET /kiosk/volume` → `{level, max}`; `POST /kiosk/volume {level}` |
| Settings → At night → Screen off | `POST /kiosk/screen {"on": false}`: backlight off (official touch display), or `wlopm` / `wlr-randr` for HDMI |
| (every 15 s) | `GET /kiosk/status`: while the setup network is on or the Pi is joining a network, show the setup steps |

## Tests

```sh
npm run test:kiosk-pi     # the helper, against a pretend NetworkManager
```
