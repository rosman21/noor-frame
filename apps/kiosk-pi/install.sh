#!/usr/bin/env bash
# noor-frame on a Raspberry Pi (Raspberry Pi OS Lite, Bookworm or newer).
#
#   sudo ./apps/kiosk-pi/install.sh server     the home server only (no screen needed)
#   sudo ./apps/kiosk-pi/install.sh frame      a screen that shows a server elsewhere on the Wi-Fi
#   sudo ./apps/kiosk-pi/install.sh both       server and screen on one Pi
#
# Options:
#   --server URL          (frame) the server's address, e.g. http://noor.local:8787
#                         Without it, the screen finds the server on the network by itself.
#   --rotate 180          (frame, both) turn the picture for an upside-down landscape mount
#   --auto-update         update from git every night at 3:30
#   --no-hotspot          (frame, both) never start the Wi-Fi setup network
#   --splash              (frame, both) Noor's boot splash instead of the Raspberry Pi logo and
#                         boot text: for a wall frame (a TV doesn't need one)
#
# Safe to run again: it updates what it installed and keeps your data and settings.
# Full guide: docs/pi-server.md

set -euo pipefail

ROLE="${1:-}"
shift || true
SERVER_URL="" ROTATE="" AUTO_UPDATE=0 HOTSPOT=1 SPLASH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER_URL="${2:?--server needs an address}"; shift 2 ;;
    --rotate) ROTATE="${2:?--rotate takes 180 for an upside-down landscape mount}"; shift 2 ;;
    --auto-update) AUTO_UPDATE=1; shift ;;
    --no-hotspot) HOTSPOT=0; shift ;;
    --splash) SPLASH=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

case "$ROLE" in server|frame|both) ;; *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;; esac
case "$ROTATE" in ''|0|180) ;; *) die "Noor is designed for landscape screens; --rotate takes 180 for an upside-down mount" ;; esac
[ "$ROTATE" != 0 ] || ROTATE=""
[ "$(id -u)" -eq 0 ] || die "Run it with sudo: sudo $0 $ROLE"
command -v apt-get >/dev/null || die "This script is for Raspberry Pi OS (or another Debian-based system)."

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$APP_DIR/apps/kiosk-pi"
WANT_SERVER=0 WANT_FRAME=0
[ "$ROLE" != frame ] && WANT_SERVER=1
[ "$ROLE" != server ] && WANT_FRAME=1
[ "$ROLE" = both ] && SERVER_URL="http://localhost:8787"
HAVE_SYSTEMD=0
[ -d /run/systemd/system ] && HAVE_SYSTEMD=1

# Paths in templates: @APP_DIR@, @UID@.
render() { sed -e "s#@APP_DIR@#$APP_DIR#g" -e "s#@UID@#$(id -u noor)#g" "$1" > "$2"; }

# ------------------------------------------------------------------ user
say "Account: noor"
if ! id noor >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/noor --shell /usr/sbin/nologin noor
  note "created the noor system account (no password, no login)"
fi
# Updates run Git and npm as the checkout's owner, never as root. A checkout made with sudo is
# handed to the noor account; your own clone (e.g. /home/pi/noor-frame) stays yours.
if [ "$(stat -c %U "$APP_DIR")" = root ]; then
  chown -R noor:noor "$APP_DIR"
  note "gave the root-owned checkout in $APP_DIR to the noor account"
fi
for g in video render input audio netdev; do
  if getent group "$g" >/dev/null; then usermod -aG "$g" noor; fi
done
if command -v runuser >/dev/null && ! runuser -u noor -- test -r "$APP_DIR/apps/kiosk-pi/install.sh"; then
  die "The noor account can't read $APP_DIR. Clone noor-frame to /opt/noor-frame instead (see docs/pi-server.md)."
fi

# ------------------------------------------------------------------ packages
say "Installing packages (this can take a few minutes)"
export DEBIAN_FRONTEND=noninteractive NPM_CONFIG_UPDATE_NOTIFIER=false
apt-get update -qq
PKGS=(ca-certificates git curl xz-utils avahi-daemon)
if [ $WANT_FRAME = 1 ]; then
  PKGS+=(cage wlr-randr qrencode avahi-utils network-manager python3)
  # Raspberry Pi OS calls it chromium (Trixie) or chromium-browser (Bookworm).
  if apt-cache show chromium >/dev/null 2>&1; then PKGS+=(chromium); else PKGS+=(chromium-browser); fi
  apt-cache show wlopm >/dev/null 2>&1 && PKGS+=(wlopm)
  [ $SPLASH = 1 ] && PKGS+=(plymouth plymouth-themes)
fi
apt-get install -y -qq --no-install-recommends "${PKGS[@]}"

# ------------------------------------------------------------------ node (server)
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
install_node() {
  if [ "$(node_major)" -ge 22 ]; then note "Node.js $(node -v) is already installed"; return; fi
  local cand
  cand=$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ {print $2}' | sed -E 's/^[0-9]+://; s/\..*//')
  if [[ "$cand" =~ ^[0-9]+$ ]] && [ "$cand" -ge 22 ]; then
    apt-get install -y -qq nodejs npm
  else
    # Debian's Node.js is too old here: use the official Node.js 22 build, checked against its
    # published checksum.
    local arch
    case "$(uname -m)" in
      aarch64|arm64) arch=arm64 ;;
      armv7l) arch=armv7l ;;
      x86_64) arch=x64 ;;
      *) die "No Node.js build for $(uname -m). A 64-bit Raspberry Pi OS is recommended." ;;
    esac
    local base=https://nodejs.org/dist/latest-v22.x tmp
    tmp=$(mktemp -d)
    curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    local file
    file=$(grep -oE "node-v[0-9.]+-linux-$arch\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)
    [ -n "$file" ] || die "Couldn't find Node.js for $arch."
    curl -fsSL "$base/$file" -o "$tmp/$file"
    (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "Node.js download failed its checksum."
    tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE
    rm -rf "$tmp"
  fi
  note "Node.js $(node -v)"
}

if [ $WANT_SERVER = 1 ]; then
  say "Node.js"
  install_node

  say "Building the dashboard"
  cd "$APP_DIR"
  npm ci --no-audit --no-fund --loglevel=error
  npm run build --silent
  cd - >/dev/null

  say "Server settings and data: /var/lib/noor-frame"
  install -d -o noor -g noor -m 750 /var/lib/noor-frame
  install -d -m 755 /etc/noor-frame
  if [ ! -f /etc/noor-frame/server.env ]; then
    cat > /etc/noor-frame/server.env <<'EOF'
# noor-frame server settings (systemctl restart noor-server after a change)
# PORT=8787
# NOOR_PUBLIC_URL=http://noor.local:8787   the address phones use, if the automatic one is wrong
# NOOR_AUTO_APPROVE=0                      approve new screens yourself, from the phone companion
# NOOR_SETUP_CODE=                         12+ characters; open the dashboard once with ?setup=<code>
#                                          to approve the first screen when NOOR_AUTO_APPROVE=0
EOF
  fi
  render "$HERE/systemd/noor-server.service" /etc/systemd/system/noor-server.service
  install -m 644 "$HERE/system/noor-frame.avahi.service" /etc/avahi/services/noor-frame.service
fi

# ------------------------------------------------------------------ screen
if [ $WANT_FRAME = 1 ]; then
  say "Screen"
  install -d -m 755 /etc/noor-frame /usr/local/lib/noor-frame
  # Kiosk settings. An existing file keeps its setup-network password.
  python3 - "$SERVER_URL" "$HOTSPOT" <<'EOF'
import json, os, sys
path = '/etc/noor-frame/kiosk.json'
cfg = {}
if os.path.exists(path):
    with open(path) as f:
        cfg = json.load(f)
server, hotspot = sys.argv[1], sys.argv[2] == '1'
if server or 'server' not in cfg:
    cfg['server'] = server or None
cfg['autoHotspot'] = hotspot
cfg.setdefault('wifiInterface', 'wlan0')
h = cfg.setdefault('hotspot', {})
h.setdefault('ssid', 'Noor Frame Setup')
# The helper creates and persists a per-device password under /var/lib/noor on first start.
if h.get('password') == 'noorframe':
    h.pop('password')
with open(path, 'w') as f:
    json.dump(cfg, f, indent=2)
os.chmod(path, 0o640)
EOF
  chgrp noor /etc/noor-frame/kiosk.json
  if [ ! -f /etc/noor-frame/kiosk.env ] || [ -n "$ROTATE" ]; then
    printf '# noor-frame screen (systemctl restart noor-kiosk after a change)\nNOOR_ROTATE=%s\n' "$ROTATE" > /etc/noor-frame/kiosk.env
  fi

  install -m 755 "$HERE/bin/noor-browser" /usr/local/lib/noor-frame/noor-browser
  install -m 644 "$HERE/system/pam-noor-kiosk" /etc/pam.d/noor-kiosk
  install -d -m 755 /etc/polkit-1/rules.d
  install -m 644 "$HERE/system/50-noor-frame.rules" /etc/polkit-1/rules.d/50-noor-frame.rules
  install -m 644 "$HERE/system/90-noor-backlight.rules" /etc/udev/rules.d/90-noor-backlight.rules
  install -d -m 755 /etc/NetworkManager/dnsmasq-shared.d
  install -m 644 "$HERE/system/dnsmasq-noor-setup.conf" /etc/NetworkManager/dnsmasq-shared.d/noor-setup.conf
  render "$HERE/systemd/noor-kiosk-helper.service" /etc/systemd/system/noor-kiosk-helper.service
  render "$HERE/systemd/noor-kiosk.service" /etc/systemd/system/noor-kiosk.service

  if [ $HAVE_SYSTEMD = 1 ]; then
    udevadm control --reload && udevadm trigger --subsystem-match=backlight || true
    systemctl is-active --quiet NetworkManager || note "Warning: NetworkManager isn't running, so Wi-Fi setup from a phone won't work."
    # The screen belongs to the dashboard: boot to the console, not a desktop.
    if [ "$(systemctl get-default)" = graphical.target ]; then
      systemctl set-default multi-user.target
      note "the desktop no longer starts at boot (sudo systemctl set-default graphical.target to undo)"
    fi
  fi
fi

# ------------------------------------------------------------------ boot splash
# Plymouth shows Noor's splash from early boot until the screen starts. The Pi's own rainbow
# square, logos and boot text are hidden. cmdline.txt and config.txt are backed up first
# (*.noor-backup); docs/pi-server.md explains how to undo it.
if [ $WANT_FRAME = 1 ] && [ $SPLASH = 1 ]; then
  say "Boot splash"
  install -d -m 755 /usr/share/plymouth/themes/noor
  install -m 644 "$HERE/splash/noor.plymouth" "$HERE/splash/noor.script" "$HERE/splash/noor.png" /usr/share/plymouth/themes/noor/
  BOOT=/boot/firmware; [ -f "$BOOT/cmdline.txt" ] || BOOT=/boot
  if [ -f "$BOOT/cmdline.txt" ]; then
    [ -f "$BOOT/cmdline.txt.noor-backup" ] || cp "$BOOT/cmdline.txt" "$BOOT/cmdline.txt.noor-backup"
    line=$(head -n1 "$BOOT/cmdline.txt")
    for word in quiet splash plymouth.ignore-serial-consoles logo.nologo vt.global_cursor_default=0; do
      case " $line " in *" $word "*) ;; *) line="$line $word" ;; esac
    done
    printf '%s\n' "$line" > "$BOOT/cmdline.txt"
  fi
  if [ -f "$BOOT/config.txt" ] && ! grep -q '^disable_splash=1' "$BOOT/config.txt"; then
    [ -f "$BOOT/config.txt.noor-backup" ] || cp "$BOOT/config.txt" "$BOOT/config.txt.noor-backup"
    printf '\n[all]\n# noor-frame: no rainbow square at power on (Noor'"'"'s splash follows)\ndisable_splash=1\n' >> "$BOOT/config.txt"
  fi
  if command -v plymouth-set-default-theme >/dev/null; then
    # -R rebuilds the initramfs, so the splash shows from the very start of boot.
    if command -v update-initramfs >/dev/null; then plymouth-set-default-theme -R noor; else plymouth-set-default-theme noor; fi
  fi
  note "the splash shows from the next restart"
fi

# ------------------------------------------------------------------ updates
render "$HERE/bin/noor-frame-update" /usr/local/bin/noor-frame-update
chmod 755 /usr/local/bin/noor-frame-update
install -m 644 "$HERE/systemd/noor-update.service" /etc/systemd/system/noor-update.service
install -m 644 "$HERE/systemd/noor-update.timer" /etc/systemd/system/noor-update.timer

# ------------------------------------------------------------------ start
say "Starting"
if [ $HAVE_SYSTEMD = 1 ]; then
  systemctl daemon-reload
  if [ $WANT_SERVER = 1 ]; then
    systemctl enable --quiet avahi-daemon noor-server
    systemctl restart avahi-daemon noor-server
  fi
  if [ $WANT_FRAME = 1 ]; then
    systemctl enable --quiet noor-kiosk-helper noor-kiosk
    systemctl restart noor-kiosk-helper noor-kiosk
  fi
  if [ $AUTO_UPDATE = 1 ]; then systemctl enable --quiet --now noor-update.timer; fi
else
  note "No systemd here (a container?): services were installed but not started."
fi

HOST="$(hostname).local"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "Done"
if [ $WANT_SERVER = 1 ]; then
  note "Dashboard:      http://$HOST:8787/   (or http://${IP:-<this Pi>}:8787/)"
  note "Phone settings: on the dashboard, Settings → Open on phone, and scan the code"
  note "Logs:           journalctl -u noor-server -f"
fi
if [ $WANT_FRAME = 1 ]; then
  note "Screen:         ${SERVER_URL:-finds the server on your network by itself}"
  [ $HOTSPOT = 1 ] && note "Wi-Fi setup:    with no Wi-Fi, the screen offers \"Noor Frame Setup\" (password in /etc/noor-frame/kiosk.json)"
  note "Logs:           journalctl -u noor-kiosk -u noor-kiosk-helper -f"
fi
note "Update later:   sudo noor-frame-update"
