// Live data: pulls config, calendars, weather and prayer times from /api, keeps a copy in
// localStorage, and tracks whether the frame is online. Each source refreshes on its own timer
// and keeps the last good copy when a request fails.
//
// Household settings live on the server. This screen registers once to get a device key (needed
// to change anything), and checks a cheap version number every few seconds so a change made on
// another screen or phone shows up here almost at once.
(function () {
  'use strict';
  var D = window.DATA;
  var EVERY = { config: 60, calendar: 5, weather: 10, prayer: 360, ayah: 30 }; // minutes

  var net = App.net = { online: true, last: {}, errors: {} };

  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }

  function request(path, opts) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 20000);
    opts = Object.assign({ signal: ctl.signal, cache: 'no-store' }, opts || {});
    return fetch(path, opts).then(function (r) {
      clearTimeout(t);
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body && body.error || ('HTTP ' + r.status));
        return body;
      });
    }, function (err) {
      clearTimeout(t);
      throw new Error(err.name === 'AbortError' ? 'Timed out' : 'No connection');
    });
  }
  function get(path) { return request(path); }

  // ------------------------------------------------------------ this screen's device key
  // { id, token, approved }. Writes (settings, calendars) send the key; reads don't need it.
  var device = load('hq-device');
  App.device = function () { return device; };
  // Can this screen change household settings? (false while waiting for approval, or offline
  // on first start before it could register)
  App.canEditHouse = function () { return !!(device && device.approved); };

  // ?setup=<code> in the address approves this screen on a server that approves nothing
  // automatically (see NOOR_SETUP_CODE). The code is taken out of the address straight away.
  var setupCode = new URLSearchParams(location.search).get('setup');
  if (setupCode) {
    var clean = new URL(location.href);
    clean.searchParams.delete('setup');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  }

  function register() {
    var body = { kind: 'screen' };
    if (setupCode) body.setupCode = setupCode;
    return request('/api/devices/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (d) { setupCode = null; device = d; save('hq-device', d); App.emit('device', d); return d; });
  }
  // Make sure we have a key and know whether it's approved. A server whose data was reset no
  // longer knows our key (401): register again.
  function checkDevice() {
    if (!device || !device.token || (setupCode && !device.approved)) return register();
    return request('/api/devices/me', { headers: { authorization: 'Bearer ' + device.token } }).then(function (me) {
      if (me.approved !== device.approved || me.name !== device.name) {
        device.approved = me.approved; device.name = me.name;
        save('hq-device', device); App.emit('device', device);
      }
      return device;
    }, function (err) {
      if (/Unknown device/.test(err.message)) return register();
      throw err;
    });
  }
  App.checkDevice = checkDevice;

  // POST to the server with this screen's key. Resolves with the reply; rejects with a message
  // meant for people (e.g. "waiting for approval").
  App.api = function (path, body) {
    var headers = { 'content-type': 'application/json' };
    if (device && device.token) headers.authorization = 'Bearer ' + device.token;
    return request(path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) });
  };

  function ok(src) {
    net.last[src] = Date.now();
    delete net.errors[src];
    if (!net.online) { net.online = true; App.emit('net'); }
    save('hq-net', net.last);
  }
  function fail(src, err) {
    net.errors[src] = err.message;
    var offline = err.message === 'No connection' || err.message === 'Timed out';
    if (offline !== !net.online) { net.online = !offline; }
    App.emit('net');
  }

  // ------------------------------------------------------------ helpers
  function rgbOf(hex) {
    var h = String(hex || '#111111').replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function personFrom(cal) {
    var c = rgbOf(cal.color), lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    return { id: cal.id, name: cal.name, color: cal.color || '#111111', rgb: c.join(' '), ink: lum > 0.6 ? '#111111' : '#FFFFFF' };
  }
  function localDate(ymd) { var a = ymd.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
  App.ymd = function (d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  };

  // ------------------------------------------------------------ config -> people (calendar lanes)
  // What a config change means for the data on screen.
  function same(a, b) { return JSON.stringify(a || null) === JSON.stringify(b || null); }
  function refreshesFor(prev, next) {
    if (!prev) return [];
    var out = [], loc = !same(prev.location, next.location);
    if (loc || !same(prev.prayer, next.prayer)) out.push('prayer');
    if (loc || !same(prev.weather, next.weather)) out.push('weather');
    if (!same(prev.quran, next.quran)) out.push('ayah');
    if (loc || !same(prev.calendars, next.calendars) || !same(prev.features, next.features)) out.push('calendar');
    return out;
  }
  App.refreshesFor = refreshesFor;

  function applyConfig(cfg) {
    D.config = cfg;
    var cals = cfg.calendars || [];
    var own = cals.filter(function (c) { return !c.family; });
    var fam = cals.filter(function (c) { return c.family; })[0];
    // With no personal calendars, the family calendar gets its own lane.
    D.people = (own.length ? own : cals).map(personFrom);
    D.ALL = D.people.map(function (p) { return p.id; });
    if (fam && own.length) D.family = personFrom(fam);
    D.familyCal = fam && own.length ? fam.id : null;
    document.getElementById('stage').style.setProperty('--lanes', Math.max(1, D.people.length));
    save('hq-state', { people: D.people, family: D.family, config: cfg });
  }

  // ------------------------------------------------------------ calendar
  function applyEvents(raw) {
    D.events = (raw || []).map(function (e) {
      var start = e.allDay ? localDate(e.start) : new Date(e.start);
      var end = e.allDay ? localDate(e.end) : new Date(e.end);
      if (end <= start) end = new Date(+start + (e.allDay ? 864e5 : 30 * 60000));
      return {
        id: e.id, title: e.title, start: start, end: end, allDay: e.allDay,
        loc: e.loc || '', notes: e.notes || '',
        // travel = drive minutes (the UI's "Leave in…" pills and calendar bars use it); trip = details.
        travel: e.travel && e.travel.minutes || 0,
        trip: e.travel || null,
        people: e.cal === D.familyCal ? D.ALL.slice() : [e.cal]
      };
    });
  }

  // ------------------------------------------------------------ weather
  // Open-Meteo WMO codes -> the icon names the UI already uses.
  function wxIcon(code, isDay) {
    if (code <= 1) return isDay ? 'sun' : 'moon';
    if (code === 2) return isDay ? 'partly' : 'moon';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    if (code >= 51) return 'rain';
    return 'cloud';
  }
  App.wxIcon = wxIcon;
  var WX_LABEL = { sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Overcast', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorms', fog: 'Fog' };
  App.wxLabel = function (icon) { return WX_LABEL[icon] ? App.t(WX_LABEL[icon]) : ''; };

  function applyWeather(w) {
    if (!w) return;
    // Hourly arrays start at midnight of the forecast's first day. If that was yesterday
    // (stale data after a night offline), shift so index 0 is today's midnight.
    var shift = Math.round((App.dayStart(new Date()) - localDate(w.hourly.start.slice(0, 10))) / 864e5) * 24;
    if (shift < 0 || shift >= w.hourly.t.length) shift = 0;
    var H = w.hourly, t = H.t.slice(shift), c = [], p = H.p.slice(shift);
    for (var i = shift; i < H.code.length; i++) c.push(wxIcon(H.code[i], H.day[i]));
    var today = w.daily.filter(function (d) { return d.date === App.ymd(new Date()); })[0] || w.daily[0];
    D.weather = {
      unit: w.unit, windUnit: w.windUnit,
      temp: w.current.temp, feels: w.current.feels, humidity: w.current.humidity, wind: w.current.wind,
      cond: wxIcon(w.current.code, w.current.isDay),
      hi: today.hi, lo: today.lo,
      t: t, c: c, p: p,
      days: w.daily.map(function (d) { return { date: localDate(d.date), hi: d.hi, lo: d.lo, p: d.p, c: wxIcon(d.code, 1) }; })
    };
  }

  // ------------------------------------------------------------ prayer (stored per month)
  function monthKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); }
  function applyPrayer() {
    var months = load('hq-prayer') || {};
    var days = {};
    Object.keys(months).forEach(function (k) {
      var m = months[k];
      Object.keys(m.days).forEach(function (day) { days[day] = m.days[day]; });
      D.prayerMethod = m.method;
      D.prayerTz = m.timezone;
    });
    D.prayer = days;
  }

  // ------------------------------------------------------------ refreshers
  var jobs = {
    config: function () {
      var prev = D.config;
      return get('/api/config').then(function (cfg) {
        applyConfig(cfg);
        ok('config');
        // Household settings changed elsewhere: fetch what they affect (fresh, not from cache).
        var stale = refreshesFor(prev, cfg);
        if (stale.length) setTimeout(function () { refresh(stale); }, 0);
      });
    },
    calendar: function () {
      return get('/api/calendar').then(function (r) {
        applyEvents(r.events);
        save('hq-events', r.events);
        ok('calendar');
        // Travel times still being looked up for the first time: fetch again shortly.
        if (r.travelPending) setTimeout(function () { run('calendar'); }, 15000);
        if (r.errors && r.errors.length) { net.errors.calendar = r.errors.join(' · '); App.emit('net'); }
      });
    },
    weather: function () {
      return get('/api/weather').then(function (w) { save('hq-weather', w); applyWeather(w); ok('weather'); });
    },
    ayah: function () {
      // One ayah per day: skip the request when today's is already saved. A saved ayah whose
      // recitation still points at the CDN (not through the server) is fetched again.
      var today = App.ymd(new Date()), have = load('hq-ayah');
      if (have && have.date === today && 'audio' in have && (!have.audio || have.audio.charAt(0) === '/')) { D.ayah = have; return Promise.resolve(); }
      return get('/api/ayah?date=' + today).then(function (a) { save('hq-ayah', a); D.ayah = a; ok('ayah'); });
    },
    prayer: function () {
      var now = new Date(), next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      var want = [now, next].map(function (d) { return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
      return Promise.all(want.map(function (x) { return get('/api/prayer?year=' + x.y + '&month=' + x.m); })).then(function (res) {
        var months = load('hq-prayer') || {}, keep = {};
        res.forEach(function (r) { months[r.year + '-' + r.month] = r; });
        // Keep last month, this month and next month only.
        var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        [prev, now, next].forEach(function (d) { var k = monthKey(d); if (months[k]) keep[k] = months[k]; });
        save('hq-prayer', keep);
        applyPrayer();
        ok('prayer');
      });
    }
  };

  function run(name) {
    return jobs[name]().then(function () { App.emit('data'); }, function (err) { fail(name, err); });
  }

  App.refreshAll = function () {
    return run('config').then(function () {
      return Promise.all(['calendar', 'weather', 'prayer', 'ayah'].map(run));
    });
  };

  // Drop saved copies of data that no longer matches the settings, then fetch fresh ones.
  var STORE = { prayer: 'hq-prayer', weather: 'hq-weather', ayah: 'hq-ayah', calendar: 'hq-events' };
  function refresh(list) {
    list.forEach(function (k) { if (STORE[k]) { try { localStorage.removeItem(STORE[k]); } catch (e) { /* ignore */ } } });
    if (list.indexOf('prayer') > -1) D.prayer = {};
    if (list.indexOf('ayah') > -1) D.ayah = null;
    var jobs = list.filter(function (k) { return k !== 'config'; });
    var first = list.indexOf('config') > -1 ? run('config') : Promise.resolve();
    return first.then(function () { return Promise.all(jobs.map(run)); });
  }
  App.on('settings', function (ch) { if (ch.refresh && ch.refresh.length) refresh(ch.refresh); });

  // ------------------------------------------------------------ changes from other screens
  var VERSION_EVERY = 15000;
  var lastVersion = null;
  function checkVersion() {
    return get('/api/version').then(function (r) {
      if (lastVersion !== null && r.version !== lastVersion) run('config');
      lastVersion = r.version;
    }, function () { /* offline: the normal timers retry */ });
  }
  App.checkVersion = checkVersion;

  // Restore the saved copy immediately (works offline), then refresh from the network.
  App.on('boot', function () {
    net.last = load('hq-net') || {};
    if (D.config) applyConfig(D.config);
    applyEvents(load('hq-events'));
    applyWeather(load('hq-weather'));
    applyPrayer();
    D.ayah = load('hq-ayah'); // yesterday's stays up until today's arrives
  });
  App.on('ready', function () {
    App.refreshAll().then(function () {
      return checkDevice().then(function () { App.emit('device', device); }, function () { /* offline */ });
    });
    checkVersion();
    setInterval(checkVersion, VERSION_EVERY);
    var ticks = 0;
    setInterval(function () {
      ticks++;
      Object.keys(EVERY).forEach(function (k) {
        // Retry failed sources every minute; otherwise follow their normal interval.
        if (ticks % EVERY[k] === 0 || net.errors[k]) {
          if (k === 'config') run('config'); else if (D.config) run(k);
        }
      });
    }, 60000);
    // Android reports Wi-Fi changes to the page: refresh as soon as it comes back.
    window.addEventListener('online', function () { App.refreshAll(); });
    window.addEventListener('offline', function () { net.online = false; App.emit('net'); });
  });
  // Weather arrays are indexed by hour from midnight, so re-index after midnight.
  App.on('minute', function (n) {
    if (n.getHours() === 0 && n.getMinutes() === 0) { applyWeather(load('hq-weather')); App.emit('data'); run('ayah'); }
  });
})();
