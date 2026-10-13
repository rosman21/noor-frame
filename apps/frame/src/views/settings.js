// Settings: everything is a tap-through list (no keyboard). Choices are saved on the frame
// (js/settings.js) and override frame.config.json. Calendars are added by scanning a QR code
// with a phone, which has a keyboard (worker/setup.js).
import qrcode from 'qrcode-generator';

(function () {
  'use strict';
  var D = window.DATA, V = {};

  // AlAdhan calculation methods, and the one usually used in each country.
  var METHODS = [
    [2, 'Islamic Society of North America (ISNA)'], [3, 'Muslim World League'], [4, 'Umm al-Qura, Makkah'],
    [5, 'Egyptian General Authority of Survey'], [1, 'University of Islamic Sciences, Karachi'], [15, 'Moonsighting Committee Worldwide'],
    [8, 'Gulf Region'], [9, 'Kuwait'], [10, 'Qatar'], [16, 'Dubai'], [13, 'Diyanet, Turkey'], [17, 'JAKIM, Malaysia'],
    [11, 'MUIS, Singapore'], [20, 'Kemenag, Indonesia'], [12, 'UOIF, France'], [21, 'Morocco'], [19, 'Algeria'], [18, 'Tunisia'],
    [23, 'Jordan'], [14, 'Spiritual Administration of Muslims of Russia'], [22, 'Comunidade Islâmica de Lisboa'],
    [7, 'Institute of Geophysics, Tehran'], [0, 'Shia Ithna-Ashari, Qum']
  ];
  var METHOD_FOR = { US: 2, CA: 2, GB: 15, IE: 3, SA: 4, AE: 16, QA: 10, KW: 9, BH: 8, OM: 8, EG: 5, SD: 5, LY: 5, TR: 13, PK: 1, IN: 1, BD: 1, AF: 1,
    MY: 17, SG: 11, ID: 20, FR: 12, MA: 21, DZ: 19, TN: 18, JO: 23, PS: 23, LB: 3, IQ: 3, IR: 7, AU: 3, NZ: 3, ZA: 3 };
  var TRANSLATIONS = [
    ['en.sahih', 'English', 'Saheeh International'], ['en.pickthall', 'English', 'Pickthall'], ['en.yusufali', 'English', 'Yusuf Ali'],
    ['en.hilali', 'English', 'Hilali & Khan'], ['en.asad', 'English', 'Muhammad Asad'], ['ur.jalandhry', 'اردو', 'Fateh Muhammad Jalandhry'],
    ['ur.junagarhi', 'اردو', 'Muhammad Junagarhi'], ['fr.hamidullah', 'Français', 'Muhammad Hamidullah'], ['tr.diyanet', 'Türkçe', 'Diyanet İşleri'],
    ['id.indonesian', 'Bahasa Indonesia', 'Kementerian Agama'], ['ms.basmeih', 'Bahasa Melayu', 'Abdullah Basmeih'], ['bn.bengali', 'বাংলা', 'Muhiuddin Khan'],
    ['de.bubenheim', 'Deutsch', 'Bubenheim & Elyas'], ['es.cortes', 'Español', 'Julio Cortés'], ['so.abduh', 'Soomaali', 'Mahmud Abduh'],
    ['sw.barwani', 'Kiswahili', 'Ali Muhsin Al-Barwani'], ['ru.kuliev', 'Русский', 'Elmir Kuliev']
  ];
  var RECITERS = [
    ['ar.alafasy', 'Mishary Rashid Alafasy'], ['ar.husary', 'Mahmoud Khalil Al-Husary'], ['ar.abdurrahmaansudais', 'Abdurrahman As-Sudais'],
    ['ar.abdulbasitmurattal', 'Abdul Basit (Murattal)'], ['ar.mahermuaiqly', 'Maher Al-Muaiqly'], ['ar.minshawi', 'Mohamed Siddiq Al-Minshawi'],
    ['ar.saoodshuraym', 'Saud Ash-Shuraim'], ['ar.shaatree', 'Abu Bakr Ash-Shatri'], ['ar.ahmedajamy', 'Ahmed Al-Ajamy'], ['ar.hudhaify', 'Ali Al-Hudhaify']
  ];
  var REMINDERS = [0, 5, 10, 15, 20, 30];

  function nameOf(list, v) { for (var i = 0; i < list.length; i++) if (String(list[i][0]) === String(v)) return list[i]; return null; }

  // ------------------------------------------------------------ the list picker (a sheet)
  // opts: { title, options: [{ value, label, sub, note, group }], value, onPick, onBack }
  App.pick = function (opts) {
    var last = null;
    var rows = opts.options.map(function (o, i) {
      var head = o.group && o.group !== last ? '<div class="pk-group label">' + App.esc(o.group) + '</div>' : '';
      last = o.group || last;
      var on = String(o.value) === String(opts.value);
      return head + '<button class="pk-row' + (on ? ' is-on' : '') + (o.dim ? ' is-dim' : '') + '" data-i="' + i + '"' + (o.font ? ' style="font-family:' + o.font + '"' : '') + '>' +
        (o.dot ? '<i class="pk-dot" style="background:' + o.dot + '"></i>' : '') +
        '<span class="pk-text"><b>' + App.esc(o.label) + '</b>' + (o.sub ? '<small>' + App.esc(o.sub) + '</small>' : '') + '</span>' +
        (o.note ? '<em>' + App.esc(o.note) + '</em>' : '') +
        (o.arrow ? App.icon('right', 24) : on ? App.icon('check', 26) : '') + '</button>';
    }).join('');
    App.sheet('<div class="pk">' +
      '<div class="pk-head">' + (opts.onBack ? '<button class="icon-btn pk-back" data-back aria-label="Back">' + App.icon('left', 24) + '</button>' : '') +
      '<h2 class="serif">' + App.esc(opts.title) + '</h2></div>' +
      '<div class="pk-list">' + rows + '</div></div>', {
      cls: 'sheet--pick',
      onMount: function (sh, close) {
        var on = sh.querySelector('.pk-row.is-on');
        if (on) sh.querySelector('.pk-list').scrollTop = Math.max(0, on.offsetTop - 160);
        sh.addEventListener('click', function (e) {
          if (e.target.closest('[data-back]')) return opts.onBack();
          var b = e.target.closest('[data-i]');
          if (!b) return;
          var o = opts.options[+b.dataset.i];
          if (!o.arrow) close();
          opts.onPick(o.value, o);
        });
      }
    });
  };

  // ------------------------------------------------------------ location
  function countryList() {
    var mine = App.ownSetting('location');
    App.pick({
      title: App.t('Choose your country'),
      value: mine && mine.code,
      options: window.CITIES.map(function (c) {
        return { value: c.code, label: c.name, sub: App.t('{n} cities', { n: c.cities.length }), arrow: true };
      }),
      onPick: function (code) { cityList(code); }
    });
  }
  function cityList(code) {
    var c = window.CITIES.filter(function (x) { return x.code === code; })[0], mine = App.ownSetting('location');
    App.pick({
      title: c.name,
      value: mine && mine.code === code ? mine.name + '|' + mine.region : null,
      onBack: countryList,
      options: c.cities.map(function (x) { return { value: x.name + '|' + x.region, label: x.name, sub: x.region, city: x }; }),
      onPick: function (v, o) {
        var x = o.city;
        setLocation({ name: x.name, region: x.region, country: c.name, code: c.code, lat: x.lat, lon: x.lon, tz: x.tz, source: 'list' });
      }
    });
  }
  function setLocation(loc) {
    App.setSetting('location', loc);
    App.toast(App.t('Location set to {place}', { place: '<b>' + App.esc(loc.name) + '</b>' }) + ' · ' + App.t('updating prayer times…'), { icon: 'pin', ms: 3500 });
    // Suggest the usual calculation method for the country, unless one was chosen by hand.
    var rec = METHOD_FOR[loc.code];
    if (rec != null && App.ownSetting('method') == null && Number(App.setting('method')) !== rec) {
      App.banner({
        tone: 'ink', icon: 'moonstar', title: App.t('Use {method}?', { method: App.t(nameOf(METHODS, rec)[1]) }),
        sub: App.t('This calculation method is usual in {country}.', { country: loc.country || loc.name }),
        action: App.t('Use it'), dismiss: App.t('Keep current'), ms: 30000,
        onAction: function () { App.setSetting('method', rec); render(); }
      });
    }
    render();
  }
  // Search by town or postal code, typed on Noor's own keyboard so Android's never appears.
  // The server does the lookup (see /api/location/search), so it works on frames whose
  // certificates are too old to reach the geocoder themselves.
  var KEYS = { abc: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], num: ['1234567890', "-'.,/()&"] };
  function search() {
    var q = '', page = 'abc', timer = null, asked = '';
    App.sheet('<div class="loc-search">' +
      '<div class="label">' + App.t('Location') + '</div>' +
      '<h2 class="serif">' + App.t('Find your town') + '</h2>' +
      '<div class="loc-field"><span class="loc-q" data-q></span><i class="loc-caret"></i></div>' +
      '<div class="loc-results" data-results></div></div>', {
      cls: 'sheet--search',
      onMount: function (sh, close) {
        var kb = document.createElement('div');
        kb.className = 'loc-kb';
        sh.parentNode.appendChild(kb);
        var results = sh.querySelector('[data-results]'), field = sh.querySelector('[data-q]');
        function hint(text, list) {
          results.innerHTML = '<p class="loc-hint">' + text + '</p>' +
            (list ? '<button class="btn btn--ghost loc-list" data-list>' + App.icon('pin', 20) + App.t('Choose from list') + '</button>' : '');
        }
        function draw() {
          field.textContent = q;
          field.classList.toggle('is-empty', !q);
          if (!q) field.textContent = App.t('Town or ZIP code');
          kb.innerHTML = KEYS[page].map(function (row, r) {
            var keys = row.split('').map(function (c) { return '<button class="k" data-k="' + App.esc(c) + '">' + App.esc(c) + '</button>'; }).join('');
            return '<div class="kr">' + keys + (r === KEYS[page].length - 1 ? '<button class="k k--wide" data-k="back" aria-label="' + App.esc(App.t('Delete')) + '">⌫</button>' : '') + '</div>';
          }).join('') +
            '<div class="kr"><button class="k k--wide" data-k="page">' + (page === 'abc' ? '123' : 'ABC') + '</button>' +
            '<button class="k k--space" data-k=" ">' + App.t('space') + '</button>' +
            '<button class="k k--wide k--go" data-k="done">' + App.t('Done') + '</button></div>';
        }
        function find() {
          clearTimeout(timer);
          var term = q.trim();
          if (term.length < 2) { asked = ''; return hint(App.t('Type your town, or your ZIP or postal code.'), true); }
          if (term === asked) return;
          timer = setTimeout(function () {
            asked = term;
            results.classList.add('is-busy');
            App.api('/api/location/search', { q: term, lang: App.lang().id }).then(function (r) {
              if (asked !== term || !results.isConnected) return;
              results.classList.remove('is-busy');
              var places = r.places || [];
              if (!places.length) return hint(App.t('Nothing found for “{q}”. Try the nearest bigger town.', { q: App.esc(term) }), true);
              results.innerHTML = places.map(function (p, i) {
                var sub = [p.postcode, p.area, p.region, p.country].filter(Boolean).join(', ');
                return '<button class="pk-row" data-i="' + i + '"><span class="pk-text"><b>' + App.esc(p.name) + '</b><small>' + App.esc(sub) + '</small></span>' + App.icon('right', 24) + '</button>';
              }).join('');
              results.onclick = function (e) {
                var b = e.target.closest('[data-i]');
                if (!b) return;
                var p = places[+b.dataset.i];
                close();
                setLocation({ name: p.name, region: p.region, country: p.country, code: p.code, lat: p.latitude, lon: p.longitude, tz: p.timezone, source: 'search' });
              };
            }).catch(function (err) {
              if (asked !== term) return;
              asked = '';
              results.classList.remove('is-busy');
              hint(App.esc(err.message) + ' · ' + App.t('You can still choose from the list.'), true);
            });
          }, 450);
        }
        kb.addEventListener('pointerdown', function (e) {
          var b = e.target.closest('[data-k]');
          if (!b) return;
          e.preventDefault();
          var k = b.dataset.k;
          if (k === 'back') q = q.slice(0, -1);
          else if (k === 'page') page = page === 'abc' ? 'num' : 'abc';
          else if (k === 'done') return keyboard(false);
          else if (q.length < 60) q += q ? k : k.toUpperCase();
          draw();
          find();
        });
        // Done hides the keyboard so more places fit; tapping the field brings it back.
        function keyboard(on) { kb.classList.toggle('is-hidden', !on); sh.classList.toggle('is-kb-off', !on); }
        sh.querySelector('.loc-field').addEventListener('click', function () { keyboard(true); });
        sh.addEventListener('click', function (e) { if (e.target.closest('[data-list]')) countryList(); });
        draw();
        find();
      }
    });
  }

  // Approximate location from the internet connection (the frame has no GPS). Providers often
  // place a whole area in its nearest big city, so this offers search straight away.
  function detect() {
    App.toast(App.t('Finding your location…'), { icon: 'pin', ms: 8000 });
    fetch('https://ipwho.is/', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (ip) {
      if (!ip || !ip.success) throw new Error('lookup failed');
      var loc = { name: ip.city, region: ip.region, country: ip.country, code: ip.country_code, lat: ip.latitude, lon: ip.longitude, tz: ip.timezone && ip.timezone.id, source: 'auto' };
      App.sheet('<div class="sheet-pad">' +
        '<div class="label">' + App.t('Detected from your internet connection') + '</div>' +
        '<h2 class="serif sheet-h">' + App.esc(loc.name) + ' <i>' + App.esc([loc.region, loc.country].filter(Boolean).join(', ')) + '</i></h2>' +
        '<p class="set-note">' + App.t('Internet providers often show the nearest big city instead of your town. If this isn’t where you live, search for your town or ZIP code so prayer times are exact.') + '</p>' +
        '<div class="sheet-actions"><button class="btn btn--ghost" data-search>' + App.icon('search', 22) + App.t('Search instead') + '</button><button class="btn btn--solid" data-use>' + App.icon('check', 22) + App.t('Use this') + '</button></div></div>', {
        onMount: function (sh, close) {
          sh.addEventListener('click', function (e) {
            if (e.target.closest('[data-use]')) { close(); setLocation(loc); }
            if (e.target.closest('[data-search]')) search();
          });
        }
      });
    }).catch(function () {
      App.toast(App.t('Couldn’t detect your location. Search for your town instead.'), { icon: 'wifioff' });
      search();
    });
  }

  // ------------------------------------------------------------ calendars
  var CAL = { list: null, colors: [] };
  // Calendar changes are sent with this screen's key. On failure the toast explains why and the
  // promise never settles, so the follow-up steps (refresh, reopen the sheet) simply don't run.
  function post(path, body) {
    return App.api(path, body).catch(function (err) {
      App.toast(App.esc(err.message), { icon: 'wifioff', tone: 'error', ms: 4000 });
      return new Promise(function () {});
    });
  }
  function loadCalendars() {
    return fetch('/api/calendars', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (r) {
      if (r.error) throw new Error(r.error);
      CAL.list = r.calendars; CAL.colors = r.colors;
      render();
      return r.calendars;
    });
  }
  function source(c) {
    return App.t({ phone: 'Added from a phone', config: 'From the settings file', demo: 'Demo calendar' }[c.source]) +
      (c.family ? ' · ' + App.t('Whole family') : '') + (c.hidden ? ' · ' + App.t('Hidden') : '');
  }
  function changed(msg) {
    App.toast(msg, { icon: 'calendar', ms: 2500 });
    App.refreshAll();
    return loadCalendars();
  }

  App.calendarsSheet = function () {
    loadCalendars().then(function (list) {
      App.pick({
        title: App.t('Calendars'), value: null,
        options: list.map(function (c) { return { value: c.id, label: c.name, sub: source(c), dot: App.dotColor(c.color), dim: c.hidden, arrow: true }; })
          .concat([{ value: '+add', label: '+ ' + App.t('Add calendar'), sub: App.t('Scan a code with your phone and paste the link there') }]),
        onPick: function (id) { if (id === '+add') return App.addCalendar(); calendarActions(id); }
      });
    }).catch(function (err) { App.toast(App.esc(err.message), { icon: 'wifioff' }); });
  };

  function calendarActions(id) {
    var c = CAL.list.filter(function (x) { return x.id === id; })[0];
    var opts = [
      { value: 'color', label: App.t('Colour'), dot: App.dotColor(c.color), arrow: true },
      { value: 'family', label: App.t('Shows for'), sub: c.family ? App.t('Whole family') : App.t('One person (own lane)'), arrow: true }
    ];
    if (c.source === 'phone') opts.push({ value: 'remove', label: App.t('Remove from frame') });
    else opts.push({ value: 'hide', label: c.hidden ? App.t('Show on frame') : App.t('Hide from frame') });
    App.pick({
      title: c.name, value: null, onBack: App.calendarsSheet, options: opts,
      onPick: function (a) {
        if (a === 'color') {
          return App.pick({
            title: App.t('Colour'), value: c.color, onBack: function () { calendarActions(id); },
            options: CAL.colors.map(function (col) { return { value: col, label: ' ', dot: App.dotColor(col) }; }),
            onPick: function (col) { post('/api/calendars/update', { id: id, color: col }).then(function () { return changed(App.t('Colour changed')); }).then(App.calendarsSheet); }
          });
        }
        if (a === 'family') {
          return App.pick({
            title: App.t('Shows for'), value: c.family ? 1 : 0, onBack: function () { calendarActions(id); },
            options: [{ value: 0, label: App.t('One person'), sub: App.t('Gets its own lane') }, { value: 1, label: App.t('Whole family'), sub: App.t('Events show in everyone’s lane') }],
            onPick: function (v) { post('/api/calendars/update', { id: id, family: !!v }).then(function () { return changed(App.t('Saved')); }).then(App.calendarsSheet); }
          });
        }
        if (a === 'hide') {
          return post('/api/calendars/update', { id: id, hidden: !c.hidden }).then(function () {
            return changed(App.t(c.hidden ? '{name} is back on the frame' : '{name} is hidden', { name: '<b>' + App.esc(c.name) + '</b>' }));
          }).then(App.calendarsSheet);
        }
        if (a === 'remove') {
          return App.pick({
            title: App.t('Remove {name}?', { name: c.name }), value: null, onBack: function () { calendarActions(id); },
            options: [{ value: 'yes', label: App.t('Remove'), sub: App.t('You can add it again any time') }, { value: 'no', label: App.t('Cancel') }],
            onPick: function (v) {
              if (v !== 'yes') return calendarActions(id);
              post('/api/calendars/remove', { id: id }).then(function () { return changed(App.t('{name} removed', { name: '<b>' + App.esc(c.name) + '</b>' })); }).then(App.calendarsSheet);
            }
          });
        }
      }
    });
  }

  // The address a phone can reach: this page's own address, or the server's Wi-Fi address when
  // the dashboard is open as "localhost" on the computer running it. A Raspberry Pi kiosk shows
  // the dashboard through its local helper, so it always uses the server's own address.
  function phoneOrigin() {
    var lan = D.config && D.config.lanIp;
    if (App.platform === 'pi' && D.config && D.config.lanUrl) return D.config.lanUrl;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && lan) return location.protocol + '//' + lan + (location.port ? ':' + location.port : '');
    return location.origin;
  }

  // A QR code that opens the phone companion and signs the phone in (Settings → Open on phone),
  // optionally straight on a page (the "Add calendar" button opens the calendar page).
  function phoneSheet(opts) {
    if (D.config && D.config.canAddCalendars === false) {
      return App.toast(App.t('This needs storage on the server. See the README (Cloudflare: FRAME_KV).'), { icon: 'calendar', ms: 6000 });
    }
    var poll = null, seenCals = 0, seenPhones = 0, closed = false;
    post('/api/pair').then(function (r) {
      var link = phoneOrigin() + '/companion/?pair=' + r.token + (opts.hash || '');
      var q = qrcode(0, 'M'); q.addData(link); q.make();
      App.sheet('<div class="add-cal">' +
        '<div class="add-cal-qr">' + q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) + '</div>' +
        '<div class="add-cal-text">' +
        '  <div class="label">' + opts.label + '</div>' +
        '  <h2 class="serif">' + App.t('Scan with your phone') + '</h2>' +
        '  <ol>' + opts.steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' +
        '  <p class="add-cal-url">' + App.esc(link.replace(/^https?:\/\//, '').replace(/pair=(\w{6})\w+/, 'pair=$1…')) + '</p>' +
        '  <div class="add-cal-status" id="addCalStatus"><i class="pulse"></i>' + App.t('Waiting for your phone…') + '</div>' +
        '</div></div>', {
        cls: 'sheet--wide',
        onClose: function () { closed = true; clearInterval(poll); }
      });
      poll = setInterval(function () {
        if (closed) return clearInterval(poll);
        fetch('/api/pair/status?token=' + r.token, { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (st) {
          var box = document.getElementById('addCalStatus');
          if (!box) return;
          if (st.status === 'expired') {
            clearInterval(poll);
            box.className = 'add-cal-status is-expired';
            box.innerHTML = App.t('This code has expired.') + ' <button class="btn btn--ghost" data-new>' + App.t('New code') + '</button>';
            box.querySelector('[data-new]').onclick = function () { App.closeSheet(); phoneSheet(opts); };
            return;
          }
          var phones = st.phones || [];
          if (st.added.length > seenCals) {
            var names = st.added.slice(seenCals);
            seenCals = st.added.length;
            box.className = 'add-cal-status is-done';
            box.innerHTML = App.icon('check', 22) + App.t('Added: {names}', { names: '<b>' + names.map(App.esc).join(', ') + '</b>' }) +
              ' <small>' + App.t('Add another from your phone, or close this.') + '</small>';
            App.refreshAll();
            loadCalendars();
          } else if (phones.length > seenPhones) {
            seenPhones = phones.length;
            box.className = 'add-cal-status is-done';
            box.innerHTML = App.icon('check', 22) + App.t('Connected: {names}', { names: '<b>' + phones.map(App.esc).join(', ') + '</b>' }) +
              ' <small>' + App.t('Carry on from your phone.') + '</small>';
          }
        }).catch(function () { /* keep waiting */ });
      }, 2000);
    });
  }

  App.addCalendar = function () {
    phoneSheet({
      label: App.t('Add calendars'), hash: '#/calendars/add',
      steps: [App.t('Open your phone’s camera and point it at the code.'), App.t('Tap the link and follow the steps to copy your calendar’s link.'), App.t('Paste it and tap Add. Add as many calendars as you like.')]
    });
  };
  App.openOnPhone = function () {
    phoneSheet({
      label: App.t('Open on phone'), hash: '',
      steps: [App.t('Open your phone’s camera and point it at the code.'), App.t('Tap the link and give your phone a name.'), App.t('Change settings, calendars and screens from your phone.')]
    });
  };

  // ------------------------------------------------------------ rows
  // Household settings (shared by every screen) carry a small house mark.
  function row(key, label, value, sub) {
    var house = App.isHouseSetting(key) ? '<i class="set-house" title="' + App.esc(App.t('For the whole house')) + '">' + App.icon('home', 14) + '</i>' : '';
    return '<button class="set-row" data-set="' + key + '"><span class="set-l">' + App.esc(label) + house + '</span>' +
      '<span class="set-v"><b>' + App.esc(value) + '</b>' + (sub ? '<small>' + App.esc(sub) + '</small>' : '') + '</span>' + App.icon('right', 22) + '</button>';
  }

  // A screen setting with a household default: "Same as the house" clears this screen's choice.
  var HOUSE_DEFAULT = '__house';
  function screenPick(key, title, options, labelOf, cast) {
    var own = App.ownSetting(key);
    App.pick({
      title: title, value: own == null ? HOUSE_DEFAULT : own,
      options: [{ value: HOUSE_DEFAULT, label: App.t('Same as the house'), sub: labelOf(App.houseDefault(key)) }].concat(options),
      onPick: function (v) { App.setSetting(key, v === HOUSE_DEFAULT ? null : cast ? cast(v) : v); render(); }
    });
  }
  function idleLabel(v) { return Number(v) ? App.t('After {t}', { t: App.t((nameOf(IDLES, v) || IDLES[1])[1]) }) : App.t('Never'); }

  var PICKERS = {
    method: function () {
      var loc = App.ownSetting('location') || {}, rec = METHOD_FOR[loc.code];
      App.pick({
        title: App.t('Calculation method'), value: App.setting('method'),
        options: METHODS.map(function (m) { return { value: m[0], label: App.t(m[1]), note: m[0] === rec ? App.t('Usual here') : '' }; }),
        onPick: function (v) { App.setSetting('method', Number(v)); render(); }
      });
    },
    school: function () {
      App.pick({
        title: App.t('Asr time'), value: Number(App.setting('school')) || 0,
        options: [{ value: 0, label: App.t('Standard'), sub: App.t('Shafiʿi, Maliki, Hanbali') }, { value: 1, label: App.t('Hanafi'), sub: App.t('Later Asr') }],
        onPick: function (v) { App.setSetting('school', Number(v)); render(); }
      });
    },
    reminder: function () {
      App.pick({
        title: App.t('Reminder before prayer'), value: Number(App.setting('reminder')) || 0,
        options: REMINDERS.map(function (m) { return { value: m, label: m ? App.t('{n} minutes before', { n: m }) : App.t('Off') }; }),
        onPick: function (v) { App.setSetting('reminder', Number(v)); render(); }
      });
    },
    translation: function () {
      App.pick({
        title: App.t('Quran translation'), value: App.setting('translation'),
        options: TRANSLATIONS.map(function (t) { return { value: t[0], label: t[2], group: t[1] }; }),
        onPick: function (v) { App.setSetting('translation', v); render(); }
      });
    },
    reciter: function () {
      App.pick({
        title: App.t('Reciter'), value: App.setting('reciter'),
        options: RECITERS.map(function (r) { return { value: r[0], label: r[1] }; }),
        onPick: function (v) { App.stopRecite(); App.setSetting('reciter', v); render(); }
      });
    },
    lang: function () {
      App.pick({
        title: App.t('Language'), value: App.setting('lang'),
        options: App.LANGS.map(function (l) { return { value: l.id, label: l.name, font: l.rtl ? "'Noto Sans Arabic', var(--arabic)" : null }; }),
        onPick: function (v) { App.setSetting('lang', v); render(); }
      });
    },
    font: function () {
      App.pick({
        title: App.t('Text style'), value: App.setting('font'),
        options: App.FONTS.map(function (f) { return { value: f.id, label: App.t(f.name), sub: f.sample }; }),
        onPick: function (v) { App.setSetting('font', v); render(); }
      });
    },
    arabicFont: function () {
      App.pick({
        title: App.t('Arabic font'), value: App.setting('arabicFont'),
        options: App.ARABIC_FONTS.map(function (f) { return { value: f.id, label: f.name, sub: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ' }; }),
        onPick: function (v) { App.setSetting('arabicFont', v); render(); }
      });
    },
    clock: function () {
      App.pick({
        title: App.t('Clock'), value: App.setting('clock'),
        options: [{ value: '12', label: App.t('12-hour'), sub: '4:30 PM' }, { value: '24', label: App.t('24-hour'), sub: '16:30' }],
        onPick: function (v) { App.setSetting('clock', v); render(); }
      });
    },
    theme: function () {
      screenPick('theme', App.t('Theme'), THEMES.map(function (t) { return { value: t[0], label: App.t(t[1]), sub: App.t(t[2]) }; }),
        function (v) { return App.t((nameOf(THEMES, v) || THEMES[0])[1]); });
    },
    idle: function () {
      screenPick('idle', App.t('Idle screen'), IDLES.map(function (t) { return { value: t[0], label: App.t(t[1]), sub: t[0] ? App.t('Clock, prayer times and the ayah after no touch') : App.t('Stay on the dashboard') }; }),
        idleLabel, Number);
    },
    nav: function () {
      screenPick('nav', App.t('Menu'), NAVS.map(function (n) { return { value: n[0], label: App.t(n[1]), sub: App.t(n[2]) }; }),
        function (v) { return App.t((nameOf(NAVS, v) || NAVS[0])[1]); });
    },
    nightScreen: function () {
      App.pick({
        title: App.t('At night'), value: App.setting('nightScreen'),
        options: NIGHTS.map(function (n) { return { value: n[0], label: App.t(n[1]), sub: App.t(n[2]) }; }),
        onPick: function (v) { App.setSetting('nightScreen', v); render(); }
      });
    },
    units: function () {
      App.pick({
        title: App.t('Temperature'), value: App.setting('units'),
        options: [{ value: 'celsius', label: App.t('Celsius'), sub: '°C' }, { value: 'fahrenheit', label: App.t('Fahrenheit'), sub: '°F' }],
        onPick: function (v) { App.setSetting('units', v); render(); }
      });
    }
  };

  var THEMES = [
    ['auto', 'Automatic', 'Dark from sunset (Maghrib) to sunrise'],
    ['light', 'Light', 'Always light'],
    ['dark', 'Dark', 'Always dark']
  ];
  var IDLES = [[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never']];

  var NIGHTS = [
    ['clock', 'Night clock', 'A dim red clock until morning'],
    ['off', 'Screen off', 'The display turns off. A touch or the athan wakes it.']
  ];

  var NAVS = [
    ['top', 'Slide down from the top', 'Full screen; pull down to open'],
    ['bottom', 'Slide up from the bottom', 'Full screen; pull up to open'],
    ['left', 'Dock on the left', 'Always visible'],
    ['right', 'Dock on the right', 'Always visible']
  ];

  function render() {
    if (!V.el) return;
    var loc = (D.config && D.config.location) || {}, mine = App.ownSetting('location');
    var place = mine || { name: loc.name, region: loc.region };
    var method = nameOf(METHODS, App.setting('method')), tr = nameOf(TRANSLATIONS, App.setting('translation')), rc = nameOf(RECITERS, App.setting('reciter'));
    var font = App.findFont(App.FONTS, App.setting('font')), af = App.findFont(App.ARABIC_FONTS, App.setting('arabicFont'));
    var rem = Number(App.setting('reminder')) || 0;
    var bridge = App.can.wifi;
    V.el.innerHTML = '<div class="set">' +
      '<div class="set-col">' + App.backBtn() +
      '  <div class="set-loc">' +
      '    <div class="label label--light">' + App.icon('pin', 18) + App.t('Location') + '<i class="set-house">' + App.icon('home', 14) + App.t('Whole house') + '</i></div>' +
      '    <div class="set-place serif">' + App.esc(place.name || '—') + '</div>' +
      '    <div class="set-region">' + App.esc([place.region, place.country].filter(Boolean).join(', ')) + '</div>' +
      '    <p class="set-why">' + App.t('Prayer times, the athan and weather use this place.') + (mine && mine.source === 'auto' ? ' ' + App.t('Detected automatically, so it may be a nearby city.') : '') + '</p>' +
      '    <div class="set-loc-btns"><button class="btn set-btn-light" data-loc="search">' + App.icon('search', 20) + App.t('Town or ZIP') + '</button>' +
      '    <button class="btn set-btn-ghost" data-loc="detect">' + App.icon('wifi', 20) + App.t('Detect') + '</button></div>' +
      '  </div>' +
      '  <div class="set-card">' +
      '    <div class="label">' + App.t('This frame') + '</div>' +
      (bridge ? '<button class="set-row" data-act="wifi"><span class="set-l">' + App.t('Wi-Fi') + '</span><span class="set-v"><b>' + App.t(App.net.online ? 'Connected' : 'Not connected') + '</b></span>' + App.icon('right', 22) + '</button>' : '') +
      deviceRow() +
      '    <button class="set-row" data-act="phone"><span class="set-l">' + App.t('Phone') + '</span><span class="set-v"><b>' + App.t('Open on phone') + '</b><small>' + App.t('Settings, calendars and screens') + '</small></span>' + App.icon('right', 22) + '</button>' +
      '    <button class="set-row" data-act="net"><span class="set-l">' + App.t('Connection') + '</span><span class="set-v"><b>' + App.t(App.net.online ? 'Online' : 'Offline') + '</b></span>' + App.icon('right', 22) + '</button>' +
      '    <button class="set-row" data-act="reset"><span class="set-l">' + App.t('Reset settings') + '</span><span class="set-v"><b>' + App.t('Use defaults') + '</b></span>' + App.icon('right', 22) + '</button>' +
      '  </div>' +
      '</div>' +
      '<div class="set-col">' +
      '  <div class="set-card">' +
      '    <div class="label">' + App.icon('moonstar', 18) + App.t('Prayer') + '</div>' +
      row('method', App.t('Calculation method'), method ? App.t(method[1]) : '—') +
      row('school', App.t('Asr time'), Number(App.setting('school')) === 1 ? App.t('Hanafi') : App.t('Standard')) +
      row('reminder', App.t('Reminder'), rem ? App.t('{n} minutes before', { n: rem }) : App.t('Off')) +
      '  </div>' +
      '  <div class="set-card">' +
      '    <div class="label">' + App.icon('book', 18) + App.t('Quran') + '</div>' +
      row('translation', App.t('Translation'), tr ? tr[2] : App.setting('translation'), tr ? tr[1] : '') +
      row('reciter', App.t('Reciter'), rc ? rc[1] : App.setting('reciter')) +
      '  </div>' +
      '  <div class="set-card">' +
      '    <div class="label">' + App.t('Screen') + '</div>' +
      row('theme', App.t('Theme'), App.t((nameOf(THEMES, App.setting('theme')) || THEMES[0])[1]) + (App.setting('theme') === 'auto' ? ' · ' + App.t(App.isDark() ? 'Dark' : 'Light') : '')) +
      row('idle', App.t('Idle screen'), idleLabel(App.setting('idle'))) +
      row('nav', App.t('Menu'), App.t((nameOf(NAVS, App.setting('nav')) || NAVS[0])[1])) +
      (App.can.screen ? row('nightScreen', App.t('At night'), App.t((nameOf(NIGHTS, App.setting('nightScreen')) || NIGHTS[0])[1])) : '') +
      '  </div>' +
      '</div>' +
      '<div class="set-col">' +
      '  <div class="set-card">' +
      '    <div class="label">' + App.t('Display') + '</div>' +
      row('lang', App.t('Language'), App.lang().name) +
      row('font', App.t('Text style'), App.t(font.name)) +
      row('arabicFont', App.t('Arabic font'), af.name) +
      row('clock', App.t('Clock'), App.setting('clock') === '24' ? App.t('24-hour') : App.t('12-hour')) +
      row('units', App.t('Temperature'), App.setting('units') === 'fahrenheit' ? App.t('Fahrenheit') + ' °F' : App.t('Celsius') + ' °C') +
      '  </div>' +
      calendarCard() +
      soundCard() +
      '</div>' +
      '</div>';
  }

  function calendarCard() {
    var list = CAL.list ? CAL.list.filter(function (c) { return !c.hidden; }) : D.people;
    return '<div class="set-card set-cals">' +
      '<div class="label">' + App.icon('calendar', 18) + App.t('Calendars') + '</div>' +
      '<button class="set-row" data-act="cals"><span class="set-l">' + App.t('{n} on the frame', { n: list.length }) + '</span>' +
      '<span class="set-v set-cal-dots">' + list.slice(0, 6).map(function (c) { return '<i style="background:' + App.dotColor(c.color) + '"></i>'; }).join('') +
      '<b>' + App.esc(list.map(function (c) { return c.name; }).join(', ') || App.t('None yet')) + '</b></span>' + App.icon('right', 22) + '</button>' +
      '<button class="btn btn--solid set-add-cal" data-act="addcal">' + App.icon('plus', 22) + App.t('Add calendar') + '</button>' +
      '</div>';
  }

  // The device's own volume (kiosk app only). The athan's share of it is on the Prayer screen.
  function soundCard() {
    var v = App.can.volume && App.volume();
    if (!v || !v.max) return '';
    var bars = '';
    for (var i = 1; i <= v.max; i++) bars += '<button class="set-vol-bar' + (i <= v.level ? ' is-on' : '') + '" data-vol-level="' + i + '" aria-label="' + i + '" style="height:' + Math.round(30 + 70 * i / v.max) + '%"></button>';
    return '<div class="set-card set-sound">' +
      '<div class="label">' + App.icon(v.level ? 'volume' : 'mute', 18) + App.t('Sound') + '<span class="set-vol-n">' + (v.level ? Math.round(v.level * 100 / v.max) + '%' : App.t('Muted')) + '</span></div>' +
      '<div class="set-vol">' +
      '<button class="set-vol-btn" data-vol-step="-1" aria-label="' + App.esc(App.t('Quieter')) + '">' + App.icon('mute', 24) + '</button>' +
      '<div class="set-vol-bars">' + bars + '</div>' +
      '<button class="set-vol-btn" data-vol-step="1" aria-label="' + App.esc(App.t('Louder')) + '">' + App.icon('volume', 24) + '</button>' +
      '</div></div>';
  }

  // This screen's name and whether it may change household settings.
  function deviceRow() {
    var d = App.device && App.device();
    var status = !d ? App.t('Not registered yet') : d.approved ? App.t('Can change household settings') : App.t('Waiting for approval');
    return '<div class="set-row set-row--info"><span class="set-l">' + App.t('This screen') + '</span>' +
      '<span class="set-v"><b>' + App.esc(d ? d.name : '—') + '</b><small>' + status + '</small></span></div>';
  }

  function notApproved() {
    App.toast(App.t('This screen is waiting for approval, so it can’t change household settings yet.'), { icon: 'person', ms: 4000 });
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-set]'))) {
      if (App.isHouseSetting(t.dataset.set) && !App.canEditHouse()) return notApproved();
      return PICKERS[t.dataset.set]();
    }
    if ((t = e.target.closest('[data-loc]'))) {
      if (!App.canEditHouse()) return notApproved();
      return t.dataset.loc === 'detect' ? detect() : search();
    }
    if ((t = e.target.closest('[data-vol-level], [data-vol-step]'))) {
      var v = App.volume();
      if (!v) return;
      var level = t.dataset.volLevel ? +t.dataset.volLevel : v.level + (+t.dataset.volStep);
      // Tapping the lowest lit bar again mutes.
      if (t.dataset.volLevel && level === 1 && v.level === 1) level = 0;
      App.setVolume(Math.max(0, Math.min(v.max, level)));
      return render();
    }
    if ((t = e.target.closest('[data-act]'))) {
      if (t.dataset.act === 'wifi') return window.Frame.openWifiSettings();
      if (t.dataset.act === 'cals') return App.calendarsSheet();
      if (t.dataset.act === 'addcal') return App.addCalendar();
      if (t.dataset.act === 'phone') return App.openOnPhone();
      if (t.dataset.act === 'net') return App.netSheet();
      if (t.dataset.act === 'reset') {
        return App.pick({
          title: App.t('Reset this screen’s settings?'), value: null,
          options: [{ value: 'yes', label: App.t('Reset to defaults'), sub: App.t('Language, fonts, clock, theme, idle time and menu on this screen. Household settings stay as they are.') }, { value: 'no', label: App.t('Cancel') }],
          onPick: function (v) {
            if (v !== 'yes') return;
            ['lang', 'font', 'arabicFont', 'clock', 'theme', 'idle', 'nav', 'nightScreen'].forEach(function (k) { App.ownSetting(k) != null && App.setSetting(k, null); });
            render();
          }
        });
      }
    }
  }

  App.register('settings', {
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
      loadCalendars().catch(function () { /* offline: show the cached lanes */ });
    }
  });
  App.on('net', function () { if (App.current === 'settings') render(); });
  App.on('device', function () { if (App.current === 'settings') render(); });
})();
