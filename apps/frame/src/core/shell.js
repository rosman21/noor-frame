// The running dashboard: screen modes, going idle, the clock tick, and start-up.
//
// Modes: 'day' (normal), 'ambient' (green idle screen), 'night' (dim red clock),
// 'nightdash' (the dashboard tinted red, after tapping the night clock).

const App = window.App;

App.setMode = (mode) => {
  App.mode = mode;
  App.$('#stage').dataset.mode = mode;
  App.emit('mode', mode);
};

// ------------------------------------------------------------ idle
// After a minute without a touch: back to Today. After Settings → Idle screen (minutes, 0 = never):
// the ambient screen, or the night clock late at night. `fast` (test drawer) shortens both.
App.idle = { home: 60, fast: false };
let idleSec = 0;
App.resetIdle = () => { idleSec = 0; };

function idleTick() {
  idleSec++;
  if (App.mode === 'nightdash' && idleSec >= 20) { App.setMode('night'); return; }
  if (App.mode !== 'day' || App.$('#takeover').classList.contains('is-open')) return;
  const toHome = App.idle.fast ? 8 : App.idle.home;
  const toIdle = App.idle.fast ? 15 : Number(App.setting('idle')) * 60;
  if (idleSec === 20) App.closeShade?.();
  if (idleSec === toHome && App.current !== 'home') { App.closeSheet(); App.go('home'); }
  if (toIdle > 0 && idleSec >= toIdle) {
    App.closeSheet();
    App.go('home');
    App.setMode(App.isNight() ? 'night' : 'ambient');
  }
}

// ------------------------------------------------------------ clock
let lastMinute = -1;
function tick() {
  const now = App.now();
  App.emit('second', now);
  if (now.getMinutes() !== lastMinute) {
    lastMinute = now.getMinutes();
    App.emit('minute', now);
  }
  idleTick();
}
// Moving the test clock or changing the clock format should repaint minute displays at once.
App.on('time', () => { lastMinute = -1; });
App.on('settings', () => { lastMinute = -1; });

// ------------------------------------------------------------ start
App.start = () => {
  // Icons in the static markup: <i data-icon="home" data-size="26"></i>
  for (const el of App.$$('[data-icon]')) el.outerHTML = App.icon(el.dataset.icon, Number(el.dataset.size) || 24);
  App.emit('boot'); // live.js restores saved data here, before the first paint
  App.fit(); // device.js: 1280×800, wider on 16:9 screens, scaled to fit
  addEventListener('resize', App.fit);
  document.addEventListener('pointerdown', App.resetIdle, true);
  addEventListener('hashchange', () => App.go(location.hash.slice(1)));
  App.go(location.hash.slice(1) || 'home');
  tick();
  setInterval(tick, 1000);
  App.emit('ready');
  App.rebuildHiddenSoon(1500);
};
document.addEventListener('DOMContentLoaded', App.start);
