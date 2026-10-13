"""Tests for the kiosk helper, with a pretend NetworkManager. Run: python3 -m unittest discover apps/kiosk-pi/helper"""

import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ['NOOR_KIOSK_CONFIG'] = '/nonexistent/kiosk.json'
os.environ['NOOR_KIOSK_STATE'] = os.path.join(tempfile.gettempdir(), 'noor-kiosk-test-state-%s.json' % os.getpid())
import noor_kiosk as K  # noqa: E402


class FakeNM:
    """Answers the nmcli commands the helper runs."""

    def __init__(self):
        self.wifi = None          # connected network, or None
        self.hotspot = False
        self.known = {'Home': 'correct-horse'}
        self.calls = []

    def __call__(self, *cmd, timeout=30):
        self.calls.append(cmd)
        if cmd[0] != 'nmcli':
            return False, 'not here'
        a = list(cmd[1:])
        if a[:2] == ['-t', '-f'] and 'device' in a and 'status' in a:
            rows = ['lo:loopback:connected (externally):lo']
            if self.hotspot:
                rows.append('wlan0:wifi:connected:noor-setup')
            elif self.wifi:
                rows.append('wlan0:wifi:connected:' + self.wifi.replace(':', '\\:'))
            else:
                rows.append('wlan0:wifi:disconnected:')
            return True, '\n'.join(rows)
        if 'wifi' in a and 'list' in a:
            return True, 'Home:82:WPA2\nCafe\\: Free:40:\nHome:30:WPA2\nNoor Frame Setup:99:WPA2\n:20:WPA2'
        if a[:3] == ['-t', 'connection', 'show']:
            return False, 'no such connection'
        if a[:5] == ['-t', '-f', 'NAME,TYPE', 'connection', 'show']:
            return True, 'Home:802-11-wireless\nWired connection 1:802-3-ethernet\nnoor-setup:802-11-wireless'
        if a == ['radio', 'wifi']:
            return True, 'enabled'
        if a[:2] in (['connection', 'add'], ['connection', 'modify']):
            return True, ''
        if a[:3] == ['connection', 'up', K.HOTSPOT]:
            self.hotspot = True
            return True, ''
        if a[:3] == ['connection', 'down', K.HOTSPOT]:
            self.hotspot = False
            return True, ''
        if a[:3] == ['device', 'wifi', 'connect']:
            ssid = a[3]
            pw = a[a.index('password') + 1] if 'password' in a else ''
            if self.known.get(ssid) == pw:
                self.wifi = ssid
                return True, 'successfully activated'
            return False, 'Error: Connection activation failed: Secrets were required, but not provided.'
        return True, ''


class Helper(unittest.TestCase):
    def setUp(self):
        self.nm = FakeNM()
        K.run = self.nm
        K.time.sleep = lambda s: None
        for k, v in dict(server=None, server_ok=False, online=False, ssid=None, offline_since=time.time(), hotspot=False,
                         hotspot_since=0, last_setup_visit=0, networks=[], message=None, joining=None,
                         auth_failed=None).items():
            setattr(K.S, k, v)

    def test_terse_fields(self):
        self.assertEqual(K.split_terse('Cafe\\: Free:40:'), ['Cafe: Free', '40', ''])

    def test_network_state(self):
        K.check_network()
        self.assertFalse(K.S.online)
        self.nm.wifi = 'Home'
        K.check_network()
        self.assertEqual((K.S.online, K.S.ssid), (True, 'Home'))

    def test_setup_network_scans_first_and_hides_itself(self):
        K.start_hotspot('test')
        self.assertTrue(K.S.hotspot and self.nm.hotspot)
        names = [n['ssid'] for n in K.S.networks]
        self.assertEqual(names, ['Home', 'Cafe: Free'])   # strongest first, no duplicates, not our own, no hidden
        self.assertEqual(K.S.networks[0], {'ssid': 'Home', 'signal': 82, 'secure': True, 'security': 'WPA2'})
        self.assertFalse(K.S.networks[1]['secure'])
        scan = next(i for i, c in enumerate(self.nm.calls) if 'list' in c)
        up = next(i for i, c in enumerate(self.nm.calls) if c[1:3] == ('connection', 'up'))
        self.assertLess(scan, up)
        # the hotspot itself doesn't count as being online
        K.check_network()
        self.assertFalse(K.S.online)
        s = K.status()
        self.assertTrue(s['hotspot'])
        self.assertEqual(s['hotspotPassword'], K.CFG['hotspot']['password'])

    def test_join_wrong_password_reopens_setup(self):
        K.start_hotspot('test')
        K.join('Home', 'wrong-pass')
        self.assertTrue(K.S.hotspot)
        self.assertIn('password may be wrong', K.S.message)
        self.assertIsNone(K.S.joining)

    def test_join_right_password(self):
        K.start_hotspot('test')
        K.join('Home', 'correct-horse')
        self.assertFalse(K.S.hotspot)
        self.assertEqual((K.S.online, K.S.ssid), (True, 'Home'))
        self.assertIsNone(K.status()['hotspotPassword'])

    def test_join_from_the_screen_needs_no_setup_network(self):
        K.join('Home', 'wrong-password')
        self.assertEqual(K.S.auth_failed, 'Home')
        self.assertFalse(K.S.hotspot, 'a wrong password typed on the screen stays on the screen')
        self.assertFalse(any(c[1:4] == ('connection', 'up', K.HOTSPOT) for c in self.nm.calls))
        K.join('Home', 'correct-horse')
        self.assertEqual((K.S.online, K.S.ssid, K.S.auth_failed), (True, 'Home', None))

    def test_networks_for_the_screen(self):
        K.scan_networks()
        nets = {n['ssid']: n for n in K.wifi_networks()}
        self.assertEqual(nets['Home'], {'ssid': 'Home', 'security': 'wpa', 'bars': 3, 'saved': True})
        self.assertEqual(nets['Cafe: Free'], {'ssid': 'Cafe: Free', 'security': 'open', 'bars': 1, 'saved': False})
        self.nm.wifi = 'Home'
        K.check_network()
        st = K.wifi_status()
        self.assertEqual((st['connected'], st['ssid'], st['wifiOn']), (True, 'Home', True))

    def test_server_address_set_on_the_screen_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            state = K.STATE_FILE
            K.STATE_FILE = os.path.join(d, 'state.json')
            try:
                self.assertFalse(K.set_server('not an address'))
                self.assertTrue(K.set_server('192.168.1.20:8787'))
                self.assertEqual(K.S.server, 'http://192.168.1.20:8787')
                self.assertEqual(K.load_config()['server'], 'http://192.168.1.20:8787', 'kept after a restart')
            finally:
                K.STATE_FILE = state

    def test_setup_password_is_random_and_persisted_per_device(self):
        with tempfile.TemporaryDirectory() as d:
            config, state = K.CONFIG_FILE, K.STATE_FILE
            K.CONFIG_FILE = os.path.join(d, 'missing-config.json')
            K.STATE_FILE = os.path.join(d, 'kiosk-state.json')
            try:
                first = K.load_config()['hotspot']['password']
                self.assertEqual(len(first), 12)
                self.assertRegex(first, r'^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$')
                self.assertEqual(K.load_config()['hotspot']['password'], first)
                with open(K.STATE_FILE) as f:
                    self.assertEqual(json.load(f)['hotspotPassword'], first)
            finally:
                K.CONFIG_FILE, K.STATE_FILE = config, state

    def test_explicit_setup_password_is_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            config, state = K.CONFIG_FILE, K.STATE_FILE
            K.CONFIG_FILE = os.path.join(d, 'kiosk.json')
            K.STATE_FILE = os.path.join(d, 'kiosk-state.json')
            try:
                with open(K.CONFIG_FILE, 'w') as f:
                    json.dump({'hotspot': {'password': 'configured-pass'}}, f)
                self.assertEqual(K.load_config()['hotspot']['password'], 'configured-pass')
                with open(K.STATE_FILE) as f:
                    self.assertEqual(json.load(f)['hotspotPassword'], 'configured-pass')
            finally:
                K.CONFIG_FILE, K.STATE_FILE = config, state

    def test_volume_with_alsa(self):
        calls = []
        def fake(*cmd, timeout=30):
            calls.append(cmd)
            if cmd[:3] == ('amixer', '-M', 'get'):
                return (True, "Simple mixer control 'PCM',0\n  Mono: Playback -1200 [40%] [-12.00dB] [on]") if cmd[3] == 'PCM' else (False, 'no control')
            return True, ''
        K.run = fake
        which = K.shutil.which
        K.shutil.which = lambda name: '/usr/bin/amixer' if name == 'amixer' else None
        try:
            self.assertEqual(K.volume(), {'level': 4, 'max': 10, 'via': 'amixer', 'control': 'PCM'})
            self.assertTrue(K.set_volume(7))
            self.assertIn(('amixer', '-q', '-M', 'set', 'PCM', '70%', 'unmute'), calls)
            K.set_volume(0)
            self.assertIn(('amixer', '-q', '-M', 'set', 'PCM', '0%', 'mute'), calls)
        finally:
            K.shutil.which = which

    def test_volume_with_pipewire(self):
        calls = []
        def fake(*cmd, timeout=30):
            calls.append(cmd)
            return (True, 'Volume: 0.60') if cmd[:2] == ('wpctl', 'get-volume') else (True, '')
        K.run = fake
        which = K.shutil.which
        K.shutil.which = lambda name: '/usr/bin/wpctl' if name == 'wpctl' else None
        try:
            self.assertEqual(K.volume()['level'], 6)
            K.set_volume(3)
            self.assertIn(('wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', '0.30'), calls)
        finally:
            K.shutil.which = which

    def test_no_volume_control(self):
        which = K.shutil.which
        K.shutil.which = lambda name: None
        try:
            self.assertIsNone(K.volume())
            self.assertFalse(K.set_volume(5))
        finally:
            K.shutil.which = which

    def test_wifi_qr_escapes(self):
        original = K.CFG['hotspot']
        K.CFG['hotspot'] = {'ssid': 'A;B', 'password': 'p:w'}
        try:
            self.assertEqual(K.wifi_qr_text(), r'WIFI:T:WPA;S:A\;B;P:p\:w;;')
        finally:
            K.CFG['hotspot'] = original

    def test_discovery(self):
        K.run = lambda *c, timeout=0: (True, '+;wlan0;IPv4;noor-frame on pi;_noor-frame._tcp;local\n'
                                             '=;wlan0;IPv6;noor-frame on pi;_noor-frame._tcp;local;pi.local;fe80::1;8787;\n'
                                             '=;wlan0;IPv4;noor-frame on pi;_noor-frame._tcp;local;pi.local;192.168.1.5;8787;')
        self.assertEqual(K.discover_server(), 'http://192.168.1.5:8787')

    def test_setup_page_only_on_setup_network(self):
        h = K.Setup.__new__(K.Setup)
        h.client_address = ('10.42.0.23', 5000)
        self.assertFalse(h.allowed())        # setup network is off
        K.S.hotspot = True
        self.assertTrue(h.allowed())
        h.client_address = ('192.168.1.40', 5000)
        self.assertFalse(h.allowed())


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = json.dumps({'path': self.path, 'host': self.headers.get('host')}).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        if self.path.startswith('/chunked'):
            self.send_header('transfer-encoding', 'chunked')
            self.end_headers()
            self.wfile.write(b'%x\r\n%s\r\n0\r\n\r\n' % (len(body), body))
        else:
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        data = self.rfile.read(n)
        self.send_response(201)
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Proxy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.up = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        threading.Thread(target=cls.up.serve_forever, daemon=True).start()
        cls.kiosk = ThreadingHTTPServer(('127.0.0.1', 0), K.Kiosk)
        threading.Thread(target=cls.kiosk.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.up.shutdown()
        cls.kiosk.shutdown()

    def get(self, path, method='GET', body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.kiosk.server_address[1], timeout=5)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        out = (r.status, r.getheader('content-type'), r.read())
        c.close()
        return out

    def test_passes_requests_through(self):
        K.S.server = 'http://127.0.0.1:%d' % self.up.server_address[1]
        status, _, body = self.get('/api/config?x=1')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['path'], '/api/config?x=1')
        self.assertEqual(json.loads(self.get('/chunked')[2])['path'], '/chunked')
        status, _, body = self.get('/api/settings', 'POST', b'{"a":1}', {'content-type': 'application/json'})
        self.assertEqual((status, body), (201, b'{"a":1}'))

    def test_server_down_shows_the_connecting_screen(self):
        K.S.server = 'http://127.0.0.1:9'
        status, ctype, body = self.get('/', headers={'accept': 'text/html'})
        self.assertEqual(status, 503)
        self.assertIn('text/html', ctype)
        self.assertIn(b'/kiosk/status', body)
        self.assertEqual(self.get('/api/version')[0], 502)

    def test_on_screen_setup(self):
        status, ctype, body = self.get('/kiosk/setup')
        self.assertEqual(status, 200)
        self.assertIn(b'piBridge', body, 'the same page as the Android frames')
        status, _, body = self.get('/kiosk/wifi/join', 'POST', b'{"ssid":"Home","password":"short"}', {'content-type': 'application/json'})
        self.assertEqual(status, 400)
        self.assertEqual(self.get('/kiosk/wifi/status')[0], 200)
        self.assertEqual(self.get('/kiosk/volume')[0], 200)

    def test_status(self):
        status, _, body = self.get('/kiosk/status')
        self.assertEqual(status, 200)
        self.assertIn('hotspot', json.loads(body))


if __name__ == '__main__':
    unittest.main()
