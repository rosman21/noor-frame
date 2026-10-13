// Today: everything the family needs at a glance, on one screen that never scrolls.
//
//   ┌ clock ─────────┬ weather + next 7 hours ──────┬ next prayer ┐
//   ├ next up (hero) ──────────────────┬ ayah of the day ────────┤
//   ├ today's calendar, one column     ├ today's prayers         ┤
//   │ per person, down to the bottom   ├ next days (tap a day)   ┤
//   └──────────────────────────────────┴─────────────────────────┘

const App = window.App, D = window.DATA;
let root = null; // the view's element once built

const part = (sel) => root.querySelector(sel);

// ------------------------------------------------------------ top row
function clockHtml() {
  const now = App.now();
  return `<div class="h-time num">${App.fmt.time(now, false)}<span class="h-ampm">${App.fmt.ampm(now)}</span></div>
    <div class="h-date"><b>${App.fmt.day(now)}</b> ${App.fmt.month(now)} ${now.getDate()}</div>`;
}

function weatherHtml() {
  const w = App.weatherNow();
  if (!w) return `<div class="label">${App.t('Weather')}</div><div class="h-wx-say"><i>${App.t('Waiting for the forecast…')}</i></div>`;
  const hours = App.hourly(7);
  const temps = hours.map((h) => h.t);
  const low = Math.min(...temps), high = Math.max(...temps);
  // Icons ride up to 8px with the temperature, a tiny chart of the afternoon.
  const rise = (t) => (high === low ? 0 : Math.round(((t - low) / (high - low)) * 8));
  return `<div class="h-wx-top">
      <span class="h-wx-icon">${App.icon(w.cond, 60)}</span>
      <span class="h-wx-temp num">${w.temp}°</span>
      <span class="h-wx-meta"><b>${w.label}</b><span>H ${w.hi}°  L ${w.lo}°</span></span>
    </div>
    <div class="h-wx-say"><b>${w.summary}.</b> ${w.advice}.</div>
    <div class="h-wx-hours">${hours.map((h) => `<div class="h-hr${h.p >= 50 ? ' is-wet' : ''}">
      <span class="h-hr-l">${h.label}</span>
      <span class="h-hr-i" style="transform:translateY(${-rise(h.t)}px)">${App.icon(h.c, 22)}</span>
      <b>${h.t}°</b></div>`).join('')}</div>`;
}

// ------------------------------------------------------------ next up
function heroHtml() {
  const now = App.now();
  const e = App.nextEvent();
  if (!e) {
    const first = App.timedOn(App.addDays(now, 1))[0];
    if (!first) {
      return `<div class="h-hero h-hero--empty" data-go="calendar">
        <div class="label label--light">${App.t('Rest of today')}</div>
        <div class="h-hero-title serif">${App.t('Nothing else scheduled.')}<br><i>${App.t('Enjoy the quiet.')}</i></div>
      </div>`;
    }
    // Nothing left today: say so briefly, and give tomorrow's first event room for its whole name.
    const where = first.loc ? ' · ' + App.esc(first.loc.split(/[,\n]/)[0]) : '';
    return `<div class="h-hero h-hero--empty h-hero--tomorrow" data-go="calendar">
      <div class="label label--light">${App.t('Rest of today')}</div>
      <div class="h-hero-title serif">${App.t('Nothing else scheduled.')}</div>
      <div class="h-tmrw">
        <div class="label label--light">${App.t('Tomorrow')} · ${App.fmt.time(first.start)}${where}</div>
        <div class="h-tmrw-title">${App.esc(first.title)}</div>
      </div>
    </div>`;
  }
  const minsAway = (e.start - now) / 60000;
  const minsToLeave = (App.leaveBy(e) - now) / 60000;
  const who = App.isFamily(e) ? App.t('Everyone') : e.people.map((id) => App.person(id).name).join(' + ');

  // Under 100 minutes: a countdown. Later: the start time.
  const big = minsAway < 100
    ? `<div class="h-hero-count num">${Math.round(minsAway)}<small>${App.t('min')}</small></div>`
    : `<div class="h-hero-count num">${App.fmt.time(e.start, false)}<small>${App.fmt.ampm(e.start)}</small></div>`;

  let leave = '';
  if (e.travel) {
    leave = minsToLeave <= 0
      ? `<span class="pill pill--alert"><i class="pulse"></i>${App.t('Leave now')}</span>`
      : `<span class="pill${minsToLeave <= 15 ? ' pill--soon' : ''}">${App.icon('car', 20)}${App.t('Leave in {t}', { t: App.fmt.mins(minsToLeave) })}</span>`;
  }
  const trip = e.travel ? ' · ' + App.t(e.trip?.mode === 'walking' ? '{n} min walk' : '{n} min drive', { n: e.travel }) : '';
  const place = e.loc ? ' · ' + App.esc(e.loc.split(',')[0]) : '';

  return `<button class="h-hero" style="${App.pstyle(App.evColor(e))}" data-ev="${e.id}">
    <div class="h-hero-main">
      <div class="label label--on">${App.t('Next up')} · ${App.esc(who)}</div>
      <div class="h-hero-title serif">${App.esc(e.title)}</div>
      <div class="h-hero-meta">${App.fmt.range(e.start, e.end)}${place}${trip}</div>
      <div class="h-hero-foot">${e.people.length > 1 ? App.dots(e.people, 22) : ''}${leave}</div>
    </div>${big}</button>`;
}

// ------------------------------------------------------------ today's calendar
function lanesHtml() {
  if (!D.people.length) {
    // Calendars are added from a phone: this opens the QR code, like Settings → Add calendar.
    return `<button class="h-setup serif" data-addcal><b>+ ${App.t('Add calendar')}</b><br><i>${App.t('and your day shows up here.')}</i></button>`;
  }
  const now = App.now();
  return D.people.map((p) => {
    // Everything left today; fitLanes() hides what doesn't fit and counts it in "+N more".
    const left = App.timedOn(now, p.id).filter((e) => e.end > now);
    const items = left.length
      ? left.map((e) => {
        const started = e.start <= now;
        return `<button class="h-ev${started ? ' is-now' : ''}" data-ev="${e.id}">
          <span class="h-ev-t">${started ? App.t('Now') : App.fmt.time(e.start, false)}</span>
          <span class="h-ev-n">${App.esc(e.title)}</span></button>`;
      }).join('')
      : `<div class="h-free serif">${App.t('{free} the rest of the day', { free: `<i>${App.t('Free')}</i>` })}</div>`;
    return `<div class="h-lane" style="${App.pstyle(p)}">
      <div class="h-lane-head">${App.avatar(p, 30)}<b>${p.name}</b></div>
      ${items}
      <button class="h-more is-hidden" data-go="calendar"></button>
    </div>`;
  }).join('');
}

// Hide events from the bottom of each column until it fits, and say how many are hidden.
function fitLanes() {
  if (!root) return;
  for (const lane of App.$$('.h-lane', root)) {
    const events = App.$$('.h-ev', lane), more = lane.querySelector('.h-more');
    for (const e of events) e.classList.remove('is-hidden');
    more.classList.add('is-hidden');
    const overflowing = () => lane.scrollHeight > lane.clientHeight + 1;
    let hidden = 0;
    for (let i = events.length - 1; i > 0 && overflowing(); i--) {
      events[i].classList.add('is-hidden');
      hidden++;
      more.textContent = App.t('+{n} more', { n: hidden });
      more.classList.remove('is-hidden');
    }
  }
}

// ------------------------------------------------------------ next days
function forecastHtml() {
  const W = D.weather;
  const title = `<div class="label">${App.t('Next days')}</div>`;
  if (!W?.days) return title;
  const today = App.dayStart(App.now());
  const days = W.days.filter((d) => d.date >= today).slice(1, 6);
  return title + `<div class="h-fc">${days.map((d) => `<button class="h-fc-d${d.p >= 50 ? ' is-wet' : ''}" data-wxday="${App.ymd(d.date)}">
      <span class="h-hr-l">${App.fmt.dayShort(d.date)}</span>${App.icon(d.c, 30)}
      <b class="num">${d.hi}°</b><small class="num">${d.lo}°</small></button>`).join('')}</div>`;
}

// ------------------------------------------------------------ ayah of the day
function ayahHtml() {
  const a = D.ayah;
  if (!a) {
    return `<div class="label label--light">${App.t('Ayah of the day')}</div>
      <div class="ay-body"><p class="ay-tr serif"><i>${App.t('Connect to Wi-Fi to load today’s ayah.')}</i></p></div>`;
  }
  const play = a.audio
    ? `<button class="ay-play${App.reciting ? ' is-on' : ''}" data-recite aria-label="${App.t(App.reciting ? 'Stop recitation' : 'Play recitation')}">${App.icon(App.reciting ? 'pause' : 'play', 22)}</button>`
    : '';
  return `<div class="ay-head"><span class="label label--light">${App.icon('book', 18)}${App.t('Ayah of the day')}</span><b class="ay-ref">${App.esc(App.ayahRef(a))}</b>${play}</div>
    <div class="ay-body">
      <p class="ay-ar" lang="ar" dir="rtl">${App.esc(a.arabic)}</p>
      <p class="ay-tr serif">“${App.esc(a.translation)}”</p>
    </div>`;
}

// Ayat vary a lot in length: shrink the text (via --k) until it fits the tile.
function fitAyah() {
  const body = root?.querySelector('.ay-body');
  if (!body) return;
  let k = 1;
  body.style.setProperty('--k', k);
  while (body.scrollHeight > body.clientHeight + 1 && k > 0.5) {
    k -= 0.05;
    body.style.setProperty('--k', k.toFixed(2));
  }
}

function paintAyah() {
  part('.h-ayah').innerHTML = ayahHtml();
  fitAyah();
}

App.ayahSheet = () => {
  const a = D.ayah;
  if (!a) return;
  const credit = App.t('{name} translation', { name: App.esc(a.translator) }) + (a.reciter ? ' · ' + App.t('Recited by {name}', { name: App.esc(a.reciter) }) : '');
  App.sheet(`<div class="ays">
      <div class="label label--light">${App.esc(a.surahName)} · ${App.esc(a.surahMeaning)} · ${a.surah}:${a.ayah}</div>
      <p class="ays-ar" lang="ar" dir="rtl">${App.esc(a.arabic)}</p>
      <p class="ays-tr serif">“${App.esc(a.translation)}”</p>
      <div class="ays-foot"><span class="label label--light">${credit}</span>
        ${a.audio ? `<button class="btn ays-play" data-recite>${App.icon(App.reciting ? 'pause' : 'play', 20)}${App.t(App.reciting ? 'Stop' : 'Listen')}</button>` : ''}</div>
    </div>`, {
    cls: 'sheet--ayah',
    onMount(sheet) {
      sheet.addEventListener('click', (e) => { if (e.target.closest('[data-recite]')) App.recite(a); });
    },
  });
};

// Keep the tile's and the sheet's play buttons in step with playback.
App.on('recite', (playing) => {
  if (root?.firstChild) paintAyah();
  for (const b of App.$$('.ays-play')) b.innerHTML = App.icon(playing ? 'pause' : 'play', 20) + App.t(playing ? 'Stop' : 'Listen');
});

// ------------------------------------------------------------ one day's weather (sheet)
const SLOT_HOURS = [6, 9, 12, 15, 18, 21]; // every 3 hours, 6 AM – 9 PM

function slotLabel(h) {
  if (App.setting('clock') === '24') return String(h).padStart(2, '0') + ':00';
  return `${h % 12 || 12} ${App.fmt.ampm(new Date(2000, 0, 1, h))}`;
}

function daySheetHtml(days, i) {
  const W = D.weather, d = days[i], now = App.now();
  const offset = Math.round((d.date - App.dayStart(now)) / 864e5) * 24; // hourly index of this day's midnight
  const slots = SLOT_HOURS
    .filter((h) => W.t[offset + h] != null)
    .map((h) => ({ h, t: W.t[offset + h], c: W.c[offset + h], p: W.p[offset + h] || 0, past: i === 0 && h + 3 <= now.getHours() }));
  const name = i === 0 ? App.t('Today') : i === 1 ? App.t('Tomorrow') : App.fmt.day(d.date);
  const rain = d.p >= 20 ? ' · ' + App.t('{n}% rain', { n: d.p }) : '';

  const grid = slots.length
    ? `<div class="wxs-grid">${slots.map((s) => `<div class="wxs-s${s.past ? ' is-past' : ''}${s.p >= 40 ? ' is-wet' : ''}">
        <span class="wxs-h">${slotLabel(s.h)}</span>${App.icon(s.c, 46)}
        <b class="num">${s.t}°</b>
        <span class="wxs-p">${App.icon('drop', 18)}${s.p}%</span></div>`).join('')}</div>`
    : `<p class="sheet-p">${App.t('Hourly forecast isn’t available for this day yet.')}</p>`;

  return `<div class="wxs">
    <div class="wxs-head">
      <button class="icon-btn" data-wxnav="-1"${i === 0 ? ' disabled' : ''} aria-label="Previous day">${App.icon('left', 26)}</button>
      <div class="wxs-title"><div class="label">${App.fmt.month(d.date)} ${d.date.getDate()}</div><h2 class="serif">${App.esc(name)}</h2></div>
      <button class="icon-btn" data-wxnav="1"${i === days.length - 1 ? ' disabled' : ''} aria-label="Next day">${App.icon('right', 26)}</button>
      <div class="wxs-sum">${App.icon(d.c, 44)}<span><b class="num">${d.hi}°</b> <small class="num">${d.lo}°</small></span>
        <em>${App.esc(App.wxLabel(d.c))}${rain}</em></div>
    </div>
    ${grid}
  </div>`;
}

App.weatherSheet = (ymd) => {
  const W = D.weather;
  if (!W?.days) return;
  const today = App.dayStart(App.now());
  const days = W.days.filter((d) => d.date >= today);
  let i = Math.max(0, days.findIndex((d) => App.ymd(d.date) === ymd));
  App.sheet(daySheetHtml(days, i), {
    cls: 'sheet--wide sheet--wx',
    onMount(sheet) {
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-wxnav]');
        if (!b || b.disabled) return;
        i = Math.min(days.length - 1, Math.max(0, i + Number(b.dataset.wxnav)));
        sheet.querySelector('.wxs').outerHTML = daySheetHtml(days, i);
      });
    },
  });
};

// ------------------------------------------------------------ the view
function paintAll() {
  part('.h-clock').innerHTML = clockHtml();
  part('.h-weather').innerHTML = weatherHtml();
  part('.h-prayer').innerHTML = App.prayerNextBlock();
  part('.h-hero-slot').innerHTML = heroHtml();
  part('.h-lanes').innerHTML = lanesHtml();
  fitLanes();
  part('.h-prayers').innerHTML = App.prayerStrip();
  part('.h-forecast').innerHTML = forecastHtml();
  paintAyah();
}

function onTap(e) {
  const t = e.target;
  if (t.closest('[data-recite]')) return App.recite(D.ayah);
  if (t.closest('[data-addcal]')) return App.addCalendar();
  if (t.closest('[data-ayah]')) return App.ayahSheet();
  const wx = t.closest('[data-wxday]');
  if (wx) return App.weatherSheet(wx.dataset.wxday === 'today' ? App.ymd(App.now()) : wx.dataset.wxday);
  const ev = t.closest('[data-ev]');
  if (ev) return App.eventSheet(App.findEvent(ev.dataset.ev));
  const go = t.closest('[data-go]');
  if (go) App.go(go.dataset.go);
}

function build(el) {
  root = el;
  el.innerHTML = `<div class="home">
    <div class="h-clock" data-go="calendar"></div>
    <div class="h-weather" data-wxday="today" role="button"></div>
    <button class="h-prayer" data-go="prayer"></button>
    <div class="h-main"><div class="h-hero-slot"></div><div class="h-lanes"></div></div>
    <div class="h-side">
      <div class="h-ayah" data-ayah role="button"></div>
      <button class="h-prayers card" data-go="prayer"></button>
      <div class="h-forecast card"></div>
    </div>
  </div>`;
  el.addEventListener('click', onTap);
}

App.register('home', {
  show(el) {
    if (!el.firstChild) build(el);
    paintAll();
  },
  resume() { fitAyah(); fitLanes(); },
});

// Every minute: the cheap parts (clock, countdowns, prayer). Weather and the lanes on the hour.
App.on('minute', (now) => {
  if (!root?.firstChild) return;
  part('.h-clock').innerHTML = clockHtml();
  part('.h-hero-slot').innerHTML = heroHtml();
  part('.h-prayer').innerHTML = App.prayerNextBlock();
  part('.h-prayers').innerHTML = App.prayerStrip();
  if (now.getMinutes() === 0) {
    part('.h-weather').innerHTML = weatherHtml();
    part('.h-lanes').innerHTML = lanesHtml();
    fitLanes();
  }
});

// The Quran font arrives after the first paint and changes line breaks: measure again.
document.fonts?.ready.then(() => { fitAyah(); fitLanes(); });
document.fonts?.addEventListener?.('loadingdone', () => { fitAyah(); fitLanes(); });
