// Prayer times (from AlAdhan via /api/prayer), the athan, and the Prayer view.
// The athan runs on the real clock (not the demo clock) and plays at most once per prayer per
// day, even if the page reloads.
(function () {
  'use strict';
  var D = window.DATA, $ = App.$;
  var FIVE = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  var SIX = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  var AR = { Fajr: 'الفجر', Sunrise: 'الشروق', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء', Jumuah: 'الجمعة' };

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------ times
  // Names in the interface language (lang.js has them per language).
  function label(name, d) { return App.t(name === 'Dhuhr' && d.getDay() === 5 ? 'Jumuʿah' : name); }
  function arabic(name, d) { return name === 'Dhuhr' && d.getDay() === 5 ? AR.Jumuah : AR[name]; }

  App.prayerDay = function (d) {
    var p = D.prayer && D.prayer[App.ymd(d)];
    if (!p) return null;
    return {
      hijri: p.hijri,
      list: SIX.map(function (n) {
        var t = new Date(p.times[n]);
        return { name: n, label: label(n, t), ar: arabic(n, t), time: t, prayer: n !== 'Sunrise' };
      })
    };
  };
  App.hijri = function (d) {
    var p = App.prayerDay(d || App.now());
    if (p && App.lang().rtl) return p.hijri.day + ' ' + p.hijri.monthAr + ' ' + p.hijri.year;
    return p ? p.hijri.day + ' ' + p.hijri.month + ' ' + p.hijri.year : '';
  };
  // "Al-Baqara 2:255", or "سورة البقرة 2:255" when the interface is Arabic or Urdu.
  App.ayahRef = function (a) {
    return (App.lang().rtl ? a.surahAr : a.surahName) + ' ' + a.surah + ':' + a.ayah;
  };
  App.hijriAr = function (d) {
    var p = App.prayerDay(d || App.now());
    return p ? p.hijri.day + ' ' + p.hijri.monthAr + ' ' + p.hijri.year : '';
  };

  // The next of the five daily prayers after `now` (looks into tomorrow after Isha).
  App.nextPrayer = function (now) {
    now = now || App.now();
    for (var i = 0; i < 2; i++) {
      var day = App.prayerDay(App.addDays(now, i));
      if (!day) continue;
      var hit = day.list.filter(function (p) { return p.prayer && p.time > now; })[0];
      if (hit) return hit;
    }
    return null;
  };
  // The prayer whose time it currently is (from its start until the next one), or null before Fajr.
  App.currentPrayer = function (now) {
    now = now || App.now();
    var day = App.prayerDay(now);
    if (!day) return null;
    var cur = null;
    day.list.forEach(function (p) { if (p.time <= now) cur = p; });
    return cur && cur.prayer ? cur : null;
  };
  function until(t) {
    var m = Math.ceil((t - App.now()) / 60000);
    return m <= 0 ? App.t('now') : App.t('in {t}', { t: App.fmt.mins(m) });
  }
  App.prayerUntil = until;

  // ------------------------------------------------------------ settings (defaults from config)
  App.athanSettings = function () {
    var base = (D.config && D.config.athan) || {};
    var own = load('hq-athan', {});
    var prayers = {};
    FIVE.forEach(function (n) {
      prayers[n] = own.prayers && own.prayers[n] != null ? own.prayers[n] : (base.prayers ? base.prayers[n] !== false : true);
    });
    return {
      enabled: base.enabled !== false,
      muted: !!own.muted,
      volume: own.volume != null ? own.volume : (base.volume != null ? base.volume : 0.8),
      prayers: prayers,
      file: base.file || '/audio/athan.mp3',
      fajrFile: base.fajrFile || '',
      reminder: Number(App.setting('reminder')) || 0
    };
  };
  function setOwn(patch) {
    var own = load('hq-athan', {});
    Object.keys(patch).forEach(function (k) { own[k] = patch[k]; });
    save('hq-athan', own);
  }

  // ------------------------------------------------------------ sound
  var audio = null, ctx = null, chimeTimer = null;

  function halt() {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
    clearTimeout(chimeTimer);
  }
  function stop() {
    halt();
    App.$$('.tk-athan [data-stop]').forEach(function (b) { b.classList.add('is-hidden'); });
  }
  App.stopAthan = stop;

  // Fallback when no athan file is installed: three soft bell tones.
  function chime(vol) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      [0, 1.1, 2.2].forEach(function (at, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
        o.type = 'sine';
        o.frequency.value = [659.25, 587.33, 523.25][i];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.4 * vol, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + 2.5);
      });
      chimeTimer = setTimeout(onEnded, 4800);
    } catch (e) { /* no audio at all */ }
  }

  var blockedBanner = null;
  function play(files, vol) {
    halt();
    var src = files.shift();
    if (!src) { chime(vol); return; }
    audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(1, vol));
    audio.addEventListener('ended', onEnded);
    var mine = audio;
    // Missing file (404) or unsupported format: try the next file, then the built-in chime.
    audio.addEventListener('error', function () { if (audio === mine) play(files, vol); });
    var pr = audio.play();
    if (pr && pr.catch) pr.catch(function (err) {
      if (err.name !== 'NotAllowedError') return;
      // A normal browser blocks sound until someone has tapped the page. The kiosk app allows it.
      if (blockedBanner) return;
      blockedBanner = App.banner({
        tone: 'ink', icon: 'volume', title: App.t('Tap to allow the athan sound'),
        sub: App.t('This browser blocks sound until the screen is touched once.'),
        action: App.t('Allow sound'), dismiss: App.t('Not now'),
        onAction: function () { blockedBanner = null; if (audio) audio.play(); }
      });
    });
  }
  function onEnded() {
    App.$$('.tk-athan [data-stop]').forEach(function (b) { b.classList.add('is-hidden'); });
    setTimeout(function () { if ($('#takeover').classList.contains('takeover--athan')) App.closeTakeover(); }, 60000);
  }

  // ------------------------------------------------------------ Quran recitation (ayah of the day)
  // Separate from the athan's player. The athan always wins: it stops any recitation.
  var rec = null;
  App.reciting = false;
  function setReciting(on) { App.reciting = on; App.emit('recite', on); }
  App.stopRecite = function () {
    if (rec) { rec.pause(); rec.removeAttribute('src'); rec = null; }
    if (App.reciting) setReciting(false);
  };
  App.recite = function (a) {
    if (App.reciting) return App.stopRecite();
    if (!a || !a.audio) return App.toast(App.t('No recitation for this ayah'), { icon: 'mute', ms: 2500 });
    halt();
    var urls = [a.audio, a.audioAlt].filter(Boolean);
    function next() {
      var url = urls.shift();
      if (!url) { App.stopRecite(); App.toast(App.t('Couldn’t play the recitation. Is the frame online?'), { icon: 'wifioff' }); return; }
      var el = rec = new Audio(url);
      el.volume = Math.max(0.2, App.athanSettings().volume);
      el.addEventListener('ended', function () { if (rec === el) App.stopRecite(); });
      el.addEventListener('error', function () { if (rec === el) next(); });
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function (err) { if (err.name === 'NotAllowedError' && rec === el) App.stopRecite(); });
    }
    setReciting(true);
    next();
  };

  // ------------------------------------------------------------ athan takeover
  App.athan = function (p, opts) {
    opts = opts || {};
    App.stopRecite();
    var s = App.athanSettings();
    var withSound = opts.sound != null ? opts.sound : (s.enabled && !s.muted && s.prayers[p.name]);
    var el = $('#takeover');
    el.className = 'takeover takeover--athan';
    el.innerHTML =
      '<div class="tk-athan">' +
      '  <div class="label label--light">' + App.icon('moonstar', 20) + ' ' + (opts.test ? App.t('Test') + ' · ' : '') + App.t('Time for prayer') + ' · ' + App.fmt.time(p.time) + '</div>' +
      '  <div class="tk-athan-ar" lang="ar" dir="rtl">' + p.ar + '</div>' +
      '  <h1 class="serif tk-athan-name">' + p.label + '</h1>' +
      '  <p class="tk-athan-sub serif"><i>' + App.esc(App.hijri(p.time)) + '</i></p>' +
      '  <div class="tk-actions">' +
      (withSound ? '<button class="tk-btn" data-stop>' + App.icon('mute', 30) + '<span>' + App.t('Stop athan') + '</span></button>' : '') +
      '    <button class="tk-btn tk-btn--solid" data-done>' + App.icon('check', 30) + '<span>' + App.t('Done') + '</span></button>' +
      '  </div>' +
      '</div>';
    el.classList.add('is-open');
    App.closeSheet();
    if (App.mode !== 'day') App.setMode('day');
    var stopBtn = el.querySelector('[data-stop]');
    if (stopBtn) stopBtn.onclick = stop;
    el.querySelector('[data-done]').onclick = function () { stop(); App.closeTakeover(); };

    if (withSound) {
      var files = p.name === 'Fajr' && s.fajrFile ? [s.fajrFile, s.file] : [s.file];
      play(files, s.volume);
    } else {
      setTimeout(function () { if ($('#takeover').classList.contains('takeover--athan')) App.closeTakeover(); }, 5 * 60000);
    }
  };

  // Play a test athan for a given prayer ('Fajr' uses the Fajr recording, the rest the regular one),
  // whatever the next prayer happens to be.
  App.testAthan = function (name) {
    var day = App.prayerDay(App.now()), p = day && day.list.filter(function (x) { return x.name === name; })[0];
    if (!p) { var now = App.now(); p = { name: name, label: label(name, now), ar: arabic(name, now), time: now, prayer: true }; }
    App.athan(p, { test: true, sound: true });
  };
  App.pickTestAthan = function () {
    App.pick({
      title: App.t('Which athan?'), value: null,
      options: [
        { value: 'Dhuhr', label: App.t('Regular athan'), sub: App.t('Dhuhr, Asr, Maghrib and Isha') },
        { value: 'Fajr', label: App.t('Fajr athan'), sub: App.t('Fajr only') }
      ],
      onPick: App.testAthan
    });
  };

  // ------------------------------------------------------------ scheduler (real clock)
  function playedToday() {
    var all = load('hq-athan-played', {}), key = App.ymd(new Date());
    return { all: all, key: key, list: all[key] || [] };
  }
  function markPlayed(id) {
    var st = playedToday(), out = {};
    st.list.push(id);
    out[st.key] = st.list; // only keep today
    save('hq-athan-played', out);
  }

  function check() {
    var now = new Date(), day = App.prayerDay(now);
    if (!day) return;
    var s = App.athanSettings(), done = playedToday().list;
    day.list.forEach(function (p) {
      if (!p.prayer) return;
      var since = now - p.time;
      // Fire within 2 minutes of the time (covers a short freeze or a reload right at the time).
      if (since >= 0 && since < 120000 && done.indexOf(p.name) < 0) {
        markPlayed(p.name);
        App.athan(p);
      }
      if (s.reminder && s.prayers[p.name]) {
        var before = p.time - now, win = s.reminder * 60000;
        if (before > 0 && before <= win && win - before < 120000 && done.indexOf(p.name + '-r') < 0) {
          markPlayed(p.name + '-r');
          App.banner({
            tone: 'ink', icon: 'moonstar', title: App.t('{prayer} in {t}', { prayer: p.label, t: App.fmt.mins(Math.ceil(before / 60000)) }),
            sub: App.t('Athan at {time}', { time: App.fmt.time(p.time) }), dismiss: App.t('OK'), ms: 120000
          });
        }
      }
    });
  }
  App.on('second', check);

  // ------------------------------------------------------------ home + ambient pieces
  App.prayerNextBlock = function () {
    var n = App.nextPrayer();
    if (!n) return '<div class="label">' + App.t('Prayer times') + '</div><div class="pn-wait serif"><i>' + App.t('Waiting for prayer times…') + '</i></div>';
    return '<div class="label">' + App.icon('moonstar', 18) + App.t('Next prayer') + '</div>' +
      '<div class="pn-row"><span class="pn-name serif">' + n.label + '</span><span class="pn-ar" lang="ar">' + n.ar + '</span></div>' +
      '<div class="pn-time"><b class="num">' + App.fmt.time(n.time, false) + '</b><span>' + App.fmt.ampm(n.time) + '</span><em>' + until(n.time) + '</em></div>' +
      '<div class="pn-hijri serif"><i>' + App.esc(App.hijri()) + '</i></div>';
  };

  App.prayerStrip = function () {
    var now = App.now(), day = App.prayerDay(now), next = App.nextPrayer(now), cur = App.currentPrayer(now);
    if (!day) return '<div class="label">' + App.t('Prayer times') + '</div><div class="pn-wait serif"><i>' + App.t('Connect to Wi-Fi to load prayer times.') + '</i></div>';
    return '<div class="label">' + App.t('Today’s prayers') + '<span class="ps-loc">' + App.esc((D.config && D.config.location.name) || '') + '</span></div>' +
      '<div class="ps-grid">' + day.list.filter(function (p) { return p.prayer; }).map(function (p) {
        var cls = 'ps-p' + (next && next.name === p.name && App.sameDay(next.time, now) ? ' is-next' : '') +
          (cur && cur.name === p.name ? ' is-now' : '') + (p.time <= now && !(cur && cur.name === p.name) ? ' is-past' : '');
        return '<div class="' + cls + '"><span class="ps-n">' + p.label + '</span><b class="num">' + App.fmt.time(p.time, false) + '</b><span class="ps-ar" lang="ar">' + p.ar + '</span></div>';
      }).join('') + '</div>';
  };

  // ------------------------------------------------------------ Prayer view
  var V = {};
  var VOL = [[0.35, 'Low'], [0.65, 'Medium'], [1, 'High']];
  function nearest(v) {
    return VOL.reduce(function (best, o) { return Math.abs(o[0] - v) < Math.abs(best - v) ? o[0] : best; }, VOL[0][0]);
  }

  function render() {
    var now = App.now(), day = App.prayerDay(now), next = App.nextPrayer(now), cur = App.currentPrayer(now);
    var s = App.athanSettings();
    if (!day) {
      V.el.innerHTML = '<div class="pr pr--empty">' + App.backBtn() + '<div class="serif pr-empty">' + App.t('Prayer times will appear') + '<br><i>' + App.t('once the frame is online.') + '</i></div>' +
        '<button class="btn btn--solid" data-refresh>' + App.icon('undo', 22) + App.t('Try again') + '</button></div>';
      return;
    }
    var hero = next ?
      '<div class="pr-hero">' +
      '  <div class="label label--light">' + App.t('Next prayer') + ' · ' + until(next.time) + '</div>' +
      '  <div class="pr-hero-ar" lang="ar" dir="rtl">' + next.ar + '</div>' +
      '  <div class="pr-hero-name serif">' + next.label + '</div>' +
      '  <div class="pr-hero-time num">' + App.fmt.time(next.time, false) + '<small>' + App.fmt.ampm(next.time) + (App.sameDay(next.time, now) ? '' : ' · ' + App.t('Tomorrow')) + '</small></div>' +
      '  <div class="pr-hero-foot"><span class="serif"><i>' + App.esc(App.hijri()) + '</i></span><span class="pr-hero-arh" lang="ar" dir="rtl">' + App.esc(App.hijriAr()) + '</span></div>' +
      '</div>' : '';
    var rows = day.list.map(function (p) {
      var isNext = next && next.name === p.name && App.sameDay(next.time, now);
      var isNow = cur && cur.name === p.name;
      var cls = 'pr-row' + (isNext ? ' is-next' : '') + (isNow ? ' is-now' : '') + (p.time <= now && !isNow ? ' is-past' : '') + (p.prayer ? '' : ' is-sun');
      var on = p.prayer && s.prayers[p.name];
      return '<div class="' + cls + '">' +
        '<span class="pr-row-n"><b>' + p.label + '</b>' + (isNow ? '<em>' + App.t('Now') + '</em>' : '') + '</span>' +
        '<span class="pr-row-ar" lang="ar">' + p.ar + '</span>' +
        '<span class="pr-row-t num">' + App.fmt.time(p.time, false) + '<small>' + App.fmt.ampm(p.time) + '</small></span>' +
        (p.prayer ? '<button class="pr-bell' + (on ? ' is-on' : '') + '" data-bell="' + p.name + '" aria-label="' + App.esc(App.t('Athan for {prayer}', { prayer: p.label })) + '">' + App.icon(on ? 'volume' : 'mute', 26) + '</button>' : '<span class="pr-bell pr-bell--none"></span>') +
        '</div>';
    }).join('');
    var loc = D.config ? D.config.location : {};
    V.el.innerHTML = '<div class="pr"><div class="pr-left">' + App.backBtn() + hero + '</div>' +
      '<div class="pr-side">' +
      '  <div class="pr-list">' + rows + '</div>' +
      '  <div class="pr-controls">' +
      '    <div class="seg">' + VOL.map(function (v) { return '<button data-vol="' + v[0] + '" class="' + (nearest(s.volume) === v[0] ? 'is-on' : '') + '">' + App.t(v[1]) + '</button>'; }).join('') + '</div>' +
      '    <button class="btn btn--ghost' + (s.muted ? ' is-muted' : '') + '" data-mute>' + App.icon(s.muted ? 'mute' : 'volume', 22) + App.t(s.muted ? 'Muted' : 'Sound on') + '</button>' +
      '    <button class="btn btn--solid" data-test>' + App.icon('play', 20) + App.t('Test athan') + '</button>' +
      '  </div>' +
      '  <div class="pr-meta label">' + App.esc([loc.name, loc.region].filter(Boolean).join(', ')) + ' · ' + App.esc(D.prayerMethod || '') + '</div>' +
      '</div></div>';
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-bell]'))) {
      var s = App.athanSettings(), prayers = s.prayers;
      prayers[t.dataset.bell] = !prayers[t.dataset.bell];
      setOwn({ prayers: prayers });
      App.toast(App.t(prayers[t.dataset.bell] ? 'Athan on for {prayer}' : 'Athan off for {prayer}', { prayer: '<b>' + App.t(t.dataset.bell) + '</b>' }), { icon: prayers[t.dataset.bell] ? 'volume' : 'mute', ms: 2500 });
      return render();
    }
    if ((t = e.target.closest('[data-vol]'))) { setOwn({ volume: +t.dataset.vol }); if (audio) audio.volume = +t.dataset.vol; return render(); }
    if ((t = e.target.closest('[data-mute]'))) { var m = !App.athanSettings().muted; setOwn({ muted: m }); if (m) stop(); return render(); }
    if (e.target.closest('[data-test]')) return App.pickTestAthan();
    if (e.target.closest('[data-refresh]')) App.refreshAll();
  }

  App.register('prayer', {
    minutely: true,
    show: function (el) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      render();
    }
  });
  App.on('minute', function () { if (App.current === 'prayer' && V.el) render(); });
})();
