// The two resting screens.
//  - Ambient (idle in the day): deep green, a big clock, weather, the next prayer and event,
//    and today's ayah. Tap to wake to Today.
//  - Night (idle late at night): a dim red clock that won't light up the room. Tap for the
//    dashboard tinted red (nightdash), which falls back to the clock after 20 s (shell.js).

const App = window.App, D = window.DATA;
let driftTimer = null;

function ambientHtml() {
  const now = App.now(), w = App.weatherNow(), prayer = App.nextPrayer(), next = App.nextEvent(), a = D.ayah;
  const right = [
    w && `<div class="amb-wx">${App.icon(w.cond, 44)}<span class="num">${w.temp}°</span><small>${App.esc(w.summary)}</small></div>`,
    prayer && `<div class="amb-pr">${App.icon('moonstar', 24)}<b>${App.esc(prayer.label)}</b> ${App.fmt.time(prayer.time)} <small>${App.prayerUntil(prayer.time)}</small></div>`,
    next && `<div class="amb-next" style="${App.pstyle(App.evColor(next))}"><i></i>${App.esc(next.title)} · ${App.fmt.time(next.start)}</div>`,
  ].filter(Boolean).join('');
  const ayah = a
    ? `<div class="amb-ayah"><p class="amb-ar" lang="ar" dir="rtl">${App.esc(a.arabic)}</p>
        <p class="amb-tr">“${App.esc(a.translation)}” <span>${App.esc(App.ayahRef(a))}</span></p></div>`
    : '';
  return `<div class="amb-top">
      <div class="amb-clock">
        <div class="amb-time num">${App.fmt.time(now, false)}<small>${App.fmt.ampm(now)}</small></div>
        <div class="amb-date">${App.fmt.day(now)}, ${App.fmt.month(now)} ${now.getDate()}<i>${App.esc(App.hijri())}</i></div>
      </div>
      <div class="amb-right">${right}</div>
    </div>${ayah}`;
}

function nightHtml() {
  const now = App.now(), w = App.weatherNow(), prayer = App.nextPrayer();
  // Before 6 AM, "tomorrow" is really later today.
  const morning = App.addDays(now, now.getHours() < 6 ? 0 : 1);
  const first = App.timedOn(morning)[0];
  const firstUp = first
    ? App.t('First up {day}: {title} {time}', { day: App.fmt.rel(first.start), title: `<b>${App.esc(first.title)}</b>`, time: App.fmt.time(first.start) })
    : App.t('Nothing early tomorrow');
  return `<div class="nt-time num">${App.fmt.time(now, false)}</div>
    <div class="nt-line">${w ? `${App.icon(w.cond, 26)} ${w.temp}° · ` : ''}${firstUp}</div>
    ${prayer ? `<div class="nt-lock">${App.icon('moonstar', 20)} ${App.esc(prayer.label)} ${App.fmt.time(prayer.time)} · ${App.prayerUntil(prayer.time)}</div>` : ''}`;
}

function paint() {
  if (App.mode === 'ambient') App.$('#ambient .amb-info').innerHTML = ambientHtml();
  if (App.mode === 'night') App.$('#night .nt-inner').innerHTML = nightHtml();
}

// Move the content a few pixels each minute, so nothing sits in one place for hours
// (cheap panels keep a ghost of static images).
function drift() {
  const dx = Math.round(Math.random() * 8 - 4), dy = Math.round(Math.random() * 8 - 4);
  for (const el of App.$$('.amb-info, .nt-inner')) el.style.transform = `translate(${dx}px, ${dy}px)`;
}

App.on('ready', () => {
  const ambient = App.$('#ambient'), night = App.$('#night');
  ambient.innerHTML = '<div class="amb-glow"></div><div class="amb-info"></div>';
  night.innerHTML = '<div class="nt-inner"></div>';
  ambient.addEventListener('click', () => { App.setMode('day'); App.go('home'); });
  night.addEventListener('click', () => App.setMode('nightdash'));
});

App.on('mode', (mode) => {
  clearInterval(driftTimer);
  if (mode === 'ambient' || mode === 'night') {
    paint();
    driftTimer = setInterval(drift, 60000);
  }
  App.resetIdle();
});
App.on('minute', paint);
App.on('data', paint);
App.on('settings', paint);
