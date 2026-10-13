// Pull-out shade: the section menu, clock and connection status live in a panel that slides
// in from the top edge (or the bottom, per the Menu setting), like a phone's notification shade,
// so every view gets the full width. Drag from the edge strip (or tap it) to open; drag it back,
// tap outside or pick a section to close. The left/right docks are plain CSS (see base.css).
(function () {
  'use strict';
  var $ = App.$;
  var shade, panel, scrim;
  var open = false, drag = null;

  // The stage is scaled on desktop previews; convert screen pixels to stage pixels.
  function scale() { return $('#stage').getBoundingClientRect().width / (App.stageWidth || 1280) || 1; }
  function height() { return panel.offsetHeight + 30; } // + shadow, so it fully clears the edge
  // +1 when it comes down from the top, -1 when it comes up from the bottom.
  function dir() { return App.setting('nav') === 'bottom' ? -1 : 1; }

  // p = 0 (closed) … 1 (open)
  function setProgress(p) {
    var y = p <= 1 ? (p - 1) * height() : Math.log(1 + (p - 1) * 4) * 14; // rubber band past fully open
    panel.style.transform = 'translateY(' + y * dir() + 'px)';
    scrim.style.opacity = Math.max(0, Math.min(1, p));
  }

  function settle(toOpen) {
    open = toOpen;
    shade.classList.add('is-settling');
    shade.classList.toggle('is-open', toOpen);
    setProgress(toOpen ? 1 : 0);
    clearTimeout(settle.t);
    settle.t = setTimeout(function () { shade.classList.remove('is-settling'); }, 280);
    if (toOpen) paint();
  }
  function docked() { var n = App.setting('nav'); return n === 'left' || n === 'right'; }
  App.openShade = function () { if (!docked()) settle(true); };
  App.closeShade = function () { if (open || drag) { drag = null; shade.classList.remove('is-dragging'); settle(false); } };

  // One drag handler for both directions: from the top strip (closed) and on the panel (open).
  function down(e) {
    if (e.button !== 0) return;
    drag = { y0: e.clientY, from: open ? 1 : 0, p: open ? 1 : 0, moved: false, t: e.timeStamp, v: 0, lastY: e.clientY, lastT: e.timeStamp, el: e.currentTarget };
    if (!open) paint();
    shade.classList.remove('is-settling');
    shade.classList.add('is-dragging');
  }
  function move(e) {
    if (!drag) return;
    var dy = (e.clientY - drag.y0) / scale() * dir();
    if (!drag.moved && Math.abs(dy) < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      // Only now take the pointer, so plain taps on tiles and buttons still click normally.
      try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }
    var dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.v = (e.clientY - drag.lastY) / scale() / dt * dir(); // stage px per ms, + = opening
    drag.lastY = e.clientY; drag.lastT = e.timeStamp;
    drag.p = Math.max(0, drag.from + dy / height());
    setProgress(drag.p);
  }
  function up(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    shade.classList.remove('is-dragging');
    if (!d.moved) {
      // A tap: on the top strip it opens, on the dimmed page it closes. Taps inside the panel are clicks.
      if (d.el.id === 'shadeGrab') settle(true);
      else if (e.target === scrim) settle(false);
      return;
    }
    d.el.dataset.dragged = '1'; // swallow the click that follows a drag
    setTimeout(function () { delete d.el.dataset.dragged; }, 0);
    // A flick decides; otherwise wherever it was let go.
    if (Math.abs(d.v) > 0.45) settle(d.v > 0);
    else settle(d.p > 0.4);
  }
  function cancel() { if (drag) { drag = null; shade.classList.remove('is-dragging'); settle(open); } }

  // ------------------------------------------------------------ content
  function paint() {
    var n = App.now(), w = App.weatherNow && App.weatherNow(), pr = App.nextPrayer && App.nextPrayer();
    $('#shadeClock').innerHTML = '<b>' + App.fmt.time(n, false) + '</b><span>' + App.fmt.ampm(n) + '</span>';
    $('#shadeInfo').innerHTML =
      '<div class="sh-date">' + App.fmt.day(n) + ', ' + App.fmt.month(n) + ' ' + n.getDate() + (App.hijri ? '<i>' + App.esc(App.hijri()) + '</i>' : '') + '</div>' +
      '<div class="sh-row">' +
      (w ? '<span>' + App.icon(w.cond, 28) + '<b class="num">' + w.temp + '°</b> <small>' + App.esc(w.summary) + '</small></span>' : '') +
      (pr ? '<span>' + App.icon('moonstar', 24) + '<b>' + App.esc(pr.label) + '</b> ' + App.fmt.time(pr.time) + ' <small>' + App.prayerUntil(pr.time) + '</small></span>' : '') +
      (App.brief && App.brief() ? '<button class="sh-brief" data-brief>' + App.icon('sun', 22) + App.t('Today’s brief') + '</button>' : '') +
      '</div>';
  }
  function paintIfOpen() { if (open) paint(); }

  // ------------------------------------------------------------ quick light / dark toggle
  // Sun | moon next to the connection button. Tapping one fixes the theme (Settings → Theme
  // can put it back on Automatic); the label says which mode is in charge.
  function paintTheme() {
    var dark = document.documentElement.dataset.theme === 'dark', set = App.setting('theme');
    var label = App.t(set === 'auto' ? 'Automatic' : dark ? 'Dark' : 'Light');
    ['#shadeTheme', '#dockTheme'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      var size = sel === '#dockTheme' ? 20 : 26;
      el.innerHTML = '<div class="theme-tog-row">' +
        '<button class="' + (dark ? '' : 'is-on') + '" data-theme-set="light" aria-label="' + App.esc(App.t('Light')) + '">' + App.icon('sun', size) + '</button>' +
        '<button class="' + (dark ? 'is-on' : '') + '" data-theme-set="dark" aria-label="' + App.esc(App.t('Dark')) + '">' + App.icon('moon', size) + '</button>' +
        '</div><span>' + label + '</span>';
    });
  }
  function onThemeTap(e) {
    var b = e.target.closest('[data-theme-set]');
    if (b && !panel.dataset.dragged) App.setSetting('theme', b.dataset.themeSet);
  }

  // Back to Today, for the pages you reach from the shade (hidden by CSS when a dock is showing).
  App.backBtn = function () {
    return '<button class="back-btn" data-home aria-label="' + App.esc(App.t('Back to Today')) + '">' + App.icon('left', 24) + '<span>' + App.t('Back') + '</span></button>';
  };

  App.on('ready', function () {
    $('#stage').addEventListener('click', function (e) { if (e.target.closest('[data-home]')) App.go('home'); });
    shade = $('#shade'); panel = $('#shadePanel'); scrim = $('#shadeScrim');
    setProgress(0);
    [$('#shadeGrab'), panel, scrim].forEach(function (el) {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', cancel);
    });
    panel.addEventListener('click', function (e) {
      if (panel.dataset.dragged) { e.stopPropagation(); e.preventDefault(); return; }
      if (e.target.closest('[data-brief]')) { settle(false); App.briefSheet(); return; }
      var b = e.target.closest('[data-go]');
      if (b) { App.go(b.dataset.go); settle(false); }
    }, true);
    App.hold($('#shadeClock'), 700, { done: function () { settle(false); App.openDemo(); } });
    $('#shadeTheme').addEventListener('click', onThemeTap);
    $('#dockTheme').addEventListener('click', onThemeTap);
    paintTheme();
    $('#shadeNet').addEventListener('click', function () { if (!panel.dataset.dragged) App.netSheet(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') App.closeShade();
      if (e.key === 'm' && e.target.tagName !== 'INPUT') (open ? App.closeShade : App.openShade)();
    });
  });
  App.on('mode', function (m) { if (m !== 'day') App.closeShade(); });
  App.on('minute', function () { paintIfOpen(); paintTheme(); });
  App.on('data', paintIfOpen);
  App.on('settings', function (s) {
    // Switching where the menu lives: start closed and re-park the panel at its new edge.
    paintTheme();
    if (s && s.key === 'nav') { open = false; shade.classList.remove('is-open', 'is-settling'); setProgress(0); return; }
    paintIfOpen();
  });
})();
