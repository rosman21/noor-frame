// Where this dashboard is running, and what that device can do.
//
//  - 'android': the noor-frame kiosk app. It adds window.Frame before the page loads.
//  - 'pi':      Chromium on a Raspberry Pi, through the local kiosk helper (apps/kiosk-pi), which
//               serves the dashboard at http://localhost:8788/?kiosk=pi and the bridge at /kiosk/*.
//  - 'browser': anything else: a laptop, tablet, phone or TV browser.
//
// Every device offers the same window.Frame shape, so the rest of the dashboard never asks which:
//   Frame.openWifiSettings()   show the device's Wi-Fi setup
//   Frame.screen(on)           turn the display on or off (night)
//   Frame.volume()             the device's media volume as JSON {"level", "max"} (Android)
//   Frame.setVolume(level)     set it (the frame has no volume buttons)
// A plain browser has none of these, and the dashboard leaves those controls out.
//
// TV mode (no touch screen, or ?tv in the address): the menu becomes a dock, and the arrow keys,
// Enter and Back of a remote move around the screen with a large focus ring.

const App = window.App;
const params = new URLSearchParams(location.search);

if (params.get('kiosk') === 'pi' && !window.Frame) {
  const call = (path, body) => fetch('/kiosk/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  }).catch(() => { /* helper restarting */ });
  // Sound: the helper reads the volume over HTTP, so keep the last answer for Settings → Sound.
  let vol = null;
  const readVolume = () => fetch('/kiosk/volume', { cache: 'no-store' }).then((r) => r.json())
    .then((v) => { const had = !!vol; vol = v && v.max ? v : null; if (!had && vol) App.emit('device'); })
    .catch(() => { /* helper restarting */ });
  readVolume();
  window.Frame = {
    platform: 'pi',
    // A touch screen chooses Wi-Fi on the screen with Noor's keyboard (the same page as the
    // Android frames). A TV has only a remote, so it uses a phone: the helper's page explains
    // that and can start the setup network.
    openWifiSettings: () => {
      location.href = matchMedia('(any-pointer: coarse)').matches ? '/kiosk/setup?reason=settings' : '/kiosk/wifi';
    },
    screen: (on) => call('screen', { on: !!on }),
    volume: () => (vol ? JSON.stringify(vol) : 'null'),
    setVolume: (level) => { if (vol) vol.level = level; call('volume', { level }).then(readVolume); },
  };
  // When the Pi starts its Wi-Fi setup network (it lost the home Wi-Fi), show the setup steps.
  setInterval(() => {
    fetch('/kiosk/status', { cache: 'no-store' }).then((r) => r.json())
      .then((s) => { if (s.hotspot || s.joining) location.href = '/kiosk/connecting'; })
      .catch(() => { /* helper restarting */ });
  }, 15000);
}

App.platform = window.Frame ? (window.Frame.platform || 'android') : 'browser';
App.can = {
  wifi: !!window.Frame?.openWifiSettings,
  screen: !!window.Frame?.screen,
  volume: !!window.Frame?.setVolume,
};

// ------------------------------------------------------------ device volume
App.volume = () => {
  try { return JSON.parse(window.Frame.volume()); } catch { return null; }
};
// Set the device volume and play a short tone, so the new level can be heard.
let toneCtx;
App.setVolume = (level) => {
  window.Frame.setVolume(level);
  if (!level) return;
  try {
    toneCtx = toneCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = toneCtx.createOscillator(), g = toneCtx.createGain(), t = toneCtx.currentTime;
    o.type = 'sine';
    o.frequency.value = 659.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(toneCtx.destination);
    o.start(t); o.stop(t + 0.65);
  } catch { /* no audio at all */ }
};

// ------------------------------------------------------------ TV mode
const noTouch = !matchMedia('(any-pointer: coarse)').matches && !(navigator.maxTouchPoints > 0) && !('ontouchstart' in window);
App.tv = params.has('tv') ? params.get('tv') !== '0' : noTouch && App.platform === 'browser';
document.documentElement.classList.toggle('tv', App.tv);

// ------------------------------------------------------------ wide screens
// The layout is drawn on a 1280×800 stage (the photo frame's 16:10). Wider screens, such as a
// 16:9 TV, get a wider stage (up to 1422×800) instead of black bars; the layout's grids stretch.
App.fit = () => {
  const stage = App.$('#stage');
  const w = Math.round(Math.max(1280, Math.min(1422, 800 * innerWidth / innerHeight)));
  if (stage.offsetWidth !== w) {
    stage.style.width = w + 'px';
    stage.style.marginLeft = -w / 2 + 'px';
    App.stageWidth = w;
    App.emit('resize');
  }
  const s = Math.min(innerWidth / w, innerHeight / 800);
  stage.style.transform = Math.abs(s - 1) < 0.01 ? '' : `scale(${s})`;
};
App.stageWidth = 1280;

// ------------------------------------------------------------ the screen at night
// Settings → At night: keep the dim night clock, or turn the display off (devices that can).
// The athan and any touch bring it back.
let screenOn = true;
function setScreen(on) {
  if (!App.can.screen || on === screenOn) return;
  screenOn = on;
  window.Frame.screen(on);
}
App.on('mode', (mode) => setScreen(!(mode === 'night' && App.setting('nightScreen') === 'off')));
App.on('settings', () => setScreen(!(App.mode === 'night' && App.setting('nightScreen') === 'off')));

// ------------------------------------------------------------ sound
// Browsers keep a page silent until someone has touched it. On a TV or laptop, ask once at the
// start, so the athan isn't silently blocked hours later. The kiosk apps allow sound already.
function askForSound() {
  if (App.platform !== 'browser') return;
  let ctx;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  const blocked = ctx.state === 'suspended';
  ctx.close?.();
  if (!blocked) return;
  const close = App.banner({
    tone: 'ink', icon: 'volume', title: App.t('Tap to allow the athan sound'),
    sub: App.t('This browser blocks sound until the screen is touched once.'),
    action: App.t('Allow sound'), dismiss: App.t('Not now'),
    onAction: () => App.toast(App.t('Sound is on'), { icon: 'volume', ms: 2500 }),
  });
  // Any other tap or key also counts, so the banner goes with it.
  const done = () => {
    const had = App.$('#banners').contains(document.activeElement);
    close();
    if (had) refocus();
    removeEventListener('pointerdown', done, true); removeEventListener('keydown', done, true); };
  addEventListener('pointerdown', done, true);
  addEventListener('keydown', done, true);
  if (App.tv) setTimeout(() => App.$('#banners .banner-btn--solid')?.focus(), 50);
}

// ------------------------------------------------------------ remote control (arrow keys)
// Anything that can be pressed. Some cards are plain elements with a click handler, so they are
// listed too and made focusable as they get focus.
const PRESSABLE = 'button, a[href], input, select, textarea, [tabindex], [data-ev], [data-addcal], [data-wxday], [data-ayah], [data-brief], [data-home], [data-i], .h-weather';

// The layer that has the remote's attention: an open sheet, the test drawer, a takeover, the
// menu, or the dashboard.
function layer() {
  const $ = App.$;
  if ($('#sheetLayer').classList.contains('is-open')) return $('#sheetLayer .sheet');
  if ($('#demo').classList.contains('is-open')) return $('#demo');
  if ($('#takeover').classList.contains('is-open')) return $('#takeover');
  if ($('#shade').classList.contains('is-open')) return $('#shadePanel');
  return $('#stage');
}

function visible(el) {
  if (el.disabled || el.closest('[hidden], .is-hidden')) return false;
  const view = el.closest('.view');
  if (view && !view.classList.contains('is-active')) return false;
  if (el.closest('.shade') && !App.$('#shade').classList.contains('is-open')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = App.$('#stage').getBoundingClientRect();
  return r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom &&
    getComputedStyle(el).visibility !== 'hidden';
}

function candidates(root) {
  const all = [...root.querySelectorAll(PRESSABLE)].filter(visible);
  // A card that is pressable as a whole stays one stop; its inner bits don't need their own.
  return all.filter((el) => !all.some((o) => o !== el && o.contains(el) && !el.matches('button, a[href], input, select')));
}

function focusEl(el) {
  if (!el.matches('button, a[href], input, select, textarea') && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: false });
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

// The nearest element in the arrow's direction, preferring ones in line with the current one.
function move(dir) {
  const root = layer(), list = candidates(root);
  if (!list.length) return;
  const cur = document.activeElement;
  if (!cur || cur === document.body || !root.contains(cur) || !visible(cur)) { focusEl(list[0]); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let main, cross;
    if (dir === 'ArrowRight') { main = b.left - a.right; cross = by - ay; if (bx <= ax) continue; }
    else if (dir === 'ArrowLeft') { main = a.left - b.right; cross = by - ay; if (bx >= ax) continue; }
    else if (dir === 'ArrowDown') { main = b.top - a.bottom; cross = bx - ax; if (by <= ay) continue; }
    else { main = a.top - b.bottom; cross = bx - ax; if (by >= ay) continue; }
    const score = Math.max(main, 0) + Math.abs(cross) * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) focusEl(best);
}

const BACK = ['Escape', 'Backspace', 'BrowserBack', 'GoBack'];

function onKey(e) {
  App.resetIdle();
  if (e.target.matches?.('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  // The idle and night screens wake on any key, like a tap.
  if (App.mode === 'ambient' || App.mode === 'night') {
    e.preventDefault();
    e.stopImmediatePropagation();
    App.$(App.mode === 'ambient' ? '#ambient' : '#night').click();
    return;
  }
  if (e.key.startsWith('Arrow')) { e.preventDefault(); move(e.key); return; }
  if (e.key === 'Enter') {
    const el = document.activeElement;
    // Buttons and links press themselves; focusable cards need a click.
    if (el && el !== document.body && !el.matches('button, a[href], input, select, textarea')) { e.preventDefault(); el.click(); }
    return;
  }
  if (BACK.includes(e.key)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const $ = App.$;
    if ($('#sheetLayer').classList.contains('is-open')) App.closeSheet();
    else if ($('#demo').classList.contains('is-open')) $('#demo [data-demo-close]')?.click();
    else if ($('#takeover').classList.contains('is-open')) $('#takeover [data-close], #takeover [data-stop]')?.click();
    else if ($('#shade').classList.contains('is-open')) App.closeShade();
    else if (App.current !== 'home') App.go('home');
    return;
  }
  if (e.key === 'ContextMenu' || e.key.toLowerCase() === 'm') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const docked = ['left', 'right'].includes(App.setting('nav'));
    if (docked) focusEl(App.$(`#dock [data-go="${App.current}"]`) || App.$('#dock [data-go]'));
    else if (App.$('#shade').classList.contains('is-open')) App.closeShade();
    else { App.openShade(); setTimeout(() => focusEl(App.$(`#shadeNav [data-go="${App.current}"]`)), 300); }
  }
}

// After a sheet opens or a view changes, put the focus somewhere sensible in it.
function refocus() {
  if (!App.tv) return;
  setTimeout(() => {
    const root = layer(), cur = document.activeElement;
    if (cur && cur !== document.body && root.contains(cur) && visible(cur)) return;
    const list = candidates(root);
    const first = root.id === 'stage' ? list.find((el) => !el.closest('#dock, .back-btn')) : list.find((el) => !el.matches('.sheet-x')) || list[0];
    if (first) focusEl(first);
  }, 60);
}

// Switching screens with the dock or the number keys: the ring follows to the new screen's item.
const go = App.go;
App.go = (name, opts) => {
  go(name, opts);
  const cur = document.activeElement;
  if (App.tv && cur?.matches?.('.dock-item, .shade-tile') && cur.dataset.go !== App.current) {
    cur.parentElement.querySelector(`[data-go="${App.current}"]`)?.focus();
  }
};

App.on('ready', () => {
  addEventListener('keydown', onKey, true);
  new MutationObserver(refocus).observe(App.$('#sheetLayer'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(refocus).observe(App.$('#takeover'), { attributes: true, attributeFilter: ['class'] });
  addEventListener('hashchange', refocus);
  setTimeout(askForSound, 1500);
});
