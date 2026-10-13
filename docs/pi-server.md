# noor-frame on a Raspberry Pi

A Raspberry Pi can run noor-frame in three ways:

| Role | What it does | Needs a screen |
| --- | --- | --- |
| `server` | The home server: the dashboard, the phone companion and the API, on port 8787. Calendar links and API keys live here. | No |
| `frame` | A wall screen that shows a server running elsewhere on your Wi-Fi. | Yes |
| `both` | Server and screen on one Pi. The simplest setup for one screen. | Yes |

One server can feed any number of screens: Pi screens, Android frames, TVs and browsers.

## What you need

- **A Raspberry Pi** that runs 64-bit Raspberry Pi OS, such as a Pi 3, 4, 5 or Zero 2 W. The
  server needs Node.js 22 or newer, and the install script only knows how to install it on
  64-bit ARM (`aarch64`), 32-bit ARMv7 (`armv7l`) or `x86_64`. The original Pi Zero and Pi 1
  aren't supported for the server.
- **A microSD card** (16 GB or more) and a power supply that suits your Pi.
- **For a screen:** the official Raspberry Pi touch display, or any HDMI screen. With the
  official touch display the screen can go dark at night while touch keeps working (see
  [The screen at night](#the-screen-at-night)).
- **Wi-Fi or Ethernet.** A screen Pi without either can be put on Wi-Fi from a phone (see
  [Wi-Fi setup from a phone](#wi-fi-setup-from-a-phone)).

## 1. Put Raspberry Pi OS Lite on the card

1. Install [Raspberry Pi Imager](https://www.raspberrypi.com/software/) on a computer.
2. Choose your Pi model, then **Raspberry Pi OS Lite (64-bit)**. It must be Bookworm or newer.
   Lite has no desktop. A screen Pi doesn't need one: noor-frame runs its own full-screen
   browser.
3. In Imager's settings:
   - Set the hostname to `noor`. The server is then at `http://noor.local:8787`.
   - Turn on SSH and set a user name and password, so you can log in from a computer.
   - Add your home Wi-Fi if you know it. On a screen Pi you can skip this and set up Wi-Fi from
     a phone later.
4. Write the card, put it in the Pi and switch it on. The first boot takes a few minutes.

Log in from a computer on the same network:

```sh
ssh <your-user>@noor.local
```

## 2. Get noor-frame

Clone it to `/opt/noor-frame`. The installer runs noor-frame as its own `noor` account, and
that account must be able to read the folder. A folder inside your home directory usually isn't
readable, and the installer stops with a message if so.

```sh
sudo apt-get install -y git
sudo git clone https://github.com/rosman21/noor-frame /opt/noor-frame
```

## 3. Run the installer

Choose the role:

```sh
sudo /opt/noor-frame/apps/kiosk-pi/install.sh both      # server and screen on this Pi
sudo /opt/noor-frame/apps/kiosk-pi/install.sh server    # server only
sudo /opt/noor-frame/apps/kiosk-pi/install.sh frame     # screen only
```

It takes a few minutes. When it finishes it prints the dashboard address, where to find the
logs, and how to update.

### Options

| Option | Roles | What it does |
| --- | --- | --- |
| `--server URL` | `frame` | The server's address, for example `--server http://noor.local:8787`. Without it, the screen finds the server on the network by itself. With `both`, the screen always uses the server on the same Pi. |
| `--rotate 180` | `frame`, `both` | Turns the picture for an upside-down landscape mount. Portrait rotation is not supported. |
| `--auto-update` | all | Updates noor-frame from Git every night at about 3:30. |
| `--no-hotspot` | `frame`, `both` | Never starts the Wi-Fi setup network. |
| `--splash` | `frame`, `both` | Shows Noor's boot splash (نور on green) instead of the Raspberry Pi logo and boot text. For a wall frame; a TV doesn't need it. See [Boot splash](#boot-splash). |

For example, an upside-down landscape screen that shows a server on another computer:

```sh
sudo /opt/noor-frame/apps/kiosk-pi/install.sh frame --server http://noor.local:8787 --rotate 180
```

### Running it again

The installer is safe to run again. It updates what it installed and keeps your data and
settings:

- **`--server`** is kept from the last run if you leave it out.
- **`--rotate`** is kept from the last run if you leave it out.
- **`--no-hotspot`** is not kept. Pass it again on every run, or the setup network is switched
  back on.

### What it changes on the Pi

- **Account:** creates a `noor` system account with no password and no login. The server and
  the screen run as this account.
- **Checkout ownership:** if `/opt/noor-frame` is root-owned, the installer gives it to `noor`.
  Updates run Git and npm as the checkout's owner, never as root; only service management uses
  root. A checkout owned by your normal login account stays owned by you.
- **Packages:** installs Node.js (server), and Chromium, cage, NetworkManager, qrencode and
  avahi (screen).
- **Boot:** on a screen Pi, the desktop no longer starts at boot, because the screen belongs to
  the dashboard. To undo this: `sudo systemctl set-default graphical.target`.
- **Services:** installs and starts these systemd services:

| Service | Role | What it does |
| --- | --- | --- |
| `noor-server` | `server`, `both` | The server, on port 8787. |
| `noor-kiosk-helper` | `frame`, `both` | Serves the dashboard to the screen's browser, handles Wi-Fi setup, and turns the display off at night. |
| `noor-kiosk` | `frame`, `both` | Chromium full screen on the Pi's display. |
| `noor-update.timer` | with `--auto-update` | The nightly update. |

The kiosk helper runs as `noor`, not as root. The installer adds a narrow polkit rule so this
account can control NetworkManager, change system connection settings, create open or protected
Wi-Fi hotspots, enable or disable Wi-Fi and scan for networks. These permissions are for the
screen's Wi-Fi setup flow; the helper does not receive general root access.

## 4. Open the dashboard

- **On the Pi's screen:** the dashboard appears by itself once the Pi is online and has found
  the server.
- **From any browser on your Wi-Fi:** open `http://noor.local:8787`. If your hostname isn't
  `noor`, use `http://<hostname>.local:8787` or the Pi's IP address
  (`hostname -I` on the Pi shows it).

### Finding the server

The server announces itself on your network as `_noor-frame._tcp`: on a Pi through Avahi, and
on a Mac, Linux or Windows computer running `npm start` through its own `dns-sd` or
`avahi-publish`. So a screen Pi also finds a server on another computer. A screen
installed without `--server` looks for that announcement, and looks again whenever the server
stops answering, so it follows the server to a new address. If your network blocks these
announcements, install the screen with `--server` and the server's address.

## 5. Set up from your phone

There is no keyboard on the screen. Anything that needs typing happens on your phone:

1. On the screen, open **Settings → Open on phone**.
2. Scan the code with your phone's camera.
3. The phone opens the companion app, signed in. From there you can set your city, add calendar
   links, switch optional features on or off, add API keys, and approve, rename or remove
   screens.

On a Node.js server, screens connecting from your home network are approved automatically.
Phones pair by scanning the QR code shown by an approved screen. To approve each screen by hand,
add `NOOR_AUTO_APPROVE=0` to `/etc/noor-frame/server.env` and run
`sudo systemctl restart noor-server`.

## Wi-Fi on the screen

A **touch screen** sets up Wi-Fi itself, the same way as Noor's Android frames:

- **Settings → Wi-Fi** opens Noor's Wi-Fi page. Tap a network, then type its password on
  Noor's keyboard.
- With no connection, the screen offers **Choose Wi-Fi on this screen** next to the phone
  steps below.
- If the Wi-Fi works but the server can't be found, open the page from the "Looking for the
  noor-frame server" screen and tap **Change** under **Noor server**. Type its address, for
  example `192.168.1.20:8787`. It's kept in `/var/lib/noor/kiosk-state.json` and overrides
  `--server`.
- **Use your phone instead** starts the setup network below.

A **TV**, with only a remote, uses the phone instead.

## Wi-Fi setup from a phone

A screen Pi with no connection (no Wi-Fi and no Ethernet) waits 90 seconds. Then it starts its
own Wi-Fi network, **Noor Frame Setup**, and the screen shows the steps:

1. **Join the setup network.** Scan the first code on the screen with your phone's camera, or
   join **Noor Frame Setup** by hand with the password shown on the screen.
2. **Choose your home Wi-Fi.** The setup page usually opens by itself, like a hotel Wi-Fi
   sign-in page. If not, scan the second code or open `10.42.0.1` in the phone's browser.
3. **Pick your network and type its password**, then tap **Connect the frame**. Your phone
   leaves the setup network. Watch the screen: the dashboard appears once it's connected.

If it can't connect (a wrong password, or the network is out of range), the setup network comes
back within a minute and the screen says what went wrong. Join it again to retry.

Good to know:

- The setup network uses 2.4 GHz.
- Each Pi gets its own random setup password on first start. The helper saves it in
  `/var/lib/noor/kiosk-state.json` and shows it on the screen. An explicit password configured
  in `/etc/noor-frame/kiosk.json` is preserved. Keep this password private.
- If nobody uses the setup network for 10 minutes, the Pi stops it and tries its known Wi-Fi
  again.
- To move a working screen to another network, open **Settings → Wi-Fi** on the screen, then
  **Change Wi-Fi** and **Set up Wi-Fi now**.
- To switch the setup network off for good, run the installer again with `--no-hotspot`.

## The screen at night

**Settings → At night** on the screen has two choices:

- **Night clock:** the screen stays on and shows a dim red clock until morning.
- **Screen off:** the display switches off.
  - **Official touch display:** the backlight goes off and touch keeps working, so a tap brings
    the dashboard back.
  - **HDMI screen:** the Pi switches the output off with `wlopm`, or `wlr-randr` where `wlopm`
    isn't available.

The athan, or a tap, turns the screen back on.

## Sound

**Settings → Sound** sets the Pi's volume, in 10 steps, with a short tone at the new level. It
uses PipeWire (`wpctl`) when it's running, otherwise ALSA (`amixer`: Master, PCM, Speaker or
Headphone). HDMI audio usually has no volume control on the Pi; the TV's remote sets it, and the
Sound card doesn't show.

## Boot splash

With `--splash`, a wall frame shows Noor's splash from early boot until the dashboard appears:
the finished frame of the Android frames' boot animation, fading in from green. The Pi's rainbow
square, logos and scrolling boot text are hidden. It uses Plymouth, with the theme in
`apps/kiosk-pi/splash/`.

The installer changes:
- **`cmdline.txt`:** adds `quiet splash plymouth.ignore-serial-consoles logo.nologo
  vt.global_cursor_default=0`.
- **`config.txt`:** adds `disable_splash=1`.

Both are in `/boot/firmware/`, and both are backed up first as `*.noor-backup`. To undo:

```sh
sudo cp /boot/firmware/cmdline.txt.noor-backup /boot/firmware/cmdline.txt
sudo cp /boot/firmware/config.txt.noor-backup /boot/firmware/config.txt
sudo plymouth-set-default-theme -R pix 2>/dev/null || true   # or your previous theme
sudo reboot
```

The splash isn't rotated by `--rotate`, so it will appear upside down on a `--rotate 180` mount.

## Updating

```sh
sudo noor-frame-update
```

This pulls the latest version with `git pull --ff-only`. On a server it also rebuilds the
dashboard and restarts the server; on a screen it restarts the screen. If nothing changed, it
says so and stops.

With `--auto-update`, the same update runs every night at about 3:30.

## Where things live

| Path | What it is |
| --- | --- |
| `/opt/noor-frame` | The code (a Git clone). |
| `/var/lib/noor-frame/data/` | The server's saved data: household settings, calendar links, screens, and encrypted API keys (`frame.json`), plus the key that encrypts them (`secret.key`). |
| `/var/lib/noor-frame/frame.config.json` | Optional first-run settings. See the main [README](../README.md#try-it). |
| `/etc/noor-frame/server.env` | Server options: `PORT`, `NOOR_PUBLIC_URL`, `NOOR_AUTO_APPROVE`. |
| `/etc/noor-frame/kiosk.json` | Screen options: the server address, setup network name and any explicitly configured password, and whether it may start. A generated password is kept in `/var/lib/noor/kiosk-state.json`. |
| `/etc/noor-frame/kiosk.env` | Screen rotation (`NOOR_ROTATE`). |

After changing a file in `/etc/noor-frame`, restart the matching service:

```sh
sudo systemctl restart noor-server                        # server.env
sudo systemctl restart noor-kiosk-helper noor-kiosk       # kiosk.json, kiosk.env
```

### Backing up

Everything the household set up is in `/var/lib/noor-frame`. Copy the whole folder, including
`data/secret.key`. Without that key, a restored copy can't read the saved API keys.

```sh
sudo tar -czf noor-frame-backup.tar.gz -C /var/lib noor-frame
```

Keep the backup private: it holds your calendar links, and `secret.key` can decrypt your API
keys.

To restore on a new Pi, run the installer first, then:

```sh
sudo systemctl stop noor-server
sudo tar -xzf noor-frame-backup.tar.gz -C /var/lib
sudo chown -R noor:noor /var/lib/noor-frame
sudo systemctl start noor-server
```

## Troubleshooting

Logs:

```sh
journalctl -u noor-server -f                        # the server
journalctl -u noor-kiosk -u noor-kiosk-helper -f    # the screen
```

| Problem | What to check |
| --- | --- |
| The installer says the `noor` account can't read the folder. | Clone noor-frame to `/opt/noor-frame` (step 2), not your home directory. |
| `No Node.js build for armv6l` | This Pi can't run the server. Use a newer Pi for the server, or a 64-bit OS. |
| The screen says "Looking for the noor-frame server". | Is the server on, and on the same network? Some routers block the announcement the screen uses; run the installer again with `--server http://<server>:8787`. |
| The screen says "This screen isn't on Wi-Fi". | Wait for the setup network (90 seconds), or tap **Set up Wi-Fi now**, then follow [Wi-Fi setup from a phone](#wi-fi-setup-from-a-phone). |
| The setup network never appears. | It needs NetworkManager; the installer warns if it isn't running. Check that it wasn't installed with `--no-hotspot`. |
| `noor.local` doesn't open. | Use the Pi's IP address (`hostname -I`). Some networks and older Android phones don't resolve `.local` names. |
| Phones open the wrong address for the companion. | Set `NOOR_PUBLIC_URL=http://<address>:8787` in `/etc/noor-frame/server.env` and restart `noor-server`. |
| The picture is upside down. | Run the installer again with `--rotate 180`, or omit `--rotate` for normal landscape. Portrait rotation is not supported. |
| The screen stays on at night with an HDMI display. | Some HDMI screens ignore the off signal. Choose **Night clock** instead. |
| No athan sound. | Check the Pi's audio output and volume. The athan recordings are your own files; see [apps/frame/public/audio](../apps/frame/public/audio/README.md). Without them, a short chime plays. |
