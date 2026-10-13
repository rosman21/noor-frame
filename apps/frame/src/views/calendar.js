// Calendar screen. Four ways to look at the family's time:
//   Today  – an hour grid with one column (lane) per person; family events span every lane
//   3 Day  – the same hour grid for three days side by side
//   Week   – seven columns of event cards
//   Month  – a month grid with a coloured dot per event
// Tapping an event opens its detail sheet (with a "leave by" card and a QR code for directions
// when it has a place). Swipe sideways on the grid to go back or forward.

import qrcode from 'qrcode-generator';

const App = window.App, D = window.DATA;

// The hour grid runs 6 AM – 11 PM at 72 px per hour.
const HOUR_PX = 72, FIRST_HOUR = 6, LAST_HOUR = 23;
const GRID_PX = (LAST_HOUR - FIRST_HOUR) * HOUR_PX;
const MODES = [['day', 'Today'], ['3day', '3 Day'], ['week', 'Week'], ['month', 'Month']];
const STEP_DAYS = { day: 1, '3day': 3, week: 7 };

const cal = { mode: 'day', date: null, el: null, scrollTop: null };

// ------------------------------------------------------------ geometry
const yOf = (d) => (d.getHours() + d.getMinutes() / 60 - FIRST_HOUR) * HOUR_PX;

// Top and height of an event on `day`, clipped to the visible hours.
function boxOn(e, day) {
  const midnight = App.dayStart(day);
  const from = e.start < midnight ? new Date(+midnight + FIRST_HOUR * 36e5) : e.start;
  const lastVisible = new Date(+midnight + LAST_HOUR * 36e5);
  const to = e.end > lastVisible ? lastVisible : e.end;
  const top = Math.max(0, yOf(from));
  return { top, height: Math.max(24, yOf(to) - top - 3) };
}

// Side-by-side placement for overlapping events. Each run of overlapping events gets columns;
// at most two are shown, and anything beyond the first column of a crowded run collapses into a
// single "+N more" block in the second column.
function packColumns(events) {
  const runs = [];
  let run = null, runEnd = 0;
  for (const e of events) {
    if (!run || +e.start >= runEnd) { run = []; runs.push(run); runEnd = 0; }
    run.push(e);
    runEnd = Math.max(runEnd, +e.end);
  }
  const placed = [];
  for (const group of runs) {
    const colEnds = [];
    const inGroup = group.map((e) => {
      let col = colEnds.findIndex((end) => end <= +e.start);
      if (col < 0) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = +e.end;
      return { e, col };
    });
    if (colEnds.length <= 2) {
      for (const p of inGroup) placed.push({ ...p, cols: colEnds.length });
      continue;
    }
    for (const p of inGroup) if (p.col === 0) placed.push({ ...p, cols: 2 });
    const rest = inGroup.filter((p) => p.col > 0).map((p) => p.e);
    placed.push({
      overflow: rest, col: 1, cols: 2,
      start: new Date(Math.min(...rest.map((e) => +e.start))),
      end: new Date(Math.max(...rest.map((e) => +e.end))),
    });
  }
  return placed;
}

// ------------------------------------------------------------ event blocks
function eventBlock(e, posStyle, { lane = null, color = null, half = false } = {}) {
  const now = App.now(), family = App.isFamily(e);
  const minutes = (e.end - e.start) / 60000;
  const classes = ['ev'];
  if (e.end <= now) classes.push('is-past');
  if (e.start <= now && e.end > now) classes.push('is-now');
  if (minutes < 45) classes.push('is-short');
  if (family) classes.push('is-family');
  if (half) classes.push('is-half');

  // Coloured dots for the other people who share this event.
  let withDots = '';
  if (family) withDots = App.dots(D.ALL, 14);
  else {
    const others = lane ? e.people.filter((id) => id !== lane) : e.people.length > 1 ? e.people : [];
    if (others.length) withDots = App.dots(others, 14);
  }
  // A striped block above the event shows the travel time before it.
  const travel = e.travel ? `<span class="ev-travel" style="height:${(e.travel * HOUR_PX) / 60}px"></span>` : '';
  const leave = e.travel ? ` · <b>${App.icon('car', 16)}${App.t('Leave {time}', { time: App.fmt.time(App.leaveBy(e), false) })}</b>` : '';

  return `<button class="${classes.join(' ')}" data-ev="${App.esc(e.id)}" style="${App.pstyle(color || App.evColor(e))};${posStyle}">${travel}` +
    `<span class="ev-title">${App.esc(e.title)}</span>` +
    `<span class="ev-meta">${App.fmt.range(e.start, e.end)}${leave}</span>` +
    (withDots ? `<span class="ev-with">${withDots}</span>` : '') +
    '</button>';
}

function laneBlocks(events, day, lane = null) {
  return packColumns(events).map((p) => {
    const width = 100 / p.cols, left = p.col * width;
    const horizontal = `left:calc(${left}% + 2px);width:calc(${width}% - 4px)`;
    if (p.overflow) {
      const top = yOf(p.start), height = Math.max(30, yOf(p.end) - top - 3);
      return `<button class="ev ev--more" data-more="${p.overflow.map((e) => e.id).join(',')}" style="top:${top}px;height:${height}px;${horizontal}">` +
        `+${p.overflow.length}<small>${App.t('more')}</small></button>`;
    }
    const box = boxOn(p.e, day);
    return eventBlock(p.e, `top:${box.top}px;height:${box.height}px;${horizontal}`, { lane, half: p.cols > 1 });
  }).join('');
}

function hourLines() {
  let html = '';
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    const label = h === 12 && App.setting('clock') !== '24' ? App.t('Noon') : App.fmt.hour(new Date(2000, 0, 1, h));
    html += `<div class="hr" style="top:${(h - FIRST_HOUR) * HOUR_PX}px"><span>${label}</span></div>`;
  }
  return html;
}

// The red "now" line, if one of `days` is today and it's within the visible hours.
// `column` positions it over one day of the 3-day grid.
function nowLine(days) {
  const now = App.now(), col = days.findIndex((d) => App.sameDay(d, now));
  if (col < 0 || now.getHours() < FIRST_HOUR || now.getHours() >= LAST_HOUR) return '';
  const variant = days.length > 1 ? ` now-line--${col}` : '';
  return `<div class="now-line${variant}" style="top:${yOf(now)}px"><span class="num">${App.fmt.time(now, false)}</span></div>`;
}

const gridShell = (inner) => `<div class="grid-scroll"><div class="grid" style="height:${GRID_PX}px"><div class="hours">${hourLines()}</div>${inner}</div></div>`;

// An all-day bar. `cont` = it started before the first visible day.
function allDayBar(e, gridColumn, extra = '', cont = false, more = false) {
  return `<button class="ad${cont ? ' ad--cont' : ''}" data-ev="${App.esc(e.id)}" style="grid-column:${gridColumn};${App.pstyle(App.evColor(e))}">` +
    (cont ? App.icon('left', 16) : '') + App.esc(e.title) + extra + (more ? App.icon('right', 16) : '') + '</button>';
}

// ------------------------------------------------------------ Today
function renderToday() {
  const day = cal.date, midnight = App.dayStart(day);
  const timed = App.timedOn(day);
  const allDay = App.allDayOn(day);
  const laneIds = D.people.map((p) => p.id);

  let allDayRow = '';
  if (allDay.length) {
    allDayRow = `<div class="allday"><div class="gutter label">${App.t('All day')}</div><div class="allday-grid">` + allDay.map((e) => {
      const col = App.isFamily(e) ? '1 / -1' : `${laneIds.indexOf(e.people[0]) + 1} / span 1`;
      const total = Math.round((e.end - e.start) / 864e5);
      const nth = Math.round((midnight - e.start) / 864e5) + 1;
      const multi = total > 1 ? ` <small>${App.t('Day {n} of {total}', { n: nth, total })}</small>` : '';
      return allDayBar(e, col, multi, e.start < midnight);
    }).join('') + '</div></div>';
  }

  const lanes = D.people.map((p) => {
    const own = App.timedOn(day, p.id).filter((e) => !App.isFamily(e));
    return `<div class="lane" style="${App.pstyle(p)}">${laneBlocks(own, day, p.id)}</div>`;
  }).join('');
  const familyRow = timed.filter(App.isFamily).map((e) => {
    const box = boxOn(e, day);
    return eventBlock(e, `top:${box.top}px;height:${box.height}px;left:2px;right:2px`);
  }).join('');

  const empty = timed.length ? '' : `<div class="cal-empty serif">${App.t('Nothing on the calendar.')}<br><i>${App.t('A rare, quiet day.')}</i></div>`;
  return `<div class="cal-day">${allDayRow}${gridShell(`<div class="lanes">${lanes}<div class="lane-fam">${familyRow}</div>${nowLine([day])}</div>`)}${empty}</div>`;
}

// ------------------------------------------------------------ 3 Day
function renderThreeDay() {
  const days = [0, 1, 2].map((i) => App.addDays(cal.date, i));
  const now = App.now();
  const first = App.dayStart(days[0]), afterLast = App.addDays(first, 3);

  const heads = days.map((d) =>
    `<div class="day-head${App.sameDay(d, now) ? ' is-today' : ''}"><span class="num">${d.getDate()}</span><b>${App.fmt.rel(d)}</b><small>${App.fmt.monthShort(d)}</small></div>`).join('');

  let allDayRow = '';
  const spanning = D.events.filter((e) => e.allDay && e.start < afterLast && e.end > first);
  if (spanning.length) {
    allDayRow = `<div class="allday"><div class="gutter label">${App.t('All day')}</div><div class="allday-grid allday-grid--3">` + spanning.map((e) => {
      const a = Math.max(0, Math.round((e.start - first) / 864e5));
      const b = Math.min(3, Math.round((e.end - first) / 864e5));
      return allDayBar(e, `${a + 1} / ${b + 1}`, '', e.start < first, e.end > afterLast);
    }).join('') + '</div></div>';
  }

  const lanes = days.map((d) => `<div class="lane${App.sameDay(d, now) ? ' is-today' : ''}">${laneBlocks(App.timedOn(d), d)}</div>`).join('');
  return `<div class="cal-day cal-3"><div class="lanes-head"><div class="gutter"></div>${heads}</div>${allDayRow}` +
    gridShell(`<div class="lanes lanes--3">${lanes}</div>${nowLine(days)}`) + '</div>';
}

// ------------------------------------------------------------ Week (rolling 7 days)
const WEEK_ROWS = 7; // cards per column before "+N more"

function renderWeek() {
  const now = App.now();
  const cols = Array.from({ length: 7 }, (_, i) => {
    const d = App.addDays(cal.date, i);
    const allDay = App.allDayOn(d), timed = App.timedOn(d);
    const room = WEEK_ROWS - allDay.length, hidden = timed.length - room;
    const bars = allDay.map((e) => `<button class="wk-ad" data-ev="${App.esc(e.id)}" style="${App.pstyle(App.evColor(e))}">${App.esc(e.title)}</button>`).join('');
    const cards = timed.slice(0, Math.max(0, room)).map((e) =>
      `<button class="wk-ev${e.end <= now ? ' is-past' : ''}" data-ev="${App.esc(e.id)}" style="${App.pstyle(App.evColor(e))}">` +
      `<span class="wk-t">${App.fmt.time(e.start, false)}</span><span class="wk-n">${App.esc(e.title)}</span></button>`).join('');
    return `<div class="wk-col${App.sameDay(d, now) ? ' is-today' : ''}" data-day="${+d}">` +
      `<div class="wk-head"><b>${App.fmt.dayShort(d)}</b><span class="num">${d.getDate()}</span></div>${bars}${cards}` +
      (hidden > 0 ? `<button class="wk-more" data-day="${+d}">${App.t('+{n} more', { n: hidden })}</button>` : '') +
      (!timed.length && !allDay.length ? `<div class="wk-free serif"><i>${App.t('Free')}</i></div>` : '') +
      '</div>';
  });
  return `<div class="week">${cols.join('')}</div>`;
}

// ------------------------------------------------------------ Month (weeks start on Monday)
function renderMonth() {
  const now = App.now();
  const firstOfMonth = new Date(cal.date.getFullYear(), cal.date.getMonth(), 1);
  const gridStart = App.addDays(firstOfMonth, -((firstOfMonth.getDay() + 6) % 7));
  const weekdayNames = [1, 2, 3, 4, 5, 6, 0].map((i) => `<span class="label">${App.fmt.dayShort(new Date(2023, 0, 1 + i))}</span>`).join('');
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = App.addDays(gridStart, i);
    const events = App.allDayOn(d).concat(App.timedOn(d));
    const dots = events.slice(0, 5).map((e) => `<i style="${App.pstyle(App.evColor(e))}"></i>`).join('');
    const cls = ['mo-cell'];
    if (d.getMonth() !== firstOfMonth.getMonth()) cls.push('is-out');
    if (App.sameDay(d, now)) cls.push('is-today');
    return `<button class="${cls.join(' ')}" data-day="${+d}"><span class="num">${d.getDate()}</span>` +
      `<span class="mo-dots">${dots}${events.length > 5 ? `<em>+${events.length - 5}</em>` : ''}</span></button>`;
  }).join('');
  return `<div class="month"><div class="mo-dow">${weekdayNames}</div><div class="mo-grid">${cells}</div></div>`;
}

// ------------------------------------------------------------ header
function heading() {
  const d = cal.date;
  switch (cal.mode) {
    case 'day':
      return { big: `${App.fmt.day(d)} <i>${d.getDate()}</i>`, small: `${App.fmt.month(d)} ${d.getFullYear()} · ${App.fmt.rel(d)}` };
    case '3day': {
      const last = App.addDays(d, 2);
      return { big: `${App.fmt.dayShort(d)} ${d.getDate()} <i>–</i> ${App.fmt.dayShort(last)} ${last.getDate()}`, small: `${App.fmt.month(d)} ${d.getFullYear()}` };
    }
    case 'week': {
      const last = App.addDays(d, 6);
      return { big: `${App.fmt.monthShort(d)} ${d.getDate()} <i>–</i> ${App.fmt.monthShort(last)} ${last.getDate()}`, small: App.t('Next 7 days') };
    }
    default:
      return { big: App.fmt.month(d), small: d.getFullYear() };
  }
}

function header() {
  const { big, small } = heading(), now = App.now();
  const showingToday = cal.mode === 'month' ? cal.date.getMonth() === now.getMonth() && cal.date.getFullYear() === now.getFullYear() : App.sameDay(cal.date, now);
  const modes = MODES.map(([id, label]) => `<button class="${cal.mode === id ? 'is-on' : ''}" data-mode="${id}">${App.t(label)}</button>`).join('');
  return `<header class="cal-head">${App.backBtn()}` +
    `<button class="icon-btn" data-nav="-1" aria-label="${App.esc(App.t('Previous'))}">${App.icon('left', 24)}</button>` +
    `<div class="cal-title"><div class="serif">${big}</div><div class="label">${small}</div></div>` +
    `<button class="icon-btn" data-nav="1" aria-label="${App.esc(App.t('Next'))}">${App.icon('right', 24)}</button>` +
    `<button class="btn btn--ghost${showingToday ? ' is-hidden' : ''}" data-today>${App.t('Today')}</button>` +
    `<div class="seg">${modes}</div></header>`;
}

// ------------------------------------------------------------ drawing and navigation
const RENDER = { day: renderToday, '3day': renderThreeDay, week: renderWeek, month: renderMonth };

function draw() {
  cal.el.innerHTML = `<div class="cal cal--${cal.mode}">${header()}<div class="cal-body">${RENDER[cal.mode]()}</div></div>`;
  const scroller = cal.el.querySelector('.grid-scroll');
  if (scroller) {
    // Open with the current time near the top, or wherever it was last scrolled to.
    scroller.scrollTop = cal.scrollTop ?? Math.max(0, yOf(App.now()) - 170);
    scroller.addEventListener('scroll', () => { cal.scrollTop = scroller.scrollTop; });
  }
}

function jumpTo(date, mode = cal.mode) {
  cal.mode = mode;
  cal.date = mode === 'month' ? new Date(date.getFullYear(), date.getMonth(), 1) : App.dayStart(date);
  cal.scrollTop = null;
  draw();
}

function step(dir) {
  if (cal.mode === 'month') jumpTo(new Date(cal.date.getFullYear(), cal.date.getMonth() + dir, 1));
  else jumpTo(App.addDays(cal.date, dir * STEP_DAYS[cal.mode]));
}

function onTap(e) {
  const hit = (sel) => {
    const el = e.target.closest(sel);
    return el && cal.el.contains(el) ? el : null;
  };
  let el;
  if ((el = hit('[data-ev]'))) return App.eventSheet(App.findEvent(el.dataset.ev));
  if ((el = hit('[data-more]'))) return overlapSheet(el.dataset.more.split(','));
  if ((el = hit('[data-nav]'))) return step(Number(el.dataset.nav));
  if (hit('[data-today]')) return jumpTo(App.now());
  if ((el = hit('[data-mode]'))) return jumpTo(cal.date, el.dataset.mode);
  if ((el = hit('[data-day]'))) return jumpTo(new Date(Number(el.dataset.day)), 'day');
}

// A quick sideways swipe (not on the header) moves back or forward.
function enableSwipe(el) {
  let start = null;
  el.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, quick = Date.now() - start.t < 700;
    start = null;
    if (quick && Math.abs(dx) > 90 && Math.abs(dy) < 60 && !e.target.closest('.cal-head')) step(dx < 0 ? 1 : -1);
  });
}

// ------------------------------------------------------------ event sheet
const TRAVEL_MODES = { driving: ['car', 'drive'], walking: ['walk', 'walk'], bicycling: ['bike', 'ride'], transit: ['bus', 'trip'] };

function qrSvg(text) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// "Leave by 10:21 · Leave in 8 min" with a QR code a phone can scan for turn-by-turn directions.
function tripCard(e) {
  const trip = e.trip, [icon, verb] = TRAVEL_MODES[trip.mode] || TRAVEL_MODES.driving;
  const qr = `<div class="trip-qr">${qrSvg(trip.mapsUrl)}<span>${App.t('Scan for directions')}</span></div>`;
  if (!trip.minutes) {
    return `<div class="trip"><div class="trip-main">${App.icon(icon, 30)}<div><b>${App.t('No travel time')}</b>` +
      `<span>${App.t('Couldn’t find this address on the map.')}</span></div></div>${qr}</div>`;
  }
  const now = App.now(), leaveAt = App.leaveBy(e), minsLeft = (leaveAt - now) / 60000;
  let pill = '';
  if (e.start > now) {
    pill = minsLeft <= 0
      ? `<span class="pill pill--alert"><i class="pulse"></i>${App.t('Leave now')}</span>`
      : `<span class="pill${minsLeft <= 15 ? ' pill--soon' : ''}">${App.t('Leave in {t}', { t: App.fmt.mins(minsLeft) })}</span>`;
  }
  const source = App.t(trip.source === 'google' ? 'Google Maps · live traffic' : 'Estimate · no live traffic');
  return `<div class="trip"><div class="trip-main">${App.icon(icon, 30)}<div>` +
    `<div class="trip-leave"><b>${App.t('Leave by {time}', { time: App.fmt.time(leaveAt) })}</b>${pill}</div>` +
    `<span class="trip-meta"><b class="num">${App.t('{n} min', { n: trip.minutes })}</b> ${App.t(verb)}${trip.km ? ` · ${trip.km} km` : ''}</span>` +
    `<small>${source}</small></div></div>${qr}</div>`;
}

App.eventSheet = (e) => {
  if (!e) return;
  const who = App.isFamily(e) ? D.people : e.people.map(App.person);
  const people = who.map((p) => `<span class="chip" style="${App.pstyle(p)}">${App.avatar(p, 32)}${App.esc(p.name)}</span>`).join('');
  App.sheet(`<div class="evs" style="${App.pstyle(App.evColor(e))}">
    <div class="evs-band">
      <div class="label label--on">${App.fmt.rel(e.start)} · ${App.fmt.month(e.start)} ${e.start.getDate()}</div>
      <h2 class="serif">${App.esc(e.title)}</h2>
      <div class="evs-time num">${e.allDay ? App.t('All day') : App.fmt.range(e.start, e.end)}</div>
    </div>
    <div class="evs-body">
      ${e.trip ? tripCard(e) : ''}
      ${e.loc ? `<div class="evs-row">${App.icon('pin', 28)}<div><b>${App.esc(e.loc)}</b></div></div>` : ''}
      <div class="evs-row">${App.icon('person', 28)}<div class="evs-people">${people}</div></div>
      ${e.notes ? `<div class="evs-notes serif">“${App.esc(e.notes)}”</div>` : ''}
    </div></div>`, { cls: 'sheet--event' });
};

// The events hidden behind a "+N more" block.
function overlapSheet(ids) {
  const list = ids.map(App.findEvent).filter(Boolean);
  const rows = list.map((e) =>
    `<button class="more-row" data-ev="${App.esc(e.id)}" style="${App.pstyle(App.evColor(e))}"><i></i><b>${App.esc(e.title)}</b><span>${App.fmt.range(e.start, e.end)}</span></button>`).join('');
  App.sheet(`<div class="sheet-pad"><div class="label">${App.t('Overlapping')}</div>` +
    `<h2 class="serif sheet-h">${App.t('{n} more events', { n: list.length })}</h2><div class="more-list">${rows}</div></div>`, {
    onMount(sheet) {
      sheet.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-ev]');
        if (row) App.eventSheet(App.findEvent(row.dataset.ev));
      });
    },
  });
}

// ------------------------------------------------------------ registration
App.register('calendar', {
  show(el, opts) {
    if (!cal.el) {
      cal.el = el;
      el.addEventListener('click', onTap);
      enableSwipe(el);
    }
    if (!cal.date) cal.date = App.dayStart(App.now());
    if (!opts.rerender) cal.scrollTop = null;
    draw();
  },
});

// Keep the now-line moving without redrawing the whole screen.
App.on('minute', () => {
  if (App.current !== 'calendar' || !cal.el) return;
  const line = cal.el.querySelector('.now-line');
  if (!line) return;
  const now = App.now();
  line.style.top = yOf(now) + 'px';
  line.querySelector('span').textContent = App.fmt.time(now, false);
});

// The test clock moved: start again from "today".
App.on('time', () => { cal.date = App.dayStart(App.now()); cal.scrollTop = null; });
