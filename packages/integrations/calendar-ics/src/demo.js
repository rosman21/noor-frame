// Demo calendars for testing without real ones: set a calendar's url to "demo:family",
// "demo:me", "demo:kid" or "demo:spouse". Events are generated around today and the current
// time (in the configured location's time zone), so there is always something coming up, some
// with real Toronto addresses for travel times.

// Wall-clock time in `tz` -> UTC Date.
function zoned(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asIfUtc - guess));
}

function stamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function dateOnly(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function esc(s) { return String(s).replace(/([,;\\])/g, '\\$1'); }

export function demoIcs(which, tz) {
  const now = new Date();
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  const nowParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(now);
  const nowH = +nowParts.find((p) => p.type === 'hour').value, nowM = +nowParts.find((p) => p.type === 'minute').value;

  const out = [];
  // Event on day offset `day` at "HH:MM" for `mins` minutes.
  function at(uid, title, day, hm, mins, loc, extra = '') {
    const [h, m] = hm.split(':').map(Number);
    const s = zoned(y, mo, d + day, h, m, tz);
    out.push({ uid, title, s, e: new Date(+s + mins * 60e3), loc, extra });
  }
  // Event starting `inMins` from now (rounded to 5 minutes), so travel countdowns are visible.
  function soon(uid, title, inMins, mins, loc) {
    const total = Math.ceil((nowH * 60 + nowM + inMins) / 5) * 5;
    const s = zoned(y, mo, d, Math.floor(total / 60), total % 60, tz);
    out.push({ uid, title, s, e: new Date(+s + mins * 60e3), loc });
  }
  function allDay(uid, title, day, days) {
    out.push({ uid, title, allDay: true, s: new Date(Date.UTC(y, mo - 1, d + day)), e: new Date(Date.UTC(y, mo - 1, d + day + days)) });
  }

  if (which === 'family') {
    allDay('f-garbage', 'Garbage + recycling night', 0, 1);
    at('f-dinner', 'Dinner at Nana’s', 0, '18:30', 90, '100 City Centre Dr, Mississauga, ON');
    at('f-picnic', 'Picnic in High Park', 2, '11:00', 180, 'High Park, 1873 Bloor St W, Toronto, ON');
    allDay('f-trip', 'Weekend in Niagara', 5, 2);
    at('f-eid', 'Community iftar', 8, '19:00', 120, 'Islamic Institute of Toronto, 1630 Neilson Rd, Scarborough, ON');
  }
  if (which === 'me') {
    soon('m-costco', 'Costco run', 35, 45, 'Costco, 100 Billy Bishop Way, North York, ON');
    soon('m-dentist', 'Dentist', 150, 45, 'Toronto General Hospital, 200 Elizabeth St, Toronto, ON');
    at('m-gym', 'Gym', -14, '07:00', 45, 'GoodLife Fitness, 100 King St W, Toronto, ON', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    at('m-jumuah', 'Jumuʿah', -14, '13:15', 60, 'Jami Mosque, 56 Boustead Ave, Toronto, ON', 'RRULE:FREQ=WEEKLY;BYDAY=FR');
    at('m-standup', 'Team standup', 1, '09:30', 30, 'Zoom');
    at('m-lunch', 'Lunch with Omar', 1, '12:30', 60, 'St. Lawrence Market, 93 Front St E, Toronto, ON');
    at('m-oil', 'Oil change', 3, '08:00', 60, 'Canadian Tire, 839 Yonge St, Toronto, ON');
  }
  if (which === 'kid') {
    soon('k-soccer', 'Soccer practice', 210, 90, 'Christie Pits Park, 750 Bloor St W, Toronto, ON');
    at('k-quran', 'Quran class', -14, '10:00', 90, 'Islamic Institute of Toronto, 1630 Neilson Rd, Scarborough, ON', 'RRULE:FREQ=WEEKLY;BYDAY=SA,SU');
    at('k-swim', 'Swimming', 1, '16:00', 60, 'Regent Park Aquatic Centre, 640 Dundas St E, Toronto, ON');
    at('k-trip', 'Science Centre field trip', 2, '09:00', 300, 'Ontario Science Centre, 770 Don Mills Rd, North York, ON');
    allDay('k-pj', 'Pajama day at school', 1, 1);
  }
  if (which === 'spouse') {
    soon('s-book', 'Book club', 120, 90, 'Toronto Reference Library, 789 Yonge St, Toronto, ON');
    at('s-doctor', 'Doctor appointment', 1, '10:30', 45, 'Mount Sinai Hospital, 600 University Ave, Toronto, ON');
    at('s-halaqa', 'Sisters’ halaqa', -14, '20:30', 60, 'Jami Mosque, 56 Boustead Ave, Toronto, ON', 'RRULE:FREQ=WEEKLY;BYDAY=TU,SU');
    at('s-call', 'Call with Mum', 2, '17:00', 30, 'FaceTime');
  }

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//noor-frame//demo//EN'];
  for (const ev of out) {
    lines.push('BEGIN:VEVENT', `UID:${ev.uid}@demo`, `SUMMARY:${esc(ev.title)}`);
    if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${dateOnly(ev.s)}`, `DTEND;VALUE=DATE:${dateOnly(ev.e)}`);
    else lines.push(`DTSTART:${stamp(ev.s)}`, `DTEND:${stamp(ev.e)}`);
    if (ev.loc) lines.push(`LOCATION:${esc(ev.loc)}`);
    if (ev.extra) lines.push(ev.extra);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
