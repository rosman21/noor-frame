#!/usr/bin/env python3
"""The noor-frame kiosk helper for a Raspberry Pi screen.

Chromium shows http://localhost:8788/?kiosk=pi. This helper:

  - passes the dashboard and its /api through from the noor-frame server (on this Pi or another
    computer on the Wi-Fi). Loading it via localhost lets the browser keep an offline copy;
  - shows a "connecting" screen while there is no Wi-Fi or the server can't be reached;
  - controls the display for the dashboard's night setting (POST /kiosk/screen) and the sound
    volume (Settings → Sound: /kiosk/volume);
  - sets up Wi-Fi on the screen itself, with Noor's own keyboard (/kiosk/setup, the same page as
    the Android frames, apps/kiosk-shared/setup.html), and can change the server's address;
  - or without a keyboard (a TV): if the Pi has no connection, it starts its own Wi-Fi network
    ("Noor Frame Setup"). The screen shows a QR code; a phone joins it, opens the setup page and
    picks the home network.

Standard library only (Python 3.9+), so it runs on Raspberry Pi OS Lite as is. Uses nmcli
(NetworkManager), qrencode, avahi-browse, and wlopm / wlr-randr or the backlight for the screen.

Settings: /etc/noor-frame/kiosk.json (NOOR_KIOSK_CONFIG). See install.sh.
"""

import http.client
import ipaddress
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import urllib.parse
from glob import glob
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, 'pages')
SHARED_SETUP = os.path.join(HERE, '..', '..', 'kiosk-shared', 'setup.html')
CONFIG_FILE = os.environ.get('NOOR_KIOSK_CONFIG', '/etc/noor-frame/kiosk.json')
# Choices made on the screen (the server's address), kept where the noor account can write.
STATE_FILE = os.environ.get('NOOR_KIOSK_STATE', '/var/lib/noor/kiosk-state.json')
PORT = int(os.environ.get('NOOR_KIOSK_PORT', '8788'))
SETUP_PORT = int(os.environ.get('NOOR_SETUP_PORT', '80'))
HOTSPOT = 'noor-setup'            # NetworkManager connection name
HOTSPOT_IP = '10.42.0.1'          # the Pi's address on its setup network
HOTSPOT_NET = ipaddress.ip_network('10.42.0.0/24')
# Seconds without any connection before the setup network starts, and how long an unused setup
# network stays up before the Pi tries its known Wi-Fi again.
NO_NETWORK_GRACE = int(os.environ.get('NOOR_KIOSK_GRACE', '90'))
HOTSPOT_IDLE = int(os.environ.get('NOOR_KIOSK_HOTSPOT_IDLE', str(10 * 60)))
HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
       'transfer-encoding', 'upgrade', 'host', 'content-length'}


def log(*args):
    print('noor-kiosk:', *args, flush=True)


def load_config():
    cfg = {'server': None, 'wifiInterface': 'wlan0', 'autoHotspot': True,
           'hotspot': {'ssid': 'Noor Frame Setup'}}
    try:
        with open(CONFIG_FILE) as f:
            mine = json.load(f)
        cfg.update({k: v for k, v in mine.items() if k != 'hotspot'})
        cfg['hotspot'].update(mine.get('hotspot') or {})
    except FileNotFoundError:
        log('no', CONFIG_FILE, '- using defaults')
    saved = {}
    try:
        with open(STATE_FILE) as f:
            saved = json.load(f)
        if saved.get('server'):
            cfg['server'] = saved['server']
    except (OSError, ValueError):
        pass
    password = cfg['hotspot'].get('password')
    if password:
        if saved.get('hotspotPassword') != password:
            save_state(hotspotPassword=password)
    else:
        password = saved.get('hotspotPassword')
        if not password:
            alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
            password = ''.join(secrets.choice(alphabet) for _ in range(12))
        if not save_state(hotspotPassword=password):
            raise RuntimeError('could not persist the setup-network password')
        cfg['hotspot']['password'] = password
    return cfg


def save_state(**values):
    state = {}
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
    except (OSError, ValueError):
        pass
    state.update(values)
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f)
        return True
    except OSError as err:
        log('could not save', STATE_FILE, err)
        return False


CFG = load_config()


def run(*cmd, timeout=30):
    """Run a command; returns (ok, output). Never raises."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, str(err)


def split_terse(line):
    """nmcli -t output: fields split by ':', with '\\:' inside values."""
    return [f.replace('\\:', ':').replace('\\\\', '\\') for f in re.split(r'(?<!\\):', line)]


# ------------------------------------------------------------------ state
class State:
    lock = threading.Lock()
    server = None            # http://host:port of the noor-frame server
    server_ok = False
    online = False           # any Wi-Fi or wired connection
    ssid = None              # the Wi-Fi network in use
    offline_since = time.time()
    hotspot = False
    hotspot_since = 0
    last_setup_visit = 0
    networks = []            # [{ssid, signal, secure}], scanned before the setup network starts
    message = None           # shown on the screen and the phone (e.g. "Couldn't join …")
    joining = None           # the network being joined right now
    auth_failed = None       # the network that last refused its password


S = State()


# ------------------------------------------------------------------ network
def check_network():
    ok, out = run('nmcli', '-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status')
    online, ssid = False, None
    if ok:
        for line in out.splitlines():
            dev, typ, state, con = (split_terse(line) + [''] * 4)[:4]
            if not state.startswith('connected') or con == HOTSPOT:
                continue
            if typ in ('wifi', 'ethernet'):
                online = True
                if typ == 'wifi':
                    ssid = con
    with S.lock:
        if online and not S.online:
            S.message = None
        if not online and S.online:
            S.offline_since = time.time()
        S.online, S.ssid = online, ssid


def scan_networks():
    iface = CFG['wifiInterface']
    ok, out = run('nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list',
                  'ifname', iface, '--rescan', 'yes', timeout=40)
    if not ok:
        return
    best = {}
    for line in out.splitlines():
        ssid, signal, security = (split_terse(line) + ['', '0', ''])[:3]
        if not ssid or ssid == CFG['hotspot']['ssid']:
            continue
        sig = int(signal or 0)
        if ssid not in best or best[ssid]['signal'] < sig:
            best[ssid] = {'ssid': ssid, 'signal': sig, 'secure': security not in ('', '--'), 'security': security}
    S.networks = sorted(best.values(), key=lambda n: -n['signal'])[:20]


def ensure_hotspot_connection():
    h, iface = CFG['hotspot'], CFG['wifiInterface']
    settings = ['802-11-wireless.ssid', h['ssid'], '802-11-wireless.mode', 'ap', '802-11-wireless.band', 'bg',
                'ipv4.method', 'shared', 'ipv4.addresses', HOTSPOT_IP + '/24', 'ipv6.method', 'disabled',
                'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', h['password'],
                'wifi-sec.proto', 'rsn', 'wifi-sec.pairwise', 'ccmp', 'wifi-sec.group', 'ccmp',
                'connection.autoconnect', 'no']
    ok, _ = run('nmcli', '-t', 'connection', 'show', HOTSPOT)
    if ok:
        run('nmcli', 'connection', 'modify', HOTSPOT, *settings)
    else:
        run('nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', iface, 'con-name', HOTSPOT, *settings)


def start_hotspot(reason):
    if S.hotspot:
        return
    log('starting the setup network:', reason)
    scan_networks()  # one radio: scan while it is still free
    ensure_hotspot_connection()
    ok, out = run('nmcli', 'connection', 'up', HOTSPOT, timeout=40)
    if not ok:
        log('could not start the setup network:', out)
        S.message = 'The setup network could not start: ' + out[-200:]
        return
    with S.lock:
        S.hotspot, S.hotspot_since, S.last_setup_visit = True, time.time(), time.time()


def stop_hotspot():
    run('nmcli', 'connection', 'down', HOTSPOT, timeout=20)
    with S.lock:
        S.hotspot = False
        S.offline_since = time.time()  # give known networks a fair chance before trying again


def join(ssid, password):
    """Join the household Wi-Fi (in a thread). From the setup network, the phone loses us, so leave
    it slowly and offer it again if joining fails; from the screen, just try."""
    from_phone = S.hotspot
    with S.lock:
        S.joining, S.message, S.auth_failed = ssid, None, None
    if from_phone:
        time.sleep(2)  # let the phone's page show "joining…" first
        stop_hotspot()
        time.sleep(3)
        run('nmcli', 'device', 'wifi', 'rescan', 'ifname', CFG['wifiInterface'], timeout=15)
        time.sleep(4)
    cmd = ['nmcli', 'device', 'wifi', 'connect', ssid, 'ifname', CFG['wifiInterface']]
    if password:
        cmd += ['password', password]
    ok, out = run(*cmd, timeout=60)
    with S.lock:
        S.joining = None
    if ok:
        log('joined', ssid)
        check_network()
        return
    log('could not join', ssid, out)
    wrong_password = bool(re.search(r'secret|password|auth', out, re.I))
    if wrong_password:
        S.auth_failed = ssid
    if from_phone:
        reason = 'the password may be wrong' if wrong_password else 'it is out of range or not answering'
        S.message = 'Couldn’t join “%s”: %s. Join “%s” again to retry.' % (ssid, reason, CFG['hotspot']['ssid'])
        start_hotspot('joining failed')


def saved_networks():
    ok, out = run('nmcli', '-t', '-f', 'NAME,TYPE', 'connection', 'show')
    if not ok:
        return set()
    return {f[0] for f in (split_terse(l) for l in out.splitlines()) if len(f) > 1 and 'wireless' in f[1] and f[0] != HOTSPOT}


def wifi_networks():
    """The networks for the on-screen setup page, in the same shape as the Android app's."""
    saved = saved_networks()
    out = []
    for n in S.networks:
        sec = n.get('security', '')
        kind = 'other' if re.search(r'802\.1X|WEP', sec) else ('wpa' if n['secure'] else 'open')
        out.append({'ssid': n['ssid'], 'security': kind, 'bars': min(3, n['signal'] // 25), 'saved': n['ssid'] in saved})
    return out


def wifi_status():
    ok, radio = run('nmcli', 'radio', 'wifi')
    ip = ''
    ok_ip, out = run('hostname', '-I')
    if ok_ip and out:
        ip = out.split()[0]
    return {
        'wifiOn': not ok or radio.strip() != 'disabled', 'connected': bool(S.online and S.ssid), 'ssid': S.ssid or '',
        'connecting': bool(S.joining), 'authFailed': S.auth_failed or '', 'ip': ip,
    }


def set_server(url):
    url = (url or '').strip()
    if not re.match(r'^https?://', url):
        url = 'http://' + url
    if not re.match(r'^https?://[^/\s]+(/\S*)?$', url):
        return False
    url = url.rstrip('/')
    if not save_state(server=url):
        return False
    with S.lock:
        CFG['server'], S.server, S.server_ok = url, url, False
    log('server address set to', url)
    return True


# ------------------------------------------------------------------ sound
# Settings → Sound on the dashboard. PipeWire (wpctl) when it runs, else ALSA (amixer). An HDMI
# TV usually has no volume to set here; its remote does that, and the dashboard hides the card.
VOLUME_STEPS = 10


def volume():
    if shutil.which('wpctl'):
        ok, out = run('wpctl', 'get-volume', '@DEFAULT_AUDIO_SINK@')
        m = re.search(r'Volume:\s*([\d.]+)(.*MUTED)?', out) if ok else None
        if m:
            level = 0 if m.group(2) else round(min(1.0, float(m.group(1))) * VOLUME_STEPS)
            return {'level': level, 'max': VOLUME_STEPS, 'via': 'wpctl'}
    if shutil.which('amixer'):
        for control in ('Master', 'PCM', 'Speaker', 'Headphone'):
            ok, out = run('amixer', '-M', 'get', control)
            m = re.search(r'\[(\d+)%\](?:.*\[(on|off)\])?', out) if ok else None
            if m:
                level = 0 if m.group(2) == 'off' else round(int(m.group(1)) * VOLUME_STEPS / 100)
                return {'level': level, 'max': VOLUME_STEPS, 'via': 'amixer', 'control': control}
    return None


def set_volume(level):
    v = volume()
    if not v:
        return False
    level = max(0, min(VOLUME_STEPS, int(level)))
    if v['via'] == 'wpctl':
        ok = run('wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', '%.2f' % (level / VOLUME_STEPS))[0]
        run('wpctl', 'set-mute', '@DEFAULT_AUDIO_SINK@', '0' if level else '1')
        return ok
    return run('amixer', '-q', '-M', 'set', v['control'], '%d%%' % (level * 100 // VOLUME_STEPS), 'unmute' if level else 'mute')[0]


# ------------------------------------------------------------------ server
def discover_server():
    """The noor-frame server announces itself on the network (avahi). Returns http://ip:port."""
    ok, out = run('avahi-browse', '-rtp', '_noor-frame._tcp', timeout=8)
    if not ok:
        return None
    for line in out.splitlines():
        f = line.split(';')
        if f[0] == '=' and len(f) > 8 and f[2] == 'IPv4':
            return 'http://%s:%s' % (f[7], f[8])
    return None


def check_server():
    url = CFG.get('server') or S.server or discover_server()
    ok = False
    if url:
        try:
            u = urllib.parse.urlsplit(url)
            c = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=5)
            c.request('GET', '/api/version')
            ok = c.getresponse().status == 200
            c.close()
        except OSError:
            ok = False
    with S.lock:
        S.server, S.server_ok = url, ok
    if not ok and not CFG.get('server'):
        S.server = None  # look again next time; it may have a new address


def watch():
    """Every few seconds: connection, server, and whether the setup network is needed."""
    while True:
        try:
            check_network()
            if not S.hotspot:
                check_server()
            now = time.time()
            if S.hotspot and not S.joining:
                if now - S.last_setup_visit > HOTSPOT_IDLE:
                    log('setup network unused; trying known Wi-Fi again')
                    stop_hotspot()
            elif CFG.get('autoHotspot', True) and not S.online and not S.joining \
                    and now - S.offline_since > NO_NETWORK_GRACE:
                start_hotspot('no connection for %d s' % NO_NETWORK_GRACE)
        except Exception as err:  # keep watching whatever happens
            log('watch error:', err)
        time.sleep(5)


def status():
    h = CFG['hotspot']
    return {
        'online': S.online, 'ssid': S.ssid, 'server': S.server, 'serverOk': S.server_ok,
        'hotspot': S.hotspot, 'hotspotSsid': h['ssid'], 'hotspotPassword': h['password'] if S.hotspot else None,
        'setupUrl': 'http://%s/' % HOTSPOT_IP, 'joining': S.joining, 'message': S.message,
        'secondsToHotspot': None if S.online or S.hotspot or not CFG.get('autoHotspot', True)
        else max(0, int(NO_NETWORK_GRACE - (time.time() - S.offline_since))),
    }


# ------------------------------------------------------------------ the display
def screen(on):
    """Display on/off. A backlight (official touch display) keeps touch working while dark."""
    lights = glob('/sys/class/backlight/*/bl_power')
    if lights:
        for f in lights:
            try:
                with open(f, 'w') as fh:
                    fh.write('0' if on else '4')
            except OSError as err:
                log('backlight:', err)
        return True
    if shutil.which('wlopm'):
        ok, out = run('wlopm', '--on' if on else '--off', '*')
        if ok:
            return True
        log('wlopm:', out)
    if shutil.which('wlr-randr'):
        ok, out = run('wlr-randr')
        name = next((l.split()[0] for l in out.splitlines() if l and not l[0].isspace()), None) if ok else None
        if name:
            return run('wlr-randr', '--output', name, '--on' if on else '--off')[0]
    return False


def qr_svg(text):
    ok, out = run('qrencode', '-t', 'SVG', '-m', '1', '-o', '-', text)
    return out if ok else ''


def wifi_qr_text():
    esc = lambda s: re.sub(r'([\\;,:"])', r'\\\1', s)
    h = CFG['hotspot']
    return 'WIFI:T:WPA;S:%s;P:%s;;' % (esc(h['ssid']), esc(h['password']))


# ------------------------------------------------------------------ HTTP
class Base(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'noor-kiosk'

    def log_message(self, fmt, *args):
        pass

    def send(self, status, body, ctype='application/json', headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        data = body.encode() if isinstance(body, str) else body
        self.send_response(status)
        self.send_header('content-type', ctype + ('; charset=utf-8' if ctype.startswith(('text/', 'application/json', 'image/svg')) else ''))
        self.send_header('content-length', str(len(data)))
        self.send_header('cache-control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def page(self, name, status=200):
        with open(os.path.join(PAGES, name), 'rb') as f:
            self.send(status, f.read(), 'text/html')

    def body_json(self):
        n = int(self.headers.get('content-length') or 0)
        if n > 16 * 1024:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            return {}


class Kiosk(Base):
    """localhost:8788: the screen's own browser only."""

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/kiosk/status':
            return self.send(200, status())
        if path in ('/kiosk/wifi', '/kiosk/connecting'):
            return self.page('screen.html')
        if path == '/kiosk/setup':
            with open(SHARED_SETUP, 'rb') as f:
                return self.send(200, f.read(), 'text/html')
        if path == '/kiosk/wifi/status':
            return self.send(200, wifi_status())
        if path == '/kiosk/wifi/networks':
            return self.send(200, wifi_networks())
        if path == '/kiosk/volume':
            return self.send(200, volume() or {'level': None, 'max': 0})
        if path == '/kiosk/qr/wifi.svg':
            return self.send(200, qr_svg(wifi_qr_text()), 'image/svg+xml')
        if path == '/kiosk/qr/setup.svg':
            return self.send(200, qr_svg('http://%s/' % HOTSPOT_IP), 'image/svg+xml')
        if path.startswith('/kiosk/'):
            return self.send(404, {'error': 'not found'})
        self.proxy()

    def do_HEAD(self):
        self.proxy()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/kiosk/screen':
            on = bool(self.body_json().get('on', True))
            return self.send(200, {'ok': screen(on)})
        if path == '/kiosk/wifi/scan':
            if not S.hotspot:  # one radio: no scanning while it is the setup network
                threading.Thread(target=scan_networks, daemon=True).start()
            return self.send(200, {'ok': True})
        if path == '/kiosk/wifi/join':
            b = self.body_json()
            ssid, password = str(b.get('ssid') or '').strip(), str(b.get('password') or '')
            if not ssid or len(ssid) > 32 or len(password) > 63 or (password and len(password) < 8):
                return self.send(400, {'ok': False, 'error': 'Check the network name and password (8–63 characters).'})
            threading.Thread(target=join, args=(ssid, password), daemon=True).start()
            return self.send(200, {'ok': True})
        if path == '/kiosk/server':
            return self.send(200, {'ok': set_server(str(self.body_json().get('url') or ''))})
        if path == '/kiosk/volume':
            return self.send(200, {'ok': set_volume(self.body_json().get('level', 0))})
        if path == '/kiosk/hotspot':
            on = bool(self.body_json().get('on', True))
            if on:
                threading.Thread(target=start_hotspot, args=('asked for on the screen',), daemon=True).start()
            else:
                threading.Thread(target=stop_hotspot, daemon=True).start()
            return self.send(200, {'ok': True})
        if path.startswith('/kiosk/'):
            return self.send(404, {'error': 'not found'})
        self.proxy()

    def do_PUT(self):
        self.proxy()

    def do_DELETE(self):
        self.proxy()

    def proxy(self):
        """Pass the request to the noor-frame server, streaming the answer back."""
        page = self.command == 'GET' and 'text/html' in (self.headers.get('accept') or '')
        if not S.server:
            return self.page('screen.html', 503) if page else self.send(502, {'error': 'The noor-frame server is not reachable.'})
        u = urllib.parse.urlsplit(S.server)
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n) if n else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        try:
            c = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=30)
            c.request(self.command, self.path, body=body, headers=headers)
            r = c.getresponse()
        except OSError:
            S.server_ok = False
            return self.page('screen.html', 503) if page else self.send(502, {'error': 'The noor-frame server is not reachable.'})
        self.send_response(r.status)
        length = r.getheader('content-length')
        for k, v in r.getheaders():
            if k.lower() not in HOP:
                self.send_header(k, v)
        if length is not None:
            self.send_header('content-length', length)
        else:
            self.send_header('transfer-encoding', 'chunked')
        self.end_headers()
        try:
            while self.command != 'HEAD':
                chunk = r.read(64 * 1024)
                if length is None:
                    self.wfile.write(b'%x\r\n%s\r\n' % (len(chunk), chunk))
                elif chunk:
                    self.wfile.write(chunk)
                if not chunk:
                    break
        except OSError:
            self.close_connection = True
        finally:
            c.close()


class Setup(Base):
    """Port 80 on the setup network: the page a phone opens to choose the home Wi-Fi."""

    def allowed(self):
        try:
            return S.hotspot and ipaddress.ip_address(self.client_address[0]) in HOTSPOT_NET
        except ValueError:
            return False

    def do_GET(self):
        if not self.allowed():
            return self.send(404, {'error': 'not found'})
        S.last_setup_visit = time.time()
        path = urllib.parse.urlsplit(self.path).path
        if path == '/networks':
            return self.send(200, {'networks': S.networks, 'message': S.message, 'name': CFG['hotspot']['ssid']})
        if path == '/':
            return self.page('setup.html')
        # Phones check a known address to spot a sign-in page; send them to ours.
        self.send(302, '', 'text/plain', {'location': 'http://%s/' % HOTSPOT_IP})

    def do_POST(self):
        if not self.allowed():
            return self.send(404, {'error': 'not found'})
        S.last_setup_visit = time.time()
        if urllib.parse.urlsplit(self.path).path != '/join':
            return self.send(404, {'error': 'not found'})
        b = self.body_json()
        ssid, password = str(b.get('ssid') or '').strip(), str(b.get('password') or '')
        if not ssid or len(ssid) > 32 or len(password) > 63 or (password and len(password) < 8):
            return self.send(400, {'error': 'Check the network name and password (8–63 characters).'})
        threading.Thread(target=join, args=(ssid, password), daemon=True).start()
        self.send(200, {'ok': True})


def serve(handler, host, port):
    s = ThreadingHTTPServer((host, port), handler)
    s.daemon_threads = True
    threading.Thread(target=s.serve_forever, daemon=True).start()
    log('listening on %s:%d' % (host, port))


def main():
    serve(Kiosk, '127.0.0.1', PORT)
    try:
        serve(Setup, '0.0.0.0', SETUP_PORT)
    except OSError as err:
        log('setup page unavailable on port %d:' % SETUP_PORT, err)
    watch()


if __name__ == '__main__':
    main()
