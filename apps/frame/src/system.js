// The frame's own chrome: banners, closing full-screen takeovers, the connection status (dock,
// menu and its detail sheet), the side dock, the hidden test drawer, and keyboard shortcuts.

const App = window.App, $ = App.$;

// ------------------------------------------------------------ takeovers (e.g. the athan)
App.closeTakeover = () => {
  const el = $('#takeover');
  el.classList.remove('is-open');
  el.replaceChildren();
};

// ------------------------------------------------------------ banners
// App.banner({ title, sub, icon = 'bell', tone = 'amber' | 'ink', action, onAction, dismiss, ms }) → close()
App.banner = (o) => {
  const el = document.createElement('div');
  el.className = 'banner banner--' + (o.tone || 'amber');
  el.innerHTML = App.icon(o.icon || 'bell', 30) +
    `<div class="banner-text"><b>${o.title}</b><span>${o.sub || ''}</span></div>` +
    (o.action ? `<button class="banner-btn banner-btn--solid" data-act>${o.action}</button>` : '') +
    `<button class="banner-btn" data-x>${o.dismiss || App.t('Dismiss')}</button>`;
  $('#banners').append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  const close = () => el.remove();
  el.querySelector('[data-x]').addEventListener('click', close);
  el.querySelector('[data-act]')?.addEventListener('click', () => { close(); o.onAction(); });
  if (o.ms) setTimeout(close, o.ms);
  return close;
};

// ------------------------------------------------------------ connection status
function ago(t) {
  if (!t) return App.t('never');
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return App.t('just now');
  if (m < 60) return App.t('{n} min ago', { n: m });
  if (m < 1440) return App.t('{n} hr ago', { n: Math.round(m / 60) });
  return App.t('{n} days ago', { n: Math.round(m / 1440) });
}
// "Stale": the browser says online, but nothing has refreshed for 30 minutes.
const isStale = () => Date.now() - (App.net.last.weather || 0) > 30 * 60000;

function paintNet() {
  const off = !App.net.online, warn = off || isStale();
  const icon = off ? 'wifioff' : 'wifi';
  const label = `<span>${App.t(off ? 'Offline' : warn ? 'Stale' : 'Online')}</span>`;
  for (const [sel, cls, size] of [['#shadeNet', 'shade-net', 28], ['#dockNet', 'dock-net', 24]]) {
    const b = $(sel);
    b.className = cls + (warn ? ' is-warn' : '');
    b.innerHTML = App.icon(icon, size) + label;
  }
  // With the menu closed, a small icon by its handle keeps a problem visible.
  const w = $('#shadeWarn');
  w.className = 'shade-warn' + (warn ? ' is-on' : '');
  w.innerHTML = warn ? App.icon(icon, 18) : '';
}

// The frame's clock and the home location's clock disagree (wrong Android time zone).
function timeZoneMismatch() {
  const home = App.state.config?.location?.timezone;
  if (!home) return null;
  try {
    const opts = { hour: 'numeric', minute: 'numeric', day: 'numeric' }, now = new Date();
    if (now.toLocaleString('en-US', { ...opts, timeZone: home }) === now.toLocaleString('en-US', opts)) return null;
    return { frame: Intl.DateTimeFormat().resolvedOptions().timeZone, home };
  } catch { return null; }
}

App.netSheet = () => {
  const N = App.net;
  const sources = [['Prayer times', 'prayer'], ['Calendar', 'calendar'], ['Weather', 'weather'], ['Ayah of the day', 'ayah'], ['Settings', 'config']];
  const tz = timeZoneMismatch();
  const canOpenWifi = !!window.Frame?.openWifiSettings;
  App.sheet(`<div class="sheet-pad net">
    <div class="label">${App.t(N.online ? 'Connected' : 'No connection')}</div>
    <h2 class="serif sheet-h">${N.online ? App.t('Online') : `${App.t('Offline')} · <i>${App.t('showing saved data')}</i>`}</h2>
    <div class="net-list">${sources.map(([label, key]) => {
      const err = N.errors[key];
      return `<div class="net-row${err ? ' is-err' : ''}"><b>${App.t(label)}</b><span>${App.t('Updated {ago}', { ago: ago(N.last[key]) })}</span>${err ? `<em>${App.esc(err)}</em>` : ''}</div>`;
    }).join('')}</div>
    ${tz ? `<p class="net-warn">${App.icon('clock', 22)}<span>${App.t('The frame’s time zone is {frame} but your location uses {home}. Fix it in Android Settings → Date & time, or prayer times will be off.', { frame: `<b>${App.esc(tz.frame)}</b>`, home: `<b>${App.esc(tz.home)}</b>` })}</span></p>` : ''}
    <div class="sheet-actions">
      ${canOpenWifi ? `<button class="btn btn--ghost" data-wifi>${App.icon('wifi', 22)}${App.t('Wi-Fi settings')}</button>` : ''}
      <button class="btn btn--solid" data-sync>${App.icon('undo', 22)}${App.t('Refresh now')}</button>
    </div></div>`, {
    onMount(sheet, close) {
      sheet.addEventListener('click', (e) => {
        if (e.target.closest('[data-wifi]')) { close(); window.Frame.openWifiSettings(); }
        if (e.target.closest('[data-sync]')) {
          close();
          App.toast(App.t('Refreshing…'), { icon: 'wifi', ms: 2000 });
          App.refreshAll().then(() => App.toast(App.t(App.net.online ? 'Up to date' : 'Still offline'), { icon: App.net.online ? 'check' : 'wifioff', ms: 2500 }));
        }
      });
    },
  });
};
App.on('net', paintNet);
App.on('data', paintNet);
App.on('minute', paintNet);

// ------------------------------------------------------------ dock (Settings → Menu: left/right)
function paintDockClock(now = App.now()) {
  $('#dockClock').innerHTML = `<b>${App.fmt.time(now, false)}</b><span>${App.fmt.ampm(now)}</span>`;
}
App.on('minute', paintDockClock);

// ------------------------------------------------------------ test drawer (hold the clock, or press D)
const TEST_TIMES = [['5:50', '5:50 AM'], ['12:55', '12:55 PM'], ['19:45', '7:45 PM'], ['23:40', '11:40 PM']];
function drawerHtml() {
  const grid = (items) => `<div class="demo-grid">${items.join('')}</div>`;
  return `<div class="demo-panel">
    <div class="demo-head"><div><div class="label label--light">Testing</div><h2 class="serif">Controls</h2></div>
      <button class="demo-x" data-demo-close aria-label="Close">${App.icon('x', 28)}</button></div>
    <div class="demo-sec"><div class="label label--light">Pretend time · now ${App.fmt.time(App.now())}</div>
      ${grid(TEST_TIMES.map(([v, l]) => `<button data-time="${v}">${l}</button>`).concat('<button data-time="real">Real time</button>'))}</div>
    <div class="demo-sec"><div class="label label--light">Screens</div>
      ${grid(['<button data-mode="ambient">Idle screen</button>', '<button data-mode="night">Night clock</button>', `<button data-fastidle class="${App.idle.fast ? 'is-on' : ''}">Fast idle${App.idle.fast ? ' ✓' : ''}</button>`])}</div>
    <div class="demo-sec"><div class="label label--light">Athan</div>
      ${grid(['<button data-athan="Dhuhr">Play regular</button>', '<button data-athan="Fajr">Play Fajr</button>', '<button data-athan="stop">Stop</button>'])}</div>
    <p class="demo-note">The athan always follows the real clock. Keyboard: <b>D</b> this drawer · <b>M</b> menu · <b>A</b> idle screen · <b>N</b> night · <b>1–4</b> screens</p>
  </div>`;
}
App.openDemo = () => {
  const el = $('#demo');
  el.innerHTML = drawerHtml();
  el.classList.add('is-open');
};
const closeDemo = () => $('#demo').classList.remove('is-open');

function onDrawerClick(e) {
  const b = e.target.closest('button');
  if (!b) { if (e.target === $('#demo')) closeDemo(); return; }
  const d = b.dataset;
  if ('demoClose' in d) return closeDemo();
  if (d.time) {
    if (d.time === 'real') App.setTime(null);
    else { const [h, m] = d.time.split(':').map(Number); App.setTime(h, m); }
    return App.openDemo();
  }
  if (d.mode) { closeDemo(); return App.setMode(d.mode); }
  if ('fastidle' in d) { App.idle.fast = !App.idle.fast; App.resetIdle(); return App.openDemo(); }
  if (d.athan) {
    closeDemo();
    if (d.athan === 'stop') App.stopAthan();
    else App.testAthan(d.athan);
  }
}

// ------------------------------------------------------------ wiring
App.on('ready', () => {
  $('#demo').addEventListener('click', onDrawerClick);

  const dock = $('#dock');
  // Switch screens the moment a finger lands, not on release. Keyboard "clicks" (detail 0) too.
  dock.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-go]');
    if (b && e.button === 0) App.go(b.dataset.go);
  });
  dock.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b && e.detail === 0) App.go(b.dataset.go);
  });
  App.hold($('#dockClock'), 700, { done: App.openDemo });
  $('#dockNet').addEventListener('click', App.netSheet);
  paintDockClock();
  paintNet();

  const screens = ['home', 'calendar', 'prayer', 'settings'];
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'd') ($('#demo').classList.contains('is-open') ? closeDemo : App.openDemo)();
    else if (k === 'a') App.setMode('ambient');
    else if (k === 'n') App.setMode('night');
    else if (k === 'escape') { closeDemo(); App.closeSheet(); }
    else if (k >= '1' && k <= '4') App.go(screens[+k - 1]);
  });
});
