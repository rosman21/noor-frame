// Settings, in two kinds:
//  - Household settings live on the server and apply to every screen in the house: location,
//    prayer calculation, reminder, temperature units, Quran translation and reciter. Reading them
//    comes from /api/config; changing them saves to the server (App.api) with this screen's key.
//  - Screen settings stay on this device (localStorage): language, text style, Arabic font,
//    12/24-hour clock, and this screen's own theme, idle time and menu position. The household's
//    display defaults (display section) apply until a screen picks its own.
(function () {
  'use strict';
  var KEY = 'hq-settings';
  var S = load();

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function cfg() { return (App.state && App.state.config) || null; }

  // Defaults when neither this screen nor the household says otherwise.
  var DEFAULTS = { lang: 'en', clock: '12', font: 'classic', arabicFont: 'amiri', nav: 'top', theme: 'auto', idle: 2, nightScreen: 'clock' };

  // Household setting -> where it lives on the server.
  var HOUSE = {
    location: { section: 'location' },
    method: { section: 'prayer', field: 'method' },
    school: { section: 'prayer', field: 'school' },
    reminder: { section: 'athan', field: 'reminderMinutes' },
    units: { section: 'weather', field: 'units' },
    translation: { section: 'quran', field: 'translation' },
    reciter: { section: 'quran', field: 'reciter' }
  };
  App.isHouseSetting = function (k) { return !!HOUSE[k]; };

  // The server's location in the shape the Settings screen uses (and back).
  function locFromServer(l) {
    return l ? { name: l.name, region: l.region, country: l.country, code: l.code, lat: l.latitude, lon: l.longitude, tz: l.timezone, source: l.source } : null;
  }
  function locToServer(l) {
    if (!l) return { city: null, region: null, country: null, code: null, latitude: null, longitude: null, timezone: null, source: null };
    return { city: l.name, region: l.region || null, country: l.country || null, code: l.code || null, latitude: l.lat, longitude: l.lon, timezone: l.tz || null, source: l.source || null };
  }
  function houseValue(k) {
    var c = cfg(), h = HOUSE[k];
    if (!c) return S[k]; // first start, offline: whatever this screen had
    if (k === 'location') return locFromServer(c.location);
    return c[h.section] ? c[h.section][h.field] : undefined;
  }
  function houseSaved(k) {
    var c = cfg(), h = HOUSE[k];
    var keys = c && c.saved && c.saved[h.section];
    return !!keys && (k === 'location' ? keys.length > 0 : keys.indexOf(h.field) > -1);
  }
  // The household's display default for theme / idle / nav / clock.
  function houseDisplay(k) {
    var d = cfg() && cfg().display;
    if (!d) return undefined;
    if (k === 'theme') return d.theme;
    if (k === 'nav') return d.nav;
    if (k === 'idle') return d.idleMinutes;
    if (k === 'clock') return d.clock24h ? '24' : undefined;
  }

  App.setting = function (k) {
    if (HOUSE[k]) { var v = houseValue(k); return v != null ? v : DEFAULTS[k]; }
    if (S[k] != null) return S[k];
    return App.houseDefault(k);
  };
  // What was actually chosen (not a default): saved for the house, or set on this screen.
  App.ownSetting = function (k) {
    if (HOUSE[k]) return houseSaved(k) ? houseValue(k) : null;
    return S[k];
  };
  // The household default a screen setting falls back to (for "Same as the house").
  App.houseDefault = function (k) {
    var d = houseDisplay(k);
    if (d == null) d = DEFAULTS[k];
    // A TV remote can't pull a menu down, so a TV uses the dock unless this screen chose otherwise.
    if (k === 'nav' && App.tv && (d === 'top' || d === 'bottom')) d = 'left';
    return d;
  };

  // What each setting affects, so a change only refreshes what it needs to.
  var DATA = { location: ['config', 'prayer', 'weather', 'calendar'], units: ['config', 'weather'], method: ['config', 'prayer'], school: ['config', 'prayer'], reminder: ['config'], translation: ['config', 'ayah'], reciter: ['config', 'ayah'] };

  // Patch the household value on screen right away; the server confirms it.
  function patchLocal(k, v) {
    var c = cfg(), h = HOUSE[k];
    if (!c) return;
    c.saved = c.saved || {};
    if (k === 'location') {
      if (v) c.location = { name: v.name, region: v.region, country: v.country, code: v.code, latitude: v.lat, longitude: v.lon, timezone: v.tz, source: v.source };
      c.saved.location = v ? ['city'] : [];
      return;
    }
    c[h.section] = c[h.section] || {};
    if (v != null) c[h.section][h.field] = v;
    var keys = (c.saved[h.section] || []).filter(function (x) { return x !== h.field; });
    if (v != null) keys.push(h.field);
    c.saved[h.section] = keys;
  }

  // Returns a promise for household settings (resolved once saved), nothing for screen settings.
  App.setSetting = function (k, v) {
    if (!HOUSE[k]) {
      if (v == null) delete S[k]; else S[k] = v;
      save();
      applyLook();
      App.emit('settings', { key: k, refresh: [] });
      return;
    }
    if (!App.canEditHouse || !App.canEditHouse()) {
      App.toast(App.t('This screen is waiting for approval, so it can’t change household settings yet.'), { icon: 'person', ms: 4000 });
      return Promise.reject(new Error('not approved'));
    }
    var h = HOUSE[k], values = {};
    if (k === 'location') values = locToServer(v);
    else values[h.field] = v;
    patchLocal(k, v);
    App.emit('settings', { key: k, refresh: [] });
    return App.api('/api/settings', { section: h.section, values: values }).then(function () {
      App.emit('settings', { key: k, refresh: DATA[k] || ['config'] });
    }, function (err) {
      App.toast(App.t('Couldn’t save: {why}', { why: App.esc(err.message) }), { icon: 'wifioff', tone: 'error' });
      App.emit('settings', { key: k, refresh: ['config'] }); // put back the server's value
      throw err;
    });
  };

  // Screens used to keep household settings themselves. Move any such values to the server once,
  // unless the household has already chosen that setting.
  App.migrateHouseSettings = function () {
    var keys = Object.keys(HOUSE).filter(function (k) { return S[k] != null; });
    if (!keys.length || !App.canEditHouse() || !cfg()) return Promise.resolve();
    var push = keys.filter(function (k) { return !houseSaved(k); });
    return push.reduce(function (p, k) {
      return p.then(function () { return App.setSetting(k, S[k]).catch(function () { /* keep going */ }); });
    }, Promise.resolve()).then(function () {
      keys.forEach(function (k) { delete S[k]; });
      save();
    });
  };
  App.on('device', function () { App.migrateHouseSettings(); });

  // Kept for older screens: settings no longer travel as query parameters.
  App.apiQuery = function () { return ''; };

  // ------------------------------------------------------------ fonts
  // Each style pairs a sans with an adjustable width (the big condensed numbers rely on it)
  // and a serif. Only the chosen style is downloaded.
  App.FONTS = [
    { id: 'classic', name: 'Classic', sample: 'Archivo + Instrument Serif', sans: 'Archivo', serif: 'Instrument Serif', css: null },
    { id: 'modern', name: 'Modern', sample: 'Roboto Flex + Fraunces', sans: 'Roboto Flex', serif: 'Fraunces',
      css: 'family=Roboto+Flex:opsz,wdth,wght@8..144,25..151,100..1000&family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600' },
    { id: 'clean', name: 'Clean', sample: 'Noto Sans + Noto Serif Display', sans: 'Noto Sans', serif: 'Noto Serif Display',
      css: 'family=Noto+Sans:wdth,wght@62.5..100,100..900&family=Noto+Serif+Display:ital,wght@0,400;1,400' },
    { id: 'friendly', name: 'Friendly', sample: 'Nunito Sans + Lora', sans: 'Nunito Sans', serif: 'Lora',
      css: 'family=Nunito+Sans:opsz,wdth,wght@6..12,75..125,200..1000&family=Lora:ital,wght@0,400;1,400' }
  ];
  App.ARABIC_FONTS = [
    { id: 'amiri', name: 'Amiri', font: 'Amiri', quran: 'Amiri Quran', css: null },
    { id: 'naskh', name: 'Noto Naskh', font: 'Noto Naskh Arabic', quran: 'Noto Naskh Arabic', css: 'family=Noto+Naskh+Arabic:wght@400..700' },
    { id: 'scheherazade', name: 'Scheherazade', font: 'Scheherazade New', quran: 'Scheherazade New', css: 'family=Scheherazade+New:wght@400;700' },
    { id: 'kufi', name: 'Reem Kufi', font: 'Reem Kufi', quran: 'Amiri Quran', css: 'family=Reem+Kufi:wght@400..700' }
  ];
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }
  App.findFont = find;

  function loadCss(id, query) {
    if (!query || document.getElementById(id + '-css')) return;
    var l = document.createElement('link');
    l.id = id + '-css';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?' + query + '&display=swap';
    document.head.appendChild(l);
  }

  function applyLook() {
    var f = find(App.FONTS, App.setting('font')), a = find(App.ARABIC_FONTS, App.setting('arabicFont'));
    loadCss('font-' + f.id, f.css);
    loadCss('arabic-' + a.id, a.css);
    var rtl = App.lang && App.lang().rtl;
    if (rtl) loadCss('ui-arabic', 'family=Noto+Sans+Arabic:wght@400..800');
    var root = document.documentElement.style;
    // Arabic-script interface text falls back to Noto Sans Arabic (the Latin fonts have no Arabic).
    root.setProperty('--sans', "'" + f.sans + "'" + (rtl ? ", 'Noto Sans Arabic'" : '') + ', system-ui, sans-serif');
    root.setProperty('--serif', "'" + f.serif + "'" + (rtl ? ", 'Noto Sans Arabic'" : '') + ', Georgia, serif');
    root.setProperty('--arabic', "'" + a.font + "', 'Amiri', serif");
    root.setProperty('--quran', "'" + a.quran + "', 'Amiri', serif");
    // Where the menu lives: top / bottom (pull-out shade) or left / right (sticky dock).
    var stage = document.getElementById('stage');
    if (stage) stage.dataset.menu = App.setting('nav');
    applyTheme();
    if (App.translateStatic) App.translateStatic();
  }
  App.applyLook = applyLook;
  App.on('boot', applyLook);

  // ------------------------------------------------------------ light / dark
  // Auto = dark from Maghrib (sunset) until sunrise, using today's prayer times;
  // 7 PM – 7 AM if prayer times haven't loaded yet.
  App.isDark = function () {
    var t = App.setting('theme');
    if (t === 'dark' || t === 'light') return t === 'dark';
    var now = App.now(), day = App.prayerDay && App.prayerDay(now);
    if (day) {
      var at = {};
      day.list.forEach(function (p) { at[p.name] = p.time; });
      if (at.Sunrise && at.Maghrib) return now < at.Sunrise || now >= at.Maghrib;
    }
    return now.getHours() >= 19 || now.getHours() < 7;
  };
  function applyTheme() {
    var dark = App.isDark(), root = document.documentElement;
    if (root.dataset.theme === (dark ? 'dark' : 'light')) return;
    root.dataset.theme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#141311' : '#F2EEE6';
  }
  App.on('minute', applyTheme);
  App.on('data', applyTheme);
})();
