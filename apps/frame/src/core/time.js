// Time: a clock that can be moved for testing, date arithmetic, and formatting that follows the
// language and 12/24-hour setting. Digits stay Latin so they match the condensed number font.

const App = window.App;
let offsetMs = 0;

App.now = () => new Date(Date.now() + offsetMs);
// Pretend it's hh:mm today (test drawer). null goes back to the real time.
App.setTime = (h, m) => {
  if (h == null) offsetMs = 0;
  else {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    offsetMs = d - Date.now();
  }
  App.emit('time');
  App.rerender();
};

App.dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
App.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
App.sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
App.isNight = () => { const h = App.now().getHours(); return h >= 22 || h < 6; };

const pad2 = (n) => String(n).padStart(2, '0');
const use24 = () => App.setting?.('clock') === '24';

// Day and month names in the current language, cached per locale.
let names = null;
function localNames() {
  const locale = App.locale ? App.locale() : 'en';
  if (names?.locale !== locale) {
    const list = (opts, make, n) => Array.from({ length: n }, (_, i) => new Intl.DateTimeFormat(locale, opts).format(make(i)));
    const day = (i) => new Date(2023, 0, 1 + i); // 1 Jan 2023 was a Sunday
    const month = (i) => new Date(2023, i, 1);
    names = {
      locale,
      days: list({ weekday: 'long' }, day, 7), daysShort: list({ weekday: 'short' }, day, 7),
      months: list({ month: 'long' }, month, 12), monthsShort: list({ month: 'short' }, month, 12),
    };
  }
  return names;
}

App.fmt = {
  // "4:05 PM" · time(d, false) → "4:05" · 24-hour: "16:05"
  time(d, withAmPm) {
    const h = d.getHours(), m = pad2(d.getMinutes());
    if (use24()) return `${pad2(h)}:${m}`;
    const t = `${h % 12 || 12}:${m}`;
    return withAmPm === false ? t : `${t} ${App.fmt.ampm(d)}`;
  },
  // "4 PM", "3:45 PM" · 24-hour: "16:00"
  hour(d) {
    const h = d.getHours(), m = d.getMinutes();
    if (use24()) return `${pad2(h)}:${pad2(m)}`;
    return `${h % 12 || 12}${m ? ':' + pad2(m) : ''} ${App.fmt.ampm(d)}`;
  },
  ampm: (d) => (use24() ? '' : App.t(d.getHours() >= 12 ? 'PM' : 'AM')),
  // "10:45 – 11:30 AM" (AM/PM shown once when both ends share it)
  range(a, b) {
    const shared = App.fmt.ampm(a) === App.fmt.ampm(b);
    return `${shared ? App.fmt.time(a, false) : App.fmt.time(a)} – ${App.fmt.time(b)}`;
  },
  day: (d) => localNames().days[d.getDay()],
  dayShort: (d) => localNames().daysShort[d.getDay()],
  month: (d) => localNames().months[d.getMonth()],
  monthShort: (d) => localNames().monthsShort[d.getMonth()],
  // 45 → "45 min", 135 → "2 hr 15 min"
  mins(total) {
    const m = Math.max(0, Math.round(total));
    if (m < 60) return App.t('{n} min', { n: m });
    const h = Math.floor(m / 60), rest = m % 60;
    return App.t('{n} hr', { n: h }) + (rest ? ' ' + App.t('{n} min', { n: rest }) : '');
  },
  // "Today", "Tomorrow", "Yesterday" or the weekday
  rel(d) {
    const diff = Math.round((App.dayStart(d) - App.dayStart(App.now())) / 864e5);
    if (diff === 0) return App.t('Today');
    if (diff === 1) return App.t('Tomorrow');
    if (diff === -1) return App.t('Yesterday');
    return App.fmt.day(d);
  },
};

// Hour label for compact strips: "Now", "3p", "11a" (or "15").
App.hourLabel = (h, isNow) => {
  if (isNow) return App.t('Now');
  if (use24()) return pad2(h);
  return (h % 12 || 12) + App.t(h >= 12 ? 'p' : 'a');
};
